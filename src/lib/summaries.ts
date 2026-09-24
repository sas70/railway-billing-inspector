import { periodProgress, projectPeriod, type CostBreakdown, type PeriodProjection } from "./billing";
import { isProtectedProject } from "./config";
import { money, plural, relative } from "./format";
import { isOnlineHealth } from "./health";
import type { ProjectSummary, ProjectUsage, WorkspaceBundle } from "./railway/api";
import type { ServiceCatalogRow } from "./service-row";

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
};

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
          if (inst.health === "crashed") {
            out.push({ key: `${inst.id}-crashed`, severity: 0, icon: "alert", title: `${where} has crashed`, detail: `${env.name} · ${when} · restart it or remove it`, href });
          } else if (inst.health === "failed") {
            out.push({ key: `${inst.id}-failed`, severity: 1, icon: "x", title: `${where}: latest deploy failed, nothing live`, detail: `${env.name} · ${when}`, href });
          } else if (inst.degraded) {
            out.push({ key: `${inst.id}-degraded`, severity: 1, icon: "alert", title: `${where}: newest deploy failed`, detail: `${env.name} · an older deployment is still serving`, href });
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
          });
        }
      }
      if (project.health.live + project.health.sleeping === 0 && usage && usage.cost.total >= 0.01) {
        out.push({
          key: `${project.id}-idle`,
          severity: 2,
          icon: "database",
          title: `${project.name}: nothing live, but ${money(usage.cost.total)} used this period`,
          detail: usage.cost.volume > 0 ? "Mostly volume storage — volumes bill until deleted" : "Usage from earlier in the period",
          href: base,
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

/** Every service instance across every workspace, sorted by expected $ (high → low). */
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
          });
        }
      }
    }
  }

  return rows.sort((a, b) => {
    const ae = a.expectedCost ?? -1;
    const be = b.expectedCost ?? -1;
    if (be !== ae) return be - ae;
    const ap = a.periodCost ?? -1;
    const bp = b.periodCost ?? -1;
    if (bp !== ap) return bp - ap;
    return a.serviceName.localeCompare(b.serviceName) || a.projectName.localeCompare(b.projectName);
  });
}
