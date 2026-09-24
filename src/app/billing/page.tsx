import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Icon } from "@/components/Icon";
import { SetupGuide } from "@/components/SetupGuide";
import {
  Badge,
  BarList,
  Card,
  CardHeader,
  CostBreakdownBar,
  EmptyState,
  Kv,
  Meter,
  Money,
  Notice,
  PageTitle,
  PlanBadge,
  StatTile,
} from "@/components/ui";
import { COST_PARTS, planTerms } from "@/lib/billing";
import { dateNoYear, dateShort, money, percent, plural } from "@/lib/format";
import {
  loadAccountViews,
  loadInvoices,
  loadWorkspaceBundle,
  settle,
  uniqueWorkspaceTargets,
  type Settled,
  type WorkspaceBundle,
} from "@/lib/railway/api";
import type { Invoice } from "@/lib/railway/types";
import { workspaceFigures } from "@/lib/summaries";

export const metadata: Metadata = { title: "Billing" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BillingPage({ searchParams }: Props) {
  await connection();
  const sp = await searchParams;
  const which = sp.period === "previous" ? "previous" : "current";
  const accounts = await loadAccountViews();
  if (accounts.length === 0) return <SetupGuide />;

  const entries = await Promise.all(
    uniqueWorkspaceTargets(accounts).map(async ({ account, workspace }) => {
      const [bundle, invoices] = await Promise.all([
        loadWorkspaceBundle(account, workspace, { period: which, includeProjects: false }),
        settle(loadInvoices(account, workspace.id)),
      ]);
      return { bundle, invoices };
    }),
  );

  let heroValue = 0;
  let heroComplete = true;
  const topServices: { key: string; label: string; href?: string; value: number }[] = [];
  for (const { bundle } of entries) {
    const figures = workspaceFigures(bundle);
    if (which === "current") {
      if (figures.projection?.projectedCost != null) heroValue += figures.projection.projectedCost;
      else heroComplete = false;
    } else if (bundle.usage.ok) {
      heroValue += bundle.usage.value.total.total;
    } else heroComplete = false;
    if (bundle.usage.ok) {
      for (const project of bundle.usage.value.projects) {
        for (const service of project.services) {
          topServices.push({
            key: `${project.id}-${service.id ?? service.name}`,
            label: `${project.name} › ${service.name}`,
            href: !project.deleted && service.id && !service.deleted ? `/a/${bundle.account.key}/p/${project.id}/s/${service.id}` : undefined,
            value: service.cost.total,
          });
        }
      }
    }
  }
  topServices.sort((a, b) => b.value - a.value);

  const tokenErrors = accounts
    .filter((a) => a.error)
    .map((a) => (
      <Notice key={a.key} tone="error" title={`Token “${a.label}” isn't working`}>
        {a.error}
      </Notice>
    ));

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <PageTitle title="Billing" subtitle="Nothing to show until at least one token can read a workspace." />
        {tokenErrors}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Billing"
        subtitle={
          <>
            Usage and projected cost per workspace, computed the same way as Railway&apos;s own <span className="font-mono">railway usage</span>{" "}
            command. Invoices come straight from Railway.
          </>
        }
        actions={
          <div role="group" aria-label="Billing period" className="flex rounded-md border border-line bg-surface p-0.5 text-sm">
            {(["current", "previous"] as const).map((p) => (
              <Link
                key={p}
                href={`/billing?period=${p}`}
                aria-current={p === which ? "true" : undefined}
                className={`rounded px-3 py-1 ${p === which ? "bg-surface-2 font-medium" : "text-ink-2 hover:text-ink"}`}
              >
                {p === "current" ? "Current period" : "Previous period"}
              </Link>
            ))}
          </div>
        }
      />

      {tokenErrors}

      <Card className="p-5">
        <div className="text-sm text-ink-2">
          {which === "current" ? "Projected cost this period, all workspaces" : "Metered usage in the previous period, all workspaces"}
        </div>
        <div className="mt-1 text-5xl font-semibold tracking-tight">{money(heroValue)}</div>
        <p className="mt-2 max-w-3xl text-sm text-ink-2">
          {which === "current"
            ? "Plan fees plus usage above what each plan includes (Hobby includes $5, Pro $20), before tax, credits and discounts."
            : "Resource usage only — plan fees and included usage are applied on the invoice."}
          {!heroComplete && " Partial: some workspaces couldn't be read with the configured tokens."}
        </p>
      </Card>

      {entries.map(({ bundle, invoices }) => (
        <WorkspaceBilling key={`${bundle.account.key}-${bundle.workspace.id}`} bundle={bundle} invoices={invoices} which={which} />
      ))}

      <Card>
        <CardHeader title="Top services by cost" subtitle={`All workspaces · ${which === "current" ? "this" : "previous"} billing period`} />
        <div className="p-4">
          <BarList
            emptyText="No metered usage."
            rows={topServices.slice(0, 12).map((s) => ({ key: s.key, label: s.label, href: s.href, value: s.value, valueLabel: money(s.value) }))}
          />
        </div>
      </Card>

      <Card className="p-4 text-sm text-ink-2">
        <h2 className="font-semibold text-ink">How these numbers are calculated</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Metered usage comes from Railway&apos;s <span className="font-mono">usage</span> API (vCPU-minutes, GB-minutes of memory and volume
            storage, GB of egress), priced at $20/vCPU/month, $10/GB/month RAM, $0.15/GB/month volumes and $0.05/GB egress with a 30-day month —
            the same method as <span className="font-mono">railway usage</span>.
          </li>
          <li>“Usage so far” is Railway&apos;s own running total for the workspace (cached by Railway, so it can lag slightly).</li>
          <li>Projections use Railway&apos;s <span className="font-mono">estimatedUsage</span>, which assumes current usage continues to period end.</li>
          <li>Builds are free. Deleted projects still count for the period they ran in, so they appear here until the period ends.</li>
          <li>Invoice amounts are read from Railway (Stripe amounts in cents, shown in dollars). The invoice PDF is the source of truth.</li>
        </ul>
      </Card>
    </div>
  );
}

