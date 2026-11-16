import "server-only";

import { randomUUID } from "node:crypto";

import { appendAudit, type AuditEvent } from "./audit";
import { periodProgress, projectPeriod } from "./billing";
import { getAccount, isMockMode, workspaceAllowed, type AccountConfig } from "./config";
import { dateShort, money } from "./format";
import {
  agentMutationInput,
  assessAgent,
  assessCompute,
  computeFromRailway,
  computeMutation,
  computeStatus,
  describeAgent,
  describeCompute,
  sameAgent,
  sameCompute,
  validateAgent,
  validateCompute,
  type AgentLimit,
  type AgentLimitState,
  type ComputeLimit,
  type Exposure,
} from "./limit-rules";
import type { LimitExecutionView, LimitPlanItem, LimitPlanView, LimitRequest, LimitRow } from "./limits-types";
import type { ExecutionItemResult } from "./plan-types";
import { UserFacingError } from "./plans";
import {
  friendlyError,
  loadAgentUsage,
  loadWorkspaceBilling,
  loadWorkspaceBundle,
  loadWorkspaceEstimates,
  loadWorkspaceUsage,
  settle,
  uniqueWorkspaceTargets,
  type AccountView,
  type BillingView,
} from "./railway/api";
import { clearCache, railwayRequest } from "./railway/client";
import * as D from "./railway/documents";
import { RailwayApiError } from "./railway/errors";
import { isReadOnly } from "./write-mode";

/**
 * Workspace usage limits (compute alert + hard limit, Railway Agent limit), changed through the
 * same path as every other change: review (fresh reads, nothing changes) → confirm, or a typed
 * phrase when the change can take services offline or removes the hard limit → each limit
 * re-read and re-checked right before it's sent → audit line first → re-read afterwards, and
 * success is only reported when Railway shows the new values. The rules live in limit-rules.ts.
 */

const PLAN_TTL_MS = 10 * 60_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const ACCOUNT_PATTERN = /^[a-z0-9-]{1,64}$/;
const READ_ONLY = "Read-only mode is on. Enable Write mode in the header to make changes.";
const ADMIN_NOTE = "Changing usage limits needs admin access to the workspace.";

type StoredPlan = {
  view: LimitPlanView;
  accountKey: string;
  accountLabel: string;
  workspaceId: string;
  workspaceName: string;
  customerId: string;
  compute?: { before: ComputeLimit; after: ComputeLimit };
  agent?: { before: AgentLimitState; after: AgentLimit };
  expiresAtMs: number;
};

const store = globalThis as typeof globalThis & { __rbiLimits?: Map<string, StoredPlan> };
const plans = (store.__rbiLimits ??= new Map<string, StoredPlan>());

function prune() {
  const now = Date.now();
  for (const [id, plan] of plans) if (plan.expiresAtMs < now) plans.delete(id);
}

const normalizePhrase = (value: string) => value.trim().replace(/\s+/g, " ");

function isAmbiguous(error: unknown) {
  return error instanceof RailwayApiError && (error.kind === "network" || error.kind === "server");
}

const agentState = (a: { softCents: number | null; hardCents: number | null }): AgentLimitState => ({ alertCents: a.softCents, hardCents: a.hardCents });

/** Usage so far and the projected bill, computed like the Billing page and `railway usage`. */
function exposureOf(billing: BillingView, meteredToDate: number | null, estimatedMetered: number | null): Exposure {
  const projection = projectPeriod({ plan: billing.plan, usageToDate: billing.currentUsage, meteredToDate, estimatedMetered });
  return { usage: billing.currentUsage, projected: projection.projectedUsage };
}

async function freshExposure(account: AccountConfig, workspaceId: string, billing: BillingView): Promise<Exposure> {
  const [usage, estimates] = await Promise.all([
    settle(loadWorkspaceUsage(account, workspaceId, billing.period, { fresh: true })),
    settle(loadWorkspaceEstimates(account, workspaceId, { fresh: true })),
  ]);
  return exposureOf(billing, usage.ok ? usage.value.total.total : null, estimates.ok ? estimates.value.total.total : null);
}

// ── The Limits page ─────────────────────────────────────────────────────────

