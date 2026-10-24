import "server-only";

import { randomUUID } from "node:crypto";

import { appendAudit, type AuditEvent } from "./audit";
import { savedSummaries } from "./code/ai-summary";
import { repoKey } from "./code/sources";
import { getAccount, isMockMode, isProtectedProject, workspaceAllowed } from "./config";
import { plural } from "./format";
import { cleanProjectName, MAX_RENAMES, NAME_MAX, suggestName, uniqueSuggestions } from "./name-suggest";
import type { ExecutionItemResult, PlanFlag } from "./plan-types";
import { UserFacingError } from "./plans";
import { isGeneratedRailwayName, projectNameHints } from "./project-name";
import { friendlyError, loadAccountViews, loadAllProjects, loadProject, type AccountView, type WorkspaceProject } from "./railway/api";
import { clearCache, railwayRequest } from "./railway/client";
import * as D from "./railway/documents";
import { RailwayApiError } from "./railway/errors";
import type { RenameExecutionView, RenamePlanItem, RenamePlanView, RenameRequestItem, RenameRow } from "./rename-types";
import { isReadOnly } from "./write-mode";

/**
 * Rename several projects in one review, through the same path as every other change: review
 * (nothing changes) → one confirm click → each project re-read and re-checked right before it's
 * renamed → audit log. The names come from the browser (typed, or accepted suggestions), so they
 * are checked here with the same rules as a single rename.
 */

const PLAN_TTL_MS = 10 * 60_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const READ_ONLY = "Read-only mode is on. Enable Write mode in the header to make changes.";

type StoredPlan = { view: RenamePlanView; expiresAtMs: number };

const store = globalThis as typeof globalThis & { __rbiRename?: Map<string, StoredPlan> };
const plans = (store.__rbiRename ??= new Map<string, StoredPlan>());

function prune() {
  const now = Date.now();
  for (const [id, plan] of plans) if (plan.expiresAtMs < now) plans.delete(id);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isAmbiguous(error: unknown) {
  return error instanceof RailwayApiError && (error.kind === "network" || error.kind === "server");
}

function lockReason({ account, workspace, project }: WorkspaceProject): string | undefined {
  if (isProtectedProject(project)) return "Listed in PROTECTED_PROJECTS";
  if (!workspaceAllowed(account, workspace.id)) return "Outside this token's workspace";
  return undefined;
}

// ── The table ───────────────────────────────────────────────────────────────

/**
 * Rows for the Rename projects page: every project that isn't scheduled for deletion, Railway's
 * random names first, each with a suggested slug. Cached reads only; nothing is written.
 */
export async function loadRenameRows(views: AccountView[]): Promise<{ rows: RenameRow[]; notes: string[]; scheduledForDeletion: number }> {
  const { projects, notes } = await loadAllProjects(views);
  const live = projects.filter((c) => !c.project.deletedAt);
  const summaries = await savedSummaries(live.flatMap((c) => c.project.repos));
  const rows = live
    .map((c): RenameRow => {
      const { account, workspace, project } = c;
      const aiNames = project.repos.flatMap((repo) => summaries.get(repoKey(repo))?.summary.name ?? []);
      const generated = isGeneratedRailwayName(project.name, projectNameHints(project));
      const suggestion = suggestName({ aiNames, repos: project.repos });
      return {
        key: `${account.key}:${project.id}`,
        accountKey: account.key,
        accountLabel: account.label,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        projectId: project.id,
        name: project.name,
        repos: project.repos,
        generated,
        // A name a person chose usually already comes from the repo, so only offer it a summary-based one.
        suggestion: generated || suggestion?.source === "ai" ? suggestion : null,
        lockReason: lockReason(c),
      };
    })
    .sort((a, b) => Number(b.generated) - Number(a.generated) || a.name.localeCompare(b.name));
  return { rows: uniqueSuggestions(rows), notes, scheduledForDeletion: projects.length - live.length };
}

// ── Review ──────────────────────────────────────────────────────────────────

function parseRequest(input: unknown): RenameRequestItem[] {
  const raw = input && typeof input === "object" ? (input as { items?: unknown }).items : undefined;
  if (!Array.isArray(raw)) throw new UserFacingError("Invalid request.");
  if (raw.length === 0) throw new UserFacingError("Tick at least one project to rename.");
  if (raw.length > MAX_RENAMES) throw new UserFacingError(`Rename at most ${MAX_RENAMES} projects at a time.`);
  const seen = new Set<string>();
  return raw.map((entry) => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    if (typeof item.projectId !== "string" || !ID_PATTERN.test(item.projectId)) throw new UserFacingError("Invalid project.");
    if (seen.has(item.projectId)) throw new UserFacingError("The same project is listed twice.");
    seen.add(item.projectId);
    const newName = typeof item.newName === "string" ? cleanProjectName(item.newName) : null;
    if (!newName) throw new UserFacingError(`Each new name must be 1–${NAME_MAX} characters, without control characters.`);
    return { projectId: item.projectId, newName };
  });
}

