import type { Metadata } from "next";
import path from "node:path";
import { connection } from "next/server";

import { ActionButton } from "@/components/ActionReview";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/Icon";
import { Badge, Card, CardHeader, EmptyState, PageTitle } from "@/components/ui";
import { auditFilePath, collapseAudit, pendingDeletions, readAudit } from "@/lib/audit";
import { isMockMode } from "@/lib/config";
import { isReadOnly } from "@/lib/write-mode";
import { dateTime, relative } from "@/lib/format";
import type { PlanKind } from "@/lib/plan-types";

export const metadata: Metadata = { title: "Audit log" };

const KIND_LABEL: Record<PlanKind, string> = {
  "deployment.remove": "Remove deployment",
  "deployment.restart": "Restart deployment",
  "deployment.redeploy": "Redeploy",
  "deployment.rollback": "Roll back",
  "deployment.cancel": "Cancel build",
  "service.delete": "Delete service",
  "environment.delete": "Delete environment",
  "project.scheduleDelete": "Schedule project deletion",
  "project.cancelDelete": "Cancel project deletion",
};

const OUTCOME_STYLE = {
  success: { icon: "check", color: "var(--status-good)", label: "success" },
  failed: { icon: "x", color: "var(--status-critical)", label: "failed" },
  skipped: { icon: "circle", color: "var(--ink-muted)", label: "skipped" },
  unknown: { icon: "alert", color: "var(--status-warning)", label: "unknown — check Railway" },
  started: { icon: "alert", color: "var(--status-warning)", label: "interrupted — outcome unknown" },
} as const;

export default async function AuditPage() {
  await connection();
  const raw = await readAudit(2000);
  const pending = pendingDeletions(raw);
  const events = collapseAudit(raw).slice(0, 1000);
  const readOnly = await isReadOnly();
  const file = path.relative(/*turbopackIgnore: true*/ process.cwd(), auditFilePath()) || auditFilePath();

  return (
    <div className="space-y-6">
      <PageTitle
        title="Audit log"
        subtitle={
          <>
            Every approved action, newest first — who approved what, on which target, and what Railway answered. Stored locally in{" "}
            <span className="font-mono">{file}</span>
            {isMockMode() ? " (demo mode keeps its own file)" : ""}.
          </>
        }
        actions={
          <a href="/audit/export" className={buttonClass("neutral", "md")}>
            <Icon name="download" size={14} /> Export CSV
          </a>
        }
      />

      {pending.length > 0 && (
        <Card>
          <CardHeader title="Projects scheduled for deletion" subtitle="Railway deletes them 48 hours after scheduling. Cancel here to keep one." />
          <ul className="divide-y divide-[var(--border)]">
            {pending.map((p) => (
              <li key={`${p.accountKey}-${p.projectId}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{p.projectName}</div>
                  <div className="text-xs text-ink-2">
                    {p.uncertain ? "may have been scheduled (outcome unknown)" : "scheduled"} {relative(p.scheduledAt)} · deleted around{" "}
                    {dateTime(p.deletesAround)} · {p.account}
                  </div>
                </div>
                <ActionButton
                  label="Cancel deletion"
                  icon="rotate"
                  tone="primary"
                  size="md"
                  disabled={readOnly}
                  disabledReason="Read-only mode is on"
                  request={{ accountKey: p.accountKey, kind: "project.cancelDelete", projectId: p.projectId, targetIds: [p.projectId] }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        {events.length === 0 ? (
          <EmptyState>No actions yet. Anything you approve from a review dialog is recorded here.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-2">
                  <th scope="col" className="px-4 py-2 font-medium">When</th>
                  <th scope="col" className="px-2 py-2 font-medium">Action</th>
                  <th scope="col" className="px-2 py-2 font-medium">Target</th>
                  <th scope="col" className="px-2 py-2 font-medium">Where</th>
                  <th scope="col" className="px-2 py-2 font-medium">Result</th>
                  <th scope="col" className="px-4 py-2 font-medium">Approved with</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.planId}-${e.targetId}-${i}`} className="border-b border-line align-top last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-2 text-xs" title={e.ts}>
                      <div>{dateTime(e.ts)}</div>
                      <div className="text-ink-2">{relative(e.ts)}</div>
                    </td>
                    <td className="px-2 py-2">
                      {KIND_LABEL[e.kind] ?? e.kind}
                      {e.demo && (
                        <span className="ml-1">
                          <Badge>demo</Badge>
                        </span>
                      )}
                    </td>
                    <td className="max-w-[18rem] px-2 py-2">
                      <div className="break-words">{e.targetLabel}</div>
                      {e.statusAtReview && <div className="text-xs text-ink-2">was {e.statusAtReview.toLowerCase()} at review</div>}
                    </td>
                    <td className="px-2 py-2 text-xs text-ink-2">
                      {[e.account, e.workspace, e.projectName, e.environment, e.service].filter(Boolean).join(" › ")}
                    </td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Icon name={OUTCOME_STYLE[e.outcome].icon} size={12} color={OUTCOME_STYLE[e.outcome].color} />
                        {OUTCOME_STYLE[e.outcome].label}
                      </span>
                      {e.message && <div className="max-w-[18rem] text-xs text-ink-2 break-words">{e.message}</div>}
                      {e.traceIds?.length ? <div className="text-xs text-ink-2">trace {e.traceIds.join(", ")}</div> : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{e.approvedWith ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
