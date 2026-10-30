import "server-only";

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { savedSummary } from "../code/ai-summary";
import { MOCK_REPOS } from "../code/mock-corpus";
import { summarizeReadme } from "../code/readme";
import { cloneFor, githubToken, localClones, mapLimit, repoKey, run } from "../code/sources";
import { isMockMode } from "../config";
import { loadAccountViews, loadWorkspaceBundle, uniqueWorkspaceTargets, type ProjectSummary } from "../railway/api";
import { EMBED_MODEL, embed, embeddingsDisabledReason, toBlob } from "./embed";
import { pruneCopies, syncCopy } from "./repo-cache";
import { clearIndex, db, getMeta, setMeta } from "./store";
import { chunkLines, isIndexableFile, MAX_BYTES_PER_REPO, MAX_FILES_PER_REPO, textHash } from "./text";

/**
 * Builds and updates the search index in the background, one job at a time.
 *
 * 1. Projects: every Railway project's name, description, services, domains and repos.
 * 2. Repos: each repo's saved Claude summary, README and code, read from a local clone, a
 *    downloaded copy of a GitHub-only repo, or the demo data. A repo whose commit (and, for a
 *    local clone, uncommitted changes) hasn't moved since the last run is skipped.
 * 3. Topics: one embedding per project from what it does (summary, README intro, description),
 *    recomputed only when that text changes.
 *
 * Railway is only read, through the same cached reads as the rest of the app.
 */

export type IndexJob = {
  running: boolean;
  mode: "update" | "rebuild" | null;
  phase: "projects" | "repos" | "topics" | "done" | null;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  done: number;
  current: string[];
  indexed: number;
  unchanged: number;
  failed: { repo: string; error: string }[];
  topics: number;
  topicsError: string | null;
  error: string | null;
};

const idle = (): IndexJob => ({
  running: false,
  mode: null,
  phase: null,
  startedAt: null,
  finishedAt: null,
  total: 0,
  done: 0,
  current: [],
  indexed: 0,
  unchanged: 0,
  failed: [],
  topics: 0,
  topicsError: null,
  error: null,
});

const store = globalThis as typeof globalThis & { __rbiIndexJob?: IndexJob };
const job = (store.__rbiIndexJob ??= idle());

export const indexJob = (): IndexJob => ({ ...job, current: [...job.current], failed: [...job.failed] });

/** Update the index when it has never been built, or was last built more than a day ago. */
const STALE_AFTER_MS = 24 * 60 * 60_000;

export function indexNeedsUpdate(): boolean {
  if (job.running) return false;
  const builtAt = getMeta("builtAt");
  return !builtAt || Date.now() - Date.parse(builtAt) > STALE_AFTER_MS;
}

/** Start the job unless one is running. "rebuild" throws the index away first. */
export function startIndexJob(mode: "update" | "rebuild" = "update"): boolean {
  if (job.running) return false;
  Object.assign(job, idle(), { running: true, mode, phase: "projects", startedAt: new Date().toISOString() });
  void runJob(mode)
    .catch((error: unknown) => {
      job.error = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      job.running = false;
      job.phase = "done";
      job.current = [];
      job.finishedAt = new Date().toISOString();
    });
  return true;
}

/** Start an update in the background if the index is missing or a day old. Cheap to call on every page load. */
export function ensureIndex() {
  try {
    if (indexNeedsUpdate()) startIndexJob("update");
  } catch {
    // The index is a convenience: never let it break a page.
  }
}

// ── Projects ────────────────────────────────────────────────────────────────

type ProjectRow = { project: ProjectSummary; account: string; workspaceId: string; workspace: string };

async function loadProjects(): Promise<ProjectRow[]> {
  const targets = uniqueWorkspaceTargets(await loadAccountViews());
  const bundles = await Promise.all(targets.map(({ account, workspace }) => loadWorkspaceBundle(account, workspace)));
  return bundles.flatMap((b) =>
    (b.projects.ok ? b.projects.value : []).map((project) => ({ project, account: b.account.key, workspaceId: b.workspace.id, workspace: b.workspace.name })),
  );
}