/** One row per workspace the tokens can read. Saved reads only; nothing is written. */
export async function loadLimitRows(views: AccountView[]): Promise<LimitRow[]> {
  return Promise.all(
    uniqueWorkspaceTargets(views).map(async ({ account, workspace }): Promise<LimitRow> => {
      const [bundle, agent] = await Promise.all([
        loadWorkspaceBundle(account, workspace, { includeProjects: false }),
        settle(loadAgentUsage(account, workspace.id)),
      ]);
      const billing = bundle.billing.ok ? bundle.billing.value : null;
      let compute: LimitRow["compute"];
      if (billing) {
        const exposure = exposureOf(
          billing,
          bundle.usage.ok ? bundle.usage.value.total.total : null,
          bundle.estimates?.ok ? bundle.estimates.value.total.total : null,
        );
        const limit = computeFromRailway(billing.usageLimit);
        const isOverLimit = billing.usageLimit?.isOverLimit ?? false;
        compute = { ok: true, limit, usage: billing.currentUsage, projected: exposure.projected, isOverLimit, status: computeStatus(limit, exposure, isOverLimit) };
      } else {
        compute = { ok: false, error: !bundle.billing.ok ? bundle.billing.error : "Billing couldn't be read." };
      }
      return {
        key: `${account.key}:${workspace.id}`,
        accountKey: account.key,
        accountLabel: account.label,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        plan: billing?.plan ?? workspace.plan,
        period: billing?.period ?? null,
        daysLeft: billing ? periodProgress(billing.period).remainingDays : null,
        compute,
        agent: agent.ok ? { ok: true, limit: agentState(agent.value), usedCents: agent.value.usedCents, custom: agent.value.custom } : { ok: false, error: agent.error },
        lockReason: !workspaceAllowed(account, workspace.id)
          ? "Outside this token's workspace"
          : !billing
            ? `Billing isn't readable with this token. ${ADMIN_NOTE}`
            : undefined,
      };
    }),
  );
}

// ── Review ──────────────────────────────────────────────────────────────────

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseLimitRequest(input: unknown): LimitRequest {
  if (!input || typeof input !== "object") throw new UserFacingError("Invalid request.");
  const raw = input as Record<string, unknown>;
  if (typeof raw.accountKey !== "string" || !ACCOUNT_PATTERN.test(raw.accountKey)) throw new UserFacingError("Unknown account.");
  if (typeof raw.workspaceId !== "string" || !ID_PATTERN.test(raw.workspaceId)) throw new UserFacingError("Invalid workspace.");
  const request: LimitRequest = { accountKey: raw.accountKey, workspaceId: raw.workspaceId };

  if (raw.compute !== undefined) {
    const c = (raw.compute && typeof raw.compute === "object" ? raw.compute : {}) as Record<string, unknown>;
    if (!(c.alert === null || isAmount(c.alert)) || !(c.hard === null || isAmount(c.hard))) throw new UserFacingError("Invalid compute limit.");
    const compute: ComputeLimit = { alert: c.alert, hard: c.hard };
    const error = validateCompute(compute);
    if (error) throw new UserFacingError(error);
    request.compute = compute;
  }
  if (raw.agent !== undefined) {
    const a = (raw.agent && typeof raw.agent === "object" ? raw.agent : {}) as Record<string, unknown>;
    if (!(a.alertCents === null || isAmount(a.alertCents)) || !isAmount(a.hardCents)) throw new UserFacingError("Invalid agent limit.");
    const agent: AgentLimit = { alertCents: a.alertCents === 0 ? null : a.alertCents, hardCents: a.hardCents };
    const error = validateAgent(agent);
    if (error) throw new UserFacingError(error);
    request.agent = agent;
  }
  if (!request.compute && !request.agent) throw new UserFacingError("Nothing to change.");
  return request;
}

function computeImpact(after: ComputeLimit, before: ComputeLimit, exposure: Exposure, billing: BillingView): string[] {
  const lines: string[] = [];
  if (after.alert == null && after.hard == null) {
    lines.push("Compute: removes the email alert and the hard limit. Railway won't email you about compute spend or stop services when the bill grows.");
  } else {
    const alert = after.alert == null ? "no email alert" : `Railway emails you when usage reaches ${money(after.alert, { whole: true })}`;
    const hard =
      after.hard == null
        ? "no hard limit, so Railway never stops services because of cost"
        : `at ${money(after.hard, { whole: true })} Railway takes every service in this workspace offline (it emails at 75% and 90% first)`;
    lines.push(`Compute: ${alert}; ${hard}.`);
  }
  lines.push(
    `Usage so far ${money(exposure.usage)}; ${exposure.projected != null ? `projected ${money(exposure.projected)}` : "the projected bill couldn't be read"} by ${dateShort(billing.period.end)}.`,
  );
  const wasStopped = billing.usageLimit?.isOverLimit || (before.hard != null && exposure.usage != null && exposure.usage >= before.hard);
  if (wasStopped && (after.hard == null || (exposure.usage != null && after.hard > exposure.usage))) {
    lines.push("If the old limit took services offline, Railway normally brings them back once the limit is above usage. If one stays down, redeploy it from its page.");
  }
  return lines;
}

