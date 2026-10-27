import type { NextConfig } from "next";

import { KEEP_PAGES_SECONDS } from "./src/lib/preload";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Keep pages the browser has shown or preloaded for an hour, so switching tabs doesn't
    // re-render them. Refresh and every change made from the app throw these copies away.
    staleTimes: { dynamic: KEEP_PAGES_SECONDS, static: KEEP_PAGES_SECONDS },
  },
  // The dashboard talks to Railway only from the server. Nothing here is meant
  // to be exposed publicly; see README "Security".
};

export default nextConfig;
