import type { Metadata } from "next";
import Link from "next/link";

import { NavLink } from "@/components/NavLink";
import { RefreshButton } from "@/components/RefreshButton";
import { WriteModeToggle } from "@/components/WriteModeToggle";
import { Badge } from "@/components/ui";
import { getAccounts, isEnvReadOnly, isMockMode } from "@/lib/config";
import { getRateInfo } from "@/lib/railway/client";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Railway Billing Inspector", template: "%s · Railway Billing Inspector" },
  description: "Inspect Railway projects, usage and billing, and approve cleanups.",
  robots: { index: false, follow: false },
};

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="var(--series-1)" />
      <path d="M6 16.5a6 6 0 0 1 12 0" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16.5 15 11" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Footer() {
  const budgets = getAccounts()
    .map((account) => ({ label: account.label, rate: getRateInfo(account.key) }))
    .filter((b) => b.rate?.remaining != null);
  return (
    <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-ink-2 sm:px-6">
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-4">
        <span>Railway reads are cached for 30 s — use Refresh for the latest.</span>
        <span>Costs are estimates (usage × Railway list prices); your invoice is authoritative.</span>
        {budgets.map((b) => (
          <span key={b.label} className="tabular">
            API budget · {b.label}: {b.rate!.remaining}
            {b.rate!.limit ? ` of ${b.rate!.limit}` : ""} requests left this hour
          </span>
        ))}
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const demo = isMockMode();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-line bg-surface">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-5 sm:px-6">
            <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight" aria-label="Railway Billing Inspector — overview">
              <Logo />
              <span className="hidden md:inline">Railway Billing Inspector</span>
            </Link>
            <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5 text-sm">
              <NavLink href="/">Overview</NavLink>
              <NavLink href="/services">Services</NavLink>
              <NavLink href="/billing">Billing</NavLink>
              <NavLink href="/audit">
                <span className="whitespace-nowrap">
                  Audit<span className="hidden sm:inline"> log</span>
                </span>
              </NavLink>
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              {demo && (
                <Badge tone="info" title="RAILWAY_MOCK is on: fake data, nothing is sent to Railway">
                  Demo<span className="hidden sm:inline"> data</span>
                </Badge>
              )}
              <WriteModeToggle envLocked={isEnvReadOnly()} />
              <RefreshButton />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
