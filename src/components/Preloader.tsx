"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { PRELOAD_DELAY_MS, REFRESHED_EVENT, REWARM_DELAY_MS, routesToPreload } from "@/lib/preload";

// `router.prefetch` takes Next's internal PrefetchKind enum; "full" asks for the whole page, data included.
type PrefetchOptions = NonNullable<Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]>;
const FULL = { kind: "full" } as unknown as PrefetchOptions;

/**
 * Reads the other tabs in the background once the first page is on screen, so clicking one shows
 * it straight away. When Refresh or a change made here throws the saved copies away, they're read
 * again after a short pause. Renders nothing.
 *
 * `next dev` ignores router.prefetch, so there we ask the server to render each tab instead: that
 * fills the server's Railway cache (and compiles the page), and the browser keeps each tab after
 * its first visit. `npm run build && npm start` gets the full effect.
 */
export function Preloader() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const warm = async () => {
      const routes = routesToPreload(window.location.pathname, window.location.search);
      if (process.env.NODE_ENV === "development") {
        // One at a time, so the page you're on keeps the server's attention.
        for (const href of routes) {
          if (cancelled) return;
          await fetch(href, { headers: { RSC: "1" }, signal: controller.signal }).then((r) => r.arrayBuffer()).catch(() => undefined);
        }
        return;
      }
      for (const href of routes) router.prefetch(href, { ...FULL, onInvalidate: () => schedule(REWARM_DELAY_MS) });
    };

    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) void warm();
      }, delay);
    };

    const start = () => schedule(PRELOAD_DELAY_MS);
    const refreshed = () => schedule(REWARM_DELAY_MS);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    window.addEventListener(REFRESHED_EVENT, refreshed);

    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener("load", start);
      window.removeEventListener(REFRESHED_EVENT, refreshed);
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  return null;
}
