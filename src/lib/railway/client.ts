import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";

import { isMockMode, type AccountConfig } from "../config";
import type { GqlDoc } from "./documents";
import { RailwayApiError, type RailwayErrorKind } from "./errors";
import { mockRequest } from "./mock";
import { SavedReads } from "./saved-reads";

export { RailwayApiError, errorMessage } from "./errors";

export const RAILWAY_ENDPOINT = "https://backboard.railway.com/graphql/v2";

/**
 * Reads are kept until you press Refresh (or make a change from this app), with no time limit.
 * They live in memory and in data/railway-cache.sqlite, so a server restart doesn't re-read
 * Railway either. The "Updated … ago" label next to Refresh says how old they are.
 */
/** Railway allows 10 req/s on Hobby; keep well under it per token. */
const MAX_IN_FLIGHT_PER_ACCOUNT = 4;
const REQUEST_TIMEOUT_MS = 30_000;
/** Railway reads slower than this are logged to the terminal. */
const SLOW_MS = 3_000;
/** Honour Retry-After automatically only when the wait is short. */
const MAX_AUTO_RETRY_WAIT_S = 10;

export type RateInfo = { limit?: number; remaining?: number; reset?: string; updatedAt: number };

type CacheEntry = { fetchedAt: number; data: unknown };
type Limiter = { active: number; queue: (() => void)[] };

// Module state lives on globalThis so it survives hot reloads in `next dev`.
const store = globalThis as typeof globalThis & {
  __rbiCache?: Map<string, CacheEntry>;
  __rbiInflight?: Map<string, Promise<unknown>>;
  __rbiRate?: Map<string, RateInfo>;
  __rbiLimiters?: Map<string, Limiter>;
  __rbiGeneration?: { value: number };
  __rbiSaved?: SavedReads | null;
};
const cache = (store.__rbiCache ??= new Map<string, CacheEntry>());
const inflight = (store.__rbiInflight ??= new Map<string, Promise<unknown>>());
const rateInfo = (store.__rbiRate ??= new Map<string, RateInfo>());
const limiters = (store.__rbiLimiters ??= new Map<string, Limiter>());
/** Bumped on every clear, so a read that was already in flight can't put old data back. */
const generation = (store.__rbiGeneration ??= { value: 0 });

/** The on-disk copy. Off in demo mode and on Vercel (read-only file system); then memory only. */
function saved(): SavedReads | null {
  if (store.__rbiSaved !== undefined) return store.__rbiSaved;
  if (isMockMode() || process.env.VERCEL === "1") return (store.__rbiSaved = null);
  try {
    const dir = process.env.AUDIT_LOG_DIR?.trim() || path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    store.__rbiSaved = new SavedReads(path.join(dir, "railway-cache.sqlite"));
  } catch (error) {
    console.warn("[railway] Saved reads are off (memory only):", error instanceof Error ? error.message : error);
    store.__rbiSaved = null;
  }
  return store.__rbiSaved;
}

function readSaved(key: string): CacheEntry | null {
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const disk = saved()?.get(key);
    if (disk) {
      cache.set(key, disk);
      return disk;
    }
  } catch {}
  return null;
}

