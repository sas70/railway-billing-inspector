import "server-only";

import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { githubGet, githubToken, repoKey, run } from "../code/sources";
import { INDEX_DIR, inMemory } from "./store";

/**
 * Read-only copies of repos that exist only on GitHub, so the index (and exact/regex code search)
 * can read their code without GitHub's search rate limits.
 *
 * Each is a shallow clone of the default branch in data/search-index/repos/<owner>__<name>,
 * refreshed only when GitHub reports a new commit. The token is passed to git through environment
 * variables for that one command, so it is never written into the copy's .git/config. Nothing is
 * ever pushed. Repos above MAX_REPO_MB are skipped: clone those under CODE_LOCAL_ROOTS instead.
 */

const CACHE_DIR = path.join(INDEX_DIR, "repos");
const MAX_REPO_MB = 500;

export function cacheDirFor(repo: string): string {
  return path.join(CACHE_DIR, repoKey(repo).replace("/", "__"));
}

/** The downloaded copy of a repo, if there is one. */
export function cachedCopy(repo: string): string | null {
  if (inMemory()) return null;
  const dir = cacheDirFor(repo);
  return existsSync(path.join(dir, ".git")) ? dir : null;
}

function gitEnv(token: string): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

const remote = (repo: string) => `https://github.com/${repoKey(repo)}.git`;

/** The latest commit on the default branch, from GitHub, without downloading anything. */
async function remoteHead(repo: string, token: string): Promise<string> {
  const { stdout } = await run("git", ["ls-remote", remote(repo), "HEAD"], { env: gitEnv(token), timeout: 30_000 });
  const sha = stdout.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("GitHub didn't return the repo's latest commit (no access, or an empty repo).");
  return sha;
}

async function localHead(dir: string): Promise<string | null> {
  try {
    return (await run("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 10_000 })).stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Make sure the downloaded copy of `repo` is at GitHub's latest commit. Returns its folder and
 * that commit, or throws a short, readable reason.
 */
export async function syncCopy(repo: string): Promise<{ dir: string; commit: string; fetched: boolean }> {
  const token = await githubToken();
  if (!token) throw new Error("No GitHub token, so this repo can't be read.");
  const dir = cacheDirFor(repo);
  const head = await remoteHead(repo, token);
  const have = existsSync(path.join(dir, ".git")) ? await localHead(dir) : null;
  if (have === head) return { dir, commit: head, fetched: false };

  if (have) {
    await run("git", ["-C", dir, "fetch", "--depth", "1", "--no-tags", "origin", "HEAD"], { env: gitEnv(token), timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 });
    await run("git", ["-C", dir, "reset", "--hard", "--quiet", "FETCH_HEAD"], { timeout: 60_000 });
    await run("git", ["-C", dir, "clean", "-fdqx"], { timeout: 60_000 });
  } else {
    const meta = await githubGet<{ size: number }>(token, `/repos/${repoKey(repo)}`);
    if (meta.size > MAX_REPO_MB * 1024) {
      throw new Error(`Too large to copy (${Math.round(meta.size / 1024)} MB). Clone it under CODE_LOCAL_ROOTS to index it.`);
    }
    await rm(dir, { recursive: true, force: true });
    await mkdir(CACHE_DIR, { recursive: true });
    await run("git", ["clone", "--depth", "1", "--single-branch", "--no-tags", "--quiet", remote(repo), dir], {
      env: gitEnv(token),
      timeout: 5 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  const commit = (await localHead(dir)) ?? head;
  return { dir, commit, fetched: true };
}

/** Delete copies of repos no longer used by any project. */
export async function pruneCopies(keep: string[]) {
  if (inMemory() || !existsSync(CACHE_DIR)) return;
  const wanted = new Set(keep.map((r) => path.basename(cacheDirFor(r))));
  const { readdir } = await import("node:fs/promises");
  for (const name of await readdir(CACHE_DIR)) {
    if (!wanted.has(name)) await rm(path.join(CACHE_DIR, name), { recursive: true, force: true });
  }
}
