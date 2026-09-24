import "server-only";

import { randomUUID } from "node:crypto";

import { appendAudit, type AuditEvent } from "./audit";
import type { BulkExecutionView, BulkMode, BulkPlanItem, BulkPlanView, BulkTargetInput } from "./bulk-types";
import { getAccount, isMockMode, isProtectedProject, workspaceAllowed } from "./config";
import { friendlyError, loadDeployment, loadDeployments, loadProject, loadServiceInstance } from "./railway/api";
import { clearCache, railwayRequest } from "./railway/client";
import * as D from "./railway/documents";
import { RailwayApiError } from "./railway/errors";
import { GONE, IN_PROGRESS } from "./health";
import type { ExecutionItemResult } from "./plan-types";
import { UserFacingError } from "./plans";
import { shortId } from "./format";
import { isReadOnly } from "./write-mode";

const PLAN_TTL_MS = 10 * 60_000;
const MAX_SERVICES = 120;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const ACCOUNT_PATTERN = /^[a-z0-9-]{1,64}$/;

type StoredBulk = {
  view: BulkPlanView;
  expiresAtMs: number;
};

const store = globalThis as typeof globalThis & { __rbiBulk?: Map<string, StoredBulk> };
const plans = (store.__rbiBulk ??= new Map<string, StoredBulk>());

function prune() {
  const now = Date.now();
  for (const [id, plan] of plans) if (plan.expiresAtMs < now) plans.delete(id);
}

const normalizePhrase = (value: string) => value.trim().replace(/\s+/g, " ");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function expectTrue(value: unknown, field: string) {
  if (value !== true) throw new Error(`Railway answered ${JSON.stringify(value)} for ${field}.`);
}

function isAmbiguous(error: unknown) {
  return error instanceof RailwayApiError && (error.kind === "network" || error.kind === "server");
}

function parseTargets(input: unknown): { mode: BulkMode; targets: BulkTargetInput[] } {
  if (!input || typeof input !== "object") throw new UserFacingError("Invalid request.");
  const raw = input as Record<string, unknown>;
  if (raw.mode !== "on" && raw.mode !== "off") throw new UserFacingError("Invalid bulk action.");
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) throw new UserFacingError("Nothing selected.");
  if (raw.targets.length > MAX_SERVICES) throw new UserFacingError(`Select at most ${MAX_SERVICES} services at a time.`);

  const id = (value: unknown, what: string): string => {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new UserFacingError(`Invalid ${what}.`);
    return value;
  };

  const targets: BulkTargetInput[] = raw.targets.map((row, index) => {
    if (!row || typeof row !== "object") throw new UserFacingError(`Invalid service #${index + 1}.`);
    const t = row as Record<string, unknown>;
    if (typeof t.accountKey !== "string" || !ACCOUNT_PATTERN.test(t.accountKey)) throw new UserFacingError("Unknown account.");
    if (typeof t.projectName !== "string" || typeof t.serviceName !== "string") throw new UserFacingError("Invalid service.");
    const live = Array.isArray(t.liveDeploymentIds) ? t.liveDeploymentIds.map((x) => id(x, "deployment")) : [];
    const latestId = t.latestId == null ? null : id(t.latestId, "deployment");
    return {
      accountKey: t.accountKey,
      projectId: id(t.projectId, "project"),
      projectName: t.projectName.slice(0, 120),
      workspaceName: typeof t.workspaceName === "string" ? t.workspaceName.slice(0, 120) : "",
      serviceId: id(t.serviceId, "service"),
      serviceName: t.serviceName.slice(0, 120),
      environmentId: id(t.environmentId, "environment"),
      environmentName: typeof t.environmentName === "string" ? t.environmentName.slice(0, 120) : "",
      liveDeploymentIds: live,
      latestId,
    };
  });
  return { mode: raw.mode, targets };
}

