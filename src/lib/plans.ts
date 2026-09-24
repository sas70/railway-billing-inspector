import "server-only";

import { randomUUID } from "node:crypto";

import { appendAudit, readAudit, type AuditEvent } from "./audit";
import { getAccount, isMockMode, isProtectedProject, workspaceAllowed, type AccountConfig } from "./config";
import { isReadOnly } from "./write-mode";
import { dateTime, deploymentMeta, plural, shortId, sizeMB } from "./format";
import { GONE, IN_PROGRESS } from "./health";
import {
  PLAN_KINDS,
  type ExecutionItemResult,
  type ExecutionView,
  type PlanFlag,
  type PlanItem,
  type PlanKind,
  type PlanRequest,
  type PlanView,
} from "./plan-types";
import {
  friendlyError,
  loadDeployment,
  loadDeployments,
  loadEnvironment,
  loadProject,
  loadServiceInstance,
  type ProjectDetail,
} from "./railway/api";
import { clearCache, railwayRequest } from "./railway/client";
import * as D from "./railway/documents";
import { RailwayApiError } from "./railway/errors";
import type { DeploymentReviewNode } from "./railway/types";

/**
 * The approval engine.
 *
 *  1. createPlan()  — re-reads the current state from Railway, checks that every target
 *                     belongs where the request says, decides per item whether it can
 *                     run, and describes the impact. Nothing is changed.
 *  2. executePlan() — only runs a plan that exists, hasn't expired (10 min), hasn't been
 *                     used, and — for destructive kinds — was approved with the exact
 *                     phrase. Protection, read-only mode and workspace limits are checked
 *                     again, and every item is re-read and re-gated right before it runs;
 *                     anything that changed since the review is skipped.
 *  3. Audit: a "started" line is written before each change is sent (no audit line →
 *     no change), then the outcome.
 */

export class UserFacingError extends Error {}

const PLAN_TTL_MS = 10 * 60_000;
const MAX_TARGETS = 50;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const ACCOUNT_PATTERN = /^[a-z0-9-]{1,64}$/;

/** Kinds that need a typed confirmation phrase. */
const DESTRUCTIVE: ReadonlySet<PlanKind> = new Set([
  "deployment.remove",
  "service.delete",
  "environment.delete",
  "project.scheduleDelete",
]);

type StoredPlan = {
  view: PlanView;
  accountKey: string;
  accountLabel: string;
  workspaceName?: string;
  projectId: string;
  projectName: string;
  /** IDs validated against Railway while building the plan (never taken from the request as-is). */
  environmentId?: string;
  environmentName?: string;
  serviceId?: string;
  serviceName?: string;
  /** Deployment kinds: was each runnable deployment live when reviewed? */
  reviewedLive: Record<string, boolean>;
  expiresAtMs: number;
};

const store = globalThis as typeof globalThis & { __rbiPlans?: Map<string, StoredPlan> };
const plans = (store.__rbiPlans ??= new Map<string, StoredPlan>());

function prunePlans() {
  const now = Date.now();
  for (const [id, plan] of plans) if (plan.expiresAtMs < now) plans.delete(id);
}

const normalizePhrase = (value: string) => value.trim().replace(/\s+/g, " ");

// ── Input validation (server actions accept arbitrary input) ────────────────

export function parsePlanRequest(input: unknown): PlanRequest {
  if (!input || typeof input !== "object") throw new UserFacingError("Invalid request.");
  const raw = input as Record<string, unknown>;
  const kind = raw.kind as PlanKind;
  if (!PLAN_KINDS.includes(kind)) throw new UserFacingError("Unknown action.");
  if (typeof raw.accountKey !== "string" || !ACCOUNT_PATTERN.test(raw.accountKey)) throw new UserFacingError("Unknown account.");
  const id = (value: unknown, what: string, optional = false): string | undefined => {
    if (value == null && optional) return undefined;
    if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new UserFacingError(`Invalid ${what}.`);
    return value;
  };
  const projectId = id(raw.projectId, "project")!;
  const environmentId = id(raw.environmentId, "environment", true);
  const serviceId = id(raw.serviceId, "service", true);
  if (!Array.isArray(raw.targetIds)) throw new UserFacingError("Nothing selected.");
  const allowEmptyTargets = kind === "deployment.redeploy";
  if (raw.targetIds.length === 0 && !allowEmptyTargets) throw new UserFacingError("Nothing selected.");
  const targetIds = [...new Set(raw.targetIds.map((t) => id(t, "target")!))];
  if (targetIds.length > MAX_TARGETS) throw new UserFacingError(`Select at most ${MAX_TARGETS} items at a time.`);
  return { accountKey: raw.accountKey, kind, projectId, environmentId, serviceId, targetIds };
}

