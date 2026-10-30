import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { isMockMode } from "../config";

/**
 * The search index: one SQLite file in the app's git-ignored data folder
 * (data/search-index/index.sqlite, or under AUDIT_LOG_DIR). It never leaves this machine.
 *
 * - projects  every Railway project, with the repos it deploys
 * - docs      searchable text: project details, each repo's summary, README and code chunks.
 *             `owner` is "p:<projectId>" for project details or "r:<repo>" for repo text.
 * - docs_fts  SQLite's full-text index over docs (BM25 ranking, porter stemming)
 * - repos     what was indexed for each repo, so unchanged repos are skipped next time
 * - vectors   one topic embedding per project, for "what is this about" search
 *
 * Demo mode keeps it in memory, and so does Vercel, whose file system is read-only.
 */

export const INDEX_DIR = path.join(process.env.AUDIT_LOG_DIR?.trim() || path.join(/*turbopackIgnore: true*/ process.cwd(), "data"), "search-index");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, account TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace TEXT NOT NULL,
  name TEXT NOT NULL, href TEXT NOT NULL, repos TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repos (
  repo TEXT PRIMARY KEY, version TEXT, source TEXT, files INTEGER, chunks INTEGER, indexed_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, path TEXT, line INTEGER, title TEXT NOT NULL, body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS docs_owner ON docs (owner);
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5 (title, body, content='docs', content_rowid='id', tokenize='porter unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts (docs_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
END;
CREATE TABLE IF NOT EXISTS vectors (owner TEXT PRIMARY KEY, model TEXT NOT NULL, hash TEXT NOT NULL, vec BLOB NOT NULL);
`;

/** Bump to rebuild every index made by an older version of this code. */
const SCHEMA_VERSION = "1";

const store = globalThis as typeof globalThis & { __rbiIndexDb?: Database.Database };

export function inMemory(): boolean {
  return isMockMode() || process.env.VERCEL === "1";
}

export function db(): Database.Database {
  if (store.__rbiIndexDb) return store.__rbiIndexDb;
  let file = ":memory:";
  if (!inMemory()) {
    mkdirSync(INDEX_DIR, { recursive: true });
    file = path.join(INDEX_DIR, "index.sqlite");
  }
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("synchronous = NORMAL");
  conn.exec(SCHEMA);
  const version = (conn.prepare("SELECT v FROM meta WHERE k = 'schema'").get() as { v: string } | undefined)?.v;
  if (version !== SCHEMA_VERSION) {
    conn.exec("DELETE FROM docs; DELETE FROM repos; DELETE FROM projects; DELETE FROM vectors; DELETE FROM meta;");
    conn.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema', ?)").run(SCHEMA_VERSION);
  }
  store.__rbiIndexDb = conn;
  return conn;
}

export function getMeta(key: string): string | null {
  return (db().prepare("SELECT v FROM meta WHERE k = ?").get(key) as { v: string } | undefined)?.v ?? null;
}

export function setMeta(key: string, value: string | null) {
  if (value == null) db().prepare("DELETE FROM meta WHERE k = ?").run(key);
  else db().prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").run(key, value);
}

export type IndexStats = { projects: number; repos: number; chunks: number; topics: number; builtAt: string | null; model: string | null };

export function indexStats(): IndexStats {
  const d = db();
  const count = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  return {
    projects: count("SELECT COUNT(*) AS n FROM projects"),
    repos: count("SELECT COUNT(*) AS n FROM repos WHERE error IS NULL"),
    chunks: count("SELECT COUNT(*) AS n FROM docs WHERE kind = 'code'"),
    topics: count("SELECT COUNT(*) AS n FROM vectors"),
    builtAt: getMeta("builtAt"),
    model: getMeta("model"),
  };
}

/** Throw everything away (the Rebuild button). Downloaded GitHub copies are kept. */
export function clearIndex() {
  db().exec("DELETE FROM docs; DELETE FROM repos; DELETE FROM projects; DELETE FROM vectors; DELETE FROM meta WHERE k <> 'schema';");
}
