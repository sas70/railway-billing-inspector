"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { refreshDataAction } from "@/app/actions";
import { REFRESHED_EVENT } from "@/lib/preload";
import { buttonClass } from "./button";
import { Icon } from "./Icon";

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/**
 * Throws away every saved Railway read, on the server and in the browser, and reads the page again.
 * The other tabs are read again in the background by <Preloader />. `dataSince` is when the oldest
 * saved read was fetched, so the label says how old what you're looking at is.
 */
export function RefreshButton({ dataSince }: { dataSince: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Rendered only after mount, so server and browser clocks can't disagree during hydration.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [dataSince]);

  const age = now == null ? null : ago(Math.max(0, now - dataSince));

  return (
    <span className="inline-flex items-center gap-2">
      {age && (
        <span className="hidden text-xs text-ink-2 md:inline" aria-live="polite">
          {pending ? "Reading from Railway…" : `Updated ${age}`}
        </span>
      )}
      <button
        type="button"
        className={buttonClass("neutral", "sm")}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await refreshDataAction();
            router.refresh();
            window.dispatchEvent(new Event(REFRESHED_EVENT));
          })
        }
        title={age ? `Data from ${age}. Re-read everything from Railway.` : "Re-read everything from Railway"}
      >
        <Icon name="refresh" size={12} className={pending ? "animate-spin" : undefined} />
        <span className="sr-only sm:not-sr-only">{pending ? "Refreshing…" : "Refresh"}</span>
      </button>
    </span>
  );
}
