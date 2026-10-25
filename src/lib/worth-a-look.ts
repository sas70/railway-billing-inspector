/**
 * The Overview's "Worth a look" list. Pure, so it can be unit-tested (scripts/test-worth-a-look.mjs).
 * It has two parts: what happened (crashes and failed deploys, filtered by their latest deploy) and
 * what is on this period's bill ("ongoing": PR environments still running, projects with nothing
 * running that have charges). The time filter only applies to the first part, so it can't hide a
 * bill, and a charge from weeks ago never shows up as something that happened today.
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

/** Did this event happen inside the range? (Only meaningful for events, not for bill items.) */
export function inWorthRange(item: Timed, range: WorthRange, now: number): boolean {
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

type Billed = Timed & { charging?: boolean; periodCost?: number };

/**
 * Events inside the range (most severe, then newest), and every bill item whatever the range
 * (still charging first, then the biggest charge). `hidden` counts events outside the range.
 */
export function splitWorth<T extends Billed>(items: T[], range: WorthRange, now: number): { events: T[]; billing: T[]; hidden: number } {
  const allEvents = items.filter((i) => !i.ongoing);
  const events = sortWorth(allEvents.filter((i) => inWorthRange(i, range, now)));
  const billing = items
    .filter((i) => i.ongoing)
    .sort((a, b) => Number(!!b.charging) - Number(!!a.charging) || (b.periodCost ?? 0) - (a.periodCost ?? 0));
  return { events, billing, hidden: allEvents.length - events.length };
}

/** How far back "still charging" looks: the last two complete UTC days. */
export const RECENT_DAYS = 2;

export function recentWindow(now = new Date()): { start: string; end: string } {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: new Date(end - RECENT_DAYS * DAY).toISOString(), end: new Date(end).toISOString() };
}

/**
 * Is a project with nothing running still adding to the bill? The evidence is what Railway
 * actually charged it over the last RECENT_DAYS complete days (not Railway's projection, which
 * just extends the period so far to the full period). Without that, an attached volume is the one
 * thing known to keep billing every day.
 */
export function billState(input: { recent: number | null; volumeSoFar: number }): { charging: boolean; perDay: number | null; known: boolean } {
  if (input.recent != null && Number.isFinite(input.recent)) {
    return input.recent >= 0.005 ? { charging: true, perDay: input.recent / RECENT_DAYS, known: true } : { charging: false, perDay: null, known: true };
  }
  return { charging: input.volumeSoFar > 0, perDay: null, known: false };
}

export type BillStatus = "running" | "charging" | "stopped";

/** Where a project's cost sits today: something running, nothing running but still charged recently, or stopped. */
export function billStatus(input: { running: number; recent: number | null; volumeSoFar: number }): BillStatus {
  if (input.running > 0) return "running";
  return billState(input).charging ? "charging" : "stopped";
}
