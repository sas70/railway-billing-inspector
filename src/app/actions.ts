"use server";

import { cookies } from "next/headers";

import { getAccount, isEnvReadOnly, workspaceAllowed, WRITE_MODE_COOKIE } from "@/lib/config";
import { isReadOnly } from "@/lib/write-mode";
import { createBulkPlan, executeBulkPlan } from "@/lib/bulk";
import type { BulkExecutionView, BulkPlanView } from "@/lib/bulk-types";
import { createDescribePlan, executeDescribePlan } from "@/lib/describe";
import type { DescribeExecutionView, DescribePlanView } from "@/lib/describe-types";
import type { ActionResult, ExecutionView, PlanView } from "@/lib/plan-types";
import { createPlan, executePlan, UserFacingError } from "@/lib/plans";
import { createRenamePlan, executeRenamePlan } from "@/lib/rename";
import type { RenameExecutionView, RenamePlanView } from "@/lib/rename-types";
import { friendlyError, loadDeployment, loadLogs, loadProject } from "@/lib/railway/api";
import { clearCache } from "@/lib/railway/client";
import type { LogLine } from "@/lib/railway/types";
import type { IndexJob } from "@/lib/search-index/build";
import type { IndexStats } from "@/lib/search-index/store";

/*
 * Server Functions are reachable by direct POST, so each one validates its input
 * and nothing here trusts the browser. Network-level protection: the app binds to
 * 127.0.0.1 by default and supports DASHBOARD_PASSWORD (see src/proxy.ts).
 */

function toMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  return friendlyError(error);
}