// ── Gating rules ────────────────────────────────────────────────────────────

type Gate = { ok: true } | { ok: false; reason: string };

function gateDeployment(kind: PlanKind, d: DeploymentReviewNode, isLive: boolean): Gate {
  const s = d.status;
  switch (kind) {
    case "deployment.remove":
      if (GONE.has(s)) return { ok: false, reason: "Already removed — Railway keeps it in the history list." };
      if (IN_PROGRESS.has(s)) return { ok: false, reason: "Still building/deploying — use Cancel instead." };
      return { ok: true };
    case "deployment.restart":
      if (s === "SUCCESS" || s === "SLEEPING" || s === "CRASHED") return { ok: true };
      return { ok: false, reason: "Only running, sleeping or crashed deployments can be restarted." };
    case "deployment.redeploy":
      if (IN_PROGRESS.has(s)) return { ok: false, reason: "It's still building/deploying." };
      if (!d.canRedeploy) return { ok: false, reason: "Railway says this deployment can't be redeployed." };
      return { ok: true };
    case "deployment.rollback":
      if (isLive) return { ok: false, reason: "This deployment is already live." };
      if (!d.canRollback) return { ok: false, reason: "Rollback isn't available (outside the image-retention window). Use Redeploy." };
      return { ok: true };
    case "deployment.cancel":
      if (IN_PROGRESS.has(s)) return { ok: true };
      return { ok: false, reason: "Only building or queued deployments can be cancelled." };
    default:
      return { ok: false, reason: "Not a deployment action." };
  }
}

// ── Plan drafts ─────────────────────────────────────────────────────────────

type Draft = {
  title: string;
  verb: string;
  items: PlanItem[];
  impact: string[];
  recovery?: string;
  phraseFor?: (runnable: number) => string;
  environmentId?: string;
  environmentName?: string;
  serviceId?: string;
  serviceName?: string;
  reviewedLive?: Record<string, boolean>;
  blockedReason?: string;
};

