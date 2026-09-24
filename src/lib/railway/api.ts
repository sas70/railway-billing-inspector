import "server-only";

import {
  addMeasurement,
  costOf,
  emptyTotals,
  mergeTotals,
  previousPeriod,
  USAGE_MEASUREMENTS,
  type CostBreakdown,
  type Period,
  type UsageTotals,
} from "../billing";
import { getAccount, getAccounts, type AccountConfig } from "../config";
import { emptyHealthCounts, instanceHealth, type Health, type HealthCounts } from "../health";
import { RailwayApiError, errorMessage, railwayRequest } from "./client";
import * as D from "./documents";
import type * as T from "./types";

// ── Small helpers ───────────────────────────────────────────────────────────

export type Settled<V> = { ok: true; value: V } | { ok: false; error: string };

export async function settle<V>(promise: Promise<V>): Promise<Settled<V>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export function friendlyError(error: unknown): string {
  if (error instanceof RailwayApiError) {
    if (error.kind === "auth") return "Railway said this token isn't allowed to see that (Not Authorized).";
    return error.message;
  }
  return errorMessage(error);
}

const nodes = <X>(connection: T.Edges<X> | null | undefined): X[] => connection?.edges.map((e) => e.node) ?? [];

// ── Accounts & workspaces ───────────────────────────────────────────────────

export type WorkspaceRef = T.WorkspaceBasics;

export type AccountView = {
  key: string;
  label: string;
  identity: { name: string | null; email: string } | null;
  tokenKind: "account" | "workspace";
  workspaces: WorkspaceRef[];
  error: string | null;
};

export async function loadAccountViews(): Promise<AccountView[]> {
  return Promise.all(getAccounts().map(loadAccountView));
}

/**
 * Every workspace once, even when several tokens can see it (an account token and a
 * workspace token for the same workspace would otherwise double-count its costs).
 * Account tokens win over workspace tokens.
 */
export function uniqueWorkspaceTargets(views: AccountView[]): { account: AccountConfig; workspace: WorkspaceRef }[] {
  const seen = new Set<string>();
  const out: { account: AccountConfig; workspace: WorkspaceRef }[] = [];
  const ordered = [...views].sort((a, b) => (a.tokenKind === b.tokenKind ? 0 : a.tokenKind === "account" ? -1 : 1));
  for (const view of ordered) {
    const account = getAccount(view.key);
    if (!account) continue;
    for (const workspace of view.workspaces) {
      if (seen.has(workspace.id)) continue;
      seen.add(workspace.id);
      out.push({ account, workspace });
    }
  }
  return out;
}

async function loadAccountView(account: AccountConfig): Promise<AccountView> {
  const base: AccountView = {
    key: account.key,
    label: account.label,
    identity: null,
    tokenKind: "account",
    workspaces: [],
    error: null,
  };

  try {
    const { me } = await railwayRequest<T.MeResult>(account, D.Me);
    let workspaces = me.workspaces;
    if (account.workspaceId) workspaces = workspaces.filter((w) => w.id === account.workspaceId);
    return { ...base, identity: { name: me.name, email: me.email }, workspaces };
  } catch (error) {
    if (!(error instanceof RailwayApiError) || error.kind !== "auth") {
      return { ...base, error: friendlyError(error) };
    }
  }

  // `me` is account-only. This is probably a workspace token (or an invalid one).
  const envName = `RAILWAY_TOKEN_${account.key.toUpperCase().replace(/-/g, "_")}_WORKSPACE_ID`;
  try {
    if (account.workspaceId) {
      const { workspace } = await railwayRequest<T.WorkspaceInfoResult>(account, D.WorkspaceInfo, {
        workspaceId: account.workspaceId,
      });
      return { ...base, tokenKind: "workspace", workspaces: [workspace] };
    }
    const probe = await railwayRequest<T.TokenProbeResult>(account, D.TokenWorkspaceProbe);
    const found = new Map<string, WorkspaceRef>();
    for (const project of nodes(probe.projects)) if (project.workspace) found.set(project.workspace.id, project.workspace);
    if (found.size === 0) {
      return {
        ...base,
        tokenKind: "workspace",
        error: `This looks like a workspace token, but its workspace couldn't be detected. Add ${envName} to .env.local.`,
      };
    }
    return { ...base, tokenKind: "workspace", workspaces: [...found.values()] };
  } catch {
    return {
      ...base,
      error:
        "Railway rejected this token (Not Authorized). It may have been revoked or mistyped — create a new token at railway.com/account/tokens.",
    };
  }
}

