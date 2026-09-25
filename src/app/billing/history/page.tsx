import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { CostHistory } from "@/components/CostHistory";
import { SetupGuide } from "@/components/SetupGuide";
import { Breadcrumbs, Card, CardHeader, EmptyState, Notice, PageTitle, StatTile } from "@/components/ui";
import { changeMoney, changePercent, compareHistory, historyRangeLabel, historyWindows } from "@/lib/cost-history";
import { money, plural } from "@/lib/format";
import { loadAccountViews, loadWorkspaceUsage, settle, uniqueWorkspaceTargets } from "@/lib/railway/api";

export const metadata: Metadata = { title: "Cost history" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CostHistoryPage({ searchParams }: Props) {
  await connection();
  const sp = await searchParams;
  const days = sp.days === "7" ? 7 : 30;
  const windows = historyWindows(days);
  const accounts = await loadAccountViews();
  if (accounts.length === 0) return <SetupGuide />;
  const targets = uniqueWorkspaceTargets(accounts);
  const entries = await Promise.all(targets.map(async ({ account, workspace }) => {
    const [recent, previous] = await Promise.all([
      settle(loadWorkspaceUsage(account, workspace.id, windows.recent)),
      settle(loadWorkspaceUsage(account, workspace.id, windows.previous)),
    ]);
    return { accountKey: account.key, workspace, recent, previous };
  }));
  const comparison = compareHistory(entries);
  const incomplete = comparison.excluded.length > 0 || accounts.some((a) => a.error);
  const largestIncrease = comparison.rows.find((row) => row.delta > 0);
  const largestDecrease = comparison.rows.find((row) => row.delta < 0);
  const max = Math.max(comparison.previous, comparison.recent, 0.01);

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={[{ label: "Billing", href: "/billing" }, { label: "Cost history" }]} />
        <PageTitle title="Cost history" subtitle="See where spending changed, and which projects drove it. Compare equal windows of metered resource usage."
          actions={<div role="group" aria-label="Comparison window" className="flex rounded-lg border border-line bg-surface p-1 text-sm">
            {([7, 30] as const).map((value) => <Link key={value} href={`/billing/history?days=${value}`} aria-current={days === value ? "true" : undefined} className={`rounded-md px-3 py-1.5 ${days === value ? "bg-surface-2 font-semibold" : "text-ink-2 hover:text-ink"}`}>Last {value} days</Link>)}
          </div>}
        />
      </div>
      {accounts.filter((a) => a.error).map((a) => <Notice key={a.key} tone="error" title={`Token “${a.label}” isn't working`}>{a.error}</Notice>)}
      {incomplete && <Notice tone="warning" title="Partial comparison">Only workspaces with usage available in both ranges are included. Missing data is never counted as zero.
        {comparison.excluded.map((entry, index) => <p key={`${entry.workspace}-${index}`} className="mt-1">{entry.workspace}: {entry.reason}</p>)}
      </Notice>}
      {!comparison.compared ? <Card><EmptyState>{targets.length ? "Cost history is unavailable until usage can be read for both date ranges. Try Refresh or check token access." : "No workspaces are available for these tokens."}</EmptyState></Card> : <>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card className="cost-summary p-6">
            <div className="text-sm font-medium">{incomplete ? "Net change · partial comparison" : "Net change in resource cost"}</div>
            <div className="mt-4 text-5xl font-semibold tracking-tight tabular">{changeMoney(comparison.delta)}</div>
            <p className="cost-summary-muted mt-2 text-sm">{changePercent(comparison.recent, comparison.previous)} · {plural(comparison.compared, "workspace")} compared</p>
            <div className="cost-summary-footer grid grid-cols-2 gap-4 border-t pt-4 text-sm">
              <div><div className="cost-summary-muted text-xs">Earlier {days} days</div><div className="mt-1 text-xl tabular">{money(comparison.previous)}</div></div>
              <div><div className="cost-summary-muted text-xs">Recent {days} days</div><div className="mt-1 text-xl tabular">{money(comparison.recent)}</div></div>
            </div>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <StatTile label="Largest increase" icon="trend" iconColor="var(--series-1)" value={largestIncrease ? changeMoney(largestIncrease.delta) : "—"} sub={largestIncrease ? `${largestIncrease.name} · ${largestIncrease.workspace}` : "No project increased its usage cost"} />
            <StatTile label="Largest decrease" icon="wallet" iconColor="var(--good-text)" value={largestDecrease ? changeMoney(largestDecrease.delta) : "—"} sub={largestDecrease ? `${largestDecrease.name} · ${largestDecrease.workspace}` : "No project decreased its usage cost"} />
          </div>
        </div>
        <Card>
          <CardHeader title="Two equal windows" subtitle={`Last ${days} complete days vs. the preceding ${days} days · UTC · today excluded`} />
          <div className="space-y-5 p-5">
            {([
              { label: "Earlier", period: windows.previous, value: comparison.previous, color: "var(--ink-muted)" },
              { label: "Recent", period: windows.recent, value: comparison.recent, color: "var(--series-1)" },
            ]).map((item) => <div key={item.label}>
              <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm"><span><span className="font-medium">{item.label}</span><span className="ml-2 text-ink-2">{historyRangeLabel(item.period)}</span></span><span className="font-medium tabular">{money(item.value)}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${item.value / max * 100}%`, background: item.color }} /></div>
            </div>)}
          </div>
        </Card>
        <CostHistory rows={comparison.rows} />
      </>}
      <p className="text-xs leading-relaxed text-ink-2">Costs use metered CPU, memory, egress, volumes and backups at the app&apos;s list prices. Plan fees, included usage, credits and taxes are excluded, so these are resource-cost changes, not invoice changes. Deleted projects remain in the comparison. “No earlier usage” means no metered cost in the earlier window, not necessarily a newly created project.</p>
    </div>
  );
}