async function reviewOff(target: BulkTargetInput): Promise<BulkPlanItem[]> {
  const account = getAccount(target.accountKey);
  if (!account) {
    return [skipped(target, "deployment.remove", "—", "Unknown account.")];
  }
  const project = await loadProject(account, target.projectId);
  if (isProtectedProject(project)) {
    return [skipped(target, "deployment.remove", "—", `${project.name} is listed in PROTECTED_PROJECTS.`)];
  }
  if (!workspaceAllowed(account, project.workspace?.id)) {
    return [skipped(target, "deployment.remove", "—", "Outside this token's workspace.")];
  }
  const instance = await loadServiceInstance(account, target.environmentId, target.serviceId);
  const live = instance.healthInfo.liveDeploymentIds;
  if (instance.healthInfo.health === "deploying") {
    return [skipped(target, "deployment.remove", live[0] ?? "—", "Still deploying — wait or cancel the build on the service page.")];
  }
  if (live.length === 0) {
    return [skipped(target, "deployment.remove", "—", "Already offline.")];
  }
  return live.map((deploymentId) =>
    item(target, account.label, {
      targetId: deploymentId,
      kind: "deployment.remove",
      willRun: true,
      reviewedLive: true,
      status: instance.latestDeployment?.status,
    }),
  );
}

async function reviewOn(target: BulkTargetInput): Promise<BulkPlanItem[]> {
  const account = getAccount(target.accountKey);
  if (!account) {
    return [skipped(target, "deployment.redeploy", "—", "Unknown account.")];
  }
  const project = await loadProject(account, target.projectId);
  if (isProtectedProject(project)) {
    return [skipped(target, "deployment.redeploy", "—", `${project.name} is listed in PROTECTED_PROJECTS.`)];
  }
  if (!workspaceAllowed(account, project.workspace?.id)) {
    return [skipped(target, "deployment.redeploy", "—", "Outside this token's workspace.")];
  }
  const instance = await loadServiceInstance(account, target.environmentId, target.serviceId);
  if (instance.healthInfo.liveDeploymentIds.length > 0) {
    return [skipped(target, "deployment.redeploy", instance.healthInfo.liveDeploymentIds[0] ?? "—", "Already online.")];
  }
  let pickId = target.latestId;
  if (pickId) {
    try {
      const d = await loadDeployment(account, pickId);
      if (!d.canRedeploy || IN_PROGRESS.has(d.status)) pickId = null;
    } catch {
      pickId = null;
    }
  }
  if (!pickId) {
    const { deployments } = await loadDeployments(
      account,
      { projectId: target.projectId, serviceId: target.serviceId, environmentId: target.environmentId },
      25,
    );
    const pick = deployments.find((d) => d.canRedeploy && !IN_PROGRESS.has(d.status));
    pickId = pick?.id ?? null;
  }
  if (!pickId) {
    return [skipped(target, "deployment.redeploy", "—", "No previous deployment to start.")];
  }
  return [
    item(target, account.label, {
      targetId: pickId,
      kind: "deployment.redeploy",
      willRun: true,
      reviewedLive: false,
      status: instance.latestDeployment?.status,
    }),
  ];
}

function item(
  target: BulkTargetInput,
  accountLabel: string,
  extra: { targetId: string; kind: BulkPlanItem["kind"]; willRun: boolean; reviewedLive: boolean; status?: string; skipReason?: string },
): BulkPlanItem {
  return {
    key: `${target.accountKey}:${target.serviceId}:${target.environmentId}:${extra.targetId}`,
    accountKey: target.accountKey,
    accountLabel,
    workspaceName: target.workspaceName,
    projectId: target.projectId,
    projectName: target.projectName,
    serviceId: target.serviceId,
    serviceName: target.serviceName,
    environmentId: target.environmentId,
    environmentName: target.environmentName,
    targetId: extra.targetId,
    kind: extra.kind,
    label: `${target.serviceName} · ${target.projectName}`,
    detail: `${target.workspaceName} · ${target.environmentName}`,
    status: extra.status,
    flags: [],
    willRun: extra.willRun,
    skipReason: extra.skipReason,
    reviewedLive: extra.reviewedLive,
  };
}

function skipped(target: BulkTargetInput, kind: BulkPlanItem["kind"], targetId: string, reason: string): BulkPlanItem {
  return item(target, getAccount(target.accountKey)?.label ?? target.accountKey, {
    targetId,
    kind,
    willRun: false,
    reviewedLive: false,
    skipReason: reason,
  });
}

