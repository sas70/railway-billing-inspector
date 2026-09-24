/**
 * Usage → dollars, using the same method and unit prices as Railway's own CLI
 * (`railway usage`, src/commands/usage.rs) and https://docs.railway.com/pricing/plans.
 *
 * Usage values come back per measurement:
 *   CPU_USAGE        vCPU-minutes      × $20 / vCPU / month
 *   MEMORY_USAGE_GB  GB-minutes        × $10 / GB / month
 *   NETWORK_TX_GB    GB of egress      × $0.05 / GB
 *   DISK_USAGE_GB    GB-minutes        × $0.15 / GB / month   (volumes)
 *   BACKUP_USAGE_GB  GB-minutes        × $0.15 / GB / month
 * with a 30-day month (43,200 minutes), exactly as the CLI does.
 */

export const USAGE_MEASUREMENTS = [
  "MEMORY_USAGE_GB",
  "CPU_USAGE",
  "NETWORK_TX_GB",
  "DISK_USAGE_GB",
  "BACKUP_USAGE_GB",
] as const;

const MINUTES_IN_MONTH = 43_200;

export const UNIT_PRICES = {
  vcpuMinute: 20 / MINUTES_IN_MONTH,
  memoryGbMinute: 10 / MINUTES_IN_MONTH,
  egressGb: 0.05,
  diskGbMinute: 0.15 / MINUTES_IN_MONTH,
  backupGbMinute: 0.15 / MINUTES_IN_MONTH,
} as const;

export type UsageTotals = { cpu: number; memory: number; egress: number; disk: number; backup: number };

export type CostBreakdown = {
  cpu: number;
  memory: number;
  egress: number;
  volume: number;
  backup: number;
  total: number;
};

export const emptyTotals = (): UsageTotals => ({ cpu: 0, memory: 0, egress: 0, disk: 0, backup: 0 });

export function addMeasurement(totals: UsageTotals, measurement: string, value: number) {
  if (!Number.isFinite(value)) return;
  switch (measurement) {
    case "CPU_USAGE":
      totals.cpu += value;
      break;
    case "MEMORY_USAGE_GB":
      totals.memory += value;
      break;
    case "NETWORK_TX_GB":
      totals.egress += value;
      break;
    case "DISK_USAGE_GB":
      totals.disk += value;
      break;
    case "BACKUP_USAGE_GB":
      totals.backup += value;
      break;
  }
}

export function mergeTotals(into: UsageTotals, from: UsageTotals) {
  into.cpu += from.cpu;
  into.memory += from.memory;
  into.egress += from.egress;
  into.disk += from.disk;
  into.backup += from.backup;
}

export function costOf(totals: UsageTotals): CostBreakdown {
  const cpu = totals.cpu * UNIT_PRICES.vcpuMinute;
  const memory = totals.memory * UNIT_PRICES.memoryGbMinute;
  const egress = totals.egress * UNIT_PRICES.egressGb;
  const volume = totals.disk * UNIT_PRICES.diskGbMinute;
  const backup = totals.backup * UNIT_PRICES.backupGbMinute;
  return { cpu, memory, egress, volume, backup, total: cpu + memory + egress + volume + backup };
}

export const emptyCost = (): CostBreakdown => ({ cpu: 0, memory: 0, egress: 0, volume: 0, backup: 0, total: 0 });

/** Cost parts in fixed categorical order (slot 1…5) — colour follows the resource, never its rank. */
export const COST_PARTS = [
  { key: "cpu", label: "CPU", color: "var(--series-1)" },
  { key: "memory", label: "Memory", color: "var(--series-2)" },
  { key: "egress", label: "Network egress", color: "var(--series-3)" },
  { key: "volume", label: "Volume storage", color: "var(--series-4)" },
  { key: "backup", label: "Backups", color: "var(--series-5)" },
] as const satisfies readonly { key: keyof Omit<CostBreakdown, "total">; label: string; color: string }[];

// ── Plans ───────────────────────────────────────────────────────────────────

/** Subscription fee and the usage it includes (docs: pricing/plans → "Included usage"). */
export const PLAN_TERMS: Record<string, { label: string; fee: number; included: number }> = {
  FREE: { label: "Free", fee: 0, included: 1 },
  HOBBY: { label: "Hobby", fee: 5, included: 5 },
  PRO: { label: "Pro", fee: 20, included: 20 },
};

export function planTerms(plan: string) {
  return PLAN_TERMS[plan] ?? { label: plan, fee: 0, included: 0 };
}

export type PeriodProjection = {
  fee: number;
  included: number;
  /** Railway's projected usage for the whole period, or null if estimates are unavailable. */
  projectedUsage: number | null;
  projectedOverage: number | null;
  /** fee + usage above the included amount — before tax, credits and discounts. */
  projectedCost: number | null;
};

/**
 * Mirrors the CLI: projected usage = cost(estimatedUsage) + any part of Railway's
 * cached currentUsage that isn't explained by metered usage. Floored at usage to date
 * (a period can't end below what has already been used).
 */
export function projectPeriod(args: {
  plan: string;
  usageToDate: number;
  meteredToDate: number | null;
  estimatedMetered: number | null;
}): PeriodProjection {
  const { fee, included } = planTerms(args.plan);
  if (args.estimatedMetered == null) {
    return { fee, included, projectedUsage: null, projectedOverage: null, projectedCost: null };
  }
  const unexplained = args.meteredToDate == null ? 0 : Math.max(0, args.usageToDate - args.meteredToDate);
  const projectedUsage = Math.max(args.estimatedMetered + unexplained, args.usageToDate);
  const projectedOverage = Math.max(0, projectedUsage - included);
  return { fee, included, projectedUsage, projectedOverage, projectedCost: fee + projectedOverage };
}

// ── Billing periods ─────────────────────────────────────────────────────────

export type Period = { start: string; end: string };

export function periodProgress(period: Period, now = Date.now()) {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  const total = Math.max(1, end - start);
  const elapsed = Math.min(total, Math.max(0, now - start));
  const day = 86_400_000;
  return {
    fraction: elapsed / total,
    totalDays: Math.round(total / day),
    elapsedDays: Math.floor(elapsed / day),
    remainingDays: Math.max(0, Math.ceil((end - now) / day)),
  };
}

/** Shift an ISO timestamp by whole months, clamping the day (same rule as the CLI). */
export function shiftMonths(iso: string, offset: number): string {
  const date = new Date(iso);
  const target = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + offset,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), daysInMonth));
  return target.toISOString();
}

/**
 * The period before `current`. With the subscription's billing-cycle anchor the start
 * day is exact (an anchor on the 31st gives Mar 31, not Mar 30, before Apr 30);
 * without it this falls back to the CLI's month shift.
 */
export function previousPeriod(current: Period, anchor?: string | null): Period {
  const anchorDate = anchor ? new Date(anchor) : null;
  if (!anchorDate || Number.isNaN(anchorDate.getTime())) {
    return { start: shiftMonths(current.start, -1), end: current.start };
  }
  const start = new Date(current.start);
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchorDate.getUTCDate(), daysInMonth));
  return { start: target.toISOString(), end: current.start };
}
