export type ButtonTone = "danger" | "neutral" | "primary" | "ghost";

const TONES: Record<ButtonTone, string> = {
  danger: "border-transparent bg-danger text-white hover:bg-danger-hover",
  neutral: "border-line-strong bg-surface text-ink hover:bg-surface-2",
  primary: "border-transparent bg-[var(--series-1)] text-white hover:brightness-110",
  ghost: "border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
};

/** Shared button styling (usable from server and client components). */
export function buttonClass(tone: ButtonTone = "neutral", size: "sm" | "md" = "sm") {
  const sizing = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm";
  return `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${sizing} ${TONES[tone]}`;
}
