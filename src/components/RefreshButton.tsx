"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { finishRefreshAction, refreshDataAction, startRefreshAction } from "@/app/actions";
import {
  AUTO_REFRESH_AFTER_MS,
  AUTO_RETRY_GAP_MS,
  REFRESH_CONCURRENCY,
  REFRESH_HEADER,
  REFRESH_TIMEOUT_MS,
  REFRESHED_EVENT,
  refreshRoutes,
} from "@/lib/preload";
import { buttonClass } from "./button";
import { Icon } from "./Icon";

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** Across browser tabs, so two open tabs don't both start an automatic refresh. */
const AUTO_KEY = "rbi:auto-refresh-at";

/**
 * Reads Railway again without emptying the screen: the page stays on the saved copy while every
 * tab is rendered again in the background (each with REFRESH_HEADER, so its reads go to the
 * refresh), then the new reads replace the saved copy at once and the page swaps. It also starts
 * on its own when the saved copy is older than an hour. `dataSince` is when the oldest saved read
 * was fetched, so the label says how old what you're looking at is.
 */
export function RefreshButton({ dataSince }: { dataSince: number }) {
  const router = useRouter();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const running = useRef(false);
  // Rendered only after mount, so server and browser clocks can't disagree during hydration.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [dataSince]);

  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setNote(null);
    setProgress({ done: 0, total: 1 });
    try {
      const start = await startRefreshAction();
      if (!start.ok) throw new Error(start.error);
      const id = start.data.id;
      if (!id) {
        // Demo mode keeps nothing, so a plain re-read is all there is.
        await refreshDataAction();
        router.refresh();
        window.dispatchEvent(new Event(REFRESHED_EVENT));
        return;
      }

      const routes = refreshRoutes(window.location.pathname, window.location.search);
      let next = 0;
      let done = 0;
      setProgress({ done, total: routes.length });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
      const worker = async () => {
        while (next < routes.length && !controller.signal.aborted) {
          const href = routes[next++];
          try {
            const response = await fetch(href, { headers: { [REFRESH_HEADER]: id }, cache: "no-store", signal: controller.signal });
            await response.arrayBuffer();
          } catch {
            // A tab that fails to render keeps its saved copy; the rest still swap in.
          }
          setProgress({ done: ++done, total: routes.length });
        }
      };
      await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, worker));
      clearTimeout(timer);
      const timedOut = controller.signal.aborted;

      const finished = await finishRefreshAction(id);
      router.refresh();
      window.dispatchEvent(new Event(REFRESHED_EVENT));
      if (!finished.ok) setNote(finished.error);
      else if (!finished.data.swapped) setNote(finished.data.reason ?? "Nothing was updated.");
      else if (timedOut) setNote(`Stopped after ${REFRESH_TIMEOUT_MS / 60_000} minutes; what was read is shown.`);
      else if (finished.data.failed > 0) setNote("Some reads failed, so the rest of the saved copy was kept.");
    } catch (error) {
      setNote(`Couldn't refresh: ${error instanceof Error ? error.message : String(error)}. Showing the saved copy.`);
    } finally {
      running.current = false;
      setProgress(null);
    }
  }, [router]);

  // Opening the dashboard on an old saved copy: show it straight away, refresh it in the background.
  useEffect(() => {
    if (Date.now() - dataSince < AUTO_REFRESH_AFTER_MS) return;
    let last = 0;
    try {
      last = Number(window.localStorage.getItem(AUTO_KEY) ?? 0);
    } catch {}
    if (Date.now() - last < AUTO_RETRY_GAP_MS) return;
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(AUTO_KEY, String(Date.now()));
      } catch {}
      void refresh();
    }, 1_500);
    return () => clearTimeout(timer);
    // Once per page load: a fresh copy after the swap moves dataSince forward anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const age = now == null ? null : ago(Math.max(0, now - dataSince));
  const busy = progress != null;
  const label = busy
    ? progress.total > 1
      ? `Updating ${progress.done} of ${progress.total}…`
      : "Updating…"
    : (note ?? (age ? `Updated ${age}` : null));

  return (
    <span className="inline-flex items-center gap-2">
      {label && (
        <span className="hidden max-w-[22rem] truncate text-xs text-ink-2 md:inline" aria-live="polite" title={note ?? undefined}>
          {label}
        </span>
      )}
      <button
        type="button"
        className={buttonClass("neutral", "sm")}
        disabled={busy}
        onClick={() => void refresh()}
        title={busy ? "Reading Railway in the background; the saved copy stays on screen until it's done." : age ? `Data from ${age}. Re-read everything from Railway.` : "Re-read everything from Railway"}
      >
        <Icon name="refresh" size={12} className={busy ? "animate-spin" : undefined} />
        <span className="sr-only sm:not-sr-only">{busy ? "Updating…" : "Refresh"}</span>
      </button>
    </span>
  );
}
