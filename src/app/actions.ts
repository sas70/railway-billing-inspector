"use server";

import { cookies } from "next/headers";

import { getAccount, isEnvReadOnly, workspaceAllowed, WRITE_MODE_COOKIE } from "@/lib/config";
import { isReadOnly } from "@/lib/write-mode";
import { createBulkPlan, executeBulkPlan } from "@/lib/bulk";
import type { BulkExecutionView, BulkPlanView } from "@/lib/bulk-types";
import type { ActionResult, ExecutionView, PlanView } from "@/lib/plan-types";
import { createPlan, executePlan, UserFacingError } from "@/lib/plans";
import { friendlyError, loadDeployment, loadLogs, loadProject } from "@/lib/railway/api";
import { clearCache } from "@/lib/railway/client";
import type { LogLine } from "@/lib/railway/types";

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

/** Drop cached Railway responses; the client then calls router.refresh(). */
export async function refreshDataAction(): Promise<void> {
  clearCache();
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
