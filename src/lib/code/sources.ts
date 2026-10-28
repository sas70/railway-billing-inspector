import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { isMockMode } from "../config";

/**
 * Where each project's code lives: a local clone (found under CODE_LOCAL_ROOTS) or GitHub.
 *
 * Everything here is read-only. Local clones are only read (`git ls-files`/`git grep` and
 * file reads); GitHub is only sent GET requests. (The search index keeps its own read-only copies
 * of GitHub-only repos in data/search-index/repos; see lib/search-index/repo-cache.ts.)
 */

export const run = promisify(execFile);

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const onVercel = () => process.env.VERCEL === "1";

/** Normalize `owner/name` for lookups. */
export const repoKey = (repo: string) => repo.trim().toLowerCase().replace(/\.git$/, "");

/** `owner/name` from any GitHub remote URL (https, ssh, git@), or null for other hosts. */
export function githubRepoFromUrl(url: string): string | null {
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * Clean `owner/name` from a repo value as Railway stores it. Railway usually returns
 * `owner/name`, but a source entered by hand can hold a full URL, even glued onto the owner
 * (`sas70/https://github.com/sas70/shellimg`). Anything else is returned trimmed, minus `.git`.
 */
export function normalizeRepo(repo: string): string {
  if (/github\.com[:/]/i.test(repo)) return githubRepoFromUrl(repo) ?? repo.trim();
  return repo.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
}

// ── Local clones ────────────────────────────────────────────────────────────

export type LocalClone = { repo: string | null; dir: string; name: string };

/** CODE_LOCAL_ROOTS: comma-separated folders that contain your clones (searched two levels deep). */
export function localRoots(): string[] {
  if (onVercel() || isMockMode()) return [];
  return (process.env.CODE_LOCAL_ROOTS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("~/") ? path.join(process.env.HOME ?? "", p.slice(2)) : p))
    .filter((p) => existsSync(p));
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "vendor", ".venv", "venv", "__pycache__"]);

async function originUrl(dir: string): Promise<string | null> {
  try {
    const gitPath = path.join(dir, ".git");
    const info = await stat(gitPath);
    let configPath = path.join(gitPath, "config");
    if (info.isFile()) {
      // Worktree / submodule: `.git` is a file pointing at the real git dir.
      const pointer = (await readFile(gitPath, "utf8")).match(/gitdir:\s*(.+)/)?.[1]?.trim();
      if (!pointer) return null;
      configPath = path.join(path.resolve(dir, pointer), "config");
    }
    const config = await readFile(configPath, "utf8");
    const origin = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config)?.[1];
    const any = /\[remote "[^"]+"\][^[]*?url\s*=\s*(\S+)/.exec(config)?.[1];
    return origin ?? any ?? null;
  } catch {
    return null;
  }
}

async function findClones(root: string, depth: number, out: LocalClone[]) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((e) => e.name === ".git")) {
    const url = await originUrl(root);
    out.push({ repo: url ? githubRepoFromUrl(url) : null, dir: root, name: path.basename(root) });
  }
  // Keep going even inside a repo: a folder of projects can itself be a git repo.
  if (depth <= 0) return;
  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith("."))
      .map((e) => findClones(path.join(root, e.name), depth - 1, out)),
  );
}

let cloneCache: { at: number; clones: LocalClone[] } | null = null;

export async function localClones(): Promise<LocalClone[]> {
  if (cloneCache && Date.now() - cloneCache.at < 60_000) return cloneCache.clones;
  const clones: LocalClone[] = [];
  for (const root of localRoots()) await findClones(root, 2, clones);
  cloneCache = { at: Date.now(), clones };
  return clones;
}

/** Best local clone for a repo: matching GitHub remote first, then a folder with the repo's name. */
export function cloneFor(repo: string, clones: LocalClone[]): { clone: LocalClone; matchedBy: "remote" | "folder" } | null {
  const key = repoKey(repo);
  const byRemote = clones.find((c) => c.repo && repoKey(c.repo) === key);
  if (byRemote) return { clone: byRemote, matchedBy: "remote" };
  const name = key.split("/")[1];
  const byFolder = clones.find((c) => !c.repo && c.name.toLowerCase() === name);
  return byFolder ? { clone: byFolder, matchedBy: "folder" } : null;
}

// ── GitHub ──────────────────────────────────────────────────────────────────

let ghCliToken: { at: number; token: string | null } | null = null;

/**
 * GITHUB_TOKEN (a read-only fine-grained token is enough), or — when running locally —
 * the token the GitHub CLI already has (`gh auth token`). Never sent to the browser.
 */
export async function githubToken(): Promise<string | null> {
  if (isMockMode()) return null;
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (onVercel()) return null;
  const allowCli = process.env.CODE_USE_GH_CLI;
  if (allowCli && !TRUE_VALUES.has(allowCli.trim().toLowerCase())) return null;
  if (ghCliToken && Date.now() - ghCliToken.at < 10 * 60_000) return ghCliToken.token;
  try {
    const { stdout } = await run("gh", ["auth", "token"], { timeout: 5_000 });
    ghCliToken = { at: Date.now(), token: stdout.trim() || null };
  } catch {
    ghCliToken = { at: Date.now(), token: null };
  }
  return ghCliToken.token;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** GET only. */
export async function githubGet<T>(token: string, pathAndQuery: string, accept = "application/vnd.github+json"): Promise<T> {
  const res = await fetch(`https://api.github.com${pathAndQuery}`, {
    method: "GET",
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "railway-billing-inspector",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = `GitHub ${res.status}`;
    try {
      message = (JSON.parse(body) as { message?: string }).message ?? message;
    } catch {}
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") message = "GitHub rate limit reached — try again in a minute.";
    throw new GitHubError(message, res.status);
  }
  return (accept.includes("raw") || !accept.includes("json") ? res.text() : res.json()) as Promise<T>;
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<I, O>(items: I[], limit: number, fn: (item: I) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
