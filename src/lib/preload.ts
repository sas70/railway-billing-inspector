/**
 * Pages read once in the background after the first page settles, so clicking a tab shows a copy
 * that's already here instead of "Reading from Railway…". Kept to the main tabs plus the one
 * switch people flip most (last billing period); project pages load the first time they're opened.
 */
export const PRELOAD_ROUTES = ["/", "/services", "/search", "/billing", "/billing?period=previous", "/audit"] as const;

/** How long the browser keeps a page it has shown or preloaded, in seconds. Matches the server's read cache. */
export const KEEP_PAGES_SECONDS = 60 * 60;

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