async function draftDeploymentPlan(account: AccountConfig, req: PlanRequest, project: ProjectDetail): Promise<Draft> {
  if (!req.serviceId || !req.environmentId) throw new UserFacingError("Missing service or environment.");
  const service = project.services.find((s) => s.id === req.serviceId);
  if (!service) throw new UserFacingError("That service isn't part of this project.");
  const env = project.environments.find((e) => e.id === req.environmentId);
  if (!env) throw new UserFacingError("That environment isn't part of this project.");

  let targetIds = req.targetIds;
  if (req.kind === "deployment.redeploy" && targetIds.length === 0) {
    const { deployments } = await loadDeployments(account, { projectId: project.id, serviceId: service.id, environmentId: env.id }, 25);
    const pick = deployments.find((d) => d.canRedeploy && !IN_PROGRESS.has(d.status));
    if (!pick) throw new UserFacingError("No previous deployment to start. Open the service page if Railway still has history.");
    targetIds = [pick.id];
  }

  if ((req.kind === "deployment.rollback" || req.kind === "deployment.redeploy") && targetIds.length !== 1) {
    throw new UserFacingError(`Pick exactly one deployment to ${req.kind === "deployment.rollback" ? "roll back to" : "redeploy"}.`);
  }

  const instance = await loadServiceInstance(account, env.id, service.id, { fresh: true });
  const activeIds = new Set(instance.activeDeployments.filter((d) => !d.deploymentStopped).map((d) => d.id));

  const items: PlanItem[] = [];
  const reviewedLive: Record<string, boolean> = {};
  let liveSelected = 0;

  for (const targetId of targetIds) {
    let deployment: DeploymentReviewNode;
    try {
      deployment = await loadDeployment(account, targetId, { fresh: true });
    } catch (error) {
      items.push({ targetId, label: shortId(targetId), flags: [], willRun: false, skipReason: `Couldn't load it: ${friendlyError(error)}` });
      continue;
    }
    const meta = deploymentMeta(deployment.meta);
    const label = `${shortId(deployment.id)} · ${meta.message ?? meta.image ?? meta.reason ?? "deployment"}`;
    const detail = [`created ${dateTime(deployment.createdAt)}`, meta.branch, meta.commitHash?.slice(0, 7)].filter(Boolean).join(" · ");

    if (deployment.projectId !== project.id || deployment.serviceId !== service.id || deployment.environmentId !== env.id) {
      items.push({ targetId, label, detail, status: deployment.status, flags: [], willRun: false, skipReason: "Belongs to a different service or environment." });
      continue;
    }

    const isLive = activeIds.has(deployment.id);
    const flags: PlanFlag[] = [];
    if (isLive) flags.push({ tone: req.kind === "deployment.remove" ? "danger" : "info", text: "Live — serving now" });
    if (deployment.status === "CRASHED") flags.push({ tone: "warning", text: "Crashed" });

    const gate = gateDeployment(req.kind, deployment, isLive);
    items.push({ targetId, label, detail, status: deployment.status, flags, willRun: gate.ok, skipReason: gate.ok ? undefined : gate.reason });
    if (gate.ok) {
      reviewedLive[deployment.id] = isLive;
      if (isLive) liveSelected++;
    }
  }

  const runnable = items.filter((i) => i.willRun).length;
  const where = `${service.name} (${env.name})`;
  const base = { items, environmentId: env.id, environmentName: env.name, serviceId: service.id, serviceName: service.name, reviewedLive };

  switch (req.kind) {
    case "deployment.remove": {
      const impact: string[] = [];
      if (liveSelected > 0) {
        const remainingLive = [...activeIds].filter((id) => reviewedLive[id] === undefined).length;
        impact.push(
          remainingLive === 0
            ? `${where} goes offline: its live deployment is taken down and stops accruing CPU and memory charges.`
            : `${plural(liveSelected, "live deployment")} of ${where} will be taken down; ${plural(remainingLive, "other active deployment")} keeps serving.`,
        );
        const envView = await loadEnvironment(account, project.id, env.id, { fresh: true }).catch(() => null);
        const volumes = envView?.volumes.filter((v) => v.serviceId === service.id) ?? [];
        if (volumes.length) {
          impact.push(`Attached volume ${volumes.map((v) => `${v.volume.name} (${sizeMB(v.currentSizeMB)})`).join(", ")} is kept and keeps billing for storage.`);
        }
      }
      const idle = runnable - liveSelected;
      if (idle > 0) impact.push(`${plural(idle, "deployment")} not serving traffic will be cleaned up — no effect on cost.`);
      impact.push("Service settings, variables and domains are not touched.");
      return {
        ...base,
        title: `Remove ${plural(runnable, "deployment")} · ${where}`,
        verb: "Remove",
        impact,
        recovery:
          "A removed deployment can be rolled back while Railway still retains its image (Hobby 72 h, Pro 120 h). After that, Redeploy rebuilds it from source.",
        phraseFor: (n) => `REMOVE ${n}`,
      };
    }
    case "deployment.restart":
      return {
        ...base,
        title: `Restart ${plural(runnable, "deployment")} · ${where}`,
        verb: "Restart",
        impact: [`Restarts the container${runnable === 1 ? "" : "s"} from the same image — expect a short interruption.`, "No rebuild; settings and variables stay as they are."],
      };
    case "deployment.redeploy":
      return {
        ...base,
        title: `Redeploy · ${where}`,
        verb: "Redeploy",
        impact: [
          "Starts a new deployment from this deployment's source and settings (a fresh build).",
          "When it succeeds it replaces the live deployment. Builds are free; the new deployment is billed like the old one.",
        ],
      };
    case "deployment.rollback":
      return {
        ...base,
        title: `Roll back · ${where}`,
        verb: "Roll back",
        impact: ["Makes this deployment live again: Railway restores its image and variables as a new deployment.", "The deployment that is live now will be replaced."],
      };
    case "deployment.cancel":
      return {
        ...base,
        title: `Cancel ${plural(runnable, "build")} · ${where}`,
        verb: "Cancel build",
        impact: ["Stops the in-progress build/deploy. Whatever is live now keeps serving."],
      };
    default:
      throw new UserFacingError("Unsupported action.");
  }
}