function draftItem(c: WorkspaceProject, after: string): RenamePlanItem {
  const { account, workspace, project } = c;
  const base = {
    key: `${account.key}:${project.id}`,
    accountKey: account.key,
    accountLabel: account.label,
    workspaceName: workspace.name,
    projectId: project.id,
    before: project.name,
    after,
  };
  const skip = (reason: string): RenamePlanItem => ({ ...base, flags: [], willRun: false, skipReason: reason });

  if (isProtectedProject(project)) return skip("Listed in PROTECTED_PROJECTS.");
  if (!workspaceAllowed(account, workspace.id)) return skip("Outside this token's workspace.");
  if (project.deletedAt) return skip("Scheduled for deletion.");
  if (project.name === after) return skip("Already named that.");

  const flags: PlanFlag[] = [];
  if (isGeneratedRailwayName(project.name, projectNameHints(project))) flags.push({ tone: "info", text: "Generated name" });
  if (project.name.toLowerCase() === after.toLowerCase()) flags.push({ tone: "info", text: "Only the capitalization changes" });
  return { ...base, flags, willRun: true };
}

/** Flag new names that another project in the same workspace has, or is also getting. Railway allows it, but it's confusing. */
function flagDuplicates(items: RenamePlanItem[], projects: WorkspaceProject[]) {
  const renamedTo = new Map(items.filter((i) => i.willRun).map((i) => [i.projectId, i.after]));
  const byWorkspace = new Map<string, { projectId: string; name: string; renamed: boolean }[]>();
  const workspaceOf = new Map<string, string>();
  for (const { workspace, project } of projects) {
    if (project.deletedAt) continue;
    workspaceOf.set(project.id, workspace.id);
    const after = renamedTo.get(project.id);
    const list = byWorkspace.get(workspace.id) ?? [];
    list.push({ projectId: project.id, name: (after ?? project.name).toLowerCase(), renamed: after !== undefined });
    byWorkspace.set(workspace.id, list);
  }
  for (const item of items) {
    if (!item.willRun) continue;
    const others = byWorkspace.get(workspaceOf.get(item.projectId) ?? "") ?? [];
    const clash = others.find((o) => o.projectId !== item.projectId && o.name === item.after.toLowerCase());
    if (clash) {
      item.flags.push({
        tone: "warning",
        text: clash.renamed ? "Another project here is getting the same name" : `${item.workspaceName} already has a project with this name`,
      });
    }
  }
}

