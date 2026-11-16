import { money } from "./format";
import type { PlanFlag } from "./plan-types";

/**
 * Railway's rules for usage limits, and how risky a change is. Pure (no I/O), so the server
 * (limits.ts), the Limits page form and the tests share one copy.
 *
 * Railway sets limits per workspace, never per project:
 *  - Compute: an email alert and a hard limit, in whole dollars. At the hard limit Railway takes
 *    every service in the workspace offline (it emails at 75%, 90% and 100% first). Railway shows
 *    the projected bill next to the limit and may act on it, so a hard limit at or below the
 *    projection is treated like one at or below usage so far.
 *  - Railway Agent: its own email alert and hard limit, in cents. Reaching it pauses the agent;
 *    services keep running. It can't be removed (a $0 hard limit blocks the agent).
 *
 * Bounds and request shapes mirror the Railway CLI (`railway usage limit set`).
 */

export const COMPUTE_ALERT_MIN = 5;
export const COMPUTE_HARD_MIN = 10;
export const LIMIT_MAX_DOLLARS = 500_000;
export const LIMIT_MAX_CENTS = LIMIT_MAX_DOLLARS * 100;
/** Railway's first warning email goes out at 75% of the hard limit. */
export const NEAR_FRACTION = 0.75;
/** A hard limit less than this far above the projected bill gets a warning. */
export const HEADROOM_FRACTION = 0.15;

/** Whole dollars; null = not set. */
export type ComputeLimit = { alert: number | null; hard: number | null };
/** The agent limit as Railway reports it (cents). hardCents null: Railway reported none. */
export type AgentLimitState = { alertCents: number | null; hardCents: number | null };
/** An agent limit to set (cents). The hard limit is required; 0 blocks the agent. */
export type AgentLimit = { alertCents: number | null; hardCents: number };

/** Usage so far and Railway's projected usage for the period, in dollars (null when unknown). */
export type Exposure = { usage: number | null; projected: number | null };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// ── Parsing what's typed in the form ────────────────────────────────────────

/** "$1,250", "75", "7.50", ".5" → cents. Blank → null. */
export function parseAmountCents(text: string): Parsed<number | null> {
  const t = text.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  if (t === "") return { ok: true, value: null };
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(t)) return { ok: false, error: "enter a dollar amount like 25 or 7.50" };
  const [whole, fraction = ""] = t.split(".");
  const cents = Number(whole || "0") * 100 + Number(`${fraction}00`.slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > LIMIT_MAX_CENTS) return { ok: false, error: "at most $500,000" };
  return { ok: true, value: cents };
}

export function computeFromText(alertText: string, hardText: string): Parsed<ComputeLimit> {
  const alert = parseAmountCents(alertText);
  if (!alert.ok) return { ok: false, error: `Compute email alert: ${alert.error}.` };
  const hard = parseAmountCents(hardText);
  if (!hard.ok) return { ok: false, error: `Compute hard limit: ${hard.error}.` };
  if ((alert.value ?? 0) % 100 || (hard.value ?? 0) % 100) return { ok: false, error: "Railway takes compute limits in whole dollars." };
  if (hard.value === 0) return { ok: false, error: "Leave the compute hard limit blank for no hard limit." };
  const limit: ComputeLimit = { alert: alert.value ? alert.value / 100 : null, hard: hard.value == null ? null : hard.value / 100 };
  const error = validateCompute(limit);
  return error ? { ok: false, error } : { ok: true, value: limit };
}

export function agentFromText(alertText: string, hardText: string): Parsed<AgentLimit> {
  const alert = parseAmountCents(alertText);
  if (!alert.ok) return { ok: false, error: `Agent email alert: ${alert.error}.` };
  const hard = parseAmountCents(hardText);
  if (!hard.ok) return { ok: false, error: `Agent hard limit: ${hard.error}.` };
  if (hard.value == null) return { ok: false, error: "Railway requires an agent hard limit (it can't be removed). Enter 0 to block the agent." };
  const limit: AgentLimit = { alertCents: alert.value ? alert.value : null, hardCents: hard.value };
  const error = validateAgent(limit);
  return error ? { ok: false, error } : { ok: true, value: limit };
}

// ── Validation (the server re-checks everything the browser sends) ──────────

