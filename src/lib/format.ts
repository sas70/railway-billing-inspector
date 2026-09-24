/** Formatting helpers (server & client safe). Times render in the machine's local time zone. */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function money(value: number | null | undefined, opts: { whole?: boolean } = {}): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value > 0 && value < 0.005) return "<$0.01";
  if (opts.whole || Math.abs(value) >= 10_000) return usdWhole.format(value);
  return usd.format(value);
}

export function percent(fraction: number | null | undefined, digits = 0): string {
  if (fraction == null || !Number.isFinite(fraction)) return "—";
  if (fraction > 0 && fraction < 0.005) return "<1%";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function num(value: number, digits = 0): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateNoYear(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const seconds = Math.round((now - t) / 1000);
  const future = seconds < 0;
  const s = Math.abs(seconds);
  let text: string;
  if (s < 60) text = "just now";
  else if (s < 3600) text = `${Math.floor(s / 60)}m`;
  else if (s < 86_400) text = `${Math.floor(s / 3600)}h`;
  else if (s < 86_400 * 45) text = `${Math.floor(s / 86_400)}d`;
  else if (s < 86_400 * 365) text = `${Math.floor(s / (86_400 * 30))}mo`;
  else text = `${Math.floor(s / (86_400 * 365))}y`;
  if (text === "just now") return text;
  return future ? `in ${text}` : `${text} ago`;
}

export function sizeMB(mb: number | null | undefined): string {
  if (mb == null || !Number.isFinite(mb)) return "—";
  if (mb < 1) return `${Math.round(mb * 1024)} KB`;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(mb < 10 * 1024 ? 2 : 1)} GB`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Pull the useful bits out of Railway's untyped deployment `meta` JSON. */
export function deploymentMeta(meta: Record<string, unknown> | null | undefined) {
  const str = (key: string) => (meta && typeof meta[key] === "string" ? (meta[key] as string) : undefined);
  const message = str("commitMessage")?.split("\n")[0];
  return {
    message,
    commitHash: str("commitHash"),
    branch: str("branch"),
    author: str("commitAuthor"),
    reason: str("reason"),
    image: str("image"),
    repo: str("repo"),
  };
}

/** Strip ANSI colour codes from log lines. */
export function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}
