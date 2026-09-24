import { NextResponse, type NextRequest } from "next/server";

import { isMockMode } from "@/lib/config";

/**
 * Runs before every page, route and Server Action.
 *
 * 1. Host check (always on). Only requests addressed to this machine by a local
 *    name are served. This blocks DNS-rebinding attacks, where a web page you visit
 *    re-points its own domain at 127.0.0.1 to script this dashboard. Add other names
 *    with DASHBOARD_ALLOWED_HOSTS if you really need them. The public Vercel demo
 *    is allowed only while the app is in mock mode (no real Railway token).
 * 2. Optional password (HTTP Basic auth, any username) when DASHBOARD_PASSWORD is set.
 */

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

function hostName(hostHeader: string): string {
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

function vercelHost(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0]?.split(":")[0]?.toLowerCase();
  }
}

function hostAllowed(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const name = hostName(hostHeader);
  const extra = (process.env.DASHBOARD_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if ([...LOCAL_HOSTS, ...extra].includes(name)) return true;

  if (!isMockMode()) return false;
  if (name === "vercel.app" || name.endsWith(".vercel.app")) return true;
  const vercelNames = [
    vercelHost(process.env.VERCEL_URL),
    vercelHost(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    vercelHost(process.env.VERCEL_BRANCH_URL),
  ].filter((h): h is string => !!h);
  return vercelNames.includes(name);
}

function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function suppliedPassword(header: string): string | null {
  if (!header.startsWith("Basic ")) return null;
  try {
    const binary = atob(header.slice(6).trim());
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    return decoded.slice(decoded.indexOf(":") + 1);
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  if (!hostAllowed(request.headers.get("host"))) {
    return new NextResponse("This dashboard only answers on 127.0.0.1 / localhost (see DASHBOARD_ALLOWED_HOSTS).", { status: 403 });
  }

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const supplied = suppliedPassword(request.headers.get("authorization") ?? "");
  if (supplied != null && constantTimeEqual(supplied, password)) return NextResponse.next();

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Railway Billing Inspector", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
