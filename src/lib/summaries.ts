import { periodProgress, projectPeriod, type CostBreakdown, type PeriodProjection } from "./billing";
import { isProtectedProject } from "./config";
import { dateNoYear, money, plural, relative } from "./format";
import { isOnlineHealth } from "./health";
import type { ProjectSummary, ProjectUsage, WorkspaceBundle } from "./railway/api";
import type { ServiceCatalogRow } from "./service-row";
import { DEFAULT_SERVICE_SORT, sortServiceRows } from "./service-stats";
import { billState, RECENT_DAYS } from "./worth-a-look";

export type { ServiceCatalogRow };

export type WorkspaceFigures = {
  usageToDate: number | null;
  metered: CostBreakdown | null;
  projection: PeriodProjection | null;
  progress: ReturnType<typeof periodProgress> | null;
  usageByProject: Map<string, ProjectUsage>;
  estimateByProject: Record<string, CostBreakdown>;
};

export function workspaceFigures(bundle: WorkspaceBundle): WorkspaceFigures {
  const usage = bundle.usage.ok ? bundle.usage.value : null;
  const billing = bundle.billing.ok ? bundle.billing.value : null;
  const estimates = bundle.estimates?.ok ? bundle.estimates.value : null;
  const usageToDate = billing ? billing.currentUsage : usage ? usage.total.total : null;
  const projection =
    usageToDate != null
      ? projectPeriod({
          plan: billing?.plan ?? bundle.workspace.plan,
          usageToDate,
          meteredToDate: usage?.total.total ?? null,
          estimatedMetered: estimates?.total.total ?? null,
        })
      : null;
  return {
    usageToDate,
    metered: usage?.total ?? null,
    projection,
    progress: billing ? periodProgress(billing.period) : null,
    usageByProject: new Map((usage?.projects ?? []).map((p) => [p.id, p])),
    estimateByProject: estimates?.byProject ?? {},
  };
}

export type Candidate = {
  key: string;
  severity: 0 | 1 | 2;
  icon: "alert" | "x" | "info" | "database";
  title: string;
  detail: string;
  href: string;
  /** When it happened: the latest deploy behind it (ISO), if known. Used by the time filter. */
  at: string | null;
  /** On this period's bill (running PR environment, project with nothing running but charges): listed apart, whatever the time filter. */
  ongoing: boolean;
  /** Bill items: still adding to the bill now, as opposed to charges from earlier in the period. */
  charging?: boolean;
  /** Bill items: what it has cost so far this period. */
  periodCost?: number;
};

function latestDeploy(instances: { latest: { createdAt: string } | null }[]): string | null {
  let latest: string | null = null;
  for (const i of instances) if (i.latest && (!latest || i.latest.createdAt > latest)) latest = i.latest.createdAt;
  return latest;
}

/** Things worth a look. Suggestions only — nothing here acts on its own. */
export function cleanupCandidates(bundles: WorkspaceBundle[]): Candidate[] {
  const out: Candidate[] = [];
  for (const bundle of bundles) {
    if (!bundle.projects.ok) continue;
    const figures = workspaceFigures(bundle);
    for (const project of bundle.projects.value) {
      const base = `/a/${bundle.account.key}/p/${project.id}`;
      const usage = figures.usageByProject.get(project.id);
      for (const env of project.environments) {
        for (const inst of env.instances) {
          const href = `${base}/s/${inst.serviceId}?env=${env.id}`;
          const where = `${project.name} › ${inst.serviceName}`;
          const when = inst.latest ? `last deploy ${relative(inst.latest.createdAt)}` : "no deployments";
          const at = inst.latest?.createdAt ?? null;
          if (inst.health === "crashed") {
            out.push({ key: `${inst.id}-crashed`, severity: 0, icon: "alert", title: `${where} has crashed`, detail: `${env.name} · ${when} · restart it or remove it`, href, at, ongoing: false });
          } else if (inst.health === "failed") {
            out.push({ key: `${inst.id}-failed`, severity: 1, icon: "x", title: `${where}: latest deploy failed, nothing live`, detail: `${env.name} · ${when}`, href, at, ongoing: false });
          } else if (inst.degraded) {
            out.push({ key: `${inst.id}-degraded`, severity: 1, icon: "alert", title: `${where}: newest deploy failed`, detail: `${env.name} · an older deployment is still serving`, href, at, ongoing: false });
          }
        }
        const running = env.health.live + env.health.sleeping;
        if (env.isEphemeral && running > 0) {
          const cost = usage?.byEnvironment[env.id];
          out.push({
            key: `${env.id}-pr`,
            severity: 2,
            icon: "info",
            title: `${project.name}: PR environment ${env.name} is still running`,
            detail: `${plural(running, "service")}${cost ? ` · ${money(cost)} this period` : ""} · delete it once the PR is merged`,
            href: `${base}?env=${env.id}`,
            at: latestDeploy(env.instances),
            ongoing: true,
            charging: true,
            periodCost: cost ?? 0,
          });
        }
      }
      if (project.health.live + project.health.sleeping === 0 && usage && usage.cost.total >= 0.01) {
        const soFar = usage.cost.total;
        const periodEnd = bundle.billing.ok ? bundle.billing.value.period.end : null;
        const state = billState({ recent: bundle.recent?.ok ? (bundle.recent.value[project.id] ?? 0) : null, volumeSoFar: usage.cost.volume });
        const volumeShare = usage.cost.volume / soFar;
        const ends = periodEnd ? ` when the billing period ends ${dateNoYear(periodEnd)}` : " when the billing period ends";
        out.push({
          key: `${project.id}-idle`,
          severity: state.charging ? 1 : 2,
          icon: "database",
          title: state.charging
            ? `${project.name}: nothing running, but still charging`
            : `${project.name}: ${money(soFar)} from earlier this period`,
          detail: state.charging
            ? [
                `${money(soFar)} so far this period`,
                state.perDay != null ? `${money(state.perDay)} a day over the last ${RECENT_DAYS} days` : null,
                usage.cost.volume > 0
                  ? "likely volume storage, which bills every day until the volume is deleted"
                  : "something in it is still using resources; open it to check its services",
              ]
                .filter(Boolean)
                .join(" · ")
            : state.known
              ? `Nothing running and nothing charged in the last ${RECENT_DAYS} days. It was billed while it ran earlier in the period${volumeShare > 0.5 ? " (mostly volume storage, since deleted)" : ""}, and leaves this list${ends}.`
              : "Nothing running. Recent usage couldn't be read, so it isn't clear whether charges stopped; check Billing → Cost history.",
          href: base,
          at: project.lastDeployAt,
          ongoing: true,
          charging: state.charging,
          periodCost: soFar,
        });
      }
    }
  }
  return out.sort((a, b) => a.severity - b.severity);
}

