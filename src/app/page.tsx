import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { BlurbCard } from "@/components/BlurbCard";
import { HoverLink } from "@/components/HoverLink";
import { Icon } from "@/components/Icon";
import { OverviewSearch } from "@/components/OverviewSearch";
import { ProjectLinks } from "@/components/ProjectLinks";
import { ProjectRename } from "@/components/ProjectRename";
import { buttonClass } from "@/components/button";
import { SetupGuide } from "@/components/SetupGuide";
import { StoppedBillingAlert } from "@/components/StoppedBillingAlert";
import { WorthALook } from "@/components/WorthALook";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  HealthSummary,
  Meter,
  Money,
  Notice,
  PageTitle,
  PlanBadge,
  StatTile,
} from "@/components/ui";
import { repoBlurbs } from "@/lib/code/blurbs";
import { repoKey } from "@/lib/code/sources";
import { isProtectedProject, unmatchedProtectedEntries } from "@/lib/config";
import { isReadOnly } from "@/lib/write-mode";
import { dateNoYear, money, plural, relative } from "@/lib/format";
import { emptyHealthCounts, needsAttention } from "@/lib/health";
import { isGeneratedRailwayName, projectNameHints } from "@/lib/project-name";
import { loadAccountViews, loadWorkspaceBundle, uniqueWorkspaceTargets, type WorkspaceBundle } from "@/lib/railway/api";
import { ensureIndex } from "@/lib/search-index/build";
import { blurbText, type RepoBlurb } from "@/lib/repo-blurb";
import { billStructure, cleanupCandidates, projectCost, stoppedBillingSummary, workspaceFigures } from "@/lib/summaries";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  await connection();
  const readOnly = await isReadOnly();
  const accounts = await loadAccountViews();
  if (accounts.length === 0) return <SetupGuide />;

  const bundles: WorkspaceBundle[] = await Promise.all(
    uniqueWorkspaceTargets(accounts).map(({ account, workspace }) => loadWorkspaceBundle(account, workspace, { recent: true })),
  );
  const allProjects = bundles.flatMap((b) => (b.projects.ok ? b.projects.value : []));
  // First run (or a day later): build the search index in the background from what was just read.
  ensureIndex();
  const unmatchedProtected = bundles.every((b) => b.projects.ok) ? unmatchedProtectedEntries(allProjects) : [];
  // Hover cards: saved summaries / local READMEs only, so this adds no Railway or GitHub calls.
  const blurbs = await repoBlurbs(allProjects.flatMap((p) => p.repos));

  const totals = emptyHealthCounts();
  let projectCount = 0;
  let usageToDate = 0;
  let projected = 0;
  let projectedComplete = true;
  for (const bundle of bundles) {
    const figures = workspaceFigures(bundle);
    if (figures.usageToDate != null) usageToDate += figures.usageToDate;
    if (figures.projection?.projectedCost != null) projected += figures.projection.projectedCost;
    else projectedComplete = false;
    if (!bundle.projects.ok) continue;
    for (const project of bundle.projects.value) {
      projectCount++;
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += project.health[key];
    }
  }
  const candidates = cleanupCandidates(bundles);
  const stoppedBilling = stoppedBillingSummary(bundles);
  const workspaceCount = bundles.length;
  const randomNames = allProjects
    .filter((p) => !p.deletedAt && !isProtectedProject(p) && isGeneratedRailwayName(p.name, projectNameHints(p)))
    .map((p) => p.name);

  if (workspaceCount === 0) {
    return (
      <div className="space-y-4">
        <PageTitle title="Overview" subtitle="Nothing to show until at least one token can read a workspace." />
        {accounts
          .filter((a) => a.error)
          .map((a) => (
            <Notice key={a.key} tone="error" title={`Token “${a.label}” isn't working`}>
              {a.error}
            </Notice>
          ))}
        {accounts.every((a) => !a.error) && (
          <Notice tone="info" title="No workspaces found">
            The token works but can&apos;t see any workspace. Account tokens should be created with “No workspace”.
          </Notice>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Overview"
        subtitle={`Your infrastructure, at a glance. Costs and service health across ${plural(workspaceCount, "workspace")}. Search every workspace. Each project lists its public *.up.railway.app URL and a direct Railway dashboard link.`}
        actions={
          <>
            <Link href="/rename" className={buttonClass("ghost", "md")}>
              <Icon name="pencil" size={13} /> Rename projects
            </Link>
            <Link href="/services" className={buttonClass("neutral", "md")}>
              Explore services <Icon name="chevron" size={14} />
            </Link>
          </>
        }
      />
      <StoppedBillingAlert summary={stoppedBilling} />
      <OverviewSearch totalProjects={projectCount} />

      {accounts
        .filter((a) => a.error)
        .map((a) => (
          <Notice key={a.key} tone="error" title={`Token “${a.label}” isn't working`}>
            {a.error}
          </Notice>
        ))}

      {unmatchedProtected.length > 0 && (
        <Notice tone="warning" title="Some PROTECTED_PROJECTS entries don't match any project">
          {unmatchedProtected.map((e) => `“${e}”`).join(", ")} — check the spelling or use the project ID, otherwise that project is not protected.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="cost-summary flex flex-col p-6 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Projected period cost</div>
            <Icon name="wallet" size={20} className="opacity-60" />
          </div>
          <div className="mt-5 flex flex-wrap items-baseline gap-3">
            <span className="text-6xl font-semibold tracking-[-0.055em] tabular">{money(projected)}</span>
            <span className="cost-summary-muted text-xs">{projectedComplete ? "estimated" : "partial estimate"}</span>
          </div>
          <p className="cost-summary-muted mt-3 max-w-sm text-xs leading-relaxed">
            Plan fees + usage above included allowances. Before tax and credits.
            {!projectedComplete && " Some workspaces have no billing access."}
          </p>
          <div className="cost-summary-footer flex flex-wrap items-end justify-between gap-4 border-t pt-5">
            <div><div className="cost-summary-muted text-xs">Usage so far</div><div className="mt-1 text-xl font-semibold tabular">{money(usageToDate)}</div></div>
            <Link href="/billing" className="inline-flex items-center gap-2 rounded-md py-1 text-sm font-medium underline-offset-4 hover:underline">View billing <Icon name="chevron" size={14} /></Link>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-4">
          <StatTile label="Projects" icon="layers" iconColor="var(--series-1)" value={projectCount} sub={plural(workspaceCount, "workspace")} />
          <StatTile label="Live services" icon="power" iconColor="var(--good-text)" value={totals.live} sub={totals.sleeping ? `+ ${totals.sleeping} sleeping` : "running now"} />
          <StatTile
            label="Needs attention"
            icon="alert"
            iconColor={needsAttention(totals) > 0 ? "var(--status-critical)" : "var(--ink-2)"}
            value={needsAttention(totals)}
            sub="crashed, failed or degraded"
          />
          <StatTile label="Offline / removed" icon="moon" value={totals.offline} sub="nothing currently live" />
        </div>
      </div>

      {candidates.length > 0 && <WorthALook candidates={candidates} structure={billStructure(bundles)} renderedAt={Date.now()} />}

      {randomNames.length > 0 && (
        <Notice tone="info" title={`${plural(randomNames.length, "project")} still ${randomNames.length === 1 ? "has" : "have"} the random name Railway picked`}>
          {listNames(randomNames)} {randomNames.length === 1 ? "doesn't" : "don't"} say what {randomNames.length === 1 ? "it runs" : "they run"}.{" "}
          <Link href="/rename" className="link">
            Rename {randomNames.length === 1 ? "it" : "them"} in one review
          </Link>
          , with names suggested from each project&apos;s code summary or repo.
        </Notice>
      )}

      {bundles.map((bundle) => (
        <WorkspaceSection
          key={`${bundle.account.key}-${bundle.workspace.id}`}
          bundle={bundle}
          showAccount={accounts.length > 1}
          readOnly={readOnly}
          blurbs={blurbs}
        />
      ))}
    </div>
  );
}

/** “a”, “a and b”, “a, b, c and 2 more” */
function listNames(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown.join("");
}

function WorkspaceSection({
  bundle,
  showAccount,
  readOnly,
  blurbs,
}: {
  bundle: WorkspaceBundle;
  showAccount: boolean;
  readOnly: boolean;
  blurbs: Map<string, RepoBlurb>;
}) {
  const figures = workspaceFigures(bundle);
  const billing = bundle.billing.ok ? bundle.billing.value : null;
  const projects = bundle.projects.ok ? bundle.projects.value : [];
  const period = billing?.period;
  const included = figures.projection?.included ?? 0;

  return (
    <Card className="workspace-card overflow-hidden" data-workspace-section>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2 text-base">
            <span className="workspace-avatar" aria-hidden="true">{bundle.workspace.name.slice(0, 1).toUpperCase()}</span>
            {bundle.workspace.name}
            <PlanBadge plan={billing?.plan ?? bundle.workspace.plan} trial={billing?.isTrialing} />
            {showAccount && <span className="text-xs font-normal text-ink-2">via {bundle.account.label}</span>}
          </span>
        }
        subtitle={
          period && figures.progress
            ? `Billing period ${dateNoYear(period.start)} – ${dateNoYear(period.end)} · ${plural(figures.progress.remainingDays, "day")} left`
            : undefined
        }
        actions={
          <Link href={`/billing#ws-${bundle.workspace.id}`} className="link text-sm">
            Billing →
          </Link>
        }
      />

      <div className="workspace-figures grid gap-5 border-b border-line p-5 sm:grid-cols-3">
        <div>
          <div className="text-xs text-ink-2">Usage so far</div>
          <div className="mt-0.5 text-xl font-semibold tabular">{money(figures.usageToDate)}</div>
          {figures.usageToDate != null && included > 0 && (
            <div className="mt-2 space-y-1">
              <Meter value={figures.usageToDate} max={included} label={`Usage against the ${money(included)} included in the plan`} />
              <div className="text-xs text-ink-2">
                {figures.usageToDate > included
                  ? `${money(figures.usageToDate - included)} over the ${money(included)} included`
                  : `of ${money(included)} included in the plan`}
              </div>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-ink-2">Projected usage by period end</div>
          <div className="mt-0.5 text-xl font-semibold tabular">{money(figures.projection?.projectedUsage)}</div>
          <div className="mt-1 text-xs text-ink-2">Railway&apos;s estimate if current usage continues</div>
        </div>
        <div>
          <div className="text-xs text-ink-2">Projected cost for the period</div>
          <div className="mt-0.5 text-xl font-semibold tabular">{money(figures.projection?.projectedCost)}</div>
          <div className="mt-1 text-xs text-ink-2">
            {figures.projection
              ? `${money(figures.projection.fee)} plan + ${money(figures.projection.projectedOverage)} over included`
              : "Needs billing access"}
          </div>
        </div>
      </div>

      <div className="space-y-2 px-4 pt-3 empty:hidden">
        {!bundle.projects.ok && <Notice tone="error" title="Couldn't load projects">{bundle.projects.error}</Notice>}
        {!bundle.billing.ok && (
          <Notice tone="warning" title="Billing isn't readable with this token">
            {bundle.billing.error} Workspace billing needs admin access to the workspace.
          </Notice>
        )}
        {!bundle.usage.ok && <Notice tone="warning" title="Usage isn't available">{bundle.usage.error}</Notice>}
      </div>

      {projects.length === 0 && bundle.projects.ok ? (
        <EmptyState>No projects in this workspace.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                <th scope="col" className="px-4 py-2 font-medium">Project</th>
                <th scope="col" className="px-2 py-2 font-medium">Services</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Envs</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">This period</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Projected</th>
                <th scope="col" className="px-2 py-2 font-medium">Last deploy</th>
                <th scope="col" className="w-8 px-4 py-2">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const href = `/a/${bundle.account.key}/p/${project.id}`;
                const cost = projectCost(figures, project);
                const prEnvs = project.environments.filter((e) => e.isEphemeral).length;
                const search = [
                  project.name,
                  project.description ?? "",
                  bundle.workspace.name,
                  bundle.account.label,
                  ...project.environments.flatMap((e) => e.instances.map((i) => i.serviceName)),
                  ...project.publicDomains,
                  ...project.repos,
                  project.id,
                ]
                  .join(" ")
                  .toLowerCase();
                const projectBlurbs = project.repos.flatMap((r) => blurbs.get(repoKey(r)) ?? []);
                const nameClass = "font-medium hover:underline underline-offset-2";
                return (
                  <tr
                    key={project.id}
                    data-project-row
                    data-search={search}
                    className="border-b border-line last:border-b-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {projectBlurbs.length > 0 || project.description ? (
                          <HoverLink
                            href={href}
                            className={nameClass}
                            card={<BlurbCard blurbs={projectBlurbs} description={project.description} />}
                            description={blurbText(projectBlurbs, project.description)}
                          >
                            {project.name}
                          </HoverLink>
                        ) : (
                          <Link href={href} className={nameClass}>
                            {project.name}
                          </Link>
                        )}
                        {isProtectedProject(project) && (
                          <Badge title="Listed in PROTECTED_PROJECTS">
                            <Icon name="lock" size={10} /> protected
                          </Badge>
                        )}
                        {project.deletedAt && <Badge tone="danger">deletion scheduled</Badge>}
                      </div>
                      {project.description && <div className="max-w-xs truncate text-xs text-ink-2">{project.description}</div>}
                      <ProjectLinks publicDomains={project.publicDomains} projectId={project.id} repos={project.repos} />
                      <ProjectRename
                        accountKey={bundle.account.key}
                        projectId={project.id}
                        currentName={project.name}
                        generated={isGeneratedRailwayName(project.name, projectNameHints(project))}
                        readOnly={readOnly}
                        lockedReason={
                          isProtectedProject(project)
                            ? `${project.name} is listed in PROTECTED_PROJECTS`
                            : project.deletedAt
                              ? "Scheduled for deletion"
                              : undefined
                        }
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <HealthSummary counts={project.health} />
                    </td>
                    <td className="px-2 py-2.5 text-right tabular">
                      {project.environments.length}
                      {prEnvs > 0 && <span className="ml-1 text-xs text-ink-2">({prEnvs} PR)</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <Money value={cost.period} />
                    </td>
                    <td className="px-2 py-2.5 text-right text-ink-2">
                      <Money value={cost.projected} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-xs text-ink-2">{relative(project.lastDeployAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={href} aria-label={`Open ${project.name}`} className="text-ink-2 hover:text-ink">
                        <Icon name="chevron" size={14} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
