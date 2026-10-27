"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const OPEN_DELAY_MS = 300;
/** Time to move the pointer from the link onto the card before it closes. */
const CLOSE_DELAY_MS = 150;
const GAP = 6;
const EDGE = 8;

/**
 * A link that shows a small card about where it goes, on mouse hover or keyboard focus.
 * The card is portalled to <body> with fixed positioning, so the lists' horizontal scroll
 * containers can't clip it, and it stays open while the pointer is over it. Screen readers get
 * the same text from a hidden description that's always linked to the link. On touch screens a
 * tap just follows the link; the project page shows the same text.
 */
export function HoverLink({
  href,
  className,
  children,
  card,
  description,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  card: React.ReactNode;
  /** Plain-text version of the card for screen readers. */
  description: string;
}) {
  const descriptionId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
    setPosition(null);
  }, []);

  const later = useCallback((action: () => void, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(action, delay);
  }, []);

  const keepOpen = useCallback(() => clearTimeout(timer.current), []);

  // The card first renders invisible so it can be measured, then sits below the link
  // (or above it when there isn't room), kept inside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const box = cardRef.current?.getBoundingClientRect();
    if (!anchor || !box) return;
    const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - box.width - EDGE));
    const below = anchor.bottom + GAP;
    const top = below + box.height + EDGE <= window.innerHeight ? below : Math.max(EDGE, anchor.top - GAP - box.height);
    setPosition({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, hide]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span
      ref={anchorRef}
      className="inline-flex min-w-0"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") later(() => setOpen(true), open ? 0 : OPEN_DELAY_MS);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") later(hide, CLOSE_DELAY_MS);
      }}
      onFocus={() => later(() => setOpen(true), 0)}
      onBlur={hide}
    >
      <Link href={href} className={className} aria-describedby={descriptionId}>
        {children}
      </Link>
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
      {open &&
        createPortal(
          <div
            ref={cardRef}
            aria-hidden="true"
            data-hover-card
            onPointerEnter={keepOpen}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") later(hide, CLOSE_DELAY_MS);
            }}
            className="fixed z-50 w-max max-w-[min(24rem,calc(100vw-1rem))] rounded-lg border border-line bg-surface px-3 py-2.5 text-xs text-ink shadow-xl"
            style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}
          >
            {card}
          </div>,
          document.body,
        )}
    </span>
  );
}
