import "server-only";

import { embed, embeddingsDisabledReason, fromBlob } from "./embed";
import { db } from "./store";
import { dot, ftsExpression, fuseRankings, linesWithTerms, queryTerms } from "./text";

/**
 * Searches the index two ways and merges them:
 *
 * - Keywords: each word or "quoted phrase" is looked up in the full-text index. A project matches
 *   when all of them appear somewhere in its details, summary, README or code (not necessarily in
 *   the same file), ranked by BM25 relevance.
 * - Topic: the query is embedded with the same model as each project's "what it does" text and
 *   compared by cosine similarity, so "segmentation" finds a project about masks and cut-outs
 *   even if the word never appears.
 *
 * The two rankings are merged with reciprocal-rank fusion.
 */

export type DocKind = "project" | "summary" | "readme" | "code";
export type Snippet = { kind: DocKind; repo: string | null; path: string | null; line: number | null; text: string };
export type ProjectHit = {
  id: string;
  name: string;
  href: string;
  workspace: string;
  repos: string[];
  /** Keyword match: how many of the query's terms appear, and where. Null when only the topic matched. */
  keyword: { matched: number; of: number; kinds: DocKind[] } | null;
  /** Topic similarity 0..1, when it's among the closest. */
  topic: number | null;
  snippets: Snippet[];
};
export type CodeHit = { repo: string; matches: { path: string; line: number; text: string }[]; more: boolean };
export type IndexSearch = { terms: string[]; projects: ProjectHit[]; code: CodeHit[]; topicNote: string | null; ms: number };

export type IndexSearchOptions = {
  query: string;
  kinds: Set<"projects" | "readme" | "code">;
  pathFilter?: string;
  /** Only these projects (the page's workspace / status / repo filters). */
  projectIds?: Set<string>;
};

/**
 * A topic match must clear an absolute floor and stand out from the typical project: with
 * bge-small-en-v1.5, unrelated projects sit around 0.45-0.6 and related ones 0.6-0.8, so the
 * gap over the median is what separates them.
 */
export const TOPIC_FLOOR = 0.55;
export const TOPIC_MARGIN = 0.08;
const TOPIC_MAX_RESULTS = 12;
const KIND_WEIGHT: Record<DocKind, number> = { project: 1.6, summary: 1.6, readme: 1.25, code: 1 };
const SNIPPET_ORDER: Record<DocKind, number> = { readme: 0, code: 1, project: 2, summary: 3 };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type Row = { id: number; owner: string; kind: DocKind; path: string | null; line: number | null; rank: number };

