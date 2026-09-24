"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatMetric, type MetricKind } from "@/lib/metric-format";

type Kind = MetricKind;

const HEIGHT_PLOT = 120;
const AXIS_BAND = 22;
const MARGIN = { top: 8, right: 12, left: 78 };

/**
 * Axis ticks are chosen in the unit that is displayed (MB, not GB) so the labels
 * are round numbers that sit exactly on their gridlines.
 */
function displayUnit(kind: Kind, maxRaw: number): { factor: number; unit: string } {
  if (kind === "cpu") return { factor: 1, unit: "vCPU" };
  if (kind === "memory") return maxRaw < 1 ? { factor: 1024, unit: "MB" } : { factor: 1, unit: "GB" };
  return maxRaw * 1024 < 0.1 ? { factor: 1024 * 1024, unit: "KB" } : { factor: 1024, unit: "MB" };
}

function tickLabel(value: number, unit: string): string {
  return value === 0 ? "0" : `${Number(value.toPrecision(3))} ${unit}`;
}

function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * exponent >= value) return f * exponent;
  return 10 * exponent;
}

function timeLabel(ts: number, spanSeconds: number) {
  const d = new Date(ts * 1000);
  if (spanSeconds <= 36 * 3600) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function fullTime(ts: number) {
  return new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Single-series area chart with a crosshair tooltip (pointer + keyboard) and a
 * table view. One measure per chart, one y-axis, never dual-axis.
 */
export function TimeSeriesChart({
  title,
  kind,
  points,
  aggregate = "avg",
  note,
}: {
  title: string;
  kind: Kind;
  points: [number, number][];
  /** How the header summarises the series: average/peak, or a total (egress). */
  aggregate?: "avg" | "sum";
  note?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);
  // Times are formatted in the browser's locale/time zone, so draw after mount.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const t0 = points[0][0];
    const t1 = points[points.length - 1][0];
    const span = Math.max(1, t1 - t0);
    const max = Math.max(...points.map((p) => p[1]));
    const { factor, unit } = displayUnit(kind, max);
    const yMaxDisplay = niceMax(max * factor * 1.15);
    const yMax = yMaxDisplay / factor;
    const ticks = [0, 0.5, 1].map((f) => ({ raw: yMax * f, label: tickLabel(yMaxDisplay * f, unit) }));
    const plotW = Math.max(10, width - MARGIN.left - MARGIN.right);
    const x = (t: number) => MARGIN.left + ((t - t0) / span) * plotW;
    const y = (v: number) => MARGIN.top + HEIGHT_PLOT - (v / yMax) * HEIGHT_PLOT;
    const xs = points.map((p) => x(p[0]));
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    const base = MARGIN.top + HEIGHT_PLOT;
    const area = `${line}L${xs[xs.length - 1].toFixed(1)},${base}L${xs[0].toFixed(1)},${base}Z`;
    return { t0, t1, span, yMax, ticks, x, y, xs, line, area, plotW };
  }, [points, width, kind]);

  const values = points.map((p) => p[1]);
  const total = values.reduce((a, b) => a + b, 0);
  const avg = values.length ? total / values.length : 0;
  const peak = values.length ? Math.max(...values) : 0;
  const latest = values.length ? values[values.length - 1] : 0;
  const summary =
    values.length === 0
      ? "no data"
      : aggregate === "sum"
        ? `total ${formatMetric(kind, total)} · peak ${formatMetric(kind, peak)}/interval`
        : `avg ${formatMetric(kind, avg)} · peak ${formatMetric(kind, peak)}`;

  function nearestIndex(px: number) {
    if (!geometry) return null;
    const xs = geometry.xs;
    let lo = 0;
    let hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < px) lo = mid;
      else hi = mid;
    }
    return Math.abs(xs[lo] - px) <= Math.abs(xs[hi] - px) ? lo : hi;
  }

  const tableRows = useMemo(() => {
    if (points.length <= 30) return points;
    const stride = points.length / 30;
    return Array.from({ length: 30 }, (_, i) => points[Math.min(points.length - 1, Math.round(i * stride))]);
  }, [points]);

  const height = MARGIN.top + HEIGHT_PLOT + AXIS_BAND;
  const hoverPoint = hover != null ? points[hover] : null;

  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-ink-2">{summary}</span>
      </figcaption>

      <div ref={wrapRef} className="relative mt-2 w-full">
        {!mounted ? (
          <div style={{ height }} aria-hidden />
        ) : !geometry ? (
          <div className="flex items-center justify-center rounded-md border border-dashed border-line text-xs text-ink-2" style={{ height }}>
            {note ?? "No samples in this range (the service may be offline or sleeping)."}
          </div>
        ) : (
          <>
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={`${title}: latest ${formatMetric(kind, latest)}, ${summary}. Use the arrow keys to read values.`}
              tabIndex={0}
              className="block touch-none select-none outline-none focus-visible:outline-2 focus-visible:outline-[var(--series-1)]"
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHover(nearestIndex(e.clientX - rect.left));
              }}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover((h) => h ?? points.length - 1)}
              onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? points.length) - 1));
                else if (e.key === "ArrowRight") setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1));
                else if (e.key === "Home") setHover(0);
                else if (e.key === "End") setHover(points.length - 1);
                else if (e.key === "Escape") setHover(null);
                else return;
                e.preventDefault();
              }}
            >
              {geometry.ticks.map((tick, i) => {
                const yy = geometry.y(tick.raw);
                return (
                  <g key={i}>
                    <line x1={MARGIN.left} x2={width - MARGIN.right} y1={yy} y2={yy} stroke={i === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
                    <text x={MARGIN.left - 6} y={yy} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-muted)" className="tabular">
                      {tick.label}
                    </text>
                  </g>
                );
              })}
              {[geometry.t0, geometry.t0 + geometry.span / 2, geometry.t1].map((t, i) => (
                <text
                  key={i}
                  x={geometry.x(t)}
                  y={MARGIN.top + HEIGHT_PLOT + 15}
                  fontSize={11}
                  fill="var(--ink-muted)"
                  textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
                >
                  {timeLabel(t, geometry.span)}
                </text>
              ))}
              <path d={geometry.area} fill="var(--series-1)" fillOpacity={0.1} />
              <path d={geometry.line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {hover != null && hoverPoint && (
                <g pointerEvents="none">
                  <line x1={geometry.xs[hover]} x2={geometry.xs[hover]} y1={MARGIN.top} y2={MARGIN.top + HEIGHT_PLOT} stroke="var(--ink-2)" strokeWidth={1} />
                  <circle cx={geometry.xs[hover]} cy={geometry.y(hoverPoint[1])} r={4} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
                </g>
              )}
            </svg>
            {hover != null && hoverPoint && (
              <div
                className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-md"
                style={{
                  left: Math.min(Math.max(geometry.xs[hover], 70), width - 70),
                  transform: "translateX(-50%)",
                }}
                role="status"
              >
                <div className="flex items-center gap-1.5 font-semibold tabular">
                  <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--series-1)" }} />
                  {formatMetric(kind, hoverPoint[1], true)}
                </div>
                <div className="text-ink-2">{fullTime(hoverPoint[0])}</div>
              </div>
            )}
          </>
        )}
      </div>

      {mounted && points.length > 0 && (
        <details className="mt-1 text-xs text-ink-2">
          <summary className="cursor-pointer select-none hover:text-ink">Data table</summary>
          <table className="mt-1 w-full">
            <thead>
              <tr className="text-left">
                <th className="py-0.5 font-medium">Time</th>
                <th className="py-0.5 text-right font-medium">{title}</th>
              </tr>
            </thead>
            <tbody className="tabular text-ink">
              {tableRows.map(([ts, v]) => (
                <tr key={ts} className="border-t border-line">
                  <td className="py-0.5">{fullTime(ts)}</td>
                  <td className="py-0.5 text-right">{formatMetric(kind, v, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}
