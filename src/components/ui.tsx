import Link from "next/link";

import { COST_PARTS, planTerms, type CostBreakdown } from "@/lib/billing";
import { money, percent } from "@/lib/format";
import type { Health, HealthCounts } from "@/lib/health";
import { Icon, type IconName } from "./Icon";

// ── Layout primitives ───────────────────────────────────────────────────────

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`panel min-w-0 rounded-xl border border-line bg-surface ${className}`}>{children}</section>;
}

export function CardHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="mt-1 text-xs leading-relaxed text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageTitle({ title, subtitle, badges, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; badges?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-[-0.035em]">{title}</h1>
          {badges}
        </div>
        {subtitle && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm text-ink-2">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <Icon name="chevron" size={12} className="opacity-60" />}
            {item.href ? (
              <Link href={item.href} className="hover:text-ink hover:underline underline-offset-2">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: React.ReactNode; tone?: "neutral" | "info" | "warning" | "danger"; title?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    info: "bg-[var(--info-wash)] text-ink",
    warning: "bg-[var(--warning-wash)] text-ink",
    danger: "bg-[var(--danger-wash)] text-ink",
  } as const;
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function PlanBadge({ plan, trial }: { plan: string; trial?: boolean }) {
  return (
    <Badge tone={plan === "PRO" ? "info" : "neutral"} title={`Railway ${planTerms(plan).label} plan`}>
      {trial ? "Trial" : planTerms(plan).label}
    </Badge>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "error"; title?: React.ReactNode; children?: React.ReactNode }) {
  const map = {
    info: { icon: "info" as IconName, color: "var(--series-1)", bg: "bg-[var(--info-wash)]" },
    warning: { icon: "alert" as IconName, color: "var(--status-warning)", bg: "bg-[var(--warning-wash)]" },
    error: { icon: "alert" as IconName, color: "var(--status-critical)", bg: "bg-[var(--danger-wash)]" },
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "note"} className={`flex gap-2.5 rounded-lg border border-line px-3 py-2.5 text-sm ${map.bg}`}>
      <Icon name={map.icon} size={16} color={map.color} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={title ? "mt-0.5 text-ink-2" : "text-ink"}>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-ink-2">{children}</div>;
}

// ── Status ──────────────────────────────────────────────────────────────────

type StatusStyle = { label: string; icon: IconName; color: string };

const GOOD = "var(--status-good)";
const WARN = "var(--status-warning)";
const CRIT = "var(--status-critical)";
const MUTED = "var(--ink-muted)";
const NEUTRAL = "var(--ink-2)";

const DEPLOYMENT_STATUS: Record<string, StatusStyle> = {
  SUCCESS: { label: "Success", icon: "check", color: GOOD },
  SLEEPING: { label: "Sleeping", icon: "moon", color: NEUTRAL },
  BUILDING: { label: "Building", icon: "loader", color: WARN },
  DEPLOYING: { label: "Deploying", icon: "loader", color: WARN },
  INITIALIZING: { label: "Initializing", icon: "loader", color: WARN },
  QUEUED: { label: "Queued", icon: "loader", color: WARN },
  WAITING: { label: "Waiting", icon: "loader", color: WARN },
  NEEDS_APPROVAL: { label: "Needs approval", icon: "loader", color: WARN },
  CRASHED: { label: "Crashed", icon: "alert", color: CRIT },
  FAILED: { label: "Failed", icon: "x", color: CRIT },
  REMOVED: { label: "Removed", icon: "circle", color: MUTED },
  REMOVING: { label: "Removing", icon: "circle", color: MUTED },
  SKIPPED: { label: "Skipped", icon: "circle", color: MUTED },
};

const HEALTH_STYLE: Record<Health, StatusStyle> = {
  live: { label: "Live", icon: "check", color: GOOD },
  sleeping: { label: "Sleeping", icon: "moon", color: NEUTRAL },
  deploying: { label: "Deploying", icon: "loader", color: WARN },
  crashed: { label: "Crashed", icon: "alert", color: CRIT },
  failed: { label: "Failed", icon: "x", color: CRIT },
  offline: { label: "Offline", icon: "circle", color: MUTED },
};

function Pill({ style, extra }: { style: StatusStyle; extra?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink">
      <Icon name={style.icon} size={12} color={style.color} />
      {style.label}
      {extra}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <Pill style={DEPLOYMENT_STATUS[status] ?? { label: status, icon: "circle", color: MUTED }} />;
}

export function HealthPill({ health, degraded }: { health: Health; degraded?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Pill style={HEALTH_STYLE[health]} />
      {degraded && (
        <span title="An older deployment is serving, but the newest one failed" className="inline-flex items-center gap-1 text-xs text-ink-2">
          <Icon name="alert" size={12} color={CRIT} />
          latest failed
        </span>
      )}
    </span>
  );
}

/** Compact "✓ 4 live · ! 1 crashed" summary; every count carries an icon and a word. */
export function HealthSummary({ counts }: { counts: HealthCounts }) {
  const order: Health[] = ["live", "sleeping", "deploying", "crashed", "failed", "offline"];
  const parts = order.filter((h) => counts[h] > 0);
  if (counts.total === 0) return <span className="text-xs text-ink-2">No services</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-2">
      {parts.map((h) => (
        <span key={h} className="inline-flex items-center gap-1 whitespace-nowrap">
          <Icon name={HEALTH_STYLE[h].icon} size={12} color={HEALTH_STYLE[h].color} />
          <span className="tabular text-ink">{counts[h]}</span> {HEALTH_STYLE[h].label.toLowerCase()}
        </span>
      ))}
      {counts.degraded > 0 && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap" title="Serving an older deployment because the newest one failed">
          <Icon name="alert" size={12} color={CRIT} />
          <span className="tabular text-ink">{counts.degraded}</span> latest failed
        </span>
      )}
    </span>
  );
}

// ── Figures ─────────────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  sub,
  icon,
  iconColor,
  chart,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: IconName;
  iconColor?: string;
  chart?: React.ReactNode;
}) {
  return (
    <div className="panel min-w-0 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm text-ink-2">
            {icon && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2"><Icon name={icon} size={14} color={iconColor ?? "var(--ink-2)"} /></span>}
            {label}
          </div>
          <div className="mt-3 text-3xl font-semibold tracking-tight tabular">{value}</div>
          {sub && <div className="mt-1.5 text-xs leading-relaxed text-ink-2">{sub}</div>}
        </div>
        {chart && <div className="mt-0.5 shrink-0">{chart}</div>}
      </div>
    </div>
  );
}

/** Usage against a plan's included amount: blue on a lighter blue track; warning once exceeded. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const over = value > max;
  const fraction = max > 0 ? Math.min(1, value / max) : 1;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(2))}
      className="h-2 w-full overflow-hidden rounded-full"
      style={{ background: over ? "var(--warning-wash)" : "var(--meter-track)" }}
    >
      <div className="h-full rounded-full" style={{ width: `${fraction * 100}%`, background: over ? "var(--status-warning)" : "var(--meter-fill)" }} />
    </div>
  );
}

/**
 * Part-to-whole: one stacked bar (≤5 resources, fixed colour per resource) plus a
 * legend table that doubles as the table view of the chart.
 */
export function CostBreakdownBar({ cost, emptyText = "No usage recorded." }: { cost: CostBreakdown; emptyText?: string }) {
  const parts = COST_PARTS.map((p) => ({ ...p, value: cost[p.key] })).filter((p) => p.value > 0);
  if (!(cost.total > 0)) return <p className="text-sm text-ink-2">{emptyText}</p>;
  return (
    <figure>
      <div
        className="flex h-4 w-full gap-[2px] overflow-hidden rounded-r-[4px]"
        role="img"
        aria-label={`Cost by resource: ${parts.map((p) => `${p.label} ${money(p.value)}`).join(", ")}`}
      >
        {parts.map((p) => (
          <div
            key={p.key}
            title={`${p.label}: ${money(p.value)} (${percent(p.value / cost.total)})`}
            className="h-full transition-opacity hover:opacity-80"
            style={{ width: `${(p.value / cost.total) * 100}%`, minWidth: 3, background: p.color }}
          />
        ))}
      </div>
      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">Cost by resource</caption>
        <tbody>
          {parts.map((p) => (
            <tr key={p.key} className="border-t border-line first:border-t-0">
              <th scope="row" className="py-1.5 text-left font-normal">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: p.color }} />
                  {p.label}
                </span>
              </th>
              <td className="tabular py-1.5 text-right">{money(p.value)}</td>
              <td className="tabular w-16 py-1.5 text-right text-ink-2">{percent(p.value / cost.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export type BarRow = { key: string; label: React.ReactNode; href?: string; value: number; valueLabel: string; note?: React.ReactNode };

/** Ranked magnitudes: one series, one colour, value at the bar tip. */
export function BarList({ rows, emptyText = "Nothing to show." }: { rows: BarRow[]; emptyText?: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-2">{emptyText}</p>;
  const top = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key} className="group">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {row.href ? (
                <Link href={row.href} className="hover:underline underline-offset-2">
                  {row.label}
                </Link>
              ) : (
                row.label
              )}
              {row.note && <span className="ml-2 text-xs text-ink-2">{row.note}</span>}
            </span>
            <span className="tabular shrink-0">{row.valueLabel}</span>
          </div>
          <div className="mt-1 h-2.5 w-full" title={`${typeof row.label === "string" ? row.label : ""} ${row.valueLabel}`.trim()}>
            <div
              className="h-full rounded-r-[4px] transition-opacity group-hover:opacity-80"
              style={{ width: `${Math.max(0.5, (row.value / top) * 100)}%`, background: "var(--series-1)" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Money({ value, whole }: { value: number | null | undefined; whole?: boolean }) {
  return <span className="tabular">{money(value, { whole })}</span>;
}

export function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-ink-2">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
