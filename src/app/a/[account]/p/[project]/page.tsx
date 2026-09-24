import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ActionButton } from "@/components/ActionReview";
import { ErrorState } from "@/components/ErrorState";
import { Icon } from "@/components/Icon";
import {
  Badge,
  BarList,
  Breadcrumbs,
  Card,
  CardHeader,
  CostBreakdownBar,
  EmptyState,
  HealthPill,
  Money,
  Notice,
  PageTitle,
  PlanBadge,
  StatTile,
} from "@/components/ui";
import { getAccount, isProtectedProject, workspaceAllowed } from "@/lib/config";
import { isReadOnly } from "@/lib/write-mode";
import { dateShort, deploymentMeta, money, plural, relative, sizeMB } from "@/lib/format";
import {
  loadEnvironment,
  loadProject,
  loadWorkspaceBilling,
  loadWorkspaceEstimates,
  loadWorkspaceUsage,
  settle,
} from "@/lib/railway/api";

type Props = {
  params: Promise<{ account: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { account: accountKey, project: projectId } = await params;
  const account = getAccount(accountKey);
  if (!account) return { title: "Project" };
  const project = await settle(loadProject(account, projectId));
  return { title: project.ok ? project.value.name : "Project" };
}

export default async function ProjectPage({ params, searchParams }: Props) {
  await connection();
  const { account: accountKey, project: projectId } = await params;
  const sp = await searchParams;
  const account = getAccount(accountKey);
  if (!account) notFound();

  const projectResult = await settle(loadProject(account, projectId));
  if (!projectResult.ok) return <ErrorState title="Couldn't load this project" message={projectResult.error} />;
  const project = projectResult.value;
  if (!workspaceAllowed(account, project.workspace?.id)) {
    return <ErrorState title="Outside this token's workspace" message="This account is limited to one workspace (RAILWAY_TOKEN_…_WORKSPACE_ID)." />;
  }

  const envParam = one(sp.env);
  const env =
    project.environments.find((e) => e.id === envParam) ??
    project.environments.find((e) => e.id === project.primaryEnvironmentId) ??
    project.environments[0];
  const workspaceId = project.workspace?.id;

  const [envResult, billingResult] = await Promise.all([
    env ? settle(loadEnvironment(account, project.id, env.id)) : Promise.resolve(null),
    workspaceId ? settle(loadWorkspaceBilling(account, workspaceId)) : Promise.resolve(null),
  ]);
  const period = billingResult?.ok ? billingResult.value.period : undefined;
  const [usageResult, estimateResult] = await Promise.all([
    workspaceId ? settle(loadWorkspaceUsage(account, workspaceId, period)) : Promise.resolve(null),
    workspaceId ? settle(loadWorkspaceEstimates(account, workspaceId)) : Promise.resolve(null),
  ]);

  const usageView = usageResult?.ok ? usageResult.value : null;
  const usage = usageView?.projects.find((p) => p.id === project.id);
  const projected = estimateResult?.ok ? estimateResult.value.byProject[project.id] : undefined;
  const envView = envResult?.ok ? envResult.value : null;
  const readOnly = await isReadOnly();
  const locked = isProtectedProject(project);
  const destructiveLock = readOnly ? "Read-only — enable Write mode in the header" : locked ? "This project is protected (PROTECTED_PROJECTS)" : undefined;
  const base = `/a/${account.key}/p/${project.id}`;

  const liveCount = envView?.instances.filter((i) => i.healthInfo.health === "live" || i.healthInfo.health === "sleeping").length ?? 0;
  const volumeUsed = envView?.volumes.reduce((sum, v) => sum + v.currentSizeMB, 0) ?? 0;
  const volumeSize = envView?.volumes.reduce((sum, v) => sum + v.sizeMB, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={[{ label: "Overview", href: "/" }, { label: project.workspace?.name ?? "Workspace", href: "/" }, { label: project.name }]} />
        <PageTitle
          title={project.name}
          badges={
            <>
              {project.workspace && <PlanBadge plan={project.workspace.plan} />}
              {locked && (
                <Badge title="Listed in PROTECTED_PROJECTS: destructive actions are refused">
                  <Icon name="lock" size={10} /> protected
                </Badge>
              )}
              {project.prDeploys && <Badge>PR deploys on</Badge>}
              {project.deletedAt && <Badge tone="danger">deletion scheduled</Badge>}
            </>
          }
          subtitle={[project.description, `created ${dateShort(project.createdAt)}`].filter(Boolean).join(" · ")}
        />
      </div>

      {project.deletedAt && (
        <Notice tone="warning" title="Railway shows this project as deleted or scheduled for deletion">
          Marked {relative(project.deletedAt)}. If that was a mistake, cancel it in the danger zone at the bottom of this page while the 48-hour
          grace period lasts.
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Cost this period" value={<Money value={usage?.cost.total ?? (usageView ? 0 : null)} />} sub="all environments, from metered usage" />
        <StatTile label="Projected by period end" value={<Money value={projected?.total ?? null} />} sub="Railway's estimate" />
        <StatTile label={`Services live in ${env?.name ?? "—"}`} value={envView ? `${liveCount} / ${envView.instances.length}` : "—"} sub="live or sleeping / total" />
        <StatTile
          label={`Volumes in ${env?.name ?? "—"}`}
          value={!envView ? "—" : envView.volumes.length === 0 ? "None" : sizeMB(volumeUsed)}
          sub={
            envView && envView.volumes.length > 0
              ? `used · ${plural(envView.volumes.length, "volume")}, ${sizeMB(volumeSize)} allocated`
              : "no persistent storage here"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cost by service" subtitle="This billing period, all environments" />
          <div className="p-4">
            {!usageResult?.ok && usageResult ? (
              <p className="text-sm text-ink-2">{usageResult.error}</p>
            ) : (
              <BarList
                emptyText="No metered usage this period."
                rows={(usage?.services ?? []).map((s) => ({
                  key: s.id ?? s.name,
                  label: s.name,
                  href: s.id && !s.deleted && project.services.some((ps) => ps.id === s.id) ? `${base}/s/${s.id}${env ? `?env=${env.id}` : ""}` : undefined,
                  value: s.cost.total,
                  valueLabel: money(s.cost.total),
                  note: s.deleted ? "deleted" : undefined,
                }))}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Cost by resource" subtitle="This billing period, all environments" />
          <div className="p-4">
            {usage ? <CostBreakdownBar cost={usage.cost} /> : <p className="text-sm text-ink-2">No metered usage this period.</p>}
          </div>
        </Card>
      </div>

      <Card>
        <nav className="flex flex-wrap items-center gap-1 border-b border-line px-3 pt-2" aria-label="Environments">
          {project.environments.map((e) => {
            const active = e.id === env?.id;
            const cost = usage?.byEnvironment[e.id];
            return (
              <Link
                key={e.id}
                href={`${base}?env=${e.id}`}
                aria-current={active ? "page" : undefined}
                className={`-mb-px flex items-center gap-1.5 rounded-t-md border px-3 py-2 text-sm ${
                  active ? "border-line border-b-surface bg-surface font-medium" : "border-transparent text-ink-2 hover:text-ink"
                }`}
              >
                {e.name}
                {e.id === project.primaryEnvironmentId && <span className="text-xs text-ink-2">(primary)</span>}
                {e.isEphemeral && <Badge>PR{e.meta?.prNumber ? ` #${e.meta.prNumber}` : ""}</Badge>}
                {cost != null && cost > 0 && <span className="tabular text-xs text-ink-2">{money(cost)}</span>}
              </Link>
            );
          })}
        </nav>

        {!env && <EmptyState>This project has no environments.</EmptyState>}
        {envResult && !envResult.ok && (
          <div className="p-4">
            <Notice tone="error" title="Couldn't load this environment">{envResult.error}</Notice>
          </div>
        )}

        {envView && (
          <>
            {envView.instances.length === 0 ? (
              <EmptyState>No services in {envView.name}.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-2">
                      <th scope="col" className="px-4 py-2 font-medium">Service</th>
                      <th scope="col" className="px-2 py-2 font-medium">Status</th>
                      <th scope="col" className="px-2 py-2 font-medium">Latest deploy</th>
                      <th scope="col" className="px-2 py-2 font-medium">Runs on</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        {usageView?.hasEnvironmentBreakdown ? `Cost in ${envView.name}` : "Cost (all envs)"}
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {envView.instances.map((inst) => {
                      const href = `${base}/s/${inst.serviceId}?env=${envView.id}`;
                      const cost = usageView?.hasEnvironmentBreakdown
                        ? (usage?.byServiceEnvironment[`${inst.serviceId}|${envView.id}`] ?? 0)
                        : (usage?.services.find((s) => s.id === inst.serviceId)?.cost.total ?? 0);
                      const meta = deploymentMeta(inst.latestDeployment?.meta);
                      const vols = envView.volumes.filter((v) => v.serviceId === inst.serviceId);
                      return (
                        <tr key={inst.id} className="border-b border-line last:border-b-0 hover:bg-surface-2">
                          <td className="px-4 py-2.5 align-top">
                            <Link href={href} className="font-medium hover:underline underline-offset-2">
                              {inst.serviceName}
                            </Link>
                            <div className="mt-0.5 max-w-[16rem] truncate text-xs text-ink-2">
                              {inst.source?.repo ?? inst.source?.image ?? "no source"}
                            </div>
                            {vols.length > 0 && (
                              <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-2">
                                <Icon name="database" size={11} /> {vols.map((v) => `${v.volume.name} ${sizeMB(v.currentSizeMB)}`).join(", ")}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2.5 align-top">
                            <HealthPill health={inst.healthInfo.health} degraded={inst.healthInfo.degraded} />
                            {inst.sleepApplication && <div className="mt-1 text-xs text-ink-2">serverless (sleeps when idle)</div>}
                            {inst.cronSchedule && <div className="mt-1 font-mono text-xs text-ink-2">cron {inst.cronSchedule}</div>}
                          </td>
                          <td className="px-2 py-2.5 align-top text-xs">
                            <div className="text-ink-2">{relative(inst.latestDeployment?.createdAt)}</div>
                            {meta.message && <div className="max-w-[14rem] truncate">{meta.message}</div>}
                          </td>
                          <td className="px-2 py-2.5 align-top text-xs text-ink-2">
                            {plural(inst.numReplicas ?? 1, "replica")}
                            {inst.region && <div>{inst.region}</div>}
                          </td>
                          <td className="px-2 py-2.5 text-right align-top">
                            <Money value={usageView ? cost : null} />
                          </td>
                          <td className="px-4 py-2.5 text-right align-top">
                            <div className="inline-flex flex-wrap justify-end gap-1.5">
                              {inst.healthInfo.liveDeploymentIds.length > 0 && (
                                <ActionButton
                                  label="Take offline"
                                  icon="power"
                                  tone="neutral"
                                  disabled={!!destructiveLock}
                                  disabledReason={destructiveLock}
                                  request={{
                                    accountKey: account.key,
                                    kind: "deployment.remove",
                                    projectId: project.id,
                                    serviceId: inst.serviceId,
                                    environmentId: envView.id,
                                    targetIds: inst.healthInfo.liveDeploymentIds,
                                  }}
                                />
                              )}
                              <Link href={href} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink">
                                Deployments <Icon name="chevron" size={12} />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      {envView && envView.volumes.length > 0 && (
        <Card>
          <CardHeader title={`Volumes in ${envView.name}`} subtitle="Volumes bill for storage ($0.15 / GB / month) until they are deleted, even when nothing is running." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-2">
                  <th scope="col" className="px-4 py-2 font-medium">Volume</th>
                  <th scope="col" className="px-2 py-2 font-medium">Attached to</th>
                  <th scope="col" className="px-2 py-2 font-medium">Mount path</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Used</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {envView.volumes.map((v) => (
                  <tr key={v.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2">
                      {v.volume.name}
                      {v.isPendingDeletion && <Badge tone="danger">pending deletion</Badge>}
                    </td>
                    <td className="px-2 py-2">{envView.instances.find((i) => i.serviceId === v.serviceId)?.serviceName ?? "—"}</td>
                    <td className="px-2 py-2 font-mono text-xs">{v.mountPath}</td>
                    <td className="px-2 py-2 text-right tabular">{sizeMB(v.currentSizeMB)}</td>
                    <td className="px-4 py-2 text-right tabular text-ink-2">{sizeMB(v.sizeMB)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <section className="rounded-lg border bg-surface" style={{ borderColor: "color-mix(in oklab, var(--status-critical) 45%, transparent)" }}>
        <CardHeader title="Danger zone" subtitle="Each action opens a review of exactly what will change. Nothing runs until you approve it." />
        <div className="divide-y divide-[var(--border)]">
          {env && env.id !== project.primaryEnvironmentId && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="text-sm">
                <div className="font-medium">Delete environment “{env.name}”</div>
                <div className="text-ink-2">
                  Removes every service instance and volume in {env.name}. Other environments are untouched.
                  {env.isEphemeral && " PR environments are a common source of forgotten costs."}
                </div>
              </div>
              <ActionButton
                label={`Delete ${env.name}`}
                icon="trash"
                tone="danger"
                size="md"
                disabled={!!destructiveLock}
                disabledReason={destructiveLock}
                request={{ accountKey: account.key, kind: "environment.delete", projectId: project.id, targetIds: [env.id] }}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="text-sm">
              {project.deletedAt ? (
                <>
                  <div className="font-medium">Cancel scheduled deletion</div>
                  <div className="text-ink-2">Keeps the project if Railway is still inside the 48-hour grace period.</div>
                </>
              ) : (
                <>
                  <div className="font-medium">Delete this project</div>
                  <div className="text-ink-2">
                    Every service, environment, database and volume. Railway waits 48 hours before deleting, and you can cancel in that window.
                  </div>
                </>
              )}
            </div>
            {project.deletedAt ? (
              <ActionButton
                label="Cancel deletion"
                icon="rotate"
                tone="primary"
                size="md"
                disabled={readOnly}
                disabledReason="Read-only mode is on"
                request={{ accountKey: account.key, kind: "project.cancelDelete", projectId: project.id, targetIds: [project.id] }}
              />
            ) : (
              <ActionButton
                label="Delete project…"
                icon="trash"
                tone="danger"
                size="md"
                disabled={!!destructiveLock}
                disabledReason={destructiveLock}
                request={{ accountKey: account.key, kind: "project.scheduleDelete", projectId: project.id, targetIds: [project.id] }}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