// ── Workspace projects (overview) ───────────────────────────────────────────

export type InstanceSummary = {
  id: string;
  serviceId: string;
  serviceName: string;
  environmentId: string;
  health: Health;
  degraded: boolean;
  liveDeploymentIds: string[];
  latest: { id: string; status: T.DeploymentStatus; createdAt: string } | null;
};

export type EnvironmentSummary = { id: string; name: string; isEphemeral: boolean; instances: InstanceSummary[]; health: HealthCounts };

export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  primaryEnvironmentId: string | null;
  prDeploys: boolean;
  serviceCount: number;
  environments: EnvironmentSummary[];
  health: HealthCounts;
  lastDeployAt: string | null;
};

function tally(counts: HealthCounts, instance: InstanceSummary) {
  counts[instance.health]++;
  counts.total++;
  if (instance.degraded) counts.degraded++;
}

function summarizeProject(node: T.ProjectNode): ProjectSummary {
  const health = emptyHealthCounts();
  let lastDeployAt: string | null = null;
  const environments = nodes(node.environments).map((env) => {
    const envHealth = emptyHealthCounts();
    const instances = nodes(env.serviceInstances).map((si) => {
      const result = instanceHealth(si.latestDeployment, si.activeDeployments);
      const summary: InstanceSummary = {
        id: si.id,
        serviceId: si.serviceId,
        serviceName: si.serviceName,
        environmentId: si.environmentId,
        health: result.health,
        degraded: result.degraded,
        liveDeploymentIds: result.liveDeploymentIds,
        latest: si.latestDeployment
          ? { id: si.latestDeployment.id, status: si.latestDeployment.status, createdAt: si.latestDeployment.createdAt }
          : null,
      };
      tally(health, summary);
      tally(envHealth, summary);
      const created = si.latestDeployment?.createdAt;
      if (created && (!lastDeployAt || created > lastDeployAt)) lastDeployAt = created;
      return summary;
    });
    return { id: env.id, name: env.name, isEphemeral: env.isEphemeral, instances, health: envHealth };
  });

  return {
    id: node.id,
    name: node.name,
    description: node.description,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    deletedAt: node.deletedAt,
    primaryEnvironmentId: node.primaryEnvironmentId,
    prDeploys: node.prDeploys,
    serviceCount: nodes(node.services).length,
    environments: sortEnvironments(environments, node.primaryEnvironmentId),
    health,
    lastDeployAt,
  };
}

