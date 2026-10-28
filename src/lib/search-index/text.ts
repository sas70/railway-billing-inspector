/**
 * Pure helpers for the search index: which files to read, how to cut them into chunks, how a
 * user's query becomes an FTS5 query, and how two rankings are merged. No I/O, so they're tested
 * directly by scripts/test-search-index.mjs.
 */

/** Lines per code chunk. Small enough that a hit points at the right place, big enough for context. */
export const CHUNK_LINES = 50;
/** Files bigger than this are skipped (generated code, data dumps, bundles). */
export const MAX_FILE_BYTES = 256 * 1024;
/** At most this many files and this much text per repo, so one huge repo can't swamp the index. */
export const MAX_FILES_PER_REPO = 4000;
export const MAX_BYTES_PER_REPO = 30 * 1024 * 1024;

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.nuxt|\.svelte-kit|vendor|venv|\.venv|env|__pycache__|coverage|\.cache|\.turbo|\.vercel|target|bin|obj|site-packages|\.railway-inspector)\//i;
const SKIP_FILE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|Pipfile\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|go\.sum|\.DS_Store)$|\.(min\.(js|css)|map|lock)$/i;
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|psd|svg|eps|pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|war|whl|egg|so|dylib|dll|exe|bin|o|a|class|pyc|pyo|wasm|woff2?|ttf|otf|eot|mp3|mp4|m4a|wav|ogg|flac|mov|avi|mkv|webm|sqlite3?|db|parquet|feather|arrow|h5|hdf5|pkl|pickle|pt|pth|onnx|safetensors|ckpt|npy|npz|xlsx?|docx?|pptx?|key|numbers|pages|csv|tsv|ipynb)$/i;

/** Whether a repo file is worth indexing as text. `size` in bytes, when known. */
export function isIndexableFile(path: string, size?: number): boolean {
  if (SKIP_DIR.test(path) || SKIP_FILE.test(path) || BINARY_EXT.test(path)) return false;
  if (size != null && size > MAX_FILE_BYTES) return false;
  return true;
}

export type Chunk = { line: number; body: string };

/** Cut text into chunks of `size` lines; `line` is the 1-based first line. Blank chunks are dropped. */
export function chunkLines(text: string, size = CHUNK_LINES): Chunk[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Chunk[] = [];
  for (let i = 0; i < lines.length; i += size) {
    const body = lines.slice(i, i + size).join("\n");
    if (body.trim()) out.push({ line: i + 1, body });
  }
  return out;
}

/**
 * The words and "quoted phrases" in a search, lower-cased, without FTS operators. Each becomes
 * its own FTS5 query, so a project can match when its words are spread over several documents.
 */
export function queryTerms(query: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  for (const m of query.matchAll(re)) {
    const raw = (m[1] ?? m[2]).toLowerCase();
    // Keep letters, digits and inner punctuation that unicode61 splits on anyway.
    const cleaned = raw.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (cleaned) terms.push(cleaned);
  }
  return [...new Set(terms)].slice(0, 8);
}

/** FTS5 MATCH expression for one term: a phrase of its tokens, the last token as a prefix. */
export function ftsExpression(term: string): string | null {
  const tokens = term.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t.replace(/"/g, "")}"`);
  // "segment" also finds "segmentation"; a lone 1-2 letter token stays exact so it isn't a flood.
  const last = tokens[tokens.length - 1];
  if (last.length >= 3) quoted[quoted.length - 1] += "*";
  return quoted.length === 1 ? quoted[0] : `NEAR(${quoted.join(" ")}, 2)`;
}

/** Reciprocal-rank fusion: each list is ids in rank order; returns ids by combined score. */
export function fuseRankings(lists: string[][], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

/** Cosine similarity of two vectors that are already L2-normalized (so just the dot product). */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * A word and its rough stem ("payments" → "payment", "segmentation" → "segment"), so a line that
 * the stemmed full-text index matched can be found again by plain substring search.
 */
export function wordForms(word: string): string[] {
  const stem = word.replace(/(ations?|ions?|ings?|ments?|ers?|ies|es|ed|s)$/, "");
  return stem.length >= 3 && stem !== word ? [word, stem] : [word];
}

/** Lines of `text` that contain any term (case-insensitive), at most `limit`, with 1-based line numbers. */
export function linesWithTerms(text: string, terms: string[], limit = 3, firstLine = 1): { line: number; text: string }[] {
  const needles = terms.flatMap((t) => t.split(/\s+/)).filter((t) => t.length > 0).flatMap(wordForms);
  if (needles.length === 0) return [];
  const out: { line: number; text: string }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const lower = lines[i].toLowerCase();
    const at = needles.map((n) => lower.indexOf(n)).filter((x) => x >= 0).sort((a, b) => a - b)[0];
    if (at == null) continue;
    const line = lines[i];
    const start = Math.max(0, at - 80);
    const shown = (start > 0 ? "…" : "") + line.slice(start, start + 200).trimEnd() + (line.length > start + 200 ? "…" : "");
    out.push({ line: firstLine + i, text: shown });
  }
  return out;
}

/** Short stable hash (FNV-1a, hex) for "has this text changed" checks. */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${text.length}`;
}
