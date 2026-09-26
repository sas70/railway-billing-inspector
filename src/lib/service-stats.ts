import type { ServiceCatalogRow } from "./service-row";

export type StatusFilter = "all" | "online" | "offline";
export type ServiceSortKey = "service" | "status" | "environment" | "latest" | "period" | "expected";
export type SortDir = "asc" | "desc";
export type ServiceSort = { key: ServiceSortKey; dir: SortDir };

export const DEFAULT_SERVICE_SORT: ServiceSort = { key: "latest", dir: "desc" };

const DEFAULT_DIR: Record<ServiceSortKey, SortDir> = {
  service: "asc",
  status: "desc",
  environment: "asc",
  latest: "desc",
  period: "desc",
  expected: "desc",
};

export function nextServiceSort(current: ServiceSort, key: ServiceSortKey): ServiceSort {
  if (current.key !== key) return { key, dir: DEFAULT_DIR[key] };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function compareNullableTime(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareKey(a: ServiceCatalogRow, b: ServiceCatalogRow, key: ServiceSortKey): number {
  switch (key) {
    case "service":
      return a.serviceName.localeCompare(b.serviceName) || a.projectName.localeCompare(b.projectName);
    case "status":
      return Number(a.online) - Number(b.online) || a.health.localeCompare(b.health);
    case "environment":
      return a.environmentName.localeCompare(b.environmentName) || Number(b.isPrimary) - Number(a.isPrimary);
    case "latest":
      return compareNullableTime(a.latestAt, b.latestAt);
    case "period":
      return compareNullableNumber(a.periodCost, b.periodCost);
    case "expected":
      return compareNullableNumber(a.expectedCost, b.expectedCost);
  }
}

export function sortServiceRows(rows: ServiceCatalogRow[], sort: ServiceSort = DEFAULT_SERVICE_SORT): ServiceCatalogRow[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const raw = compareKey(a, b, sort.key);
    const nullsLast =
      (sort.key === "latest" && (!a.latestAt || !b.latestAt) && a.latestAt !== b.latestAt) ||
      (sort.key === "period" && (a.periodCost == null || b.periodCost == null) && a.periodCost !== b.periodCost) ||
      (sort.key === "expected" && (a.expectedCost == null || b.expectedCost == null) && a.expectedCost !== b.expectedCost);
    const cmp = nullsLast ? raw : raw * mul;
    if (cmp !== 0) return cmp;
    return compareNullableTime(a.latestAt, b.latestAt) * -1 || a.serviceName.localeCompare(b.serviceName);
  });
}

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