/** Step 1 of every change: build a reviewable plan from fresh Railway state. Changes nothing. */
export async function createPlanAction(request: unknown): Promise<ActionResult<PlanView>> {
  try {
    return { ok: true, data: await createPlan(request) };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function createBulkPlanAction(request: unknown): Promise<ActionResult<BulkPlanView>> {
  try {
    return { ok: true, data: await createBulkPlan(request) };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function executeBulkPlanAction(planId: unknown, phrase: unknown): Promise<ActionResult<BulkExecutionView>> {
  try {
    return { ok: true, data: await executeBulkPlan(planId, phrase) };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Review copying saved summaries into Railway project descriptions (one project, or all). Changes nothing. */
export async function createDescribePlanAction(scope: unknown): Promise<ActionResult<DescribePlanView>> {
  try {
    return { ok: true, data: await createDescribePlan(scope) };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function executeDescribePlanAction(planId: unknown): Promise<ActionResult<DescribeExecutionView>> {
  try {
    return { ok: true, data: await executeDescribePlan(planId) };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Review renaming several projects at once ({ items: [{ projectId, newName }] }). Changes nothing. */
export async function createRenamePlanAction(request: unknown): Promise<ActionResult<RenamePlanView>> {
  try {
    return { ok: true, data: await createRenamePlan(request) };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function executeRenamePlanAction(planId: unknown): Promise<ActionResult<RenameExecutionView>> {
  try {
    return { ok: true, data: await executeRenamePlan(planId) };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Step 2: run a reviewed plan, only with the exact confirmation phrase. */
export async function executePlanAction(planId: unknown, phrase: unknown): Promise<ActionResult<ExecutionView>> {
  try {
    return { ok: true, data: await executePlan(planId, phrase) };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function fetchLogsAction(accountKey: unknown, deploymentId: unknown, kind: unknown): Promise<ActionResult<LogLine[]>> {
  try {
    if (typeof accountKey !== "string" || typeof deploymentId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(deploymentId)) {
      throw new UserFacingError("Invalid request.");
    }
    const account = getAccount(accountKey);
    if (!account) throw new UserFacingError("Unknown account.");
    if (account.workspaceId) {
      // Honour a RAILWAY_TOKEN_…_WORKSPACE_ID limit for logs too.
      const deployment = await loadDeployment(account, deploymentId);
      const project = await loadProject(account, deployment.projectId);
      if (!workspaceAllowed(account, project.workspace?.id)) throw new UserFacingError("Outside this token's workspace.");
    }
    const logKind = kind === "build" ? "build" : "runtime";
    return { ok: true, data: await loadLogs(account, deploymentId, logKind, 300) };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * The Refresh button: forget every saved Railway read (in memory and on disk) and what was read
 * from local clones and GitHub, so the next render reads everything again. The client then calls
 * router.refresh().
 */
export async function refreshDataAction(): Promise<void> {
  clearCache();
  const [{ clearRepoInfoCache }, { clearSummaryStatusCache }, { clearCloneCache }] = await Promise.all([
    import("@/lib/code"),
    import("@/lib/code/ai-summary"),
    import("@/lib/code/sources"),
  ]);
  clearRepoInfoCache();
  clearSummaryStatusCache();
  clearCloneCache();
}

export async function getWriteModeAction(): Promise<ActionResult<{ writeMode: boolean }>> {
  try {
    return { ok: true, data: { writeMode: !(await isReadOnly()) } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Session write mode — still blocked if DASHBOARD_READ_ONLY=true. */
export async function setWriteModeAction(enabled: unknown): Promise<ActionResult<{ writeMode: boolean }>> {
  try {
    if (typeof enabled !== "boolean") throw new UserFacingError("Invalid request.");
    if (enabled && isEnvReadOnly()) {
      throw new UserFacingError("DASHBOARD_READ_ONLY is on in .env, so Write mode can't be enabled.");
    }
    const jar = await cookies();
    if (enabled) {
      jar.set(WRITE_MODE_COOKIE, "1", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 });
    } else {
      jar.delete(WRITE_MODE_COOKIE);
    }
    return { ok: true, data: { writeMode: enabled } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Start AI summaries of every project's repo in the background. "missing" covers repos with no
 * summary or whose code changed since; "all" re-summarizes everything. Railway is only read.
 */
export async function startSummariesAction(mode: unknown): Promise<ActionResult<{ started: boolean; count: number }>> {
  try {
    if (mode !== "missing" && mode !== "all") throw new UserFacingError("Unknown summary mode.");
    const { aiSummariesAvailable, startSummaryJob, summaryStatuses } = await import("@/lib/code/ai-summary");
    const { repoKey } = await import("@/lib/code/sources");
    if (!aiSummariesAvailable()) throw new UserFacingError("Set ANTHROPIC_API_KEY in .env.local to turn on AI summaries.");
    const { loadAccountViews, loadWorkspaceBundle, uniqueWorkspaceTargets } = await import("@/lib/railway/api");
    const bundles = await Promise.all(uniqueWorkspaceTargets(await loadAccountViews()).map(({ account, workspace }) => loadWorkspaceBundle(account, workspace)));
    const repos = [...new Set(bundles.flatMap((b) => (b.projects.ok ? b.projects.value.flatMap((p) => p.repos) : [])))];
    let todo = repos;
    if (mode === "missing") {
      const statuses = await summaryStatuses(repos);
      todo = repos.filter((r) => {
        const s = statuses.get(repoKey(r));
        return s && (!s.stored || s.stale);
      });
    }
    return { ok: true, data: { started: startSummaryJob(todo, mode === "all"), count: todo.length } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Build or update the local search index in the background. "update" re-reads only what changed;
 * "rebuild" starts from scratch (downloaded GitHub copies are kept). Railway and GitHub are only read.
 */
export async function startIndexAction(mode: unknown): Promise<ActionResult<{ started: boolean }>> {
  try {
    if (mode !== "update" && mode !== "rebuild") throw new UserFacingError("Unknown index mode.");
    const { startIndexJob } = await import("@/lib/search-index/build");
    return { ok: true, data: { started: startIndexJob(mode) } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Progress of the search index job, for the status line while it runs. */
export async function indexStatusAction(): Promise<ActionResult<{ job: IndexJob; stats: IndexStats }>> {
  try {
    const [{ indexJob }, { indexStats }] = await Promise.all([import("@/lib/search-index/build"), import("@/lib/search-index/store")]);
    return { ok: true, data: { job: indexJob(), stats: indexStats() } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}
