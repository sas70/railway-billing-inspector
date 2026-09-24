import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ActionButton } from "@/components/ActionReview";
import { DeploymentHistory, type DeploymentRowView } from "@/components/DeploymentHistory";
import { ErrorState } from "@/components/ErrorState";
import { Icon } from "@/components/Icon";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import {
  Badge,
  Breadcrumbs,
  Card,
  CardHeader,
  CostBreakdownBar,
  HealthPill,
  Money,
  Notice,
  PageTitle,
  StatTile,
  StatusPill,
} from "@/components/ui";
import { getAccount, isProtectedProject, workspaceAllowed } from "@/lib/config";
import { isReadOnly } from "@/lib/write-mode";
import { dateTime, deploymentMeta, money, plural, relative, shortId } from "@/lib/format";
import { formatMetric } from "@/lib/metric-format";
import {
  loadDeployments,
  loadProject,
  loadServiceInstance,
  loadServiceMetrics,
  loadWorkspaceBilling,
  loadWorkspaceUsage,
  METRIC_RANGES,
  settle,
  type MetricRange,
} from "@/lib/railway/api";

type Props = {
  params: Promise<{ account: string; project: string; service: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { account: accountKey, project: projectId, service: serviceId } = await params;
  const account = getAccount(accountKey);
  if (!account) return { title: "Service" };
  const project = await settle(loadProject(account, projectId));
  const service = project.ok ? project.value.services.find((s) => s.id === serviceId) : undefined;
  return { title: service && project.ok ? `${service.name} · ${project.value.name}` : "Service" };
}

export default async function ServicePage({ params, searchParams }: Props) {
  await connection();
  const { account: accountKey, project: projectId, service: serviceId } = await params;
  const sp = await searchParams;
  const account = getAccount(accountKey);
  if (!account) notFound();

  const projectResult = await settle(loadProject(account, projectId));
  if (!projectResult.ok) return <ErrorState title="Couldn't load this project" message={projectResult.error} />;
  const project = projectResult.value;
  if (!workspaceAllowed(account, project.workspace?.id)) {
    return <ErrorState title="Outside this token's workspace" message="This account is limited to one workspace (RAILWAY_TOKEN_…_WORKSPACE_ID)." />;
  }
  const projectHref = `/a/${account.key}/p/${project.id}`;
  const service = project.services.find((s) => s.id === serviceId);
  if (!service) {
    return <ErrorState title="Service not found" message="It may have been deleted, or it belongs to another project." backHref={projectHref} backLabel={`Back to ${project.name}`} />;
  }

  const envs = project.environments.filter((e) => e.serviceIds.includes(service.id));
  const envParam = one(sp.env);
  const env = envs.find((e) => e.id === envParam) ?? envs.find((e) => e.id === project.primaryEnvironmentId) ?? envs[0];
  if (!env) {
    return <ErrorState title={`${service.name} isn't deployed anywhere`} message="It has no instance in any environment." backHref={projectHref} backLabel={`Back to ${project.name}`} />;
  }

  const rangeParam = one(sp.range);
  const range: MetricRange = rangeParam && rangeParam in METRIC_RANGES ? (rangeParam as MetricRange) : "24h";
  const limitParam = Number(one(sp.n));
  const limit = [25, 50, 100].includes(limitParam) ? limitParam : 25;
  const ids = { projectId: project.id, serviceId: service.id, environmentId: env.id };
  const workspaceId = project.workspace?.id;

  const [instanceResult, deploymentsResult, metricsResult, billingResult] = await Promise.all([
    settle(loadServiceInstance(account, env.id, service.id)),
    settle(loadDeployments(account, ids, limit)),
    settle(loadServiceMetrics(account, ids, range)),
    workspaceId ? settle(loadWorkspaceBilling(account, workspaceId)) : Promise.resolve(null),
  ]);
  const period = billingResult?.ok ? billingResult.value.period : undefined;
  const usageResult = workspaceId ? await settle(loadWorkspaceUsage(account, workspaceId, period)) : null;

  const usageView = usageResult?.ok ? usageResult.value : null;
  const projectUsage = usageView?.projects.find((p) => p.id === project.id);
  const serviceUsage = projectUsage?.services.find((s) => s.id === service.id);
  const envCost = usageView?.hasEnvironmentBreakdown ? (projectUsage?.byServiceEnvironment[`${service.id}|${env.id}`] ?? 0) : null;

  const instance = instanceResult.ok ? instanceResult.value : null;
  const metrics = metricsResult.ok ? metricsResult.value : null;
  const readOnly = await isReadOnly();
  const locked = isProtectedProject(project);
  const lockReason = readOnly ? "Read-only — enable Write mode in the header" : locked ? "This project is protected (PROTECTED_PROJECTS)" : undefined;
  const destructiveLock = lockReason;
  const activeIds = new Set(instance?.healthInfo.liveDeploymentIds ?? []);
  const selfHref = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ env: env.id, range, n: String(limit), ...extra });
    return `${projectHref}/s/${service.id}?${q.toString()}`;
  };

  const rows: DeploymentRowView[] = deploymentsResult.ok
    ? deploymentsResult.value.deployments.map((d) => {
        const meta = deploymentMeta(d.meta);
        return {
          id: d.id,
          shortId: shortId(d.id),
          status: d.status,
          createdLabel: dateTime(d.createdAt),
          createdRelative: relative(d.createdAt),
          message: meta.message,
          branch: meta.branch,
          commit: meta.commitHash?.slice(0, 7),
          author: d.creator?.name ?? meta.author ?? undefined,
          reason: meta.reason,
          image: meta.image,
          isLive: activeIds.has(d.id),
          canRedeploy: d.canRedeploy,
          canRollback: d.canRollback,
        };
      })
    : [];

  const avg = (points: [number, number][]) => (points.length ? points.reduce((s, p) => s + p[1], 0) / points.length : null);
  const peak = (points: [number, number][]) => (points.length ? Math.max(...points.map((p) => p[1])) : null);
  const sum = (points: [number, number][]) => (points.length ? points.reduce((s, p) => s + p[1], 0) : null);
  const cpuAvg = metrics ? avg(metrics.cpu) : null;
  const memAvg = metrics ? avg(metrics.memory) : null;
  const egress = metrics ? sum(metrics.egress) : null;
  const liveDeployments = instance?.activeDeployments.filter((d) => activeIds.has(d.id)) ?? [];
  const domains = [...(instance?.domains.customDomains ?? []), ...(instance?.domains.serviceDomains ?? [])].map((d) => d.domain);

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Overview", href: "/" },
            { label: project.workspace?.name ?? "Workspace", href: "/" },
            { label: project.name, href: `${projectHref}?env=${env.id}` },
            { label: service.name },
          ]}
        />
        <PageTitle
          title={service.name}
          badges={
            <>
              {instance && <HealthPill health={instance.healthInfo.health} degraded={instance.healthInfo.degraded} />}
              <Badge>{env.name}</Badge>
              {instance?.sleepApplication && <Badge title="Serverless: Railway stops it when idle">serverless</Badge>}
              {instance?.cronSchedule && <Badge title="Cron schedule">cron {instance.cronSchedule}</Badge>}
            </>
          }
          subtitle={
            instance ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{instance.source?.repo ?? instance.source?.image ?? "no source"}</span>
                <span>
                  {plural(instance.numReplicas ?? 1, "replica")}
                  {instance.region ? ` · ${instance.region}` : ""}
                </span>
                {domains.slice(0, 3).map((domain) => (
                  <a key={domain} href={`https://${domain}`} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">
                    {domain} <Icon name="external" size={11} />
                  </a>
                ))}
              </span>
            ) : undefined
          }
        />
      </div>

      {!instanceResult.ok && <Notice tone="error" title="Couldn't load this service instance">{instanceResult.error}</Notice>}

      {envs.length > 1 && (
        <nav aria-label="Environments" className="flex flex-wrap gap-1">
          {envs.map((e) => (
            <Link
              key={e.id}
              href={`${projectHref}/s/${service.id}?env=${e.id}&range=${range}`}
              aria-current={e.id === env.id ? "page" : undefined}
              className={`rounded-md border px-3 py-1.5 text-sm ${e.id === env.id ? "border-line-strong bg-surface font-medium" : "border-line text-ink-2 hover:text-ink"}`}
            >
              {e.name}
              {e.isEphemeral && <span className="ml-1 text-xs text-ink-2">(PR)</span>}
            </Link>
          ))}
        </nav>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={envCost != null ? `Cost in ${env.name} this period` : "Cost this period"}
          value={<Money value={envCost ?? serviceUsage?.cost.total ?? (usageView ? 0 : null)} />}
          sub={serviceUsage ? `all environments: ${money(serviceUsage.cost.total)}` : usageResult && !usageResult.ok ? usageResult.error : "no metered usage"}
        />
        <StatTile
          label={`CPU · ${METRIC_RANGES[range].label.toLowerCase()}`}
          value={cpuAvg != null ? formatMetric("cpu", cpuAvg) : "—"}
          sub={metrics && peak(metrics.cpu) != null ? `average · peak ${formatMetric("cpu", peak(metrics.cpu)!)}` : "no samples"}
        />
        <StatTile
          label={`Memory · ${METRIC_RANGES[range].label.toLowerCase()}`}
          value={memAvg != null ? formatMetric("memory", memAvg) : "—"}
          sub={metrics && peak(metrics.memory) != null ? `average · peak ${formatMetric("memory", peak(metrics.memory)!)}` : "no samples"}
        />
        <StatTile
          label={`Egress · ${METRIC_RANGES[range].label.toLowerCase()}`}
          value={egress != null ? formatMetric("network", egress) : "—"}
          sub="$0.05 per GB leaving Railway"
        />
      </div>

      <Card>
        <CardHeader
          title="Resources"
          subtitle={
            metrics && (metrics.cpuLimit || metrics.memoryLimit)
              ? `Limits per replica: ${metrics.cpuLimit ? `${metrics.cpuLimit} vCPU` : "—"} · ${metrics.memoryLimit ? `${metrics.memoryLimit} GB` : "—"}. You're billed for what's used, not the limit.`
              : "You're billed for CPU and memory actually used, not for the limits."
          }
          actions={
            <div role="group" aria-label="Time range" className="flex rounded-md border border-line p-0.5">
              {(Object.keys(METRIC_RANGES) as MetricRange[]).map((key) => (
                <Link
                  key={key}
                  href={selfHref({ range: key })}
                  aria-current={key === range ? "true" : undefined}
                  className={`rounded px-2 py-0.5 text-xs ${key === range ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
                >
                  {key}
                </Link>
              ))}
            </div>
          }
        />
        {!metricsResult.ok ? (
          <div className="p-4">
            <Notice tone="warning" title="Metrics unavailable">{metricsResult.error}</Notice>
          </div>
        ) : (
          <div className="grid gap-6 p-4 lg:grid-cols-3">
            <TimeSeriesChart title="CPU" kind="cpu" points={metricsResult.value.cpu} />
            <TimeSeriesChart title="Memory" kind="memory" points={metricsResult.value.memory} />
            <TimeSeriesChart title="Network egress" kind="network" points={metricsResult.value.egress} aggregate="sum" />
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={`Live in ${env.name}`} subtitle="What is serving traffic right now" />
          <div className="p-4">
            {liveDeployments.length === 0 ? (
              <p className="text-sm text-ink-2">
                Nothing is live in {env.name}
                {instance?.latestDeployment ? ` — latest deployment is ${instance.latestDeployment.status.toLowerCase()} (${relative(instance.latestDeployment.createdAt)}).` : "."}
              </p>
            ) : (
              <ul className="space-y-3">
                {liveDeployments.map((d) => {
                  const row = rows.find((r) => r.id === d.id);
                  return (
                    <li key={d.id} className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 text-sm">
                        <div className="flex items-center gap-2">
                          <StatusPill status={d.status} />
                          <span className="font-mono text-xs text-ink-2">{shortId(d.id)}</span>
                        </div>
                        <div className="mt-1 truncate">{row?.message ?? row?.image ?? "Deployment"}</div>
                        <div className="text-xs text-ink-2">deployed {relative(d.createdAt)}</div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <ActionButton
                          label="Restart"
                          icon="rotate"
                          disabled={!!lockReason}
                          disabledReason={lockReason}
                          request={{ accountKey: account.key, kind: "deployment.restart", ...ids, targetIds: [d.id] }}
                        />
                        <ActionButton
                          label="Take offline"
                          icon="power"
                          tone="danger"
                          disabled={!!destructiveLock}
                          disabledReason={destructiveLock}
                          request={{ accountKey: account.key, kind: "deployment.remove", ...ids, targetIds: [d.id] }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Cost by resource" subtitle="This service, all environments, this billing period" />
          <div className="p-4">
            {serviceUsage ? <CostBreakdownBar cost={serviceUsage.cost} /> : <p className="text-sm text-ink-2">No metered usage this period.</p>}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Deployments"
          subtitle={`${env.name} · newest first · select to remove or restart; removed ones stay listed as history`}
          actions={
            <div className="flex items-center gap-1 text-xs text-ink-2">
              Show
              {[25, 50, 100].map((n) => (
                <Link
                  key={n}
                  href={selfHref({ n: String(n) })}
                  aria-current={n === limit ? "true" : undefined}
                  className={`rounded px-1.5 py-0.5 ${n === limit ? "bg-surface-2 font-medium text-ink" : "hover:text-ink"}`}
                >
                  {n}
                </Link>
              ))}
            </div>
          }
        />
        {!deploymentsResult.ok ? (
          <div className="p-4">
            <Notice tone="error" title="Couldn't load deployments">{deploymentsResult.error}</Notice>
          </div>
        ) : (
          <>
            <DeploymentHistory
              accountKey={account.key}
              projectId={project.id}
              serviceId={service.id}
              environmentId={env.id}
              rows={rows}
              readOnly={readOnly}
              protectedProject={locked}
            />
            {deploymentsResult.value.hasMore && (
              <p className="border-t border-line px-4 py-2 text-xs text-ink-2">
                Older deployments exist.{" "}
                {limit < 100 ? (
                  <Link href={selfHref({ n: String(limit === 25 ? 50 : 100) })} className="link">
                    Show more
                  </Link>
                ) : (
                  "Showing the newest 100."
                )}
              </p>
            )}
          </>
        )}
      </Card>

      <section className="rounded-lg border bg-surface" style={{ borderColor: "color-mix(in oklab, var(--status-critical) 45%, transparent)" }}>
        <CardHeader title="Danger zone" subtitle="Opens a review first. Nothing runs until you approve it." />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm">
            <div className="font-medium">
              Delete {service.name} from {env.name}
            </div>
            <div className="text-ink-2">
              Deletes the service and all its deployments in this environment
              {envs.length > 1 ? `; it stays in ${envs.filter((e) => e.id !== env.id).map((e) => e.name).join(", ")}` : ", and the service itself"}.
            </div>
          </div>
          <ActionButton
            label="Delete service…"
            icon="trash"
            tone="danger"
            size="md"
            disabled={!!destructiveLock}
            disabledReason={destructiveLock}
            request={{ accountKey: account.key, kind: "service.delete", projectId: project.id, environmentId: env.id, targetIds: [service.id] }}
          />
        </div>
      </section>
    </div>
  );
}