export function validateCompute(limit: ComputeLimit): string | null {
  const { alert, hard } = limit;
  if (alert !== null) {
    if (!Number.isInteger(alert)) return "The compute email alert must be a whole dollar amount.";
    if (alert < COMPUTE_ALERT_MIN || alert > LIMIT_MAX_DOLLARS) return "The compute email alert must be from $5 to $500,000, or blank for none.";
  }
  if (hard !== null) {
    if (!Number.isInteger(hard)) return "The compute hard limit must be a whole dollar amount.";
    if (hard < COMPUTE_HARD_MIN || hard > LIMIT_MAX_DOLLARS) return "The compute hard limit must be from $10 to $500,000, or blank for none.";
    if (alert !== null && hard < alert) return "The compute hard limit must be at least the email alert.";
  }
  return null;
}

export function validateAgent(limit: AgentLimit): string | null {
  const { alertCents, hardCents } = limit;
  if (!Number.isInteger(hardCents) || hardCents < 0 || hardCents > LIMIT_MAX_CENTS) return "The agent hard limit must be from $0 to $500,000.";
  if (alertCents !== null) {
    if (!Number.isInteger(alertCents) || alertCents < 1 || alertCents > LIMIT_MAX_CENTS) return "The agent email alert must be from $0.01 to $500,000, or blank for none.";
    if (alertCents > hardCents) return "The agent hard limit must be at least its email alert.";
  }
  return null;
}

// ── Reading Railway's values ────────────────────────────────────────────────

/** Railway's usageLimit (null when none is set; softLimit 0 = no email alert) → ComputeLimit. */
export function computeFromRailway(usageLimit: { softLimit: number; hardLimit: number | null } | null): ComputeLimit {
  if (!usageLimit) return { alert: null, hard: null };
  return { alert: usageLimit.softLimit > 0 ? usageLimit.softLimit : null, hard: usageLimit.hardLimit };
}

export const sameCompute = (a: ComputeLimit, b: ComputeLimit) => a.alert === b.alert && a.hard === b.hard;
export const sameAgent = (a: AgentLimitState, b: AgentLimitState) => a.alertCents === b.alertCents && a.hardCents === b.hardCents;

const whole = (dollars: number) => money(dollars, { whole: true });
const cents = (value: number) => money(value / 100);

export function describeCompute(limit: ComputeLimit): string {
  if (limit.alert == null && limit.hard == null) return "no limits";
  const alert = limit.alert == null ? "no email alert" : `email alert ${whole(limit.alert)}`;
  const hard = limit.hard == null ? "no hard limit" : `hard limit ${whole(limit.hard)}`;
  return `${alert} · ${hard}`;
}

export function describeAgent(limit: AgentLimitState): string {
  const alert = limit.alertCents == null ? "no email alert" : `email alert ${cents(limit.alertCents)}`;
  const hard = limit.hardCents == null ? "no hard limit" : limit.hardCents === 0 ? "hard limit $0 (agent blocked)" : `hard limit ${cents(limit.hardCents)}`;
  return `${alert} · ${hard}`;
}

// ── What gets sent to Railway ───────────────────────────────────────────────

export type ComputeMutation =
  | { op: "remove"; input: { customerId: string } }
  | { op: "set"; input: { customerId: string; softLimitDollars: number; hardLimitDollars: number | null } };

/**
 * usageLimitSet replaces both values (it isn't a patch), so both are always sent: alert 0 means
 * none, hard null means none. A hard limit of 0 is never sent: its meaning isn't documented and
 * it could read as a $0 cap. Clearing both uses usageLimitRemove, like `railway usage limit remove`.
 */
export function computeMutation(customerId: string, after: ComputeLimit): ComputeMutation {
  if (after.alert == null && after.hard == null) return { op: "remove", input: { customerId } };
  if (after.hard === 0) throw new Error("Refusing to send a $0 compute hard limit.");
  return { op: "set", input: { customerId, softLimitDollars: after.alert ?? 0, hardLimitDollars: after.hard } };
}

/** The alert is always sent (0 = none), so clearing it works whether Railway treats null as "keep" or "clear". */
export function agentMutationInput(workspaceId: string, after: AgentLimit) {
  return { workspaceId, hardLimitCents: after.hardCents, softLimitCents: after.alertCents ?? 0 };
}

// ── Risk ────────────────────────────────────────────────────────────────────

