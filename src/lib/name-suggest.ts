/**
 * Name suggestions for the bulk rename table. Pure text handling with no I/O, so it can be
 * unit-tested (scripts/test-name-suggest.mjs) and used in the browser. Which names look
 * Railway-generated is decided in project-name.ts.
 */

export const NAME_MAX = 64;
/** Most projects one rename review covers. */
export const MAX_RENAMES = 100;
const SUGGESTION_MAX = 40;

/** "Room shell image matcher" → "room-shell-image-matcher" (ASCII, lowercase, at most `max` characters, cut at a word). */
export function slugify(text: string, max = SUGGESTION_MAX): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const dash = cut.lastIndexOf("-");
  return (dash > max * 0.5 ? cut.slice(0, dash) : cut).replace(/-+$/, "");
}

function commonLeadingWords(slugs: string[]): string | null {
  const parts = slugs.map((s) => s.split("-"));
  const out: string[] = [];
  for (let i = 0; i < parts[0].length; i++) {
    const word = parts[0][i];
    if (parts.some((p) => p[i] !== word)) break;
    out.push(word);
  }
  return out.length > 0 ? out.join("-") : null;
}

export type Suggestion = { name: string; source: "ai" | "repo" };

/**
 * A slug for the project: from its apps' saved summary names (their shared leading words when it
 * has several, e.g. client-portal for "Client portal API" + "Client portal front end"), else from
 * its repo names. Null when there's nothing to go on.
 */
export function suggestName(input: { aiNames: string[]; repos: string[] }): Suggestion | null {
  const ai = [...new Set(input.aiNames.map((n) => slugify(n)).filter(Boolean))];
  if (ai.length === 1) return { name: ai[0], source: "ai" };
  const aiCommon = ai.length > 1 ? commonLeadingWords(ai) : null;
  if (aiCommon) return { name: aiCommon, source: "ai" };

  const repos = [...new Set(input.repos.map((r) => slugify(r.split("/").pop() ?? "")).filter(Boolean))];
  if (repos.length === 1) return { name: repos[0], source: "repo" };
  const repoCommon = repos.length > 1 ? commonLeadingWords(repos) : null;
  if (repoCommon) return { name: repoCommon, source: "repo" };
  if (ai.length > 0) return { name: ai[0], source: "ai" };
  if (repos.length > 0) return { name: repos[0], source: "repo" };
  return null;
}

/**
 * Make suggestions unique across the account: a name already taken by another project, or
 * suggested earlier in the list, gets -2, -3, … Input order decides who keeps the plain name.
 */
export function uniqueSuggestions<T extends { name: string; suggestion: Suggestion | null }>(rows: T[]): T[] {
  const taken = new Set(rows.map((r) => r.name.toLowerCase()));
  return rows.map((row) => {
    if (!row.suggestion) return row;
    const base = row.suggestion.name;
    if (base.toLowerCase() === row.name.toLowerCase()) return { ...row, suggestion: null };
    let candidate = base;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base}-${n}`;
    taken.add(candidate.toLowerCase());
    return { ...row, suggestion: { ...row.suggestion, name: candidate } };
  });
}

/** The same rule as a single rename: 1–64 characters, no control characters, spaces collapsed. Null when invalid. */
export function cleanProjectName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > NAME_MAX) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}
