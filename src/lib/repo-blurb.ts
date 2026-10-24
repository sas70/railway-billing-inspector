/** A short "what is this app" for one repo, shown on hover in the Overview and Services lists. */
export type RepoBlurb = {
  repo: string;
  name: string | null;
  text: string;
  /** "ai": Claude's saved summary of the code. "readme": the README's opening paragraph. "description": the repo's own one-liner. */
  source: "ai" | "readme" | "description";
  stack: string[];
};

export const BLURB_SOURCE_LABEL: Record<RepoBlurb["source"], string> = {
  ai: "AI summary",
  readme: "From README",
  description: "Repo description",
};

/** Plain-text version of a hover card, for screen readers. */
export function blurbText(blurbs: RepoBlurb[], fallback?: string | null): string {
  if (blurbs.length === 0) return fallback ?? "";
  return blurbs.map((b) => (b.name ? `${b.name}: ${b.text}` : b.text)).join(" ");
}