function agentImpact(after: AgentLimit): string {
  const hard = after.hardCents === 0 ? "blocked" : `stops at ${money(after.hardCents / 100)}`;
  const alert = after.alertCents == null ? "no email alert" : `email alert at ${money(after.alertCents / 100)}`;
  return `Railway Agent: ${hard}, ${alert}. Reaching it pauses only the agent; services keep running. Railway's agent limit can't be removed.`;
}

/** Re-read Railway and build a reviewable plan. Changes nothing. */
export async function createLimitPlan(input: unknown): Promise<LimitPlanView> {
  prune();
  const request = parseLimitRequest(input);
  if (await isReadOnly()) throw new UserFacingError(READ_ONLY);
  const account = getAccount(request.accountKey);
  if (!account) throw new UserFacingError("Unknown account. Check your .env.local tokens.");
  if (!workspaceAllowed(account, request.workspaceId)) throw new UserFacingError("This token is limited to a different workspace (RAILWAY_TOKEN_…_WORKSPACE_ID).");

  let billing: BillingView;
  try {
    billing = await loadWorkspaceBilling(account, request.workspaceId, { fresh: true });
  } catch (error) {
    throw new UserFacingError(`Couldn't read this workspace's billing from Railway, so nothing can be changed: ${friendlyError(error)} ${ADMIN_NOTE}`);
  }
  const [exposure, agentNow] = await Promise.all([
    freshExposure(account, request.workspaceId, billing),
    request.agent ? settle(loadAgentUsage(account, request.workspaceId, { fresh: true })) : Promise.resolve(null),
  ]);

  const items: LimitPlanItem[] = [];
  const impact: string[] = [`Limits cover the whole ${billing.workspaceName} workspace: every project in it counts. Railway has no per-project limit.`];
  let phrase = "";
  const stored: Pick<StoredPlan, "compute" | "agent"> = {};

  if (request.compute) {
    const before = computeFromRailway(billing.usageLimit);
    const after = request.compute;
    const changed = !sameCompute(before, after);
    const assessment = assessCompute(before, after, exposure);
    items.push({
      key: "compute",
      label: "Compute usage limit",
      before: describeCompute(before),
      after: describeCompute(after),
      flags: changed ? assessment.flags : [],
      willRun: changed,
      skipReason: changed ? undefined : "Already set to this.",
    });
    if (changed) {
      phrase = assessment.phrase ?? "";
      impact.push(...computeImpact(after, before, exposure, billing));
      stored.compute = { before, after };
    }
  }

  if (request.agent && agentNow) {
    const after = request.agent;
    if (!agentNow.ok) {
      items.push({ key: "agent", label: "Railway Agent limit", before: "unknown", after: describeAgent(after), flags: [], willRun: false, skipReason: `Couldn't read it: ${agentNow.error}` });
    } else {
      const before = agentState(agentNow.value);
      const changed = !sameAgent(before, after);
      items.push({
        key: "agent",
        label: "Railway Agent limit",
        before: describeAgent(before),
        after: describeAgent(after),
        flags: changed ? assessAgent(before, after, agentNow.value.usedCents) : [],
        willRun: changed,
        skipReason: changed ? undefined : "Already set to this.",
      });
      if (changed) {
        impact.push(agentImpact(after));
        stored.agent = { before, after };
      }
    }
  }

  const runnableCount = items.filter((i) => i.willRun).length;
  const expiresAtMs = Date.now() + PLAN_TTL_MS;
  const view: LimitPlanView = {
    id: randomUUID(),
    title: `Change usage limits for ${billing.workspaceName}`,
    account: account.label,
    workspace: billing.workspaceName,
    impact,
    recovery: "Change them again here or with Update limits on Railway's Usage page. The previous values are in the audit log.",
    items,
    runnableCount,
    requiresPhrase: phrase !== "",
    phrase,
    blockedReason: runnableCount === 0 ? "Nothing to change: Railway already has these limits (see each item)." : undefined,
    expiresAt: new Date(expiresAtMs).toISOString(),
    demo: isMockMode(),
  };
  plans.set(view.id, {
    view,
    accountKey: account.key,
    accountLabel: account.label,
    workspaceId: request.workspaceId,
    workspaceName: billing.workspaceName,
    customerId: billing.customerId,
    ...stored,
    expiresAtMs,
  });
  return view;
}