/** Re-read Railway and build a reviewable plan. Changes nothing. */
export async function createBulkPlan(input: unknown): Promise<BulkPlanView> {
  prune();
  if (await isReadOnly()) throw new UserFacingError("Read-only mode is on. Enable Write mode in the header to make changes.");
  const { mode, targets } = parseTargets(input);

  const items: BulkPlanItem[] = [];
  for (const target of targets) {
    try {
      items.push(...(mode === "off" ? await reviewOff(target) : await reviewOn(target)));
    } catch (error) {
      items.push(skipped(target, mode === "off" ? "deployment.remove" : "deployment.redeploy", "—", friendlyError(error)));
    }
  }

  const runnableCount = items.filter((i) => i.willRun).length;
  const projects = new Set(items.filter((i) => i.willRun).map((i) => i.projectId)).size;
  const phrase = mode === "off" ? `TURN OFF ${runnableCount} SERVICES` : `TURN ON ${runnableCount} SERVICES`;
  const expiresAtMs = Date.now() + PLAN_TTL_MS;

  const view: BulkPlanView = {
    id: randomUUID(),
    mode,
    title: mode === "off" ? "Turn all projects off" : "Turn all projects on",
    verb: mode === "off" ? "Turn off" : "Turn on",
    destructive: true,
    impact:
      mode === "off"
        ? [
            `Take ${runnableCount} live service${runnableCount === 1 ? "" : "s"} offline across ${projects} project${projects === 1 ? "" : "s"} (Railway deployment.remove).`,
            "Those GraphQL mutations are not a billed Railway product. Stopping compute stops new usage charges; usage already incurred this period stays on the invoice.",
            "Each service is one API mutation, run one after another, and each is re-checked immediately before it runs.",
          ]
        : [
            `Redeploy ${runnableCount} offline service${runnableCount === 1 ? "" : "s"} across ${projects} project${projects === 1 ? "" : "s"} (Railway deployment.redeploy).`,
            "Those GraphQL mutations are not a billed Railway product. Starting services starts compute, memory, and volume usage, which is what Railway bills.",
            "Each service is one API mutation, run one after another, and each is re-checked immediately before it runs.",
          ],
    recovery:
      mode === "off"
        ? "Turn a service back on from this table (redeploy). Data on volumes is kept; in-memory state is lost."
        : "Turn a service off again from this table if you did not mean to start it.",
    items,
    runnableCount,
    requiresPhrase: true,
    phrase: runnableCount ? phrase : "",
    blockedReason:
      runnableCount === 0 ? "Nothing to do — every selected service was skipped (see reasons)." : undefined,
    expiresAt: new Date(expiresAtMs).toISOString(),
    demo: isMockMode(),
  };

  plans.set(view.id, { view, expiresAtMs });
  return view;
}

