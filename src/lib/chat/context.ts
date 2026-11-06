import "server-only";

import { savedSummaries } from "../code/ai-summary";
import { repoKey } from "../code/sources";
import { isProtectedProject } from "../config";
import { isGeneratedRailwayName } from "../project-name";
import { loadAccountViews, loadWorkspaceBundle, uniqueWorkspaceTargets, type WorkspaceBundle } from "../railway/api";
import { billStructure, stoppedBillingSummary, workspaceFigures } from "../summaries";
import { billStatus, RECENT_DAYS } from "../worth-a-look";
import type { ChatProject, ChatSnapshot } from "./types";

/**
 * What the assistant knows: one compact line of facts per project, read from the same saved
 * Railway reads the Overview uses (so asking a question normally costs no Railway requests).
 * No secrets: no variables, tokens or logs.
 */
export async function chatSnapshot(): Promise<ChatSnapshot> {
  const accounts = await loadAccountViews();
  const bundles: WorkspaceBundle[] = await Promise.all(
    uniqueWorkspaceTargets(accounts).map(({ account, workspace }) => loadWorkspaceBundle(account, workspace, { recent: true })),
  );
  const repos = [...new Set(bundles.flatMap((b) => (b.projects.ok ? b.projects.value.flatMap((p) => p.repos) : [])))];
  const summaries = await savedSummaries(repos);

  const dataIssues = accounts.filter((a) => a.error).map((a) => `Account ${a.label}: workspace list unavailable.`);
  for (const b of bundles) {
    if (!b.projects.ok) dataIssues.push(`${b.workspace.name}: projects unavailable.`);
    if (!b.usage.ok) dataIssues.push(`${b.workspace.name}: project costs unavailable.`);
    if (!b.recent?.ok) dataIssues.push(`${b.workspace.name}: recent charges unavailable.`);
  }
  const projects: ChatProject[] = [];
  for (const bundle of bundles) {
    if (!bundle.projects.ok) continue;
    const figures = workspaceFigures(bundle);
    const recent = bundle.recent?.ok ? bundle.recent.value : null;
    for (const p of bundle.projects.value) {
      if (p.deletedAt) continue;
      const cost = figures.usageByProject.get(p.id)?.cost;
      const recentTotal = recent ? (recent[p.id]?.total ?? 0) : null;
      const running = p.health.live + p.health.sleeping;
      const stopped = p.environments.flatMap((e) => e.instances.filter((i) => i.stoppedDeploymentIds.length > 0).map((i) => i.serviceName));
      const firstStopped = p.environments.flatMap((e) => e.instances.filter((i) => i.stoppedDeploymentIds.length > 0).map((i) => ({ e, i })))[0];
      const summary = p.repos.map((r) => summaries.get(repoKey(r))?.summary).find(Boolean);
      projects.push({
        name: p.name,
        href: `/a/${bundle.account.key}/p/${p.id}`,
        workspace: bundle.workspace.name,
        about: summary ? `${summary.name}: ${summary.summary}` : (p.description ?? null),
        repos: p.repos,
        services: p.serviceCount,
        live: p.health.live,
        sleeping: p.health.sleeping,
        attention: p.health.crashed + p.health.failed + p.health.degraded,
        status: running === 0 && recentTotal == null ? "unknown" : billStatus({ running, recent: recentTotal, volumeSoFar: cost?.volume ?? 0 }),
        costThisPeriod: bundle.usage.ok ? (cost?.total ?? 0) : null,
        costPerDayRecent: recentTotal == null ? null : recentTotal / RECENT_DAYS,
        biggestCost: cost ? biggestPart(cost) : null,
        stoppedButBilled: stopped,
        stoppedHref: firstStopped ? `/a/${bundle.account.key}/p/${p.id}/s/${firstStopped.i.serviceId}?env=${firstStopped.e.id}` : null,
        randomName: isGeneratedRailwayName(p.name),
        protected: isProtectedProject(p),
        lastDeployAt: p.lastDeployAt,
      });
    }
  }

  const structure = billStructure(bundles);
  const stoppedBilling = stoppedBillingSummary(bundles);
  const plans = bundles.map((b) => {
    const f = workspaceFigures(b);
    return { workspace: b.workspace.name, usageSoFar: f.usageToDate ?? null, projected: f.projection?.projectedCost ?? null };
  });
  return {
    dataIssues,
    projects,
    workspaces: plans,
    offStillCharging: { projects: structure.charging.projects, perDay: structure.charging.perDay },
    stoppedBilling: { services: stoppedBilling.services, perDay: stoppedBilling.perDay },
  };
}

function biggestPart(cost: { cpu: number; memory: number; egress: number; volume: number; backup: number }): string | null {
  const parts: [string, number][] = [
    ["CPU", cost.cpu],
    ["memory", cost.memory],
    ["network egress", cost.egress],
    ["volume storage", cost.volume],
    ["backups", cost.backup],
  ];
  const [name, value] = parts.sort((a, b) => b[1] - a[1])[0];
  return value > 0 ? name : null;
}
