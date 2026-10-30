"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { buttonClass } from "./button";
import { Icon } from "./Icon";
import { money, plural } from "@/lib/format";
import type { StoppedBilling } from "@/lib/summaries";

const REVIEW_HREF = "/services?show=stopped";
const SEEN_KEY = "rbi:stopped-billing-alert";

function costLine(s: StoppedBilling) {
  if (s.perDay != null && s.perDay >= 0.005) return `about ${money(s.perDay)} a day, ${money(s.soFar)} so far this period`;
  return `${money(s.soFar)} so far this period`;
}

/**
 * Services Railway stopped but still bills: a pulsing banner on the Overview, and a pop-up once per browser
 * session (shown again if the count changes). Both lead to Services filtered to those services; nothing is
 * removed without the usual review.
 */
export function StoppedBillingAlert({ summary }: { summary: StoppedBilling }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const seenValue = String(summary.services);

  useEffect(() => {
    if (summary.services === 0) return;
    let seen: string | null = null;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY);
    } catch {
      // Storage blocked: still show it, once per page load.
    }
    if (seen === seenValue) return;
    setOpen(true);
  }, [summary.services, seenValue]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  function markSeen() {
    try {
      window.sessionStorage.setItem(SEEN_KEY, seenValue);
    } catch {
      // Not remembered; it shows again on the next visit.
    }
  }

  if (summary.services === 0) return null;
  const what = plural(summary.services, "service");
  const where = summary.projects !== summary.services ? ` in ${plural(summary.projects, "project")}` : "";

  return (
    <>
      <Link
        href={REVIEW_HREF}
        className="attention-pulse group flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm bg-[var(--warning-wash)] hover:brightness-[0.98]"
        style={{ borderColor: "color-mix(in oklab, var(--status-warning) 60%, transparent)" }}
      >
        <Icon name="alert" size={18} color="var(--status-warning)" className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">
            {what}
            {where} stopped, but Railway is still billing {summary.services === 1 ? "it" : "them"}
          </span>
          <span className="block text-ink-2">{costLine(summary)}. Nothing is serving traffic from them.</span>
        </span>
        <span className={`${buttonClass("danger", "sm")} shrink-0`}>
          Review and remove <Icon name="chevron" size={13} />
        </span>
      </Link>

      {open && (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          onClose={() => {
            markSeen();
            setOpen(false);
          }}
          className="m-auto w-[min(520px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-left font-normal text-ink shadow-2xl"
        >
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--status-warning)" }}>
              <Icon name="alert" size={14} color="var(--status-warning)" /> Still charging
            </div>
            <h2 id={titleId} className="mt-1 text-lg font-semibold">
              {what} stopped, but still on your bill
            </h2>
            <div className="mt-3 space-y-3 text-sm">
              <p>
                Railway marked {summary.services === 1 ? "this deployment" : "these deployments"} stopped, but still lists{" "}
                {summary.services === 1 ? "it" : "them"} as active and keeps billing the memory:{" "}
                <strong>{costLine(summary)}</strong>.
              </p>
              <p className="text-ink-2">
                Removing {summary.services === 1 ? "it" : "them"} should end the charge. Settings, variables, domains
                and volumes stay. {summary.services === 1 ? "You'll review it" : "You'll pick which ones and approve them"}{" "}
                first.
              </p>
            </div>
          </div>
          <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" className={buttonClass("neutral", "md")} onClick={() => dialogRef.current?.close()}>
              Not now
            </button>
            <Link href={REVIEW_HREF} className={buttonClass("danger", "md")} onClick={() => markSeen()}>
              Review them <Icon name="chevron" size={14} />
            </Link>
          </footer>
        </dialog>
      )}
    </>
  );
}
