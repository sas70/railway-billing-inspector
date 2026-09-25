"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" || pathname.startsWith("/a/") : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`nav-link whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${active ? "nav-link-active font-semibold" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
    >
      {children}
    </Link>
  );
}
