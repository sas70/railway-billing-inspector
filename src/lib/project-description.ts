/**
 * Railway project descriptions built from saved Claude summaries. Pure text handling with no I/O,
 * so it can be unit-tested (scripts/test-project-description.mjs).
 */

/**
 * Railway doesn't document a limit for project descriptions. 500 characters keeps them readable
 * in Railway's dashboard; if Railway ever rejects one, that project's write fails on its own.
 */
export const DESCRIPTION_MAX = 500;

export type DescriptionSource = { repo: string; name: string; summary: string };

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const asSentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** For comparisons: null, "" and whitespace all mean "no description". */
export function normalizeDescription(value: string | null | undefined): string {
  return squash(value ?? "");
}

export function sameDescription(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeDescription(a) === normalizeDescription(b);
}

/** Cut at a word boundary and end with an ellipsis when the text is longer than `max`. */
export function clipDescription(text: string, max = DESCRIPTION_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}

/**
 * One paragraph for a project: the summary itself when the project deploys one repo, or
 * "Name: summary." per repo when it deploys several. Repeated summaries are dropped.
 */
export function descriptionFromSummaries(sources: DescriptionSource[], max = DESCRIPTION_MAX): { text: string; clipped: boolean } {
  const seen = new Set<string>();
  const parts: { name: string; summary: string }[] = [];
  for (const source of sources) {
    const summary = squash(source.summary);
    if (!summary || seen.has(summary.toLowerCase())) continue;
    seen.add(summary.toLowerCase());
    parts.push({ name: squash(source.name) || source.repo, summary });
  }
  if (parts.length === 0) return { text: "", clipped: false };
  const full = parts.length === 1 ? asSentence(parts[0].summary) : parts.map((p) => `${p.name}: ${asSentence(p.summary)}`).join(" ");
  const text = clipDescription(full, max);
  return { text, clipped: text !== full };
}
