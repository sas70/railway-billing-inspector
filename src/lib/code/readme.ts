/** Turn a README into a short title + summary. Pure text processing, no I/O. */

const COMMAND_RE = /^\s*(\$ |#!|(git|npm|npx|pnpm|yarn|bun|pip3?|python3?|node|source|cd|export|curl|wget|docker|brew|make|uvicorn|gunicorn|flask|deactivate|chmod|mkdir|cp|mv|rm|ls|cat|railway|vercel|heroku)(\s|$))/;

export type ReadmeSummary = { title: string | null; summary: string };

function inline(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ") // linked badges
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1") // reference links
    .replace(/<[^>]+>/g, " ") // html tags
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\s)[*_](\S.*?\S|\S)[*_](?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.6 ? space : max).replace(/[\s,;:.–-]+$/, "")}…`;
}

export function summarizeReadme(markdown: string, max = 320): ReadmeSummary {
  const body = markdown
    .replace(/\r\n/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n/, "") // front matter
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n")
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, ""); // reference definitions

  let title: string | null = null;
  const blocks = body.split(/\n\s*\n/);
  const prose: string[] = [];
  const fallback: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (lines.length === 0) continue;
    const first = lines[0].trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(first) ?? (lines[1] && /^[=-]{3,}\s*$/.test(lines[1].trim()) ? [first, first] : null);
    if (heading) {
      if (!title) title = inline(heading[1]).replace(/^[^\p{L}\p{N}]+/u, "") || null;
      continue;
    }
    if (/^\s*\|/.test(first)) continue; // tables
    if (lines.every((l) => /^( {4}|\t)/.test(l))) continue; // indented code
    if (lines.filter((l) => COMMAND_RE.test(l)).length >= Math.ceil(lines.length / 2)) continue; // shell snippets
    if (/^\s*([-*+]|\d+\.)\s+/.test(first)) {
      fallback.push(lines.map((l) => inline(l.replace(/^\s*([-*+]|\d+\.)\s+/, ""))).filter(Boolean).join("; "));
      continue;
    }
    const text = inline(lines.join(" ").replace(/^>\s?/gm, ""));
    if (text.length < 25 || !/[a-z]{3}/i.test(text)) continue;
    prose.push(text);
    if (prose.join(" ").length >= max * 0.6) break;
  }

  const summary = clip((prose.length ? prose : fallback).join(" ").trim(), max);
  return { title, summary };
}

/** Lines of `text` that match, trimmed around the hit. */
export function matchingLines(text: string, test: (line: string) => number, limit = 3, width = 200): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const at = test(lines[i]);
    if (at < 0) continue;
    out.push({ line: i + 1, text: around(lines[i], at, width) });
  }
  return out;
}

export function around(line: string, at: number, width = 200): string {
  const clean = line.replace(/\t/g, "  ");
  if (clean.length <= width) return clean.trim();
  const start = Math.max(0, Math.min(at - Math.floor(width / 3), clean.length - width));
  return `${start > 0 ? "…" : ""}${clean.slice(start, start + width).trim()}${start + width < clean.length ? "…" : ""}`;
}
