import { COST_PARTS, emptyCost, type CostBreakdown, type Period } from "./billing";
import { money } from "./format";

const DAY = 86_400_000;
export type HistoryDays = 7 | 30;

/** Adjacent, equally long UTC windows; never compare a partial day. */
export function historyWindows(days: HistoryDays, now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const boundary = end - days * DAY;
  return {
    recent: { start: new Date(boundary).toISOString(), end: new Date(end).toISOString() },
    previous: { start: new Date(boundary - days * DAY).toISOString(), end: new Date(boundary).toISOString() },
  };
}

export function historyRangeLabel(period: Period) {
  const format = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${format(new Date(period.start))} – ${format(new Date(Date.parse(period.end) - 1))}`;
}

type HistoryProject = { id: string; name: string; deleted: boolean; cost: CostBreakdown };
type HistoryUsage = { projects: HistoryProject[]; total: CostBreakdown };
type HistoryResult = { ok: true; value: HistoryUsage } | { ok: false; error: string };
export type HistoryEntry = {
  accountKey: string;
  workspace: { id: string; name: string };
  recent: HistoryResult;
  previous: HistoryResult;
};

export type ProjectChange = {
  key: string;
  name: string;
  workspace: string;
  href?: string;
  deleted: boolean;
  previous: number;
  recent: number;
  delta: number;
  percentage: number | null;
  resources: { key: string; label: string; delta: number }[];
  driver: { label: string; delta: number } | null;
};

/** Only compare workspaces with both reads, using the union of project IDs. */
export function compareHistory(entries: HistoryEntry[]) {
  const rows: ProjectChange[] = [];
  const excluded: { workspace: string; reason: string }[] = [];
  let recent = 0;
  let previous = 0;
  let compared = 0;
  for (const entry of entries) {
    if (!entry.recent.ok || !entry.previous.ok) {
      excluded.push({ workspace: entry.workspace.name, reason: [
        !entry.recent.ok ? `Recent range: ${entry.recent.error}` : "",
        !entry.previous.ok ? `Earlier range: ${entry.previous.error}` : "",
      ].filter(Boolean).join(" ") });
      continue;
    }
    compared++;
    recent += entry.recent.value.total.total;
    previous += entry.previous.value.total.total;
    const before = new Map(entry.previous.value.projects.map((p) => [p.id, p]));
    const after = new Map(entry.recent.value.projects.map((p) => [p.id, p]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const project = after.get(id) ?? before.get(id)!;
      const a = before.get(id)?.cost ?? emptyCost();
      const b = after.get(id)?.cost ?? emptyCost();
      const delta = b.total - a.total;
      const resources = COST_PARTS.map((part) => ({ key: part.key, label: part.label, delta: b[part.key] - a[part.key] }));
      // Identify the largest contributor in the direction of the net change.
      const driver = resources.filter((r) => delta > 0 ? r.delta > 0 : delta < 0 && r.delta < 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] ?? null;
      rows.push({
        key: `${entry.workspace.id}:${id}`, name: project.name, workspace: entry.workspace.name,
        href: !project.deleted && id !== "unknown" ? `/a/${entry.accountKey}/p/${id}` : undefined,
        deleted: project.deleted && id !== "unknown", previous: a.total, recent: b.total, delta,
        percentage: a.total > 0 ? delta / a.total : null, resources, driver,
      });
    }
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key));
  return { rows, recent, previous, delta: recent - previous, compared, excluded };
}

export function changeMoney(value: number) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;
}

export function changePercent(recent: number, previous: number) {
  if (recent === previous) return "No change";
  if (previous === 0) return recent > 0 ? "No earlier usage" : "No change";
  const percentage = (recent - previous) / previous * 100;
  if (Math.abs(percentage) < 0.05) return "<0.1% change";
  return `${percentage > 0 ? "+" : "−"}${Math.abs(percentage).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}
