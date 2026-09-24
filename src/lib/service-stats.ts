import type { ServiceCatalogRow } from "./service-row";

export type StatusFilter = "all" | "online" | "offline";

export function matchServiceRow(row: ServiceCatalogRow, query: string, filter: StatusFilter) {
  if (filter === "online" && !row.online) return false;
  if (filter === "offline" && row.online) return false;
  if (!query) return true;
  const hay = `${row.serviceName} ${row.projectName} ${row.workspaceName} ${row.environmentName}`.toLowerCase();
  return hay.includes(query);
}

export function serviceStats(rows: ServiceCatalogRow[]) {
  const online = rows.filter((r) => r.online).length;
  const expectedTotal = rows.reduce((sum, r) => sum + (r.expectedCost ?? 0), 0);
  const periodTotal = rows.reduce((sum, r) => sum + (r.periodCost ?? 0), 0);
  const byWorkspace = new Map<string, { services: number; expected: number; period: number }>();
  for (const row of rows) {
    const entry = byWorkspace.get(row.workspaceName) ?? { services: 0, expected: 0, period: 0 };
    entry.services++;
    entry.expected += row.expectedCost ?? 0;
    entry.period += row.periodCost ?? 0;
    byWorkspace.set(row.workspaceName, entry);
  }
  return {
    count: rows.length,
    online,
    offline: rows.length - online,
    expectedTotal,
    periodTotal,
    remainingExpected: Math.max(0, expectedTotal - periodTotal),
    workspaceCount: byWorkspace.size,
    workspaceBars: [...byWorkspace.entries()].map(([name, v]) => ({ name, ...v })),
  };
}