export function sortEnvironments<E extends { id: string; name: string; isEphemeral: boolean }>(envs: E[], primaryId: string | null): E[] {
  return [...envs].sort((a, b) => {
    if (a.id === primaryId) return -1;
    if (b.id === primaryId) return 1;
    if (a.isEphemeral !== b.isEphemeral) return a.isEphemeral ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

export async function loadWorkspaceProjects(account: AccountConfig, workspaceId: string): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const { projects } = await railwayRequest<T.WorkspaceProjectsResult>(account, D.WorkspaceProjects, { workspaceId, after });
    out.push(...nodes(projects).map(summarizeProject));
    if (!projects.pageInfo.hasNextPage || !projects.pageInfo.endCursor) break;
    after = projects.pageInfo.endCursor;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Billing ─────────────────────────────────────────────────────────────────

export type BillingView = {
  plan: T.Plan;
  state: string;
  isTrialing: boolean;
  trialDaysRemaining: number;
  /** Dollars used so far this period (Railway's cached figure). */
  currentUsage: number;
  creditBalance: number;
  appliedCredits: number;
  period: Period;
  /** Subscription billing-cycle anchor (sets the start day of each period). */
  anchor: string | null;
  usageLimit: T.CustomerBilling["usageLimit"];
  nextInvoice: { date: string; amountSoFar: number; status: string; cancelAtPeriodEnd: boolean } | null;
};

export async function loadWorkspaceBilling(account: AccountConfig, workspaceId: string): Promise<BillingView> {
  const { workspace } = await railwayRequest<T.WorkspaceBillingResult>(account, D.WorkspaceBilling, { workspaceId });
  const c = workspace.customer;
  const sub = [...c.subscriptions].sort((a, b) => (a.nextInvoiceDate < b.nextInvoiceDate ? -1 : 1))[0];
  return {
    plan: workspace.plan,
    state: c.state,
    isTrialing: c.isTrialing,
    trialDaysRemaining: c.trialDaysRemaining,
    currentUsage: c.currentUsage,
    creditBalance: c.creditBalance,
    appliedCredits: c.appliedCredits,
    period: c.billingPeriod,
    anchor: sub?.billingCycleAnchor ?? null,
    usageLimit: c.usageLimit,
    nextInvoice: sub
      ? { date: sub.nextInvoiceDate, amountSoFar: sub.nextInvoiceCurrentTotal / 100, status: sub.status, cancelAtPeriodEnd: sub.cancelAtPeriodEnd }
      : null,
  };
}

export async function loadInvoices(account: AccountConfig, workspaceId: string): Promise<T.Invoice[]> {
  const { workspace } = await railwayRequest<T.WorkspaceInvoicesResult>(account, D.WorkspaceInvoices, { workspaceId });
  return [...workspace.customer.invoices].sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
}

// ── Usage ───────────────────────────────────────────────────────────────────

export type ServiceUsage = { id: string | null; name: string; deleted: boolean; totals: UsageTotals; cost: CostBreakdown };

export type ProjectUsage = {
  id: string;
  name: string;
  deleted: boolean;
  totals: UsageTotals;
  cost: CostBreakdown;
  services: ServiceUsage[];
  /** cost per environment id (only when Railway returns environment-level rows) */
  byEnvironment: Record<string, number>;
  /** cost per `${serviceId}|${environmentId}` */
  byServiceEnvironment: Record<string, number>;
};

export type UsageView = {
  period: Period | null;
  projects: ProjectUsage[];
  total: CostBreakdown;
  hasEnvironmentBreakdown: boolean;
};

function aggregateUsage(result: T.WorkspaceUsageResult, period: Period | null, withEnvironment: boolean): UsageView {
  const names = new Map<string, { name: string; deleted: boolean; services: Map<string, { name: string; deleted: boolean }> }>();
  for (const project of nodes(result.projects)) {
    names.set(project.id, {
      name: project.name,
      deleted: !!project.deletedAt,
      services: new Map(nodes(project.services).map((s) => [s.id, { name: s.name, deleted: !!s.deletedAt }])),
    });
  }

  const byProject = new Map<string, { totals: UsageTotals; services: Map<string, UsageTotals>; serviceEnv: Map<string, UsageTotals>; env: Map<string, UsageTotals> }>();
  const grand = emptyTotals();

  for (const row of result.usage) {
    const projectId = row.tags.projectId ?? "unknown";
    let entry = byProject.get(projectId);
    if (!entry) {
      entry = { totals: emptyTotals(), services: new Map(), serviceEnv: new Map(), env: new Map() };
      byProject.set(projectId, entry);
    }
    addMeasurement(entry.totals, row.measurement, row.value);
    addMeasurement(grand, row.measurement, row.value);

    const serviceKey = row.tags.serviceId ?? "";
    let serviceTotals = entry.services.get(serviceKey);
    if (!serviceTotals) entry.services.set(serviceKey, (serviceTotals = emptyTotals()));
    addMeasurement(serviceTotals, row.measurement, row.value);

    if (withEnvironment && row.tags.environmentId) {
      const envKey = row.tags.environmentId;
      let envTotals = entry.env.get(envKey);
      if (!envTotals) entry.env.set(envKey, (envTotals = emptyTotals()));
      addMeasurement(envTotals, row.measurement, row.value);

      const seKey = `${serviceKey}|${envKey}`;
      let seTotals = entry.serviceEnv.get(seKey);
      if (!seTotals) entry.serviceEnv.set(seKey, (seTotals = emptyTotals()));
      addMeasurement(seTotals, row.measurement, row.value);
    }
  }

  const projects: ProjectUsage[] = [...byProject.entries()].map(([id, entry]) => {
    const meta = names.get(id);
    const services: ServiceUsage[] = [...entry.services.entries()]
      .map(([serviceId, totals]) => {
        const svc = serviceId ? meta?.services.get(serviceId) : undefined;
        return {
          id: serviceId || null,
          name: svc?.name ?? (serviceId ? "deleted service" : "unattributed (e.g. volumes)"),
          deleted: svc ? svc.deleted : !!serviceId,
          totals,
          cost: costOf(totals),
        };
      })
      .filter((s) => s.cost.total > 0)
      .sort((a, b) => b.cost.total - a.cost.total);

    const byEnvironment: Record<string, number> = {};
    for (const [envId, totals] of entry.env) byEnvironment[envId] = costOf(totals).total;
    const byServiceEnvironment: Record<string, number> = {};
    for (const [key, totals] of entry.serviceEnv) byServiceEnvironment[key] = costOf(totals).total;

    return {
      id,
      name: meta?.name ?? (id === "unknown" ? "Unattributed" : "Deleted project"),
      deleted: meta ? meta.deleted : true,
      totals: entry.totals,
      cost: costOf(entry.totals),
      services,
      byEnvironment,
      byServiceEnvironment,
    };
  });

  projects.sort((a, b) => b.cost.total - a.cost.total);
  return { period, projects: projects.filter((p) => p.cost.total > 0), total: costOf(grand), hasEnvironmentBreakdown: withEnvironment };
}

/**
 * Metered usage for a workspace, grouped by project → service (→ environment).
 * `period` omitted = Railway's current billing period for the workspace.
 */
export async function loadWorkspaceUsage(account: AccountConfig, workspaceId: string, period?: Period): Promise<UsageView> {
  const base: Record<string, unknown> = { workspaceId, measurements: [...USAGE_MEASUREMENTS] };
  if (period) {
    base.startDate = period.start;
    base.endDate = period.end;
  }
  try {
    const result = await railwayRequest<T.WorkspaceUsageResult>(account, D.WorkspaceUsage, {
      ...base,
      groupBy: ["PROJECT_ID", "SERVICE_ID", "ENVIRONMENT_ID"],
    });
    return aggregateUsage(result, period ?? null, true);
  } catch (error) {
    // Some grouping combinations may be refused; fall back to the CLI's grouping.
    if (error instanceof RailwayApiError && ["auth", "rate_limit", "network", "not_found"].includes(error.kind)) throw error;
    const result = await railwayRequest<T.WorkspaceUsageResult>(account, D.WorkspaceUsage, {
      ...base,
      groupBy: ["PROJECT_ID", "SERVICE_ID"],
    });
    return aggregateUsage(result, period ?? null, false);
  }
}

export type EstimateView = { byProject: Record<string, CostBreakdown>; total: CostBreakdown };

/** Railway's projection of each project's usage at the end of the current period. */
export async function loadWorkspaceEstimates(account: AccountConfig, workspaceId: string): Promise<EstimateView> {
  const { estimatedUsage } = await railwayRequest<T.WorkspaceEstimatedResult>(account, D.WorkspaceEstimatedUsage, {
    workspaceId,
    measurements: [...USAGE_MEASUREMENTS],
  });
  const perProject = new Map<string, UsageTotals>();
  const total = emptyTotals();
  for (const row of estimatedUsage) {
    let totals = perProject.get(row.projectId);
    if (!totals) perProject.set(row.projectId, (totals = emptyTotals()));
    addMeasurement(totals, row.measurement, row.estimatedValue);
    addMeasurement(total, row.measurement, row.estimatedValue);
  }
  const byProject: Record<string, CostBreakdown> = {};
  for (const [id, totals] of perProject) byProject[id] = costOf(totals);
  return { byProject, total: costOf(total) };
}

export function sumUsageTotals(usages: ProjectUsage[]): UsageTotals {
  const totals = emptyTotals();
  for (const usage of usages) mergeTotals(totals, usage.totals);
  return totals;
}

// ── Workspace bundle (overview & billing pages) ─────────────────────────────

export type WorkspaceBundle = {
  account: { key: string; label: string };
  workspace: WorkspaceRef;
  projects: Settled<ProjectSummary[]>;
  billing: Settled<BillingView>;
  usage: Settled<UsageView>;
  estimates: Settled<EstimateView> | null;
};

export async function loadWorkspaceBundle(
  account: AccountConfig,
  workspace: WorkspaceRef,
  opts: { period?: "current" | "previous"; includeProjects?: boolean } = {},
): Promise<WorkspaceBundle> {
  const wantPrevious = opts.period === "previous";
  const [projects, billing] = await Promise.all([
    opts.includeProjects === false ? Promise.resolve<Settled<ProjectSummary[]>>({ ok: true, value: [] }) : settle(loadWorkspaceProjects(account, workspace.id)),
    settle(loadWorkspaceBilling(account, workspace.id)),
  ]);

  let period: Period | undefined;
  if (billing.ok) {
    const current = billing.value.period;
    period = wantPrevious ? previousPeriod(current, billing.value.anchor) : current;
  }

  const [usage, estimates] = await Promise.all([
    wantPrevious && !period
      ? Promise.resolve<Settled<UsageView>>({ ok: false, error: "The previous period needs billing access to know its dates." })
      : settle(loadWorkspaceUsage(account, workspace.id, period)),
    wantPrevious ? Promise.resolve(null) : settle(loadWorkspaceEstimates(account, workspace.id)),
  ]);

  return { account: { key: account.key, label: account.label }, workspace, projects, billing, usage, estimates };
}

// ── Project, environment, service ───────────────────────────────────────────

export type ProjectDetail = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  workspace: WorkspaceRef | null;
  primaryEnvironmentId: string | null;
  prDeploys: boolean;
  services: { id: string; name: string; icon: string | null; createdAt: string }[];
  environments: {
    id: string;
    name: string;
    isEphemeral: boolean;
    createdAt: string;
    meta: { prNumber: number | null; prTitle: string | null; branch: string | null } | null;
    serviceIds: string[];
  }[];
};

export async function loadProject(account: AccountConfig, projectId: string, opts: { fresh?: boolean } = {}): Promise<ProjectDetail> {
  const { project } = await railwayRequest<T.ProjectDetailResult>(account, D.ProjectDetail, { id: projectId }, opts);
  const environments = nodes(project.environments).map((env) => ({
    id: env.id,
    name: env.name,
    isEphemeral: env.isEphemeral,
    createdAt: env.createdAt,
    meta: env.meta,
    serviceIds: nodes(env.serviceInstances).map((si) => si.serviceId),
  }));
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deletedAt: project.deletedAt,
    workspace: project.workspace,
    primaryEnvironmentId: project.primaryEnvironmentId,
    prDeploys: project.prDeploys,
    services: nodes(project.services).sort((a, b) => a.name.localeCompare(b.name)),
    environments: sortEnvironments(environments, project.primaryEnvironmentId),
  };
}

export type InstanceView = T.InstanceDetail & { healthInfo: ReturnType<typeof instanceHealth> };

export type EnvironmentView = {
  id: string;
  name: string;
  isEphemeral: boolean;
  instances: InstanceView[];
  volumes: T.VolumeInstanceNode[];
};

export async function loadEnvironment(account: AccountConfig, projectId: string, environmentId: string, opts: { fresh?: boolean } = {}): Promise<EnvironmentView> {
  const { environment } = await railwayRequest<T.EnvironmentDetailResult>(
    account,
    D.EnvironmentDetail,
    { environmentId, projectId },
    opts,
  );
  return {
    id: environment.id,
    name: environment.name,
    isEphemeral: environment.isEphemeral,
    instances: nodes(environment.serviceInstances)
      .map((si) => ({ ...si, healthInfo: instanceHealth(si.latestDeployment, si.activeDeployments) }))
      .sort((a, b) => a.serviceName.localeCompare(b.serviceName)),
    volumes: nodes(environment.volumeInstances),
  };
}

export async function loadServiceInstance(
  account: AccountConfig,
  environmentId: string,
  serviceId: string,
  opts: { fresh?: boolean } = {},
): Promise<T.ServiceInstanceDetailResult["serviceInstance"] & { healthInfo: ReturnType<typeof instanceHealth> }> {
  const { serviceInstance } = await railwayRequest<T.ServiceInstanceDetailResult>(
    account,
    D.ServiceInstanceDetail,
    { environmentId, serviceId },
    opts,
  );
  return { ...serviceInstance, healthInfo: instanceHealth(serviceInstance.latestDeployment, serviceInstance.activeDeployments) };
}

export async function loadDeployments(
  account: AccountConfig,
  ids: { projectId: string; serviceId: string; environmentId: string },
  first = 25,
): Promise<{ deployments: T.DeploymentNode[]; hasMore: boolean }> {
  const { deployments } = await railwayRequest<T.ServiceDeploymentsResult>(account, D.ServiceDeployments, {
    input: { projectId: ids.projectId, serviceId: ids.serviceId, environmentId: ids.environmentId },
    first,
  });
  return { deployments: nodes(deployments), hasMore: deployments.pageInfo.hasNextPage };
}

export async function loadDeployment(account: AccountConfig, id: string, opts: { fresh?: boolean } = {}): Promise<T.DeploymentReviewNode> {
  const { deployment } = await railwayRequest<T.DeploymentForReviewResult>(account, D.DeploymentForReview, { id }, opts);
  return deployment;
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export const METRIC_RANGES = {
  "1h": { label: "Last hour", seconds: 3600, step: 60 },
  "24h": { label: "Last 24 hours", seconds: 86_400, step: 900 },
  "7d": { label: "Last 7 days", seconds: 7 * 86_400, step: 3600 },
} as const;

export type MetricRange = keyof typeof METRIC_RANGES;

export type Point = [ts: number, value: number];

export type ServiceMetricsView = {
  range: MetricRange;
  step: number;
  cpu: Point[];
  memory: Point[];
  egress: Point[];
  cpuLimit: number | null;
  memoryLimit: number | null;
};

export async function loadServiceMetrics(
  account: AccountConfig,
  ids: { projectId: string; serviceId: string; environmentId: string },
  range: MetricRange,
): Promise<ServiceMetricsView> {
  const spec = METRIC_RANGES[range];
  // Round the window to the step so the 30s cache is actually hit between page loads.
  const end = Math.floor(Date.now() / 1000 / spec.step) * spec.step;
  const start = end - spec.seconds;
  const { metrics } = await railwayRequest<T.MetricsResult>(account, D.ServiceMetrics, {
    ...ids,
    startDate: new Date(start * 1000).toISOString(),
    endDate: new Date(end * 1000).toISOString(),
    measurements: ["CPU_USAGE", "MEMORY_USAGE_GB", "NETWORK_TX_GB", "CPU_LIMIT", "MEMORY_LIMIT_GB"],
    sampleRateSeconds: spec.step,
  });
  const series = (measurement: string): Point[] =>
    (metrics.find((m) => m.measurement === measurement)?.values ?? [])
      .map((v): Point => [v.ts, v.value])
      .sort((a, b) => a[0] - b[0]);
  const lastValue = (measurement: string) => {
    const values = series(measurement);
    return values.length ? values[values.length - 1][1] : null;
  };
  return {
    range,
    step: spec.step,
    cpu: series("CPU_USAGE"),
    memory: series("MEMORY_USAGE_GB"),
    egress: series("NETWORK_TX_GB"),
    cpuLimit: lastValue("CPU_LIMIT"),
    memoryLimit: lastValue("MEMORY_LIMIT_GB"),
  };
}

// ── Logs ────────────────────────────────────────────────────────────────────

export async function loadLogs(account: AccountConfig, deploymentId: string, kind: "runtime" | "build", limit = 300): Promise<T.LogLine[]> {
  if (kind === "build") {
    const { buildLogs } = await railwayRequest<T.BuildLogsResult>(account, D.DeploymentBuildLogs, { deploymentId, limit }, { fresh: true });
    return buildLogs;
  }
  const { deploymentLogs } = await railwayRequest<T.RuntimeLogsResult>(account, D.DeploymentRuntimeLogs, { deploymentId, limit }, { fresh: true });
  return deploymentLogs;
}