function WorkspaceBilling({ bundle, invoices, which }: { bundle: WorkspaceBundle; invoices: Settled<Invoice[]>; which: "current" | "previous" }) {
  const figures = workspaceFigures(bundle);
  const billing = bundle.billing.ok ? bundle.billing.value : null;
  const usage = bundle.usage.ok ? bundle.usage.value : null;
  const plan = billing?.plan ?? bundle.workspace.plan;
  const terms = planTerms(plan);
  const period = usage?.period ?? billing?.period ?? null;
  const metered = usage?.total.total ?? null;
  const previousOverage = metered != null ? Math.max(0, metered - terms.included) : null;

  return (
    <Card>
      <div id={`ws-${bundle.workspace.id}`} className="scroll-mt-20" />
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2 text-base">
            {bundle.workspace.name} <PlanBadge plan={plan} trial={billing?.isTrialing} />
            {billing && billing.state !== "ACTIVE" && <Badge tone="danger">{billing.state.toLowerCase().replace("_", " ")}</Badge>}
          </span>
        }
        subtitle={
          period
            ? `${which === "current" ? "Current" : "Previous"} billing period ${dateShort(period.start)} – ${dateShort(period.end)}`
            : "Billing period unknown"
        }
      />

      <div className="space-y-2 px-4 pt-3 empty:hidden">
        {!bundle.billing.ok && (
          <Notice tone="warning" title="Billing isn't readable with this token">
            {bundle.billing.error} Plan, invoices and Railway&apos;s running total need admin access to the workspace; metered usage below is still
            shown if available.
          </Notice>
        )}
        {!bundle.usage.ok && <Notice tone="warning" title="Usage isn't available">{bundle.usage.error}</Notice>}
      </div>

      {which === "current" ? (
        <div className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-5">
          <StatTile
            label="Usage so far"
            value={<Money value={figures.usageToDate} />}
            sub={
              figures.usageToDate != null && terms.included > 0 ? (
                <div className="space-y-1">
                  <Meter value={figures.usageToDate} max={terms.included} label="Usage against included amount" />
                  <div>{percent(figures.usageToDate / terms.included)} of included</div>
                </div>
              ) : undefined
            }
          />
          <StatTile label="Included in plan" value={money(terms.included)} sub={`${terms.label} fee ${money(terms.fee)} / month`} />
          <StatTile label="Projected usage" value={<Money value={figures.projection?.projectedUsage} />} sub="by period end" />
          <StatTile label="Projected overage" value={<Money value={figures.projection?.projectedOverage} />} sub="usage above included" />
          <StatTile
            label="Projected cost"
            value={<Money value={figures.projection?.projectedCost} />}
            sub={figures.progress ? `${plural(figures.progress.remainingDays, "day")} left in period` : "fee + overage"}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-3">
          <StatTile label="Metered usage" value={<Money value={metered} />} sub="previous period" />
          <StatTile label="Included in plan" value={money(terms.included)} sub={`${terms.label} plan`} />
          <StatTile label="Usage above included" value={<Money value={previousOverage} />} sub="what the invoice charges on top of the fee" />
        </div>
      )}

      {billing && which === "current" && (
        <div className="grid gap-x-8 border-t border-line px-4 py-3 sm:grid-cols-3">
          <Kv label="Credit balance">
            <Money value={billing.creditBalance} />
          </Kv>
          <Kv label="Usage limit">
            {billing.usageLimit
              ? `alert at ${money(billing.usageLimit.softLimit, { whole: true })}${billing.usageLimit.hardLimit != null ? ` · hard stop ${money(billing.usageLimit.hardLimit, { whole: true })}` : " · no hard limit"}`
              : "none set"}
          </Kv>
          <Kv label="Next invoice">
            {billing.nextInvoice ? (
              <span>
                {dateNoYear(billing.nextInvoice.date)} · <Money value={billing.nextInvoice.amountSoFar} /> so far
              </span>
            ) : (
              "—"
            )}
          </Kv>
        </div>
      )}

      {usage && (
        <div className="grid gap-6 border-t border-line p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div>
            <h3 className="mb-3 text-sm font-semibold">Cost by resource</h3>
            <CostBreakdownBar cost={usage.total} emptyText="No metered usage in this period." />
          </div>
          <div className="min-w-0">
            <h3 className="mb-3 text-sm font-semibold">Cost by project</h3>
            {usage.projects.length === 0 ? (
              <p className="text-sm text-ink-2">No metered usage in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-2">
                      <th scope="col" className="py-1.5 pr-2 font-medium">Project</th>
                      {COST_PARTS.map((p) => (
                        <th key={p.key} scope="col" className="px-2 py-1.5 text-right font-medium">
                          {p.label.replace("Network egress", "Egress").replace("Volume storage", "Volumes")}
                        </th>
                      ))}
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Total</th>
                      <th scope="col" className="py-1.5 pl-2 text-right font-medium">Share</th>
                      {which === "current" && <th scope="col" className="py-1.5 pl-2 text-right font-medium">Projected</th>}
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {usage.projects.map((project) => (
                      <tr key={project.id} className="border-b border-line last:border-b-0">
                        <td className="py-1.5 pr-2">
                          {project.deleted ? (
                            <span className="text-ink-2">
                              {project.name} <Badge>deleted</Badge>
                            </span>
                          ) : (
                            <Link href={`/a/${bundle.account.key}/p/${project.id}`} className="hover:underline underline-offset-2">
                              {project.name}
                            </Link>
                          )}
                        </td>
                        {COST_PARTS.map((p) => (
                          <td key={p.key} className="px-2 py-1.5 text-right text-ink-2">
                            {project.cost[p.key] > 0 ? money(project.cost[p.key]) : "—"}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right font-medium">{money(project.cost.total)}</td>
                        <td className="py-1.5 pl-2 text-right text-ink-2">{percent(project.cost.total / (usage.total.total || 1))}</td>
                        {which === "current" && (
                          <td className="py-1.5 pl-2 text-right text-ink-2">{money(figures.estimateByProject[project.id]?.total ?? null)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-line">
        <div className="px-4 pt-3 text-sm font-semibold">Invoices</div>
        {!invoices.ok ? (
          <p className="px-4 py-3 text-sm text-ink-2">Invoices aren&apos;t readable with this token ({invoices.error}).</p>
        ) : invoices.value.length === 0 ? (
          <EmptyState>No invoices yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-2">
                  <th scope="col" className="px-4 py-1.5 font-medium">Period</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Status</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Total</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Paid</th>
                  <th scope="col" className="px-4 py-1.5 text-right font-medium">
                    <span className="sr-only">Links</span>
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {invoices.value.slice(0, 6).map((inv) => (
                  <tr key={inv.invoiceId} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-1.5">
                      {dateShort(inv.periodStart)} – {dateShort(inv.periodEnd)}
                    </td>
                    <td className="px-2 py-1.5 text-ink-2">{inv.status ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{money(inv.total / 100)}</td>
                    <td className="px-2 py-1.5 text-right text-ink-2">{money(inv.amountPaid / 100)}</td>
                    <td className="px-4 py-1.5 text-right">
                      <span className="inline-flex gap-3">
                        {inv.hostedURL && (
                          <a href={inv.hostedURL} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">
                            View <Icon name="external" size={11} />
                          </a>
                        )}
                        {inv.pdfURL && (
                          <a href={inv.pdfURL} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">
                            PDF <Icon name="download" size={11} />
                          </a>
                        )}
                        {!inv.hostedURL && !inv.pdfURL && <span className="text-ink-2">—</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
