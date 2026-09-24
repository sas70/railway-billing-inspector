import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { isMockMode } from "./config";
import type { PlanKind } from "./plan-types";

/**
 * Append-only audit trail of every approved action, one JSON object per line.
 * Stored locally in ./data (or AUDIT_LOG_DIR). Demo mode writes to a separate file.
 */
export type AuditEvent = {
  ts: string;
  planId: string;
  kind: PlanKind;
  /**
   * "started" is written right before a change is sent, then the outcome is appended.
   * A "started" line without an outcome means the process stopped mid-way.
   * "unknown": sent, but Railway's answer was lost (timeout / 5xx).
   */
  outcome: "started" | "success" | "failed" | "skipped" | "unknown";
  accountKey: string;
  account: string;
  workspace?: string;
  projectId: string;
  projectName: string;
  environmentId?: string;
  environment?: string;
  serviceId?: string;
  service?: string;
  targetId: string;
  targetLabel: string;
  statusAtReview?: string;
  message?: string;
  traceIds?: string[];
  approvedWith?: string;
  demo: boolean;
};

export function auditFilePath(): string {
  const dir = process.env.AUDIT_LOG_DIR?.trim() || path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
  return path.join(dir, isMockMode() ? "audit-log.demo.jsonl" : "audit-log.jsonl");
}

export async function appendAudit(events: AuditEvent[]): Promise<void> {
  if (events.length === 0) return;
  const file = auditFilePath();
  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  await fs.appendFile(/*turbopackIgnore: true*/ file, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
}

/** Newest first. */
export async function readAudit(limit = 1000): Promise<AuditEvent[]> {
  let text: string;
  try {
    text = await fs.readFile(/*turbopackIgnore: true*/ auditFilePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const events: AuditEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as AuditEvent);
    } catch {
      // ignore a torn line rather than hiding the whole log
    }
  }
  return events.reverse().slice(0, limit);
}

/**
 * For display: drop each "started" line that has an outcome, and turn a "started"
 * line without one into an explicit "interrupted" row. Input and output are newest-first.
 */
export function collapseAudit(events: AuditEvent[]): (AuditEvent & { interrupted?: boolean })[] {
  const finished = new Set(events.filter((e) => e.outcome !== "started").map((e) => `${e.planId}|${e.targetId}`));
  return events
    .filter((e) => e.outcome !== "started" || !finished.has(`${e.planId}|${e.targetId}`))
    .map((e) => (e.outcome === "started" ? { ...e, interrupted: true } : e));
}

const GRACE_MS = 48 * 60 * 60 * 1000;

export type PendingDeletion = {
  accountKey: string;
  account: string;
  projectId: string;
  projectName: string;
  scheduledAt: string;
  deletesAround: string;
  uncertain: boolean;
};

/**
 * Projects this dashboard scheduled for deletion (or may have: outcome unknown or
 * interrupted) within the 48 h grace window, and hasn't cancelled since.
 */
export function pendingDeletions(events: AuditEvent[], now = Date.now()): PendingDeletion[] {
  const latest = new Map<string, AuditEvent & { interrupted?: boolean }>();
  // newest-first: the first relevant schedule/cancel we see per project wins
  for (const event of collapseAudit(events)) {
    if (event.kind !== "project.scheduleDelete" && event.kind !== "project.cancelDelete") continue;
    const relevant =
      event.kind === "project.scheduleDelete"
        ? event.outcome === "success" || event.outcome === "unknown" || event.interrupted
        : event.outcome === "success";
    if (!relevant) continue;
    const key = `${event.accountKey}|${event.projectId}`;
    if (!latest.has(key)) latest.set(key, event);
  }
  const out: PendingDeletion[] = [];
  for (const event of latest.values()) {
    if (event.kind !== "project.scheduleDelete") continue;
    const scheduled = Date.parse(event.ts);
    if (now - scheduled > GRACE_MS) continue;
    out.push({
      accountKey: event.accountKey,
      account: event.account,
      projectId: event.projectId,
      projectName: event.projectName,
      scheduledAt: event.ts,
      deletesAround: new Date(scheduled + GRACE_MS).toISOString(),
      uncertain: event.outcome !== "success",
    });
  }
  return out;
}