/** Re-read Railway and build a reviewable plan. Changes nothing. */
export async function createRenamePlan(input: unknown): Promise<RenamePlanView> {
  prune();
  const requested = parseRequest(input);
  if (await isReadOnly()) throw new UserFacingError(READ_ONLY);

  const { projects, notes } = await loadAllProjects(await loadAccountViews(), { fresh: true });
  const byId = new Map(projects.map((c) => [c.project.id, c]));
  const items = requested
    .flatMap(({ projectId, newName }) => {
      const found = byId.get(projectId);
      return found ? [draftItem(found, newName)] : [];
    })
    .sort((a, b) => Number(b.willRun) - Number(a.willRun) || a.before.localeCompare(b.before));
  flagDuplicates(items, projects);

  const runnable = items.filter((i) => i.willRun);
  const missing = requested.length - items.length;
  // `notes` is only set when a token or a workspace couldn't be read, so a missing project may just be unreadable right now.
  const partialRead = notes.length > 0;
  const impact = [
    `Renames ${plural(runnable.length, "project")} in Railway. Services, domains, deployments, your variables and billing stay as they are.`,
    "Railway's links to a project use its ID, not its name, so they keep working. Railway's own RAILWAY_PROJECT_NAME variable takes the new name at each service's next deploy, in case your code or logs use it.",
  ];
  if (missing > 0) {
    impact.push(
      partialRead
        ? `${plural(missing, "ticked project")} couldn't be checked because part of your account couldn't be read just now (below), so ${missing === 1 ? "it's" : "they're"} left out.`
        : `${plural(missing, "ticked project")} ${missing === 1 ? "wasn't" : "weren't"} found (deleted, or no longer visible to these tokens) and ${missing === 1 ? "is" : "are"} left out.`,
    );
  }
  impact.push(...notes);

  const blockedReason =
    items.length === 0
      ? partialRead
        ? "Couldn't read the ticked projects from Railway just now. Wait a moment and review again."
        : "None of the ticked projects were found. Refresh the page and try again."
      : runnable.length === 0
        ? "Nothing to do — every project was skipped (see reasons)."
        : undefined;

  const expiresAtMs = Date.now() + PLAN_TTL_MS;
  const view: RenamePlanView = {
    id: randomUUID(),
    title: runnable.length === 1 ? `Rename ${runnable[0].before} → ${runnable[0].after}` : `Rename ${plural(runnable.length || items.length, "project")}`,
    impact,
    recovery: "Rename them again here or from Overview. Each project's previous name is in the audit log.",
    items,
    runnableCount: runnable.length,
    blockedReason,
    expiresAt: new Date(expiresAtMs).toISOString(),
    demo: isMockMode(),
  };
  plans.set(view.id, { view, expiresAtMs });
  return view;
}

// ── Run ─────────────────────────────────────────────────────────────────────

/** Run a reviewed plan once. Every project is re-read first; anything renamed since the review is skipped. */
export async function executeRenamePlan(planId: unknown): Promise<RenameExecutionView> {
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

  const event = (item: RenamePlanItem, outcome: AuditEvent["outcome"], extra: Partial<AuditEvent> = {}): AuditEvent => ({
    ts: new Date().toISOString(),
    planId: stored.view.id,
    kind: "project.rename",
    outcome,
    accountKey: item.accountKey,
    account: item.accountLabel,
    workspace: item.workspaceName,
    projectId: item.projectId,
    projectName: item.before,
    targetId: item.projectId,
    targetLabel: `${item.before} → ${item.after}`,
    approvedWith: "confirm button",
    demo: stored.view.demo,
    ...extra,
  });
  const label = (item: RenamePlanItem) => `${item.before} → ${item.after}`;
  const skipped = (item: RenamePlanItem, message: string): ExecutionItemResult => ({ targetId: item.projectId, label: label(item), outcome: "skipped", message });

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
      else if (project.name === item.after) skipReason = "It already has this name.";
      else if (project.name !== item.before) skipReason = `It was renamed after you reviewed it (now “${project.name}”).`;
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

    // No audit line, no change. The line holds both names.
    try {
      await appendAudit([event(item, "started")]);
    } catch (error) {
      auditError = `The audit log couldn't be written, so nothing further was run: ${friendlyError(error)}`;
      results.push(skipped(item, "Not run: the audit log can't be written."));
      continue;
    }

    let result: ExecutionItemResult;
    const base = { targetId: item.projectId, label: label(item) };
    try {
      const r = await railwayRequest<{ projectUpdate: { id: string; name: string } }>(account, D.ProjectUpdate, {
        id: item.projectId,
        input: { name: item.after },
      });
      // Only report success when Railway's answer holds the new name.
      const saved = r.projectUpdate.name;
      if (saved === item.after) result = { ...base, outcome: "success", message: `Now named “${item.after}”.` };
      else if (saved === item.before) result = { ...base, outcome: "failed", message: "Railway answered but kept the old name." };
      else result = { ...base, outcome: "unknown", message: `Railway saved “${saved}” instead. Check it in Railway.` };
    } catch (error) {
      const traceIds = error instanceof RailwayApiError && error.traceIds.length ? error.traceIds : undefined;
      if (error instanceof RailwayApiError && error.kind === "rate_limit") {
        halt = "Stopped: Railway's hourly API budget ran out. Wait and review the remaining projects again.";
      }
      result = isAmbiguous(error)
        ? { ...base, outcome: "unknown", message: `${friendlyError(error)} Check Railway before trying again.`, traceIds }
        : { ...base, outcome: "failed", message: friendlyError(error), traceIds };
    }
    results.push(result);
    try {
      await appendAudit([event(item, result.outcome, { message: result.message, traceIds: result.traceIds })]);
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
