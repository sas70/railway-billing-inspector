import "server-only";

import { randomUUID } from "node:crypto";

import { appendAudit, type AuditEvent } from "./audit";
import { savedSummaries, type StoredSummary } from "./code/ai-summary";
import { repoKey } from "./code/sources";
import { getAccount, isMockMode, isProtectedProject, workspaceAllowed, type AccountConfig } from "./config";
import type { DescribeExecutionView, DescribePlanItem, DescribePlanView, DescribeScope } from "./describe-types";
import { plural } from "./format";
import type { ExecutionItemResult, PlanFlag } from "./plan-types";
import { UserFacingError } from "./plans";
import { DESCRIPTION_MAX, descriptionFromSummaries, normalizeDescription, sameDescription } from "./project-description";
import { friendlyError, loadAccountViews, loadAllProjects, loadProject, loadWorkspaceProjects, type ProjectSummary } from "./railway/api";
import { clearCache, railwayRequest } from "./railway/client";
import * as D from "./railway/documents";
import { RailwayApiError } from "./railway/errors";
import { isReadOnly } from "./write-mode";

/**
 * Copy saved Claude summaries into Railway project descriptions, through the same path as every
 * other change: review (nothing changes) → one confirm click → each project re-read and re-checked
 * right before it's written → audit log. The text is built here from the saved summaries; nothing
 * the browser sends is written to Railway. The summary files themselves are left as they are.
 */

const PLAN_TTL_MS = 10 * 60_000;
const MAX_PROJECTS = 300;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const ACCOUNT_PATTERN = /^[a-z0-9-]{1,64}$/;
const READ_ONLY = "Read-only mode is on. Enable Write mode in the header to make changes.";

type StoredPlan = { view: DescribePlanView; expiresAtMs: number };

const store = globalThis as typeof globalThis & { __rbiDescribe?: Map<string, StoredPlan> };
const plans = (store.__rbiDescribe ??= new Map<string, StoredPlan>());

