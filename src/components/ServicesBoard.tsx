"use client";

import { useEffect, useMemo, useState } from "react";

import { BulkMasterButtons } from "@/components/BulkMaster";
import { MiniHistogram, MiniPie } from "@/components/MiniCharts";
import { ServicesToolbar } from "@/components/ServicesToolbar";
import { Card, Money, StatTile } from "@/components/ui";
import { money, plural } from "@/lib/format";
import type { ServiceCatalogRow } from "@/lib/service-row";
import { matchServiceRow, serviceStats, type StatusFilter } from "@/lib/service-stats";

export function ServicesBoard({
  rows,
  readOnly,
  children,
}: {
  rows: ServiceCatalogRow[];
  readOnly: boolean;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((row) => matchServiceRow(row, q, filter)), [rows, q, filter]);
  const stats = serviceStats(visible);
  const filtered = filter !== "all" || q.length > 0;

  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLTableRowElement>("[data-service-row]");
    for (const node of nodes) {
      const online = node.dataset.online === "1";
      const hay = node.dataset.search ?? "";
      node.hidden = !((filter === "all" || (filter === "online") === online) && (!q || hay.includes(q)));
    }
  }, [q, filter]);

  const scope = filter === "online" ? "online services" : filter === "offline" ? "offline services" : "visible services";

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Services"
          icon="layers"
          iconColor="var(--series-1)"
          value={stats.count}
          sub={
            filtered
              ? `${scope} · ${stats.count} of ${rows.length} · ${plural(stats.workspaceCount, "workspace")}`
              : plural(stats.workspaceCount, "workspace")
          }
          chart={
            <MiniHistogram
              label={`Services per workspace: ${stats.workspaceBars.map((w) => `${w.name} ${w.services}`).join(", ")}`}
              bars={stats.workspaceBars.map((w) => ({ label: w.name, value: w.services }))}
            />
          }
        />
        <StatTile
          label={filter === "offline" ? "Offline" : "Online"}
          icon="power"
          iconColor={filter === "offline" ? "var(--ink-muted)" : "var(--status-good)"}
          value={filter === "offline" ? stats.offline : stats.online}
          sub={filter === "offline" ? `${stats.online} online in this set` : `${stats.offline} offline`}
          chart={
            <MiniPie
              label={`${stats.online} online, ${stats.offline} offline`}
              slices={[
                { label: "Online", value: stats.online, color: "var(--status-good)" },
                { label: "Offline", value: stats.offline, color: "var(--ink-muted)" },
              ]}
            />
          }
        />
        <StatTile
          label="Expected this period"
          icon="trend"
          iconColor="var(--series-2)"
          value={<Money value={stats.count ? stats.expectedTotal : null} />}
          sub={filtered ? `expected usage for ${scope}` : "service usage scaled to Railway's project estimate"}
          chart={
            <MiniHistogram
              label={`Expected cost by workspace: ${stats.workspaceBars.map((w) => `${w.name} ${money(w.expected)}`).join(", ")}`}
              bars={stats.workspaceBars.map((w) => ({ label: w.name, value: w.expected }))}
              moneyValues
            />
          }
        />
        <StatTile
          label="Used so far"
          icon="wallet"
          iconColor="var(--series-3)"
          value={<Money value={stats.count ? stats.periodTotal : null} />}
          sub={filtered ? `metered usage for ${scope}` : "metered usage this billing period"}
          chart={
            <MiniPie
              label={`${money(stats.periodTotal)} used so far, ${money(stats.remainingExpected)} still expected`}
              slices={[
                { label: "Used so far", value: stats.periodTotal, color: "var(--series-3)" },
                { label: "Still expected", value: stats.remainingExpected, color: "var(--axis)" },
              ]}
            />
          }
        />
      </div>

      <Card>
        <ServicesToolbar
          query={query}
          filter={filter}
          onQuery={setQuery}
          onFilter={setFilter}
          visible={stats.count}
          total={rows.length}
          actions={<BulkMasterButtons rows={visible} readOnly={readOnly} />}
        />
        {children}
      </Card>
    </>
  );
}
