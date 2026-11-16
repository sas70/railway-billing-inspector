/**
 * Pages read once in the background after the first page settles, so clicking a tab shows a copy
 * that's already here instead of "Reading from Railway…". Includes every dashboard
 * tab and billing window; project detail pages load when opened.
 */
export const PRELOAD_ROUTES = ["/", "/services", "/search", "/billing", "/billing?period=previous", "/billing/history", "/billing/history?days=7", "/billing/history?days=30", "/limits", "/rename", "/audit"] as const;

/**
 * How long the browser keeps a page it has shown or preloaded, in seconds: a week, so in practice
 * until you press Refresh (which throws them away). Reloading the browser tab also starts fresh,
 * but the server answers from its saved copy, so that's quick too.
 */
export const KEEP_PAGES_SECONDS = 7 * 24 * 60 * 60;

/** Wait this long after the page settles before preloading, so the page you opened gets Railway's attention first. */
export const PRELOAD_DELAY_MS = 1_500;

/** After Refresh, wait for things to go quiet before re-reading the other tabs, so a burst of refreshes costs one preload. */
export const REWARM_DELAY_MS = 4_000;

/** The routes to preload from `pathname`: everything except the page already on screen. */
export function routesToPreload(pathname: string, search = ""): string[] {
  const here = search ? `${pathname}?${search.replace(/^\?/, "")}` : pathname;
  return PRELOAD_ROUTES.filter((route) => route !== here);
}

/** Sent by the Refresh button once the fresh page is on screen, so the other tabs are read again. */
export const REFRESHED_EVENT = "rbi:refreshed";

// ── Background refresh ──────────────────────────────────────────────────────
// Refresh (and the automatic one) reads Railway again without throwing the saved copy away first:
// the pages stay on screen from the saved copy while each tab is rendered again in the background
// with REFRESH_HEADER, then the new reads replace the old ones in one go and the page swaps.

/** Sent with each background render so its Railway reads go to the refresh, not the saved copy. */
export const REFRESH_HEADER = "x-rbi-refresh";

/** Opening the dashboard refreshes in the background when the saved copy is older than this. */
export const AUTO_REFRESH_AFTER_MS = 60 * 60_000;

/** If an automatic refresh didn't finish, don't start another one on the next page for this long. */
export const AUTO_RETRY_GAP_MS = 10 * 60_000;

/** A whole refresh stops waiting after this; whatever was read by then is kept. */
export const REFRESH_TIMEOUT_MS = 3 * 60_000;

/** Tabs rendered at the same time during a refresh (each is several Railway reads). */
export const REFRESH_CONCURRENCY = 2;

/** What a refresh renders again: the page on screen first, then every other tab. */
export function refreshRoutes(pathname: string, search = ""): string[] {
  const here = search ? `${pathname}?${search.replace(/^\?/, "")}` : pathname;
  return [here, ...PRELOAD_ROUTES.filter((route) => route !== here)];
}
