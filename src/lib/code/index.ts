import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { isMockMode } from "../config";
import { cachedCopy } from "../search-index/repo-cache";
import { MOCK_REPOS } from "./mock-corpus";
import { around, matchingLines, summarizeReadme, type ReadmeSummary } from "./readme";
import { cloneFor, GitHubError, githubGet, githubToken, localClones, localRoots, mapLimit, repoKey, run } from "./sources";

/**
 * Read-only access to the code behind each Railway project: README summaries and code search,
 * from local clones (CODE_LOCAL_ROOTS) or GitHub (GITHUB_TOKEN / `gh auth token`).
 */

export type RepoSource =
  | { kind: "local"; dir: string; matchedBy: "remote" | "folder" | "copy" }
  | { kind: "github" }
  | { kind: "mock" }
  | { kind: "none"; reason: string };

export type RepoInfo = {
  repo: string;
  source: RepoSource;
  description: string | null;
  readme: (ReadmeSummary & { file: string; text: string; url: string | null }) | null;
  error: string | null;
};

export type CodeSetup = { localRoots: string[]; clones: number; github: boolean; mock: boolean };

export async function codeSetup(): Promise<CodeSetup> {
  const mock = isMockMode();
  const [clones, token] = await Promise.all([localClones(), githubToken()]);
  return { localRoots: localRoots(), clones: clones.length, github: !!token, mock };
}

const githubUrl = (repo: string, file: string, line?: number | null) =>
  `https://github.com/${repo}/blob/HEAD/${file.split("/").map(encodeURIComponent).join("/")}${line ? `#L${line}` : ""}`;

async function resolveSource(repo: string): Promise<RepoSource> {
  if (isMockMode()) return MOCK_REPOS[repoKey(repo)] ? { kind: "mock" } : { kind: "none", reason: "Not in the demo data." };
  const found = cloneFor(repo, await localClones());
  if (found) return { kind: "local", dir: found.clone.dir, matchedBy: found.matchedBy };
  // A GitHub-only repo the search index has downloaded: read it like a clone (no rate limits).
  const copy = cachedCopy(repo);
  if (copy) return { kind: "local", dir: copy, matchedBy: "copy" };
  if (await githubToken()) return { kind: "github" };
  return {
    kind: "none",
    reason: localRoots().length
      ? "No clone under CODE_LOCAL_ROOTS and no GitHub token."
      : "Set CODE_LOCAL_ROOTS or GITHUB_TOKEN to read this repo.",
  };
}

// ── README ──────────────────────────────────────────────────────────────────

const README_RE = /^readme(\.(md|markdown|mdx|txt|rst))?$/i;
const infoCache = new Map<string, { at: number; info: RepoInfo }>();
/** README and description per repo, kept until Refresh (see clearRepoInfoCache). */
export function clearRepoInfoCache() {
  infoCache.clear();
}

async function localInfo(repo: string, dir: string): Promise<Pick<RepoInfo, "description" | "readme">> {
  const names = await readdir(dir);
  const file = names.filter((n) => README_RE.test(n)).sort((a, b) => Number(!/\.md$/i.test(a)) - Number(!/\.md$/i.test(b)))[0];
  let description: string | null = null;
  try {
    description = (JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as { description?: string }).description || null;
  } catch {}
  if (!file) return { description, readme: null };
  const text = (await readFile(path.join(dir, file), "utf8")).slice(0, 200_000);
  return { description, readme: { ...summarizeReadme(text), file, text, url: repo.includes("/") ? githubUrl(repo, file) : null } };
}

async function githubInfo(repo: string, token: string): Promise<Pick<RepoInfo, "description" | "readme">> {
  const [meta, readme] = await Promise.all([
    githubGet<{ description: string | null }>(token, `/repos/${repo}`),
    githubGet<string>(token, `/repos/${repo}/readme`, "application/vnd.github.raw+json").catch((e) => {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }),
  ]);
  const text = readme?.slice(0, 200_000) ?? null;
  return {
    description: meta.description,
    readme: text ? { ...summarizeReadme(text), file: "README", text, url: `https://github.com/${repo}#readme` } : null,
  };
}

export async function repoInfo(repo: string, fresh = false): Promise<RepoInfo> {
  const key = repoKey(repo);
  const cached = infoCache.get(key);
  if (!fresh && cached) return cached.info;

  const source = await resolveSource(repo);
  const info: RepoInfo = { repo, source, description: null, readme: null, error: null };
  try {
    if (source.kind === "mock") {
      const mock = MOCK_REPOS[key];
      const text = mock.files["README.md"] ?? "";
      info.description = mock.description;
      info.readme = { ...summarizeReadme(text), file: "README.md", text, url: null };
    } else if (source.kind === "local") {
      Object.assign(info, await localInfo(repo, source.dir));
    } else if (source.kind === "github") {
      Object.assign(info, await githubInfo(repo, (await githubToken())!));
    }
  } catch (error) {
    info.error =
      error instanceof GitHubError && error.status === 404
        ? "GitHub says this repo doesn't exist or the token can't see it."
        : error instanceof Error
          ? error.message
          : String(error);
  }
  infoCache.set(key, { at: Date.now(), info });
  return info;
}

