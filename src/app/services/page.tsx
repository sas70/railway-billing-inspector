import type { Metadata } from "next";
import { connection } from "next/server";

import { ServicesBoard } from "@/components/ServicesBoard";
import { ServicesTable } from "@/components/ServicesTable";
import { SetupGuide } from "@/components/SetupGuide";
import { Notice, PageTitle } from "@/components/ui";
import { repoBlurbs } from "@/lib/code/blurbs";
import { repoKey } from "@/lib/code/sources";
import { isEnvReadOnly } from "@/lib/config";
import { loadAccountViews, loadWorkspaceBundle, uniqueWorkspaceTargets, type WorkspaceBundle } from "@/lib/railway/api";
import { isStatusFilter } from "@/lib/service-stats";
import { serviceCatalog } from "@/lib/summaries";
import { isReadOnly } from "@/lib/write-mode";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ show?: string | string[] }> }) {
  await connection();
  const { show } = await searchParams;
  const initialFilter = typeof show === "string" && isStatusFilter(show) ? show : "all";
  const accounts = await loadAccountViews();
  if (accounts.length === 0) return <SetupGuide />;

  const bundles: WorkspaceBundle[] = await Promise.all(
    uniqueWorkspaceTargets(accounts).map(({ account, workspace }) => loadWorkspaceBundle(account, workspace)),
  );
  const rows = serviceCatalog(bundles);
  // Hover cards: saved summaries / local READMEs only, so this adds no Railway or GitHub calls.
  const blurbs = await repoBlurbs(rows.flatMap((r) => (r.repo ? [r.repo] : [])));
  const tableRows = rows.map((r) => ({ ...r, blurb: r.repo ? (blurbs.get(repoKey(r.repo)) ?? null) : null }));
  const usageMissing = bundles.some((b) => !b.usage.ok);
  const readOnly = await isReadOnly();
  const envLocked = isEnvReadOnly();

  return (
    <div className="space-y-6">
      <PageTitle
        title="Services"
        subtitle="Every service across every workspace, newest deploy first. Click a column to sort by cost, status, or name. Turn one off or on — you'll review the plan before anything changes."
      />

      {accounts
        .filter((a) => a.error)
        .map((a) => (
          <Notice key={a.key} tone="error" title={`Token “${a.label}” isn't working`}>
            {a.error}
          </Notice>
        ))}

      {bundles.map((b) =>
        b.projects.ok ? null : (
          <Notice key={`${b.account.key}-${b.workspace.id}`} tone="error" title={`Couldn't load projects in ${b.workspace.name}`}>
            {b.projects.error}
          </Notice>
        ),
      )}

      {usageMissing && (
        <Notice tone="warning" title="Some usage figures are missing">
          Expected cost falls back to $0 for those workspaces. Refresh after Railway usage is readable.
        </Notice>
      )}

      {readOnly && (
        <Notice tone="info" title={envLocked ? "Read-only is locked in .env" : "Read-only until you enable Write mode"}>
          {envLocked
            ? "DASHBOARD_READ_ONLY is on, so Turn on / Turn off stay disabled."
            : "Click Write mode in the header to enable Turn on / Turn off. You'll still review each change before it runs."}
        </Notice>
      )}

      <ServicesBoard rows={rows} readOnly={readOnly} initialFilter={initialFilter}>
        <ServicesTable rows={tableRows} readOnly={readOnly} />
      </ServicesBoard>
    </div>
  );
}