async function draftServiceDelete(account: AccountConfig, req: PlanRequest, project: ProjectDetail): Promise<Draft> {
  if (req.targetIds.length !== 1 || !req.environmentId) throw new UserFacingError("Pick one service and environment.");
  const service = project.services.find((s) => s.id === req.targetIds[0]);
  if (!service) throw new UserFacingError("That service isn't part of this project.");
  const env = project.environments.find((e) => e.id === req.environmentId);
  if (!env) throw new UserFacingError("That environment isn't part of this project.");
  if (!env.serviceIds.includes(service.id)) throw new UserFacingError(`${service.name} isn't deployed in ${env.name}.`);

  const envView = await loadEnvironment(account, project.id, env.id, { fresh: true });
  const instance = envView.instances.find((i) => i.serviceId === service.id);
  const volumes = envView.volumes.filter((v) => v.serviceId === service.id);
  const elsewhere = project.environments.filter((e) => e.id !== env.id && e.serviceIds.includes(service.id)).map((e) => e.name);

  const flags: PlanFlag[] = [];
  if (instance?.healthInfo.health === "live") flags.push({ tone: "danger", text: "Live — serving now" });
  for (const v of volumes) flags.push({ tone: "danger", text: `Volume ${v.volume.name} · ${sizeMB(v.currentSizeMB)} used` });

  const impact = [
    `Deletes ${service.name} from ${env.name}, including all of its deployments there. Its CPU, memory and egress charges in ${env.name} stop.`,
    elsewhere.length
      ? `${service.name} stays in ${elsewhere.join(", ")}. The service itself is only removed once no environment has it.`
      : `${env.name} is the only environment with ${service.name}, so the service itself is deleted too.`,
  ];
  if (volumes.length) impact.push(`Its volume data (${volumes.map((v) => v.volume.name).join(", ")}) should be treated as deleted with it — back it up first if you need it.`);

  return {
    title: `Delete ${service.name} from ${env.name}`,
    verb: "Delete service",
    items: [
      {
        targetId: service.id,
        label: `${service.name} in ${env.name}`,
        detail: instance?.latestDeployment ? `latest deployment ${instance.latestDeployment.status.toLowerCase()}` : "no deployments",
        status: instance?.latestDeployment?.status,
        flags,
        willRun: true,
      },
    ],
    impact,
    recovery: "Not reversible.",
    phraseFor: () => service.name,
    environmentId: env.id,
    environmentName: env.name,
    serviceId: service.id,
    serviceName: service.name,
  };
}

async function draftEnvironmentDelete(account: AccountConfig, req: PlanRequest, project: ProjectDetail): Promise<Draft> {
  const env = project.environments.find((e) => e.id === req.targetIds[0]);
  if (req.targetIds.length !== 1 || !env) throw new UserFacingError("That environment isn't part of this project.");
  if (env.id === project.primaryEnvironmentId) {
    throw new UserFacingError(`${env.name} is the project's primary environment. Delete the whole project instead.`);
  }
  const envView = await loadEnvironment(account, project.id, env.id, { fresh: true });
  const liveCount = envView.instances.filter((i) => i.healthInfo.health === "live" || i.healthInfo.health === "sleeping").length;
  const flags: PlanFlag[] = [];
  if (liveCount) flags.push({ tone: "danger", text: `${plural(liveCount, "service")} live` });
  if (envView.volumes.length) flags.push({ tone: "danger", text: `${plural(envView.volumes.length, "volume")}` });
  if (env.isEphemeral) flags.push({ tone: "info", text: "PR / ephemeral environment" });

  return {
    title: `Delete environment ${env.name}`,
    verb: "Delete environment",
    items: [
      {
        targetId: env.id,
        label: env.name,
        detail: `${plural(envView.instances.length, "service instance")} · ${plural(envView.volumes.length, "volume")}`,
        flags,
        willRun: true,
      },
    ],
    impact: [
      `Deletes ${env.name} with its ${plural(envView.instances.length, "service instance")}${envView.volumes.length ? ` and ${plural(envView.volumes.length, "volume")}` : ""}.`,
      "Everything running in it stops, and so do its charges. Other environments are not touched.",
    ],
    recovery: "Not reversible.",
    phraseFor: () => env.name,
    environmentId: env.id,
    environmentName: env.name,
  };
}