/**
 * README summary without any network call: from the demo data or a local clone only, so list
 * pages stay fast and show the same thing every time. Repos that exist only on GitHub get null.
 */
export async function offlineRepoInfo(repo: string): Promise<Pick<RepoInfo, "description" | "readme"> | null> {
  const key = repoKey(repo);
  if (isMockMode()) {
    const mock = MOCK_REPOS[key];
    if (!mock) return null;
    const text = mock.files["README.md"] ?? "";
    return { description: mock.description, readme: { ...summarizeReadme(text), file: "README.md", text, url: null } };
  }
  const found = cloneFor(repo, await localClones());
  if (!found) return null;
  try {
    return await localInfo(repo, found.clone.dir);
  } catch {
    return null;
  }
}

export async function repoInfos(repos: string[], fresh = false): Promise<Map<string, RepoInfo>> {
  const unique = [...new Map(repos.map((r) => [repoKey(r), r])).values()];
  const infos = await mapLimit(unique, 8, (r) => repoInfo(r, fresh));
  return new Map(infos.map((i) => [repoKey(i.repo), i]));
}

// ── Search ──────────────────────────────────────────────────────────────────

export type SearchOptions = { query: string; regex: boolean; caseSensitive: boolean; pathFilter: string };

export type Matcher = { test: (line: string) => number; error: string | null };

/** Returns the index of the first hit in a line, or -1. */
export function makeMatcher(o: Pick<SearchOptions, "query" | "regex" | "caseSensitive">): Matcher {
  if (o.regex) {
    try {
      const re = new RegExp(o.query, o.caseSensitive ? "" : "i");
      return { test: (line) => line.search(re), error: null };
    } catch (error) {
      return { test: () => -1, error: `Invalid regular expression: ${(error as Error).message}` };
    }
  }
  const needle = o.caseSensitive ? o.query : o.query.toLowerCase();
  return { test: (line) => (o.caseSensitive ? line : line.toLowerCase()).indexOf(needle), error: null };
}

export type CodeMatch = { path: string; line: number | null; text: string; url: string | null };
export type RepoCodeResult = {
  repo: string;
  source: RepoSource["kind"];
  dir: string | null;
  matches: CodeMatch[];
  truncated: boolean;
  error: string | null;
};

const PER_REPO = 40;
const PER_FILE = 4;
const EXCLUDES = [":(exclude)*.lock", ":(exclude)*package-lock.json", ":(exclude)*pnpm-lock.yaml", ":(exclude)*.min.js", ":(exclude)*.map", ":(exclude)*.svg"];