export async function searchIndex(o: IndexSearchOptions): Promise<IndexSearch> {
  const started = Date.now();
  const d = db();
  const terms = queryTerms(o.query);
  const projects = (d.prepare("SELECT id, name, href, workspace, repos FROM projects").all() as { id: string; name: string; href: string; workspace: string; repos: string }[])
    .filter((p) => !o.projectIds || o.projectIds.has(p.id))
    .map((p) => ({ ...p, repos: JSON.parse(p.repos) as string[] }));
  const byId = new Map(projects.map((p) => [p.id, p]));
  const projectsOfRepo = new Map<string, string[]>();
  for (const p of projects) for (const r of p.repos) projectsOfRepo.set(r, [...(projectsOfRepo.get(r) ?? []), p.id]);
  const ownersOf = (owner: string): string[] => (owner.startsWith("p:") ? (byId.has(owner.slice(2)) ? [owner.slice(2)] : []) : (projectsOfRepo.get(owner.slice(2)) ?? []));

  const kinds: DocKind[] = [
    ...(o.kinds.has("projects") ? (["project", "summary"] as const) : []),
    ...(o.kinds.has("readme") ? (["readme"] as const) : []),
    ...(o.kinds.has("code") ? (["code"] as const) : []),
  ];

  // ── Keywords ────────────────────────────────────────────────────────────
  type Agg = { terms: Set<number>; score: number[]; rows: Map<number, { row: Row; score: number }>; kinds: Set<DocKind> };
  const agg = new Map<string, Agg>();
  const docTerms = new Map<number, { row: Row; terms: Set<number>; score: number }>();
  if (terms.length && kinds.length) {
    const pathLike = o.pathFilter ? `%${o.pathFilter.replace(/[%_]/g, "\\$&")}%` : null;
    const stmt = d.prepare(
      `SELECT docs.id AS id, docs.owner AS owner, docs.kind AS kind, docs.path AS path, docs.line AS line, bm25(docs_fts, 3.0, 1.0) AS rank
       FROM docs_fts JOIN docs ON docs.id = docs_fts.rowid
       WHERE docs_fts MATCH ? AND docs.kind IN (${kinds.map(() => "?").join(",")})
       ${pathLike ? "AND (docs.kind <> 'code' OR docs.path LIKE ? ESCAPE '\\')" : ""}
       ORDER BY rank LIMIT 4000`,
    );
    terms.forEach((term, t) => {
      const expr = ftsExpression(term);
      if (!expr) return;
      let rows: Row[];
      try {
        rows = stmt.all(expr, ...kinds, ...(pathLike ? [pathLike] : [])) as Row[];
      } catch {
        return; // A query FTS can't parse matches nothing rather than failing the page.
      }
      for (const row of rows) {
        const score = -row.rank * KIND_WEIGHT[row.kind];
        const doc = docTerms.get(row.id) ?? { row, terms: new Set<number>(), score: 0 };
        doc.terms.add(t);
        doc.score += score;
        docTerms.set(row.id, doc);
        for (const pid of ownersOf(row.owner)) {
          const a = agg.get(pid) ?? { terms: new Set<number>(), score: terms.map(() => 0), rows: new Map(), kinds: new Set<DocKind>() };
          a.terms.add(t);
          a.kinds.add(row.kind);
          a.score[t] = Math.max(a.score[t], score);
          const kept = a.rows.get(row.id);
          if (kept) kept.score += score;
          else if (a.rows.size < 40) a.rows.set(row.id, { row, score });
          agg.set(pid, a);
        }
      }
    });
  }
  const full = [...agg].filter(([, a]) => a.terms.size === terms.length);
  const keywordRanked = (full.length ? full : [...agg])
    .sort(([, a], [, b]) => b.terms.size - a.terms.size || b.score.reduce((x, y) => x + y, 0) - a.score.reduce((x, y) => x + y, 0))
    .map(([id]) => id);

  // ── Topic ───────────────────────────────────────────────────────────────
  let topicNote: string | null = null;
  const topicScore = new Map<string, number>();
  const vectors = d.prepare("SELECT owner, vec FROM vectors").all() as { owner: string; vec: Buffer }[];
  if (o.query.trim() && vectors.length && o.kinds.has("projects")) {
    try {
      const [q] = await embed([o.query.trim()], "query");
      const all = vectors.map((v) => ({ id: v.owner.slice(2), sim: dot(q, fromBlob(v.vec)) })).sort((a, b) => b.sim - a.sim);
      const typical = median(all.map((v) => v.sim));
      for (const v of all.filter((x) => byId.has(x.id)).slice(0, TOPIC_MAX_RESULTS)) {
        if (v.sim >= TOPIC_FLOOR && v.sim - typical >= TOPIC_MARGIN) topicScore.set(v.id, v.sim);
      }
    } catch {
      topicNote = embeddingsDisabledReason();
    }
  } else if (!vectors.length) {
    topicNote = embeddingsDisabledReason();
  }
  const topicRanked = [...topicScore].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  // ── Merge, with snippets ──────────────────────────────────────────────────
  const fused = fuseRankings([keywordRanked.slice(0, 200), topicRanked]);
  const bodyOf = d.prepare("SELECT body FROM docs WHERE id = ?");
  const repoOf = (owner: string) => (owner.startsWith("r:") ? owner.slice(2) : null);
  const projectHits: ProjectHit[] = fused.slice(0, 60).map(({ id }) => {
    const p = byId.get(id)!;
    const a = agg.get(id);
    // Evidence the summary column doesn't already show: README and code lines first.
    const snippets: Snippet[] = [];
    const candidates = a ? [...a.rows.values()].sort((x, y) => SNIPPET_ORDER[x.row.kind] - SNIPPET_ORDER[y.row.kind] || y.score - x.score) : [];
    for (const { row } of candidates) {
      if (snippets.length >= 3) break;
      const { body } = bodyOf.get(row.id) as { body: string };
      const [hit] = linesWithTerms(body, terms, 1, row.line ?? 1);
      if (!hit) continue; // Matched only on the file path; the path is shown with code hits anyway.
      snippets.push({ kind: row.kind, repo: repoOf(row.owner), path: row.path, line: row.line == null ? null : hit.line, text: hit.text });
    }
    return {
      id,
      name: p.name,
      href: p.href,
      workspace: p.workspace,
      repos: p.repos,
      keyword: a ? { matched: a.terms.size, of: terms.length, kinds: [...a.kinds] } : null,
      topic: topicScore.get(id) ?? null,
      snippets,
    };
  });

  // ── Code: chunks that contain every term ─────────────────────────────────
  const codeByRepo = new Map<string, CodeHit>();
  if (o.kinds.has("code")) {
    const docs = [...docTerms.values()]
      .filter((x) => x.row.kind === "code" && x.terms.size === terms.length && ownersOf(x.row.owner).length > 0)
      .sort((a, b) => b.score - a.score);
    for (const doc of docs) {
      const repo = repoOf(doc.row.owner)!;
      const hit = codeByRepo.get(repo) ?? { repo, matches: [], more: false };
      if (!codeByRepo.has(repo) && codeByRepo.size >= 30) continue;
      if (hit.matches.length >= 6) {
        hit.more = true;
        continue;
      }
      const { body } = bodyOf.get(doc.row.id) as { body: string };
      const lines = linesWithTerms(body, terms, 2, doc.row.line ?? 1);
      if (lines.length === 0) continue;
      for (const l of lines) hit.matches.push({ path: doc.row.path ?? "", line: l.line, text: l.text });
      codeByRepo.set(repo, hit);
    }
  }

  return { terms, projects: projectHits, code: [...codeByRepo.values()], topicNote, ms: Date.now() - started };
}