// ── Run ─────────────────────────────────────────────────────────────────────

function expectTrue(value: unknown, field: string) {
  if (value !== true) throw new Error(`Railway answered ${JSON.stringify(value)} for ${field}.`);
}

/** Run a reviewed plan once, with the exact phrase when one is required. */
export async function executeLimitPlan(planId: unknown, typedPhrase: unknown): Promise<LimitExecutionView> {
  prune();
  const stored = typeof planId === "string" ? plans.get(planId) : undefined;
  if (!stored) throw new UserFacingError("This review has expired or was already used. Close it and start again so the current state is re-checked.");
  if (Date.now() > stored.expiresAtMs) {
    plans.delete(stored.view.id);
    throw new UserFacingError("This review expired (10 minutes). Start again so the current state is re-checked.");
  }
  if (stored.view.blockedReason) throw new UserFacingError(stored.view.blockedReason);
  if (stored.view.requiresPhrase) {
    const typed = typeof typedPhrase === "string" ? normalizePhrase(typedPhrase) : "";
    if (typed !== stored.view.phrase) throw new UserFacingError(`To approve, type ${stored.view.phrase} exactly.`);
  }
  // Single use: claim the plan before the first await, so two requests that arrive together can't both run it.
  plans.delete(stored.view.id);
  if (await isReadOnly()) throw new UserFacingError(READ_ONLY);
  const account = getAccount(stored.accountKey);
  if (!account) throw new UserFacingError("Unknown account. Check your .env.local tokens.");
  if (!workspaceAllowed(account, stored.workspaceId)) throw new UserFacingError("This token is limited to a different workspace (RAILWAY_TOKEN_…_WORKSPACE_ID).");

  // Re-read before touching anything.
  let billing: BillingView;
  try {
    billing = await loadWorkspaceBilling(account, stored.workspaceId, { fresh: true });
  } catch (error) {
    throw new UserFacingError(`Couldn't re-read the workspace's billing from Railway, so nothing was changed: ${friendlyError(error)}`);
  }
  if (billing.customerId !== stored.customerId) throw new UserFacingError("This workspace's billing account changed since the review. Review again.");
  const exposure = stored.compute ? await freshExposure(account, stored.workspaceId, billing) : { usage: billing.currentUsage, projected: null };

  const results: ExecutionItemResult[] = [];
  let auditError: string | undefined;
  const runnable = stored.view.items.filter((i) => i.willRun);

  const event = (item: LimitPlanItem, outcome: AuditEvent["outcome"], extra: Partial<AuditEvent> = {}): AuditEvent => ({
    ts: new Date().toISOString(),
    planId: stored.view.id,
    kind: item.key === "compute" ? "workspace.usageLimit" : "workspace.agentLimit",
    outcome,
    accountKey: stored.accountKey,
    account: stored.accountLabel,
    workspace: stored.workspaceName,
    projectId: "",
    projectName: "",
    targetId: `${stored.workspaceId}:${item.key}`,
    targetLabel: `${item.label}: ${item.before} → ${item.after}`,
    statusAtReview: item.key === "compute" && exposure.usage != null ? `usage ${money(exposure.usage)}` : undefined,
    approvedWith: stored.view.requiresPhrase ? stored.view.phrase : "confirm button",
    demo: stored.view.demo,
    ...extra,
  });
  const label = (item: LimitPlanItem) => `${item.label}: ${item.after}`;
  const skipped = (item: LimitPlanItem, message: string): ExecutionItemResult => ({ targetId: item.key, label: label(item), outcome: "skipped", message });

  for (const item of runnable) {
    if (auditError) {
      results.push(skipped(item, "Not run: the audit log can't be written."));
      continue;
    }

    // Re-check against what Railway has right now.
    let skipReason: string | null = null;
    try {
      if (item.key === "compute" && stored.compute) {
        const now = computeFromRailway(billing.usageLimit);
        const again = assessCompute(stored.compute.before, stored.compute.after, exposure);
        if (!sameCompute(now, stored.compute.before)) skipReason = `The limits changed after you reviewed them (now ${describeCompute(now)}).`;
        else if (again.phrase && again.phrase !== stored.view.phrase) {
          skipReason = "Usage moved since the review, and this change could now take services offline. Review it again.";
        }
      } else if (item.key === "agent" && stored.agent) {
        const now = agentState(await loadAgentUsage(account, stored.workspaceId, { fresh: true }));
        if (!sameAgent(now, stored.agent.before)) skipReason = `The agent limit changed after you reviewed it (now ${describeAgent(now)}).`;
      } else {
        skipReason = "Nothing stored for this item.";
      }
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

    // No audit line, no change. The line holds the old and new values.
    try {
      await appendAudit([event(item, "started")]);
    } catch (error) {
      auditError = `The audit log couldn't be written, so nothing further was run: ${friendlyError(error)}`;
      results.push(skipped(item, "Not run: the audit log can't be written."));
      continue;
    }

    let result: ExecutionItemResult;
    const base = { targetId: item.key, label: label(item) };
    try {
      if (item.key === "compute" && stored.compute) {
        const mutation = computeMutation(stored.customerId, stored.compute.after);
        if (mutation.op === "remove") {
          expectTrue((await railwayRequest<{ usageLimitRemove: unknown }>(account, D.UsageLimitRemove, { input: mutation.input })).usageLimitRemove, "usageLimitRemove");
        } else {
          expectTrue((await railwayRequest<{ usageLimitSet: unknown }>(account, D.UsageLimitSet, { input: mutation.input })).usageLimitSet, "usageLimitSet");
        }
      } else if (stored.agent) {
        const input = agentMutationInput(stored.workspaceId, stored.agent.after);
        expectTrue((await railwayRequest<{ agentUsageLimitSet: unknown }>(account, D.AgentUsageLimitSet, { input })).agentUsageLimitSet, "agentUsageLimitSet");
      }
      // Railway only answers true/false, so read the limit back before calling it done.
      result = await verify(account, stored, item, base);
    } catch (error) {
      const traceIds = error instanceof RailwayApiError && error.traceIds.length ? error.traceIds : undefined;
      result = isAmbiguous(error)
        ? { ...base, outcome: "unknown", message: `${friendlyError(error)} Check Railway's Usage page before trying again.`, traceIds }
        : { ...base, outcome: "failed", message: friendlyError(error), traceIds };
    }
    results.push(result);
    try {
      await appendAudit([event(item, result.outcome, { message: result.message, traceIds: result.traceIds })]);
    } catch (error) {
      auditError = `The change ran, but its outcome couldn't be written to the audit log: ${friendlyError(error)}`;
    }
  }

  clearCache(account.key);

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

async function verify(account: AccountConfig, stored: StoredPlan, item: LimitPlanItem, base: { targetId: string; label: string }): Promise<ExecutionItemResult> {
  try {
    if (item.key === "compute" && stored.compute) {
      const now = computeFromRailway((await loadWorkspaceBilling(account, stored.workspaceId, { fresh: true })).usageLimit);
      return sameCompute(now, stored.compute.after)
        ? { ...base, outcome: "success", message: `Railway now has: ${describeCompute(now)}.` }
        : { ...base, outcome: "unknown", message: `Railway accepted the change but now shows ${describeCompute(now)}. Check its Usage page.` };
    }
    if (stored.agent) {
      const now = agentState(await loadAgentUsage(account, stored.workspaceId, { fresh: true }));
      return sameAgent(now, stored.agent.after)
        ? { ...base, outcome: "success", message: `Railway now has: ${describeAgent(now)}.` }
        : { ...base, outcome: "unknown", message: `Railway accepted the change but now shows ${describeAgent(now)}. Check its Usage page.` };
    }
  } catch (error) {
    return { ...base, outcome: "success", message: `Railway accepted the change; reading it back failed (${friendlyError(error)}), so refresh to confirm.` };
  }
  return { ...base, outcome: "success" };
}