function draftProjectDelete(project: ProjectDetail): Draft {
  return {
    title: `Delete project ${project.name}`,
    verb: "Schedule deletion",
    items: [
      {
        targetId: project.id,
        label: project.name,
        detail: `${plural(project.services.length, "service")} · ${plural(project.environments.length, "environment")}`,
        flags: [{ tone: "danger", text: "Whole project" }],
        willRun: true,
      },
    ],
    impact: [
      `Asks Railway to delete ${project.name} and everything in it: ${plural(project.services.length, "service")} across ${plural(project.environments.length, "environment")}, including any databases and volumes.`,
      "Railway waits 48 hours before deleting it for good.",
    ],
    recovery: "You can cancel within the 48-hour grace period from the Audit log page (or in Railway) to keep the project.",
    phraseFor: () => project.name,
    blockedReason: project.deletedAt ? "Railway already shows this project as deleted or scheduled for deletion." : undefined,
  };
}

function draftCancelDelete(projectId: string, projectName: string): Draft {
  return {
    title: `Keep project ${projectName}`,
    verb: "Cancel deletion",
    items: [{ targetId: projectId, label: projectName, detail: "scheduled for deletion", flags: [], willRun: true }],
    impact: ["Cancels the scheduled deletion so Railway keeps the project."],
  };
}

// ── Shared checks (run at review time and again at execution time) ──────────

/** Why this plan must not run right now, if anything. Cancelling a deletion is always allowed. */
async function policyBlock(account: AccountConfig, kind: PlanKind, project: { id: string; name: string; workspaceId?: string | null }): Promise<string | undefined> {
  if (await isReadOnly()) return "Read-only mode is on. Enable Write mode in the header to make changes.";
  if (project.workspaceId !== undefined && !workspaceAllowed(account, project.workspaceId)) {
    return "This token is limited to a different workspace (RAILWAY_TOKEN_…_WORKSPACE_ID).";
  }
  if (kind !== "project.cancelDelete" && isProtectedProject(project)) {
    return `${project.name} is listed in PROTECTED_PROJECTS, so it can't be changed from this dashboard.`;
  }
  return undefined;
}

