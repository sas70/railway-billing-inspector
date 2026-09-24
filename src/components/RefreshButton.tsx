"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { refreshDataAction } from "@/app/actions";
import { buttonClass } from "./button";
import { Icon } from "./Icon";

/** Drops the 30-second cache and re-reads everything from Railway. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={buttonClass("neutral", "sm")}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await refreshDataAction();
          router.refresh();
        })
      }
      title="Re-read everything from Railway (skips the 30-second cache)"
    >
      <Icon name="refresh" size={12} className={pending ? "animate-spin" : undefined} />
      <span className="sr-only sm:not-sr-only">{pending ? "Refreshing…" : "Refresh"}</span>
    </button>
  );
}
