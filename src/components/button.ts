export type ButtonTone = "danger" | "neutral" | "primary" | "ghost";

const TONES: Record<ButtonTone, string> = {
  danger: "border-transparent bg-danger text-white hover:bg-danger-hover",
  neutral: "border-line-strong bg-surface text-ink hover:bg-surface-2",
  primary: "border-transparent bg-[var(--series-1)] text-white hover:brightness-110",
  ghost: "border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
};

/** Shared button styling (usable from server and client components). */
export function buttonClass(tone: ButtonTone = "neutral", size: "sm" | "md" = "sm") {
  const sizing = size === "sm" ? "min-h-8 px-2.5 py-1.5 text-xs" : "min-h-10 px-4 py-2 text-sm";
  return `ui-button inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-medium disabled:cursor-not-allowed disabled:opacity-45 ${sizing} ${TONES[tone]}`;
}