function prune() {
  const now = Date.now();
  for (const [id, plan] of plans) if (plan.expiresAtMs < now) plans.delete(id);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isAmbiguous(error: unknown) {
  return error instanceof RailwayApiError && (error.kind === "network" || error.kind === "server");
}

function parseScope(input: unknown): DescribeScope | null {
  if (input == null) return null;
  if (typeof input !== "object") throw new UserFacingError("Invalid request.");
  const raw = input as Record<string, unknown>;
  if (raw.accountKey === undefined && raw.projectId === undefined) return null;
  if (typeof raw.accountKey !== "string" || !ACCOUNT_PATTERN.test(raw.accountKey)) throw new UserFacingError("Unknown account.");
  if (typeof raw.projectId !== "string" || !ID_PATTERN.test(raw.projectId)) throw new UserFacingError("Invalid project.");
  return { accountKey: raw.accountKey, projectId: raw.projectId };
}

type Candidate = { account: AccountConfig; workspaceId: string; workspaceName: string; project: ProjectSummary };

/** The one project asked for, or every project the tokens can see (each workspace once). Fresh reads. */
async function loadCandidates(scope: DescribeScope | null): Promise<{ candidates: Candidate[]; notes: string[] }> {
  if (scope) {
    const account = getAccount(scope.accountKey);
    if (!account) throw new UserFacingError("Unknown account. Check your .env.local tokens.");
    const detail = await loadProject(account, scope.projectId, { fresh: true });
    const workspace = detail.workspace;
    if (!workspace) throw new UserFacingError("Couldn't tell which workspace this project is in.");
    const project = (await loadWorkspaceProjects(account, workspace.id, { fresh: true })).find((p) => p.id === scope.projectId);
    if (!project) throw new UserFacingError("Project not found.");
    return { candidates: [{ account, workspaceId: workspace.id, workspaceName: workspace.name, project }], notes: [] };
  }
  const { projects, notes } = await loadAllProjects(await loadAccountViews(), { fresh: true });
  return {
    candidates: projects.map(({ account, workspace, project }) => ({ account, workspaceId: workspace.id, workspaceName: workspace.name, project })),
    notes,
  };
}

function draftItem(c: Candidate, summaries: Map<string, StoredSummary>): DescribePlanItem {
  const { account, project } = c;
  const sources = project.repos.flatMap((repo) => {
    const s = summaries.get(repoKey(repo))?.summary;
    return s ? [{ repo, name: s.name, summary: s.summary }] : [];
  });
  const { text: after, clipped } = descriptionFromSummaries(sources);
  // Kept exactly as Railway has it (line breaks included) for the review and the audit log;
  // comparisons go through sameDescription(), which ignores spacing.
  const before = project.description ?? "";
  const hasBefore = normalizeDescription(before) !== "";
  const base = {
    key: `${account.key}:${project.id}`,
    accountKey: account.key,
    accountLabel: account.label,
    workspaceName: c.workspaceName,
    projectId: project.id,
    projectName: project.name,
    before,
    after,
    repos: project.repos,
  };
  const skip = (reason: string): DescribePlanItem => ({ ...base, flags: [], willRun: false, skipReason: reason });

  if (isProtectedProject(project)) return skip("Listed in PROTECTED_PROJECTS.");
  if (!workspaceAllowed(account, c.workspaceId)) return skip("Outside this token's workspace.");
  if (project.deletedAt) return skip("Scheduled for deletion.");
  if (!after) return skip("No saved summary for its repo yet. Run Summarize with Claude on the Search page first.");
  if (sameDescription(before, after)) return skip("Already has this description.");

  const flags: PlanFlag[] = [];
  if (hasBefore) flags.push({ tone: "warning", text: "Replaces the current description" });
  if (sources.length < project.repos.length) flags.push({ tone: "info", text: `${sources.length} of ${project.repos.length} repos summarized` });
  if (clipped) flags.push({ tone: "info", text: `Trimmed to ${DESCRIPTION_MAX} characters` });
  return { ...base, flags, willRun: true };
}

/** Re-read Railway and build a reviewable plan. Changes nothing. */
export async function createDescribePlan(input: unknown): Promise<DescribePlanView> {
  prune();
  const scope = parseScope(input);
  if (await isReadOnly()) throw new UserFacingError(READ_ONLY);
  const { candidates, notes } = await loadCandidates(scope);
  const withRepos = candidates.filter((c) => c.project.repos.length > 0);
  if (withRepos.length > MAX_PROJECTS) throw new UserFacingError(`That's more than ${MAX_PROJECTS} projects at once.`);

  const summaries = await savedSummaries(withRepos.flatMap((c) => c.project.repos));
  const items = withRepos
    .map((c) => draftItem(c, summaries))
    .sort((a, b) => Number(b.willRun) - Number(a.willRun) || a.projectName.localeCompare(b.projectName));

  const runnable = items.filter((i) => i.willRun);
  const replacing = runnable.filter((i) => normalizeDescription(i.before) !== "").length;
  const withoutRepo = candidates.length - withRepos.length;

  const impact = [
    `Writes the saved summary of the code into the Railway description of ${plural(runnable.length, "project")}.`,
    replacing === 0
      ? "None of them has a description yet, so nothing is overwritten."
      : `${replacing === 1 ? "1 of them already has a description" : `${replacing} of them already have descriptions`}. The old text is replaced and kept in the audit log.`,
    "Only the description changes: names, services, deployments and billing aren't touched, and your saved summaries stay where they are.",
    `Anything longer than ${DESCRIPTION_MAX} characters is trimmed. Railway doesn't publish a limit; if it rejects one, that project shows as failed and the rest carry on.`,
  ];
  if (!scope && withoutRepo > 0) impact.push(`${plural(withoutRepo, "project")} without a GitHub repo (databases, images) ${withoutRepo === 1 ? "isn't" : "aren't"} listed.`);
  impact.push(...notes);

  const blockedReason =
    items.length === 0
      ? "None of these projects deploys from a GitHub repo, so there's no summary to copy."
      : runnable.length === 0
        ? "Nothing to do — every project was skipped (see reasons)."
        : undefined;

  const expiresAtMs = Date.now() + PLAN_TTL_MS;
  const view: DescribePlanView = {
    id: randomUUID(),
    title: scope ? `Railway description for ${items[0]?.projectName ?? withRepos[0]?.project.name ?? "this project"}` : "Copy summaries into Railway descriptions",
    impact,
    recovery: "Edit or clear the description in Railway (project settings → General). Each project's previous text is in the audit log.",
    items,
    runnableCount: runnable.length,
    blockedReason,
    expiresAt: new Date(expiresAtMs).toISOString(),
    demo: isMockMode(),
  };
  plans.set(view.id, { view, expiresAtMs });
  return view;
}

const previousText = (before: string) =>
  normalizeDescription(before) ? `Previous description: “${before}”` : "No previous description.";

/** Run a reviewed plan once. Every project is re-read first; anything that changed since the review is skipped. */
export async function executeDescribePlan(planId: unknown): Promise<DescribeExecutionView> {
  prune();
  const stored = typeof planId === "string" ? plans.get(planId) : undefined;
  if (!stored) {
    throw new UserFacingError("This review has expired or was already used. Close it and start again so the current state is re-checked.");
  }
  // Single use: claim the plan before the first await, so two requests that arrive together
  // can't both run it.
  plans.delete(planId as string);
  if (Date.now() > stored.expiresAtMs) {
    throw new UserFacingError("This review expired (10 minutes). Start again so the current state is re-checked.");
  }
  if (stored.view.blockedReason) throw new UserFacingError(stored.view.blockedReason);
  if (await isReadOnly()) throw new UserFacingError(READ_ONLY);

  const results: ExecutionItemResult[] = [];
  const runnable = stored.view.items.filter((i) => i.willRun);
  let auditError: string | undefined;
  let halt: string | undefined;

  const event = (item: DescribePlanItem, outcome: AuditEvent["outcome"], extra: Partial<AuditEvent> = {}): AuditEvent => ({
    ts: new Date().toISOString(),
    planId: stored.view.id,
    kind: "project.describe",
    outcome,
    accountKey: item.accountKey,
    account: item.accountLabel,
    workspace: item.workspaceName,
    projectId: item.projectId,
    projectName: item.projectName,
    targetId: item.projectId,
    targetLabel: item.projectName,
    approvedWith: "confirm button",
    demo: stored.view.demo,
    ...extra,
  });
  const skipped = (item: DescribePlanItem, message: string): ExecutionItemResult => ({ targetId: item.projectId, label: item.projectName, outcome: "skipped", message });

  for (const [index, item] of runnable.entries()) {
    if (halt) {
      results.push(skipped(item, halt));
      continue;
    }
    if (auditError) {
      results.push(skipped(item, "Not run: the audit log can't be written."));
      continue;
    }
    if (index > 0) await sleep(150);

    const account = getAccount(item.accountKey);
    if (!account) {
      results.push(skipped(item, "Unknown account."));
      continue;
    }

    let skipReason: string | null = null;
    try {
      const project = await loadProject(account, item.projectId, { fresh: true });
      if (isProtectedProject(project)) skipReason = "It is listed in PROTECTED_PROJECTS.";
      else if (!workspaceAllowed(account, project.workspace?.id)) skipReason = "Outside this token's workspace.";
      else if (project.deletedAt) skipReason = "It is scheduled for deletion.";
      else if (sameDescription(project.description, item.after)) skipReason = "It already has this description.";
      else if (!sameDescription(project.description, item.before)) skipReason = "Its description changed after you reviewed it.";
    } catch (error) {
      skipReason = `Couldn't re-check it: ${friendlyError(error)}`;
    }
    if (skipReason) {
      const result = skipped(item, `Skipped: ${skipReason}`);
      results.push(result);
      await appendAudit([event(item, "skipped", { message: result.message })]).catch((error) => {
        auditError = `The audit log couldn't be written: ${friendlyError(error)}`;
      });
      continue;
    }

    // No audit line, no change. The "started" line already holds the old text.
    try {
      await appendAudit([event(item, "started", { message: previousText(item.before) })]);
    } catch (error) {
      auditError = `The audit log couldn't be written, so nothing further was run: ${friendlyError(error)}`;
      results.push(skipped(item, "Not run: the audit log can't be written."));
      continue;
    }

    let result: ExecutionItemResult;
    try {
      const r = await railwayRequest<{ projectUpdate: { id: string; name: string; description?: string | null } }>(account, D.ProjectUpdate, {
        id: item.projectId,
        input: { description: item.after },
      });
      // Only report success when Railway's answer holds the new text.
      const saved = r.projectUpdate.description ?? null;
      const base = { targetId: item.projectId, label: item.projectName };
      if (sameDescription(saved, item.after)) {
        result = { ...base, outcome: "success", message: `Description set (${item.after.length} characters).` };
      } else if (sameDescription(saved, item.before)) {
        result = { ...base, outcome: "failed", message: "Railway answered but kept the previous description." };
      } else {
        result = {
          ...base,
          outcome: "unknown",
          message: saved ? `Railway saved different text: “${saved}”. Check it in Railway.` : "Railway's answer didn't include the new description. Check it in Railway.",
        };
      }
    } catch (error) {
      const traceIds = error instanceof RailwayApiError && error.traceIds.length ? error.traceIds : undefined;
      if (error instanceof RailwayApiError && error.kind === "rate_limit") {
        halt = "Stopped: Railway's hourly API budget ran out. Wait and review the remaining projects again.";
      }
      result = isAmbiguous(error)
        ? { targetId: item.projectId, label: item.projectName, outcome: "unknown", message: `${friendlyError(error)} Check Railway before trying again.`, traceIds }
        : { targetId: item.projectId, label: item.projectName, outcome: "failed", message: friendlyError(error), traceIds };
    }
    results.push(result);
    try {
      await appendAudit([event(item, result.outcome, { message: `${result.message ?? ""} ${previousText(item.before)}`.trim(), traceIds: result.traceIds })]);
    } catch (error) {
      auditError = `The change ran, but its outcome couldn't be written to the audit log: ${friendlyError(error)}`;
    }
  }

  for (const key of new Set(runnable.map((i) => i.accountKey))) clearCache(key);

  const count = (outcome: ExecutionItemResult["outcome"]) => results.filter((r) => r.outcome === outcome).length;
  return {
    planId: stored.view.id,
    title: stored.view.title,
    results,
    succeeded: count("success"),
    failed: count("failed"),
    skipped: count("skipped"),
    unknown: count("unknown"),
    auditWritten: !auditError,
    auditError,
  };
}