function writeSaved(key: string, account: string, entry: CacheEntry) {
  cache.set(key, entry);
  try {
    saved()?.set(key, account, entry.data, entry.fetchedAt);
  } catch {}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

async function withSlot<T>(accountKey: string, fn: () => Promise<T>): Promise<T> {
  let limiter = limiters.get(accountKey);
  if (!limiter) {
    limiter = { active: 0, queue: [] };
    limiters.set(accountKey, limiter);
  }
  if (limiter.active < MAX_IN_FLIGHT_PER_ACCOUNT) {
    limiter.active++;
  } else {
    // Wait for a finishing request to hand its slot over.
    await new Promise<void>((resolve) => limiter!.queue.push(resolve));
  }
  try {
    return await fn();
  } finally {
    const next = limiter.queue.shift();
    if (next) next();
    else limiter.active--;
  }
}

function recordRate(accountKey: string, headers: Headers) {
  const limit = Number(headers.get("x-ratelimit-limit"));
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  const reset = headers.get("x-ratelimit-reset") ?? undefined;
  if (!Number.isFinite(limit) && !Number.isFinite(remaining)) return;
  rateInfo.set(accountKey, {
    limit: Number.isFinite(limit) && headers.has("x-ratelimit-limit") ? limit : undefined,
    remaining: Number.isFinite(remaining) && headers.has("x-ratelimit-remaining") ? remaining : undefined,
    reset,
    updatedAt: Date.now(),
  });
}

export function getRateInfo(accountKey: string): RateInfo | undefined {
  return rateInfo.get(accountKey);
}

export function clearCache(accountKey?: string) {
  generation.value++;
  try {
    saved()?.clear(accountKey);
  } catch {}
  if (!accountKey) {
    cache.clear();
    inflight.clear();
    return;
  }
  for (const key of cache.keys()) if (key.startsWith(`${accountKey}|`)) cache.delete(key);
  for (const key of inflight.keys()) if (key.startsWith(`${accountKey}|`)) inflight.delete(key);
}

/** When the oldest saved read was fetched (ms since epoch), or null when nothing is saved. */
export function oldestCachedAt(): number | null {
  try {
    const disk = saved()?.oldest();
    if (disk != null) return disk;
  } catch {}
  let oldest: number | null = null;
  for (const entry of cache.values()) if (oldest == null || entry.fetchedAt < oldest) oldest = entry.fetchedAt;
  return oldest;
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 5;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  return 5;
}

type GraphQLErrorShape = { message?: string; extensions?: { code?: string; traceId?: string } };

function fromGraphQLErrors(doc: GqlDoc, status: number, errors: GraphQLErrorShape[]): RailwayApiError {
  const messages = [...new Set(errors.map((e) => e.message || "Unknown error"))];
  const codes = errors.map((e) => e.extensions?.code ?? "");
  const traceIds = errors.map((e) => e.extensions?.traceId).filter((t): t is string => !!t);
  const text = messages.join("; ");
  let kind: RailwayErrorKind = "graphql";
  if (/not authori[sz]ed/i.test(text)) kind = "auth";
  else if (/not found/i.test(text)) kind = "not_found";
  else if (status === 400 || codes.some((c) => c.startsWith("GRAPHQL_") || c === "BAD_USER_INPUT")) kind = "validation";
  return new RailwayApiError(`${text} (${doc.name})`, { kind, operation: doc.name, status, traceIds });
}

async function execute<T>(account: AccountConfig, doc: GqlDoc, variables: Record<string, unknown>): Promise<T> {
  const isMutation = doc.kind === "mutation";
  // Reads are safe to retry. Writes are retried only after a 429 (request rejected, never ran).
  const maxAttempts = isMutation ? 2 : 3;

  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(RAILWAY_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query: doc.query, variables, operationName: doc.name }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (!isMutation && attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new RailwayApiError(
        isMutation
          ? `Network error during ${doc.name} (${reason}). The change may or may not have reached Railway — refresh and check before trying again.`
          : `Couldn't reach Railway (${reason}).`,
        { kind: "network", operation: doc.name },
      );
    }

    recordRate(account.key, response.headers);

    if (response.status === 429) {
      const wait = parseRetryAfter(response.headers.get("retry-after"));
      if (attempt < maxAttempts && wait <= MAX_AUTO_RETRY_WAIT_S) {
        await sleep(wait * 1000);
        continue;
      }
      throw new RailwayApiError(`Railway API rate limit reached — try again in about ${wait}s.`, {
        kind: "rate_limit",
        operation: doc.name,
        status: 429,
        retryAfterSec: wait,
      });
    }

    const text = await response.text();
    let body: { data?: unknown; errors?: GraphQLErrorShape[] } | null = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (response.status >= 500 && !(body?.errors?.length)) {
      if (!isMutation && attempt < maxAttempts) {
        await sleep(800 * attempt);
        continue;
      }
      throw new RailwayApiError(
        isMutation
          ? `Railway returned HTTP ${response.status} during ${doc.name}. The change may or may not have been applied — refresh and check.`
          : `Railway returned HTTP ${response.status}.`,
        { kind: "server", operation: doc.name, status: response.status },
      );
    }

    if (body?.errors?.length) throw fromGraphQLErrors(doc, response.status, body.errors);

    if (!response.ok || !body || body.data == null) {
      throw new RailwayApiError(`Unexpected response from Railway (HTTP ${response.status}) for ${doc.name}.`, {
        kind: "server",
        operation: doc.name,
        status: response.status,
      });
    }

    return body.data as T;
  }
}

/**
 * Send one GraphQL operation to Railway with the account's token.
 * - Queries: saved until Refresh, with no time limit (per account + variables, in memory and on disk),
 *   de-duplicated while in flight.
 * - Mutations: never cached; a mutation clears that account's cache.
 * - Any `errors` entry throws — Railway reports auth failures as HTTP 200 + errors.
 */
export async function railwayRequest<T>(
  account: AccountConfig,
  doc: GqlDoc,
  variables: Record<string, unknown> = {},
  opts: { fresh?: boolean } = {},
): Promise<T> {
  if (isMockMode()) return mockRequest<T>(doc, variables);

  if (doc.kind === "mutation") {
    try {
      return await withSlot(account.key, () => execute<T>(account, doc, variables));
    } finally {
      clearCache(account.key);
    }
  }

  const cacheKey = `${account.key}|${doc.name}|${stableStringify(variables)}`;
  if (!opts.fresh) {
    const hit = readSaved(cacheKey);
    if (hit) return hit.data as T;
    const pending = inflight.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const startedIn = generation.value;
  const queuedAt = Date.now();
  const promise = withSlot(account.key, () => execute<T>(account, doc, variables))
    .then((data) => {
      const took = Date.now() - queuedAt;
      // Shown in the terminal running the dashboard, to spot what makes a page slow.
      if (took > SLOW_MS) console.info(`[railway] ${doc.name} for ${account.label} took ${(took / 1000).toFixed(1)} s (including waiting for a free slot)`);
      // Live reads (logs) aren't saved; everything else is kept until Refresh.
      if (generation.value === startedIn && !opts.fresh) writeSaved(cacheKey, account.key, { fetchedAt: Date.now(), data });
      return data;
    })
    .finally(() => {
      if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey);
    });
  inflight.set(cacheKey, promise);
  return promise;
}