async function grepLocal(repo: string, dir: string, o: SearchOptions, matcher: Matcher): Promise<RepoCodeResult> {
  const base: RepoCodeResult = { repo, source: "local", dir, matches: [], truncated: false, error: null };
  const args = ["-C", dir, "-c", "core.quotepath=off", "grep", "-n", "-I", "--no-color", "--null", "--untracked", "--max-count", String(PER_FILE)];
  if (!o.caseSensitive) args.push("-i");
  args.push(o.regex ? "-E" : "-F", "-e", o.query, "--", o.pathFilter ? `*${o.pathFilter}*` : ".", ...EXCLUDES);
  try {
    const { stdout } = await run("git", args, { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
    const lines = stdout.split("\n").filter(Boolean);
    for (const row of lines) {
      const [file, lineNo, ...rest] = row.split("\0");
      const text = rest.join("\0");
      if (base.matches.length >= PER_REPO) {
        base.truncated = true;
        break;
      }
      const line = Number(lineNo) || null;
      base.matches.push({ path: file, line, text: around(text, Math.max(0, matcher.test(text))), url: repo.includes("/") ? githubUrl(repo, file, line) : null });
    }
  } catch (error) {
    const e = error as { code?: number; stderr?: string; killed?: boolean };
    if (e.code === 1 && !e.stderr) return base; // no matches
    base.error = e.killed ? "Search timed out." : (e.stderr?.trim().split("\n")[0] ?? String(error));
  }
  return base;
}

function grepMock(repo: string, o: SearchOptions, matcher: Matcher): RepoCodeResult {
  const out: RepoCodeResult = { repo, source: "mock", dir: null, matches: [], truncated: false, error: null };
  for (const [file, text] of Object.entries(MOCK_REPOS[repoKey(repo)]?.files ?? {})) {
    if (o.pathFilter && !file.toLowerCase().includes(o.pathFilter.toLowerCase())) continue;
    for (const hit of matchingLines(text, matcher.test, PER_FILE)) out.matches.push({ path: file, line: hit.line, text: hit.text, url: null });
  }
  return out;
}

type GitHubSearchItem = {
  path: string;
  html_url: string;
  repository: { full_name: string };
  text_matches?: { property: string; fragment: string }[];
};

/** GitHub code search (default branch only, no regex). Repos are batched into as few queries as fit in 256 chars. */
async function grepGitHub(repos: string[], o: SearchOptions): Promise<{ results: RepoCodeResult[]; note: string | null }> {
  const token = await githubToken();
  if (!token || repos.length === 0) return { results: [], note: null };
  const term = /\s/.test(o.query) ? `"${o.query.replace(/"/g, "")}"` : o.query;
  const extra = o.pathFilter ? ` path:${o.pathFilter.replace(/\s/g, "")}` : "";
  const batches: string[][] = [];
  for (const repo of repos) {
    const last = batches.at(-1);
    const length = (b: string[]) => term.length + extra.length + b.reduce((n, r) => n + r.length + 6, 0);
    if (last && length([...last, repo]) <= 250) last.push(repo);
    else batches.push([repo]);
  }
  const MAX_BATCHES = 6; // code search allows ~10 requests a minute
  const byRepo = new Map<string, RepoCodeResult>(
    repos.map((r) => [repoKey(r), { repo: r, source: "github", dir: null, matches: [], truncated: false, error: null }]),
  );
  let note: string | null = o.regex ? "GitHub code search doesn't support regular expressions — GitHub repos were searched for the literal text." : null;
  if (batches.length > MAX_BATCHES) note = `Only the first ${MAX_BATCHES * 10}-ish GitHub repos were searched (GitHub limits code search to 10 requests a minute). Clone the rest locally for full coverage.`;

  await mapLimit(batches.slice(0, MAX_BATCHES), 2, async (batch) => {
    const q = `${term}${extra} ${batch.map((r) => `repo:${r}`).join(" ")}`;
    try {
      const data = await githubGet<{ items: GitHubSearchItem[]; incomplete_results: boolean }>(
        token,
        `/search/code?per_page=100&q=${encodeURIComponent(q)}`,
        "application/vnd.github.text-match+json",
      );
      for (const item of data.items) {
        const result = byRepo.get(repoKey(item.repository.full_name));
        if (!result) continue;
        if (result.matches.length >= PER_REPO) {
          result.truncated = true;
          continue;
        }
        const fragments = (item.text_matches ?? []).filter((m) => m.property === "content").slice(0, 2);
        if (fragments.length === 0) result.matches.push({ path: item.path, line: null, text: "", url: item.html_url });
        for (const f of fragments) {
          const lines = f.fragment.split("\n");
          const hit = lines.find((l) => l.toLowerCase().includes(o.query.toLowerCase())) ?? lines.find((l) => l.trim()) ?? "";
          result.matches.push({ path: item.path, line: null, text: around(hit, Math.max(0, hit.toLowerCase().indexOf(o.query.toLowerCase()))), url: item.html_url });
        }
      }
    } catch (error) {
      for (const r of batch) byRepo.get(repoKey(r))!.error = error instanceof Error ? error.message : String(error);
    }
  });
  return { results: [...byRepo.values()], note };
}

export type CodeSearchResult = { results: RepoCodeResult[]; skipped: { repo: string; reason: string }[]; notes: string[]; error: string | null };

export async function searchCode(repos: string[], o: SearchOptions): Promise<CodeSearchResult> {
  const matcher = makeMatcher(o);
  if (matcher.error) return { results: [], skipped: [], notes: [], error: matcher.error };
  const unique = [...new Map(repos.map((r) => [repoKey(r), r])).values()];
  const sources = await mapLimit(unique, 8, async (repo) => ({ repo, source: await resolveSource(repo) }));

  const skipped: CodeSearchResult["skipped"] = [];
  const githubRepos: string[] = [];
  const local: { repo: string; dir: string }[] = [];
  const results: RepoCodeResult[] = [];
  for (const { repo, source } of sources) {
    if (source.kind === "local") local.push({ repo, dir: source.dir });
    else if (source.kind === "mock") results.push(grepMock(repo, o, matcher));
    else if (source.kind === "github") githubRepos.push(repo);
    else skipped.push({ repo, reason: source.reason });
  }
  const [localResults, github] = await Promise.all([
    mapLimit(local, 6, (l) => grepLocal(l.repo, l.dir, o, matcher)),
    grepGitHub(githubRepos, o),
  ]);
  results.push(...localResults, ...github.results);
  return {
    results: results.filter((r) => r.matches.length > 0 || r.error).sort((a, b) => b.matches.length - a.matches.length),
    skipped,
    notes: github.note ? [github.note] : [],
    error: null,
  };
}
