import type { NextConfig } from "next";

import { KEEP_PAGES_SECONDS } from "./src/lib/preload";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Native or large server-only packages for the search index: load them from node_modules at
  // runtime instead of bundling them.
  serverExternalPackages: ["better-sqlite3", "@huggingface/transformers", "onnxruntime-node"],
  // The embedding runtime is optional and large; never ship it in a serverless bundle (the
  // hosted demo has topic search off).
  outputFileTracingExcludes: {
    "*": ["node_modules/onnxruntime-node/**", "node_modules/onnxruntime-web/**", "node_modules/@huggingface/transformers/**"],
  },
  experimental: {
    // Keep pages the browser has shown or preloaded for an hour, so switching tabs doesn't
    // re-render them. Refresh and every change made from the app throw these copies away.
    staleTimes: { dynamic: KEEP_PAGES_SECONDS, static: KEEP_PAGES_SECONDS },
  },
  // The dashboard talks to Railway only from the server. Nothing here is meant
  // to be exposed publicly; see README "Security".
};

export default nextConfig;