export async function createPlan(input: unknown): Promise<PlanView> {
  prunePlans();
  const req = parsePlanRequest(input);
  const account = getAccount(req.accountKey);
  if (!account) throw new UserFacingError("Unknown account. Check your .env.local tokens.");

  let project: ProjectDetail | null = null;
  let projectName: string;
  try {
    project = await loadProject(account, req.projectId, { fresh: true });
    projectName = project.name;
  } catch (error) {
    // A project scheduled for deletion may no longer load; allow cancelling it using the audit record.
    if (req.kind !== "project.cancelDelete" || !(error instanceof RailwayApiError) || error.kind !== "not_found") throw error;
    const record = (await readAudit(5000)).find((e) => e.projectId === req.projectId && e.kind === "project.scheduleDelete");
    if (!record) throw new UserFacingError("Project not found.");
    projectName = record.projectName;
  }

  if (project && !workspaceAllowed(account, project.workspace?.id)) {
    throw new UserFacingError("This token is limited to a different workspace (RAILWAY_TOKEN_…_WORKSPACE_ID).");
  }
  if ((req.kind === "project.scheduleDelete" || req.kind === "project.cancelDelete") && req.targetIds[0] !== req.projectId) {
    throw new UserFacingError("Project mismatch.");
  }

  let draft: Draft;
  if (req.kind.startsWith("deployment.")) draft = await draftDeploymentPlan(account, req, project!);
  else if (req.kind === "service.delete") draft = await draftServiceDelete(account, req, project!);
  else if (req.kind === "environment.delete") draft = await draftEnvironmentDelete(account, req, project!);
  else if (req.kind === "project.scheduleDelete") draft = draftProjectDelete(project!);
  else draft = draftCancelDelete(req.projectId, projectName);

  const destructive = DESTRUCTIVE.has(req.kind);
  const runnableCount = draft.items.filter((i) => i.willRun).length;
  const phrase = destructive ? normalizePhrase(draft.phraseFor?.(runnableCount) ?? "") : "";

  const blockedReason =
    (await policyBlock(account, req.kind, { id: req.projectId, name: projectName, workspaceId: project ? (project.workspace?.id ?? null) : undefined })) ??
    draft.blockedReason ??
    (destructive && !phrase ? "Couldn't build a confirmation phrase for this item, so it can't be approved here." : undefined) ??
    (runnableCount === 0 ? "Nothing to do — every selected item was skipped (see reasons)." : undefined);

  const expiresAtMs = Date.now() + PLAN_TTL_MS;
  const view: PlanView = {
    id: randomUUID(),
    kind: req.kind,
    title: draft.title,
    verb: draft.verb,
    destructive,
    context: {
      account: account.label,
      workspace: project?.workspace?.name,
      project: projectName,
      environment: draft.environmentName,
      service: draft.serviceName,
    },
    impact: draft.impact,
    recovery: draft.recovery,
    items: draft.items,
    runnableCount,
    requiresPhrase: destructive,
    phrase,
    blockedReason,
    expiresAt: new Date(expiresAtMs).toISOString(),
    demo: isMockMode(),
  };

  plans.set(view.id, {
    view,
    accountKey: account.key,
    accountLabel: account.label,
    workspaceName: project?.workspace?.name,
    projectId: req.projectId,
    projectName,
    environmentId: draft.environmentId,
    environmentName: draft.environmentName,
    serviceId: draft.serviceId,
    serviceName: draft.serviceName,
    reviewedLive: draft.reviewedLive ?? {},
    expiresAtMs,
  });

  return view;
}

// ── Execution ───────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function expectTrue(value: unknown, field: string) {
  if (value !== true) throw new Error(`Railway answered ${JSON.stringify(value)} for ${field}.`);
}

async function runMutation(account: AccountConfig, plan: StoredPlan, targetId: string): Promise<string | undefined> {
  switch (plan.view.kind) {
    case "deployment.remove": {
      const r = await railwayRequest<{ deploymentRemove: boolean }>(account, D.DeploymentRemove, { id: targetId });
      expectTrue(r.deploymentRemove, "deploymentRemove");
      return undefined;
    }
    case "deployment.restart": {
      const r = await railwayRequest<{ deploymentRestart: boolean }>(account, D.DeploymentRestart, { id: targetId });
      expectTrue(r.deploymentRestart, "deploymentRestart");
      return undefined;
    }
    case "deployment.redeploy": {
      const r = await railwayRequest<{ deploymentRedeploy: { id: string; status: string } }>(account, D.DeploymentRedeploy, { id: targetId });
      return `New deployment ${shortId(r.deploymentRedeploy.id)} (${r.deploymentRedeploy.status.toLowerCase()})`;
    }
    case "deployment.rollback": {
      const r = await railwayRequest<{ deploymentRollback: boolean }>(account, D.DeploymentRollback, { id: targetId });
      expectTrue(r.deploymentRollback, "deploymentRollback");
      return undefined;
    }
    case "deployment.cancel": {
      const r = await railwayRequest<{ deploymentCancel: boolean }>(account, D.DeploymentCancel, { id: targetId });
      expectTrue(r.deploymentCancel, "deploymentCancel");
      return undefined;
    }
    case "service.delete": {
      if (!plan.environmentId) throw new Error("Missing environment.");
      const r = await railwayRequest<{ serviceDelete: boolean }>(account, D.ServiceDelete, { id: targetId, environmentId: plan.environmentId });
      expectTrue(r.serviceDelete, "serviceDelete");
      return undefined;
    }
    case "environment.delete": {
      const r = await railwayRequest<{ environmentDelete: boolean }>(account, D.EnvironmentDelete, { id: targetId });
      expectTrue(r.environmentDelete, "environmentDelete");
      return undefined;
    }
    case "project.scheduleDelete": {
      const r = await railwayRequest<{ projectScheduleDelete: boolean }>(account, D.ProjectScheduleDelete, { id: targetId });
      expectTrue(r.projectScheduleDelete, "projectScheduleDelete");
      return "Scheduled — Railway deletes it after the 48-hour grace period.";
    }
    case "project.cancelDelete": {
      const r = await railwayRequest<{ projectScheduleDeleteCancel: boolean }>(account, D.ProjectScheduleDeleteCancel, { id: targetId });
      expectTrue(r.projectScheduleDeleteCancel, "projectScheduleDeleteCancel");
      return "Deletion cancelled.";
    }
  }
}