export async function executeBulkPlan(planId: unknown, typedPhrase: unknown): Promise<BulkExecutionView> {
  prune();
  if (typeof planId !== "string" || !plans.has(planId)) {
    throw new UserFacingError("This review has expired or was already used. Close it and start again so the current state is re-checked.");
  }
  const stored = plans.get(planId)!;
  if (Date.now() > stored.expiresAtMs) {
    plans.delete(planId);
    throw new UserFacingError("This review expired (10 minutes). Start again so the current state is re-checked.");
  }
  if (await isReadOnly()) throw new UserFacingError("Read-only mode is on. Enable Write mode in the header to make changes.");
  if (stored.view.blockedReason) throw new UserFacingError(stored.view.blockedReason);
  const typed = typeof typedPhrase === "string" ? normalizePhrase(typedPhrase) : "";
  if (!stored.view.phrase || typed !== stored.view.phrase) {
    throw new UserFacingError(`To approve, type ${stored.view.phrase} exactly.`);
  }

  plans.delete(planId);

  const results: ExecutionItemResult[] = [];
  let auditError: string | undefined;
  const runnable = stored.view.items.filter((i) => i.willRun);
  let halt: string | undefined;

  const event = (row: BulkPlanItem, outcome: AuditEvent["outcome"], extra: Partial<AuditEvent> = {}): AuditEvent => ({
    ts: new Date().toISOString(),
    planId: stored.view.id,
    kind: row.kind,
    outcome,
    accountKey: row.accountKey,
    account: row.accountLabel,
    workspace: row.workspaceName,
    projectId: row.projectId,
    projectName: row.projectName,
    environmentId: row.environmentId,
    environment: row.environmentName,
    serviceId: row.serviceId,
    service: row.serviceName,
    targetId: row.targetId,
    targetLabel: row.label,
    statusAtReview: row.status,
    approvedWith: stored.view.phrase,
    demo: stored.view.demo,
    ...extra,
  });

  for (const [index, row] of runnable.entries()) {
    if (halt) {
      results.push({ targetId: row.targetId, label: row.label, outcome: "skipped", message: halt });
      continue;
    }
    if (auditError) {
      results.push({ targetId: row.targetId, label: row.label, outcome: "skipped", message: "Not run: the audit log can't be written." });
      continue;
    }
    if (index > 0) await sleep(150);

    const account = getAccount(row.accountKey);
    if (!account) {
      results.push({ targetId: row.targetId, label: row.label, outcome: "skipped", message: "Unknown account." });
      continue;
    }

    let skipReason: string | null = null;
    try {
      const project = await loadProject(account, row.projectId, { fresh: true });
      if (isProtectedProject(project)) skipReason = `${project.name} is listed in PROTECTED_PROJECTS.`;
      else if (!workspaceAllowed(account, project.workspace?.id)) skipReason = "Outside this token's workspace.";
      else {
        const d = await loadDeployment(account, row.targetId, { fresh: true });
        if (d.projectId !== row.projectId || d.serviceId !== row.serviceId || d.environmentId !== row.environmentId) {
          skipReason = "It no longer belongs to the reviewed service/environment.";
        } else if (row.kind === "deployment.remove") {
          if (GONE.has(d.status)) skipReason = "Already removed.";
          else if (IN_PROGRESS.has(d.status)) skipReason = "Still building/deploying.";
        } else if (IN_PROGRESS.has(d.status) || !d.canRedeploy) {
          skipReason = "Railway says this deployment can't be redeployed right now.";
        }
      }
    } catch (error) {
      skipReason = `Couldn't re-check it: ${friendlyError(error)}`;
    }

    if (skipReason) {
      const result: ExecutionItemResult = { targetId: row.targetId, label: row.label, outcome: "skipped", message: `Skipped: ${skipReason}` };
      results.push(result);
      await appendAudit([event(row, "skipped", { message: result.message })]).catch((error) => {
        auditError = `The audit log couldn't be written: ${friendlyError(error)}`;
      });
      continue;
    }

    try {
      await appendAudit([event(row, "started")]);
    } catch (error) {
      auditError = `The audit log couldn't be written, so nothing further was run: ${friendlyError(error)}`;
      results.push({ targetId: row.targetId, label: row.label, outcome: "skipped", message: "Not run: the audit log can't be written." });
      continue;
    }

    let result: ExecutionItemResult;
    try {
      let message: string | undefined;
      if (row.kind === "deployment.remove") {
        const r = await railwayRequest<{ deploymentRemove: boolean }>(account, D.DeploymentRemove, { id: row.targetId });
        expectTrue(r.deploymentRemove, "deploymentRemove");
      } else {
        const r = await railwayRequest<{ deploymentRedeploy: { id: string; status: string } }>(account, D.DeploymentRedeploy, { id: row.targetId });
        message = `New deployment ${shortId(r.deploymentRedeploy.id)} (${r.deploymentRedeploy.status.toLowerCase()})`;
      }
      result = { targetId: row.targetId, label: row.label, outcome: "success", message };
    } catch (error) {
      const traceIds = error instanceof RailwayApiError && error.traceIds.length ? error.traceIds : undefined;
      if (error instanceof RailwayApiError && error.kind === "rate_limit") {
        halt = "Stopped: Railway's hourly API budget ran out. Wait and review the remaining services again.";
      }
      result = isAmbiguous(error)
        ? { targetId: row.targetId, label: row.label, outcome: "unknown", message: `${friendlyError(error)} Check Railway before trying again.`, traceIds }
        : { targetId: row.targetId, label: row.label, outcome: "failed", message: friendlyError(error), traceIds };
    }
    results.push(result);
    try {
      await appendAudit([event(row, result.outcome, { message: result.message, traceIds: result.traceIds })]);
    } catch (error) {
      auditError = `The change ran, but its outcome couldn't be written to the audit log: ${friendlyError(error)}`;
    }
  }

  for (const key of new Set(runnable.map((r) => r.accountKey))) clearCache(key);

  const count = (outcome: ExecutionItemResult["outcome"]) => results.filter((r) => r.outcome === outcome).length;
  return {
    planId: stored.view.id,
    mode: stored.view.mode,
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
