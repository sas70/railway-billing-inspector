import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dashboard talks to Railway only from the server. Nothing here is meant
  // to be exposed publicly; see README "Security".
};

export default nextConfig;
