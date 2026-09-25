"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { changeMoney, changePercent, type ProjectChange } from "@/lib/cost-history";
import { money } from "@/lib/format";
import { buttonClass } from "./button";
import { Icon } from "./Icon";
import { Badge, Card, CardHeader } from "./ui";

export function CostHistory({ rows }: { rows: ProjectChange[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "up" | "down">("all");
  const searchId = useId();
  const visible = rows.filter((row) =>
    `${row.name} ${row.workspace}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (filter === "all" || (filter === "up" ? row.delta > 0 : row.delta < 0)),
  );
  const maxChange = Math.max(...rows.map((row) => Math.abs(row.delta)), 0.01);

  return (
    <Card className="overflow-hidden">
      <CardHeader title="What changed, by project" subtitle="Largest absolute changes first. Expand a row to see the resource breakdown." />
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-5">
        <div className="relative w-full sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">Search cost history</label>
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-3 text-ink-2" />
          <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects or workspaces…" className="h-10 w-full rounded-lg border border-line bg-page pl-9 pr-3 text-sm" />
        </div>
        <div role="group" aria-label="Spending change" className="flex rounded-lg border border-line bg-page p-1 text-xs">
          {([["all", "All projects"], ["up", "Increased"], ["down", "Decreased"]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-md px-3 py-1.5 font-medium ${filter === value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>{label}</button>
          ))}
        </div>
        <span role="status" className="ml-auto text-xs text-ink-2">{visible.length} of {rows.length} projects</span>
      </div>
      {visible.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-semibold">{rows.length ? "No projects match your filters" : "No metered usage in either range"}</p>
          {rows.length > 0 && <button type="button" className={`${buttonClass("neutral", "md")} mt-4`} onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button>}
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_1fr_1fr_1.2fr] gap-4 bg-surface-2 px-5 py-3 text-xs text-ink-2 md:grid" aria-hidden="true">
            <span>Project / resource details</span><span className="text-right">Earlier range</span><span className="text-right">Recent range</span><span className="text-right">Change</span>
          </div>
          {visible.map((row) => (
            <details key={row.key} className="group">
              <summary className="list-none px-5 py-4 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_1fr_1fr_1.2fr] md:items-center md:gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <Icon name="chevron" size={14} className="mt-1 shrink-0 text-ink-2 group-open:rotate-90" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="break-words">{row.name}</span>{row.deleted && <Badge>deleted</Badge>}</div>
                      <p className="mt-1 text-xs text-ink-2">{row.workspace}</p>
                    </div>
                  </div>
                  <div className="flex justify-between gap-2 text-sm tabular md:block md:text-right"><span className="text-ink-2 md:sr-only">Earlier range</span>{money(row.previous)}</div>
                  <div className="flex justify-between gap-2 text-sm tabular md:block md:text-right"><span className="text-ink-2 md:sr-only">Recent range</span>{money(row.recent)}</div>
                  <div className="min-w-0 md:text-right">
                    <div className="flex items-baseline justify-between gap-2 md:justify-end">
                      <span className={`text-sm font-semibold tabular ${row.delta > 0 ? "text-link" : row.delta < 0 ? "text-good-text" : "text-ink-2"}`}>{changeMoney(row.delta)}</span>
                      <span className="text-xs text-ink-2">{changePercent(row.recent, row.previous)}</span>
                    </div>
                    <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                      <div className="absolute h-full rounded-full" style={{
                        width: `${Math.abs(row.delta) / maxChange * 50}%`,
                        left: row.delta >= 0 ? "50%" : `${50 - Math.abs(row.delta) / maxChange * 50}%`,
                        background: row.delta >= 0 ? "var(--series-1)" : "var(--series-3)",
                      }} />
                    </div>
                  </div>
                </div>
                {row.driver && <p className="mt-2 pl-6 text-xs text-ink-2">Main contributor: {row.driver.label} <span className="tabular">{changeMoney(row.driver.delta)}</span></p>}
              </summary>
              <div className="border-t border-line bg-page px-5 py-4 md:pl-12">
                <dl className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-5">
                  {row.resources.map((resource) => <div key={resource.key}><dt className="text-ink-2">{resource.label}</dt><dd className="mt-1 font-medium tabular">{changeMoney(resource.delta)}</dd></div>)}
                </dl>
                {row.href && <Link href={row.href} className="link mt-4 inline-flex items-center gap-1 text-sm">Open project <Icon name="chevron" size={12} /></Link>}
              </div>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}