function writeProjects(rows: ProjectRow[]) {
  const d = db();
  const insertProject = d.prepare("INSERT INTO projects (id, account, workspace_id, workspace, name, href, repos) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertDoc = d.prepare("INSERT INTO docs (owner, kind, path, line, title, body) VALUES (?, ?, NULL, NULL, ?, ?)");
  d.transaction(() => {
    d.exec("DELETE FROM projects; DELETE FROM docs WHERE owner LIKE 'p:%';");
    for (const { project: p, account, workspaceId, workspace } of rows) {
      insertProject.run(p.id, account, workspaceId, workspace, p.name, `/a/${account}/p/${p.id}`, JSON.stringify(p.repos.map(repoKey)));
      const services = [...new Set(p.environments.flatMap((e) => e.instances.map((i) => i.serviceName)))];
      const body = [p.description ?? "", `Workspace: ${workspace}`, `Services: ${services.join(", ")}`, `Domains: ${p.publicDomains.join(", ")}`, `Repos: ${p.repos.join(", ")}`, `Environments: ${p.environments.map((e) => e.name).join(", ")}`]
        .filter((line) => !/:\s*$/.test(line) && line)
        .join("\n");
      insertDoc.run(`p:${p.id}`, "project", p.name, body);
    }
  })();
}

// ── Repos ───────────────────────────────────────────────────────────────────

type RepoText = { source: string; version: string; files: { path: string; text: string }[] };

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

async function gitFiles(dir: string, includeUntracked: boolean): Promise<string[]> {
  const args = ["-C", dir, "-c", "core.quotepath=off", "ls-files", "-z", "--cached", ...(includeUntracked ? ["--others", "--exclude-standard"] : [])];
  const { stdout } = await run("git", args, { timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(stdout.split("\0").filter(Boolean))];
}

async function readTree(dir: string, includeUntracked: boolean): Promise<{ path: string; text: string }[]> {
  const files: { path: string; text: string }[] = [];
  let bytes = 0;
  for (const file of (await gitFiles(dir, includeUntracked)).filter((f) => isIndexableFile(f))) {
    if (files.length >= MAX_FILES_PER_REPO || bytes >= MAX_BYTES_PER_REPO) break;
    try {
      const full = path.join(dir, file);
      const info = await stat(full);
      if (!info.isFile() || !isIndexableFile(file, info.size)) continue;
      const text = await readFile(full, "utf8");
      if (text.includes("\0")) continue;
      files.push({ path: file, text });
      bytes += text.length;
    } catch {}
  }
  return files;
}

/** Where a repo's code comes from, and a version string that changes whenever the code does. */
async function locate(repo: string): Promise<{ source: string; version: string; read: () => Promise<RepoText["files"]> }> {
  if (isMockMode()) {
    const mock = MOCK_REPOS[repoKey(repo)];
    if (!mock) throw new Error("Not in the demo data.");
    const files = Object.entries(mock.files).map(([p, text]) => ({ path: p, text }));
    return { source: "demo", version: `demo:${textHash(JSON.stringify(files))}`, read: async () => files };
  }
  const found = cloneFor(repo, await localClones());
  if (found) {
    const dir = found.clone.dir;
    const [{ stdout: head }, { stdout: status }] = await Promise.all([
      run("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 10_000 }),
      run("git", ["-C", dir, "status", "--porcelain"], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }),
    ]);
    const dirty = status.split("\n").filter((l) => l && !l.includes(".railway-inspector/")).join("\n");
    return { source: `local:${dir}`, version: `${head.trim()}${dirty ? `+${sha1(dirty)}` : ""}`, read: () => readTree(dir, true) };
  }
  if (await githubToken()) {
    const copy = await syncCopy(repo);
    return { source: "github-copy", version: copy.commit, read: () => readTree(copy.dir, false) };
  }
  throw new Error("No local clone and no GitHub token.");
}

async function summaryText(repo: string): Promise<{ title: string; body: string } | null> {
  const stored = await savedSummary(repo).catch(() => null);
  if (!stored) return null;
  const s = stored.summary;
  return {
    title: s.name,
    body: [s.summary, `Features: ${s.features.join("; ")}`, `Stack: ${s.stack.join(", ")}`, `Services: ${s.services.join(", ")}`, `Keywords: ${s.keywords.join(", ")}`, `Starts with: ${s.entrypoint}`].join("\n"),
  };
}

const README_RE = /(^|\/)readme(\.(md|markdown|mdx|txt|rst))?$/i;

async function indexRepo(repo: string, force: boolean): Promise<"indexed" | "unchanged"> {
  const key = repoKey(repo);
  const d = db();
  const where = await locate(repo);
  const summary = await summaryText(repo);
  // A new or changed summary also counts as a change.
  const version = `${where.version}|${summary ? textHash(summary.body) : "-"}`;
  const previous = d.prepare("SELECT version, error FROM repos WHERE repo = ?").get(key) as { version: string | null; error: string | null } | undefined;
  if (!force && previous?.version === version && !previous.error) return "unchanged";

  const files = await where.read();
  const insert = d.prepare("INSERT INTO docs (owner, kind, path, line, title, body) VALUES (?, ?, ?, ?, ?, ?)");
  let chunks = 0;
  d.transaction(() => {
    d.prepare("DELETE FROM docs WHERE owner = ?").run(`r:${key}`);
    if (summary) insert.run(`r:${key}`, "summary", null, null, summary.title, summary.body);
    for (const f of files) {
      const kind = README_RE.test(f.path) && !f.path.includes("/") ? "readme" : "code";
      for (const c of chunkLines(f.text)) {
        insert.run(`r:${key}`, kind, f.path, c.line, f.path, c.body);
        if (kind === "code") chunks++;
      }
    }
    d.prepare("INSERT OR REPLACE INTO repos (repo, version, source, files, chunks, indexed_at, error) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(
      key,
      version,
      where.source,
      files.length,
      chunks,
      new Date().toISOString(),
    );
  })();
  return "indexed";
}

// ── Topics ──────────────────────────────────────────────────────────────────

/** What a project is about, in at most ~2,000 characters (the model reads about 512 tokens). */
function topicText(projectId: string): string {
  const d = db();
  const p = d.prepare("SELECT name, repos FROM projects WHERE id = ?").get(projectId) as { name: string; repos: string };
  const parts = [p.name];
  const own = d.prepare("SELECT body FROM docs WHERE owner = ? AND kind = 'project'").get(`p:${projectId}`) as { body: string } | undefined;
  if (own) parts.push(own.body.split("\n").filter((l) => !l.startsWith("Workspace:") && !l.startsWith("Environments:")).join("\n"));
  for (const repo of JSON.parse(p.repos) as string[]) {
    const summary = d.prepare("SELECT title, body FROM docs WHERE owner = ? AND kind = 'summary'").get(`r:${repo}`) as { title: string; body: string } | undefined;
    if (summary) parts.push(`${summary.title}. ${summary.body.split("\nStarts with:")[0]}`);
    const readme = d
      .prepare("SELECT body FROM docs WHERE owner = ? AND kind = 'readme' ORDER BY line LIMIT 2")
      .all(`r:${repo}`) as { body: string }[];
    if (readme.length) {
      const intro = summarizeReadme(readme.map((r) => r.body).join("\n"), 600);
      parts.push([intro.title, intro.summary].filter(Boolean).join(". "));
    }
  }
  return parts.join("\n").slice(0, 2000);
}

async function updateTopics() {
  const reason = embeddingsDisabledReason();
  if (reason && /off on the hosted|turned off/.test(reason)) {
    job.topicsError = reason;
    return;
  }
  const d = db();
  const ids = (d.prepare("SELECT id FROM projects").all() as { id: string }[]).map((r) => r.id);
  const existing = new Map((d.prepare("SELECT owner, hash, model FROM vectors").all() as { owner: string; hash: string; model: string }[]).map((r) => [r.owner, r]));
  const todo: { owner: string; text: string; hash: string }[] = [];
  for (const id of ids) {
    const text = topicText(id);
    const hash = textHash(text);
    const have = existing.get(`p:${id}`);
    if (!have || have.hash !== hash || have.model !== EMBED_MODEL) todo.push({ owner: `p:${id}`, text, hash });
  }
  d.prepare(`DELETE FROM vectors WHERE owner NOT IN (${ids.map(() => "?").join(",") || "''"})`).run(...ids.map((id) => `p:${id}`));
  job.total = todo.length;
  job.done = 0;
  try {
    for (let i = 0; i < todo.length; i += 16) {
      const batch = todo.slice(i, i + 16);
      const vectors = await embed(batch.map((t) => t.text), "document");
      const upsert = d.prepare("INSERT OR REPLACE INTO vectors (owner, model, hash, vec) VALUES (?, ?, ?, ?)");
      d.transaction(() => batch.forEach((t, j) => upsert.run(t.owner, EMBED_MODEL, t.hash, toBlob(vectors[j]))))();
      job.done += batch.length;
      job.topics += batch.length;
    }
    setMeta("model", EMBED_MODEL);
  } catch (error) {
    job.topicsError = embeddingsDisabledReason() ?? (error instanceof Error ? error.message : String(error));
  }
}

// ── The job ─────────────────────────────────────────────────────────────────

async function runJob(mode: "update" | "rebuild") {
  if (mode === "rebuild") clearIndex();

  job.phase = "projects";
  const rows = await loadProjects();
  writeProjects(rows);

  job.phase = "repos";
  const repos = [...new Map(rows.flatMap((r) => r.project.repos).map((r) => [repoKey(r), r])).values()];
  const d = db();
  const keep = new Set(repos.map(repoKey));
  for (const { repo } of d.prepare("SELECT repo FROM repos").all() as { repo: string }[]) {
    if (!keep.has(repo)) d.transaction(() => {
      d.prepare("DELETE FROM docs WHERE owner = ?").run(`r:${repo}`);
      d.prepare("DELETE FROM repos WHERE repo = ?").run(repo);
    })();
  }
  job.total = repos.length;
  job.done = 0;
  await mapLimit(repos, 3, async (repo) => {
    job.current.push(repo);
    try {
      job[await indexRepo(repo, mode === "rebuild")]++;
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0].slice(0, 300) : String(error);
      job.failed.push({ repo, error: message });
      d.prepare("INSERT OR REPLACE INTO repos (repo, version, source, files, chunks, indexed_at, error) VALUES (?, NULL, NULL, 0, 0, ?, ?)").run(repoKey(repo), new Date().toISOString(), message);
    } finally {
      job.current = job.current.filter((r) => r !== repo);
      job.done++;
    }
  });
  await pruneCopies(repos).catch(() => {});

  job.phase = "topics";
  await updateTopics();

  setMeta("builtAt", new Date().toISOString());
  d.exec("INSERT INTO docs_fts (docs_fts) VALUES ('optimize')");
}
