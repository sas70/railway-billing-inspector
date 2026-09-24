export type MiniSlice = { label: string; value: number; color: string };
export type MiniBar = { label: string; value: number; color?: string };

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  const x = Math.round((cx + r * Math.cos(rad)) * 1e4) / 1e4;
  const y = Math.round((cy + r * Math.sin(rad)) * 1e4) / 1e4;
  return [x, y];
}

function wedge(cx: number, cy: number, r: number, start: number, end: number): string {
  const [x1, y1] = polar(cx, cy, r, start);
  const [x2, y2] = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

/** Compact pie for a stat tile. One full circle when a single slice is 100%. */
export function MiniPie({
  slices,
  size = 56,
  label,
}: {
  slices: MiniSlice[];
  size?: number;
  label: string;
}) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;

  const parts: { label: string; value: number; color: string; start: number; sweep: number }[] = [];
  if (total > 0) {
    let angle = 0;
    for (const s of slices) {
      if (s.value <= 0) continue;
      const sweep = (s.value / total) * 360;
      parts.push({ ...s, start: angle, sweep });
      angle += sweep;
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      {parts.length === 0 && <circle cx={cx} cy={cy} r={r} fill="var(--surface-2)" />}
      {parts.map((s) =>
        s.sweep >= 359.9 ? (
          <circle key={s.label} cx={cx} cy={cy} r={r} fill={s.color} stroke="var(--surface)" strokeWidth="1" />
        ) : (
          <path key={s.label} d={wedge(cx, cy, r, s.start, s.start + s.sweep)} fill={s.color} stroke="var(--surface)" strokeWidth="1" />
        ),
      )}
    </svg>
  );
}

/** Compact histogram for a stat tile. Bar height is relative to the tallest value. */
export function MiniHistogram({
  bars,
  width = 72,
  height = 44,
  label,
  moneyValues = false,
}: {
  bars: MiniBar[];
  width?: number;
  height?: number;
  label: string;
  moneyValues?: boolean;
}) {
  const max = Math.max(...bars.map((b) => b.value), 0);
  const gap = 3;
  const barW = bars.length ? (width - gap * (bars.length - 1)) / bars.length : width;
  const colors = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {bars.map((bar, i) => {
        const h = max > 0 ? Math.max(2, (bar.value / max) * height) : 2;
        const x = i * (barW + gap);
        const color = bar.color ?? colors[i % colors.length];
        return (
          <rect
            key={bar.label}
            x={x}
            y={height - h}
            width={barW}
            height={h}
            rx={2}
            fill={color}
          />
        );
      })}
    </svg>
  );
}
