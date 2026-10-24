/**
 * Time filter for the Overview's "Worth a look" list. Pure, so it can be unit-tested
 * (scripts/test-worth-a-look.mjs). Crashes and failed deploys are filtered by their latest
 * deploy; anything still costing money ("ongoing") always shows, so the filter can't hide a bill.
 */

export type WorthRange = "today" | "week" | "month" | "year" | "all";

const DAY = 86_400_000;

export const WORTH_RANGES: { id: WorthRange; label: string; ms: number | null; phrase: string }[] = [
  { id: "today", label: "Today", ms: DAY, phrase: "the last 24 hours" },
  { id: "week", label: "This week", ms: 7 * DAY, phrase: "the last 7 days" },
  { id: "month", label: "This month", ms: 30 * DAY, phrase: "the last 30 days" },
  { id: "year", label: "This year", ms: 365 * DAY, phrase: "the last 12 months" },
  { id: "all", label: "All", ms: null, phrase: "any time" },
];

export const DEFAULT_WORTH_RANGE: WorthRange = "week";

export const isWorthRange = (value: unknown): value is WorthRange => WORTH_RANGES.some((r) => r.id === value);

type Timed = { at: string | null; ongoing: boolean; severity: number };

export function inWorthRange(item: Timed, range: WorthRange, now: number): boolean {
  if (item.ongoing) return true;
  const ms = WORTH_RANGES.find((r) => r.id === range)?.ms ?? null;
  if (ms == null) return true;
  const t = item.at ? Date.parse(item.at) : NaN;
  return Number.isFinite(t) && now - t <= ms;
}

/** Most severe first, then most recent. */
export function sortWorth<T extends Timed>(items: T[]): T[] {
  const time = (item: Timed) => (item.at ? Date.parse(item.at) || 0 : 0);
  return [...items].sort((a, b) => a.severity - b.severity || time(b) - time(a));
}
