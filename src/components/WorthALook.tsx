"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/Icon";
import { Badge, Card, CardHeader } from "@/components/ui";
import type { Candidate } from "@/lib/summaries";
import { DEFAULT_WORTH_RANGE, WORTH_RANGES, isWorthRange, splitWorth, type WorthRange } from "@/lib/worth-a-look";

const STORAGE_KEY = "rbi-worth-range";
const SHOWN = 10;

/**
 * "Worth a look": what happened (crashes, failed deploys), filtered by Today / This week / This
 * month / This year / All (remembered per browser), and, apart from that, what is on this
 * period's bill. The filter never applies to the bill part.
 */
export function WorthALook({ candidates, renderedAt }: { candidates: Candidate[]; renderedAt: number }) {
  const [range, setRange] = useState<WorthRange>(DEFAULT_WORTH_RANGE);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isWorthRange(saved)) setRange(saved);
    } catch {
      // storage blocked: keep the default
    }
  }, []);

  const { events: visible, billing, hidden: older } = useMemo(() => splitWorth(candidates, range, renderedAt), [candidates, range, renderedAt]);
  const shown = expanded ? visible : visible.slice(0, SHOWN);
  const phrase = WORTH_RANGES.find((r) => r.id === range)?.phrase ?? "any time";
  const eventCount = visible.length + older;
  const charging = billing.filter((c) => c.charging).length;

  function choose(next: WorthRange) {
    setRange(next);
    setExpanded(false);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage blocked: the choice lasts for this page view
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={<span className="flex items-center gap-2">Worth a look <Badge>{visible.length}</Badge></span>}
        subtitle={
          range === "all"
            ? "Crashes and failed deploys from any time. Every change still needs your approval."
            : `Crashes and failed deploys from ${phrase}. Every change still needs your approval.`
        }
        actions={
          <div className="flex max-w-full overflow-x-auto rounded-lg border border-line bg-page p-1 text-xs" role="group" aria-label="Show items from">
            {WORTH_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                title={r.ms == null ? "Everything" : `Last ${r.phrase.replace("the last ", "")}`}
                onClick={() => choose(r.id)}
                className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 font-medium ${range === r.id ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />
      {visible.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-2">
          {eventCount === 0 ? (
            "No crashes or failed deploys."
          ) : (
            <>
              Nothing happened in {phrase}.{" "}
              <button type="button" className="font-medium text-link underline-offset-2 hover:underline" onClick={() => choose("all")}>
                Show all {eventCount}
              </button>
            </>
          )}
        </p>
      ) : (
        <ItemList items={shown} />
      )}
      {(visible.length > SHOWN || (older > 0 && range !== "all")) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-ink-2">
          {visible.length > SHOWN && (
            <button type="button" className="font-medium text-link underline-offset-2 hover:underline" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Show fewer" : `Show all ${visible.length}`}
            </button>
          )}
          {older > 0 && range !== "all" && visible.length > 0 && (
            <span>
              {older} older {older === 1 ? "item" : "items"} hidden ·{" "}
              <button type="button" className="font-medium text-link underline-offset-2 hover:underline" onClick={() => choose("all")}>
                show everything
              </button>
            </span>
          )}
        </p>
      )}
      {billing.length > 0 && (
        <section aria-labelledby="still-on-bill" className="border-t border-line">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-1">
            <div className="min-w-0">
              <h3 id="still-on-bill" className="flex items-center gap-2 text-sm font-semibold">
                Still on this period&apos;s bill <Badge>{billing.length}</Badge>
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">
                {charging > 0
                  ? `${charging === 1 ? "1 is" : `${charging} are`} still adding to the bill now. The rest were charged earlier this period and have stopped.`
                  : "All of these were charged earlier this period and have stopped; nothing here is adding to the bill now."}{" "}
                The date filter above doesn&apos;t apply here.
              </p>
            </div>
            <Link href="/billing/history" className="link shrink-0 text-xs">
              Daily cost by project →
            </Link>
          </div>
          <ItemList items={billing} tag />
        </section>
      )}
    </Card>
  );
}

function ItemList({ items, tag = false }: { items: Candidate[]; tag?: boolean }) {
  return (
    <ul className="recommendations grid md:grid-cols-2">
      {items.map((c) => (
        <li key={c.key}>
          <Link href={c.href} className="flex h-full items-start gap-3 px-5 py-4 transition-colors hover:bg-surface-2">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: c.severity === 0 ? "var(--danger-wash)" : c.severity === 1 ? "var(--warning-wash)" : "var(--info-wash)" }}
            >
              <Icon
                name={c.icon}
                size={15}
                color={c.severity === 0 ? "var(--status-critical)" : c.severity === 1 ? "var(--status-warning)" : "var(--series-1)"}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{c.title}</span>
              <span className="mt-1 block text-xs leading-relaxed text-ink-2">{c.detail}</span>
              {tag && (
                <span className="mt-1.5 block">
                  {c.charging ? <Badge tone="warning">Still charging</Badge> : <Badge>Charged earlier, stopped</Badge>}
                </span>
              )}
            </span>
            <Icon name="chevron" size={14} className="mt-1 shrink-0 text-ink-2" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