/**
 * Re-read one item right before it runs and apply the same rules as the review.
 * Returns a skip reason when the item must not run now.
 */
async function recheckItem(
  account: AccountConfig,
  plan: StoredPlan,
  targetId: string,
  fresh: { project: ProjectDetail | null; activeIds: Set<string> | null },
): Promise<string | null> {
  const kind = plan.view.kind;
  if (kind.startsWith("deployment.")) {
    const d = await loadDeployment(account, targetId, { fresh: true });
    if (d.projectId !== plan.projectId || d.serviceId !== plan.serviceId || d.environmentId !== plan.environmentId) {
      return "It no longer belongs to the reviewed service/environment.";
    }
    const isLive = fresh.activeIds?.has(d.id) ?? false;
    const gate = gateDeployment(kind, d, isLive);
    if (!gate.ok) return `Changed since review (now ${d.status.toLowerCase()}): ${gate.reason}`;
    if (kind === "deployment.remove" && isLive && !plan.reviewedLive[targetId]) {
      return "It became the live deployment after you reviewed it.";
    }
    return null;
  }
  const project = fresh.project;
  if (kind === "service.delete") {
    const env = project?.environments.find((e) => e.id === plan.environmentId);
    if (!env || !env.serviceIds.includes(targetId)) return "The service is no longer in that environment.";
    return null;
  }
  if (kind === "environment.delete") {
    const env = project?.environments.find((e) => e.id === targetId);
    if (!env) return "The environment no longer exists.";
    if (env.id === project?.primaryEnvironmentId) return "It is now the project's primary environment.";
    return null;
  }
  if (kind === "project.scheduleDelete") {
    if (!project) return "The project could not be re-read.";
    if (project.deletedAt) return "Railway already shows the project as deleted or scheduled for deletion.";
    return null;
  }
  return null;
}

/** Errors after which we can't know whether Railway applied the change. */
function isAmbiguous(error: unknown) {
  return error instanceof RailwayApiError && (error.kind === "network" || error.kind === "server");
}