export function projectCost(figures: WorkspaceFigures, project: ProjectSummary) {
  return {
    period: figures.usageByProject.get(project.id)?.cost.total ?? 0,
    projected: figures.estimateByProject[project.id]?.total ?? null,
  };
}

function scaleExpected(periodCost: number, projectPeriod: number, projectProjected: number | null): number {
  if (projectProjected == null || projectPeriod <= 0) return periodCost;
  return periodCost * (projectProjected / projectPeriod);
}

/** Every service instance across every workspace, newest deploy first. */
export function serviceCatalog(bundles: WorkspaceBundle[]): ServiceCatalogRow[] {
  const rows: ServiceCatalogRow[] = [];
  for (const bundle of bundles) {
    if (!bundle.projects.ok) continue;
    const figures = workspaceFigures(bundle);
    const hasEnv = bundle.usage.ok ? bundle.usage.value.hasEnvironmentBreakdown : false;
    const usageReady = bundle.usage.ok;

    for (const project of bundle.projects.value) {
      const usage = figures.usageByProject.get(project.id);
      const projectPeriod = usage?.cost.total ?? 0;
      const projectProjected = figures.estimateByProject[project.id]?.total ?? null;
      const locked = isProtectedProject(project);

      for (const env of project.environments) {
        for (const inst of env.instances) {
          let periodCost: number | null = null;
          if (usageReady) {
            periodCost = hasEnv
              ? (usage?.byServiceEnvironment[`${inst.serviceId}|${env.id}`] ?? 0)
              : (usage?.services.find((s) => s.id === inst.serviceId)?.cost.total ?? 0);
          }
          const expectedCost = periodCost == null ? null : scaleExpected(periodCost, projectPeriod, projectProjected);

          rows.push({
            key: `${bundle.account.key}-${project.id}-${inst.serviceId}-${env.id}`,
            accountKey: bundle.account.key,
            workspaceName: bundle.workspace.name,
            projectId: project.id,
            projectName: project.name,
            protected: locked,
            serviceId: inst.serviceId,
            serviceName: inst.serviceName,
            environmentId: env.id,
            environmentName: env.name,
            isPrimary: env.id === project.primaryEnvironmentId,
            isEphemeral: env.isEphemeral,
            health: inst.health,
            degraded: inst.degraded,
            online: isOnlineHealth(inst.health),
            liveDeploymentIds: inst.liveDeploymentIds,
            latestId: inst.latest?.id ?? null,
            latestAt: inst.latest?.createdAt ?? null,
            latestLabel: relative(inst.latest?.createdAt),
            href: `/a/${bundle.account.key}/p/${project.id}/s/${inst.serviceId}?env=${env.id}`,
            periodCost,
            expectedCost,
            costIsAllEnvs: usageReady && !hasEnv,
            repo: inst.repo,
            projectDescription: project.description,
          });
        }
      }
    }
  }

  return sortServiceRows(rows, DEFAULT_SERVICE_SORT);
}
