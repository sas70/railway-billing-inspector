import "server-only";

import { REFRESH_HEADER } from "../preload";

/**
 * The background refresh this request belongs to, if any. The browser renders each page again
 * with REFRESH_HEADER set to the refresh's id; Railway reads made while rendering it go to the
 * refresh instead of the saved copy (see railwayRequest). Outside a request (background jobs
 * started later, scripts) there is no header, and this returns null.
 *
 * Its own module so the tests can stand in for Next's request headers.
 */
export async function requestRefreshId(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get(REFRESH_HEADER);
  } catch {
    return null;
  }
}