export async function executePlan(planId: unknown, typedPhrase: unknown): Promise<ExecutionView> {
  prunePlans();
  if (typeof planId !== "string" || !plans.has(planId)) {
    throw new UserFacingError("This review has expired or was already used. Close it and start again so the current state is re-checked.");
  }
  const plan = plans.get(planId)!;
  if (Date.now() > plan.expiresAtMs) {
    plans.delete(planId);
    throw new UserFacingError("This review expired (10 minutes). Start again so the current state is re-checked.");
  }
  if (plan.view.blockedReason) throw new UserFacingError(plan.view.blockedReason);
  if (plan.view.requiresPhrase) {
    const typed = typeof typedPhrase === "string" ? normalizePhrase(typedPhrase) : "";
    if (!plan.view.phrase || typed !== plan.view.phrase) throw new UserFacingError(`To approve, type ${plan.view.phrase} exactly.`);
  }

  const account = getAccount(plan.accountKey);
  if (!account) throw new UserFacingError("Unknown account. Check your .env.local tokens.");

  // Re-read the project and re-apply policy before touching anything.
  let freshProject: ProjectDetail | null = null;
  if (plan.view.kind !== "project.cancelDelete") {
    try {
      freshProject = await loadProject(account, plan.projectId, { fresh: true });
    } catch (error) {
      throw new UserFacingError(`Couldn't re-read the project from Railway, so nothing was changed: ${friendlyError(error)}`);
    }
  }
  const block = await policyBlock(account, plan.view.kind, {
    id: plan.projectId,
    name: freshProject?.name ?? plan.projectName,
    workspaceId: freshProject ? (freshProject.workspace?.id ?? null) : undefined,
  });
  if (block) throw new UserFacingError(block);

  let activeIds: Set<string> | null = null;
  if (plan.view.kind.startsWith("deployment.") && plan.environmentId && plan.serviceId) {
    try {
      const instance = await loadServiceInstance(account, plan.environmentId, plan.serviceId, { fresh: true });
      activeIds = new Set(instance.activeDeployments.filter((d) => !d.deploymentStopped).map((d) => d.id));
    } catch (error) {
      throw new UserFacingError(`Couldn't re-read the service from Railway, so nothing was changed: ${friendlyError(error)}`);
    }
  }

  // Single use: remove before running so a double-click can't execute it twice.
  plans.delete(planId);

  const results: ExecutionItemResult[] = [];
  let auditError: string | undefined;
  const runnable = plan.view.items.filter((i) => i.willRun);

  const event = (item: PlanItem, outcome: AuditEvent["outcome"], extra: Partial<AuditEvent> = {}): AuditEvent => ({
    ts: new Date().toISOString(),
    planId: plan.view.id,
    kind: plan.view.kind,
    outcome,
    accountKey: plan.accountKey,
    account: plan.accountLabel,
    workspace: plan.workspaceName,
    projectId: plan.projectId,
    projectName: plan.projectName,
    environmentId: plan.environmentId,
    environment: plan.environmentName,
    serviceId: plan.serviceId,
    service: plan.serviceName,
    targetId: item.targetId,
    targetLabel: item.label,
    statusAtReview: item.status,
    approvedWith: plan.view.requiresPhrase ? plan.view.phrase : "confirm button",
    demo: plan.view.demo,
    ...extra,
  });

  for (const [index, item] of runnable.entries()) {
    if (auditError) {
      results.push({ targetId: item.targetId, label: item.label, outcome: "skipped", message: "Not run: the audit log can't be written." });
      continue;
    }
    if (index > 0) await sleep(150);

    let skipReason: string | null;
    try {
      skipReason = await recheckItem(account, plan, item.targetId, { project: freshProject, activeIds });
    } catch (error) {
      skipReason = `Couldn't re-check it: ${friendlyError(error)}`;
    }
    if (skipReason) {
      const result: ExecutionItemResult = { targetId: item.targetId, label: item.label, outcome: "skipped", message: `Skipped: ${skipReason}` };
      results.push(result);
      await appendAudit([event(item, "skipped", { message: result.message })]).catch((error) => {
        auditError = `The audit log couldn't be written: ${friendlyError(error)}`;
      });
      continue;
    }

    // No audit line, no change.
    try {
      await appendAudit([event(item, "started")]);
    } catch (error) {
      auditError = `The audit log couldn't be written, so nothing further was run: ${friendlyError(error)}`;
      results.push({ targetId: item.targetId, label: item.label, outcome: "skipped", message: "Not run: the audit log can't be written." });
      continue;
    }

    let result: ExecutionItemResult;
    try {
      const message = await runMutation(account, plan, item.targetId);
      result = { targetId: item.targetId, label: item.label, outcome: "success", message };
    } catch (error) {
      const traceIds = error instanceof RailwayApiError && error.traceIds.length ? error.traceIds : undefined;
      result = isAmbiguous(error)
        ? { targetId: item.targetId, label: item.label, outcome: "unknown", message: `${friendlyError(error)} Check Railway before trying again.`, traceIds }
        : { targetId: item.targetId, label: item.label, outcome: "failed", message: friendlyError(error), traceIds };
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
    planId: plan.view.id,
    kind: plan.view.kind,
    title: plan.view.title,
    results,
    succeeded: count("success"),
    failed: count("failed"),
    skipped: count("skipped"),
    unknown: count("unknown"),
    auditWritten: !auditError,
    auditError,
  };
}
