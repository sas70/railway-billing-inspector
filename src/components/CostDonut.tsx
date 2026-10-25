import { money, percent } from "@/lib/format";

export type DonutSlice = { key: string; label: string; value: number; color: string; note?: string };

const SIZE = 132;
const R_OUTER = 62;
const R_INNER = 40;

function arc(start: number, end: number): string {
  // Angles in radians, 0 at 12 o'clock, clockwise.
  const point = (r: number, a: number) => [SIZE / 2 + r * Math.sin(a), SIZE / 2 - r * Math.cos(a)].map((n) => n.toFixed(2)).join(" ");
  const large = end - start > Math.PI ? 1 : 0;
  return [
    `M ${point(R_OUTER, start)}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${point(R_OUTER, end)}`,
    `L ${point(R_INNER, end)}`,
    `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${point(R_INNER, start)}`,
    "Z",
  ].join(" ");
}

/**
 * A donut for a cost split, with a legend that doubles as the data table (label, dollars, share),
 * so nothing depends on color alone. Slices under half a cent are left out of the ring but stay
 * in the legend.
 */
export function CostDonut({ title, slices, emptyText, centerLabel = "total" }: { title: string; slices: DonutSlice[]; emptyText: string; centerLabel?: string }) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const drawn = slices.filter((s) => s.value >= 0.005);
  let angle = 0;

  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 text-sm font-semibold">{title}</figcaption>
      {total < 0.005 ? (
        <p className="text-sm text-ink-2">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${title}: ${money(total)} in total`}>
              {drawn.length === 1 ? (
                <circle cx={SIZE / 2} cy={SIZE / 2} r={(R_OUTER + R_INNER) / 2} fill="none" stroke={drawn[0].color} strokeWidth={R_OUTER - R_INNER}>
                  <title>{`${drawn[0].label}: ${money(drawn[0].value)} (100%)`}</title>
                </circle>
              ) : (
                drawn.map((s) => {
                  const start = angle;
                  angle += (s.value / total) * Math.PI * 2;
                  return (
                    <path key={s.key} d={arc(start, angle)} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} strokeLinejoin="round" className="transition-opacity hover:opacity-80">
                      <title>{`${s.label}: ${money(s.value)} (${percent(s.value / total)})`}</title>
                    </path>
                  );
                })
              )}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-base font-semibold tabular">{money(total)}</span>
              <span className="text-[11px] text-ink-2">{centerLabel}</span>
            </div>
          </div>
          <table className="min-w-[14rem] flex-1 text-sm">
            <tbody className="tabular">
              {slices.map((s) => (
                <tr key={s.key} className="align-top">
                  <td className="py-1 pr-2">
                    <span className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                      <span>
                        {s.label}
                        {s.note && <span className="block text-xs text-ink-2">{s.note}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="py-1 pl-2 text-right whitespace-nowrap">{money(s.value)}</td>
                  <td className="py-1 pl-2 text-right whitespace-nowrap text-ink-2">{total > 0 ? percent(s.value / total) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