export const setHardPhrase = (hard: number) => `SET HARD LIMIT $${hard}`;
export const REMOVE_HARD_PHRASE = "REMOVE HARD LIMIT";

export type ComputeAssessment = {
  flags: PlanFlag[];
  /** Set when the change can take services offline or removes the spending cap: approve by typing it. */
  phrase: string | null;
};

export function assessCompute(before: ComputeLimit, after: ComputeLimit, exposure: Exposure): ComputeAssessment {
  const flags: PlanFlag[] = [];
  let phrase: string | null = null;
  const { usage, projected } = exposure;
  const hardChanged = before.hard !== after.hard;

  if (after.hard == null) {
    if (before.hard != null) {
      phrase = REMOVE_HARD_PHRASE;
      flags.push({ tone: "danger", text: "Removes the spending cap: Railway keeps services running whatever the bill" });
    }
  } else {
    const hard = after.hard;
    if (usage != null && hard <= usage) {
      flags.push({
        tone: "danger",
        text: hardChanged
          ? `At or below usage so far (${money(usage)}): Railway takes this workspace's services offline`
          : `Usage so far (${money(usage)}) is already at this hard limit`,
      });
      if (hardChanged) phrase = setHardPhrase(hard);
    } else if (projected != null && hard <= projected) {
      flags.push({
        tone: "danger",
        text: hardChanged
          ? `At or below the projected bill (${money(projected)}): services can go offline before the period ends`
          : `The projected bill (${money(projected)}) is already above this hard limit`,
      });
      if (hardChanged) phrase = setHardPhrase(hard);
    } else if (projected == null && hardChanged && (before.hard == null || hard < before.hard)) {
      flags.push({ tone: "warning", text: "The projected bill couldn't be read, so it's unknown whether this takes services offline" });
      phrase = setHardPhrase(hard);
    } else if (projected != null && hard < projected * (1 + HEADROOM_FRACTION)) {
      flags.push({ tone: "warning", text: `Less than 15% above the projected bill (${money(projected)}): a usage spike could reach it` });
    }
    if (before.hard == null) flags.push({ tone: "info", text: "Adds a hard limit (there's none today)" });
  }

  if (after.alert != null && after.alert !== before.alert && usage != null && after.alert <= usage) {
    flags.push({ tone: "info", text: `Usage is already past this alert (${money(usage)}), so expect Railway's email` });
  }
  if (after.alert == null && after.hard == null && (before.alert != null || before.hard != null)) {
    flags.push({ tone: "info", text: "Clears every compute limit for this workspace" });
  }
  return { flags, phrase };
}

export function assessAgent(before: AgentLimitState, after: AgentLimit, usedCents: number | null): PlanFlag[] {
  const flags: PlanFlag[] = [];
  if (after.hardCents === 0) {
    if (before.hardCents !== 0) flags.push({ tone: "warning", text: "Blocks Railway Agent until you raise it (services keep running)" });
  } else if (usedCents != null && after.hardCents <= usedCents) {
    flags.push({ tone: "warning", text: `At or below agent use so far (${cents(usedCents)}): the agent pauses until next period; services keep running` });
  }
  return flags;
}

// ── Status on the Limits page ───────────────────────────────────────────────

export type ComputeStatus = "at-limit" | "projected-over" | "near" | "ok" | "no-cap";

export function computeStatus(limit: ComputeLimit, exposure: Exposure, isOverLimit: boolean): ComputeStatus {
  if (isOverLimit) return "at-limit";
  if (limit.hard == null) return "no-cap";
  if (exposure.usage != null && exposure.usage >= limit.hard) return "at-limit";
  if (exposure.projected != null && exposure.projected >= limit.hard) return "projected-over";
  if (exposure.usage != null && exposure.usage >= limit.hard * NEAR_FRACTION) return "near";
  return "ok";
}

/** A hard limit with room to spare: the projected bill (or usage so far) plus 25%, rounded up to $5, at least $10. */
export function suggestHardLimit(exposure: Exposure): number | null {
  if (exposure.projected == null && exposure.usage == null) return null;
  const base = Math.max(exposure.projected ?? 0, exposure.usage ?? 0);
  return Math.min(LIMIT_MAX_DOLLARS, Math.max(COMPUTE_HARD_MIN, Math.ceil((base * 1.25) / 5) * 5));
}
