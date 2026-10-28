import Database from "better-sqlite3";

/**
 * Railway reads saved on disk, so they survive a server restart and are reused until you press
 * Refresh. One SQLite file in the app's git-ignored data folder; nothing leaves this machine.
 *
 * Kept free of server-only imports so scripts/test-saved-reads.mjs can exercise it directly.
 */

export type SavedRead = { fetchedAt: number; data: unknown };

/** Reads nobody has asked for in this long are dropped when the store opens (old time windows, deleted projects). */
export const UNUSED_FOR_MS = 30 * 24 * 60 * 60_000;
/** `used_at` is only rewritten when it is older than this, so reading doesn't mean writing every time. */
const TOUCH_AFTER_MS = 24 * 60 * 60_000;

export class SavedReads {
  private db: Database.Database;

  constructor(file: string, now = Date.now()) {
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS reads (
      key TEXT PRIMARY KEY, account TEXT NOT NULL, fetched_at INTEGER NOT NULL, used_at INTEGER NOT NULL, data TEXT NOT NULL
    )`);
    this.db.prepare("DELETE FROM reads WHERE used_at < ?").run(now - UNUSED_FOR_MS);
  }

  get(key: string, now = Date.now()): SavedRead | null {
    const row = this.db.prepare("SELECT fetched_at, used_at, data FROM reads WHERE key = ?").get(key) as
      | { fetched_at: number; used_at: number; data: string }
      | undefined;
    if (!row) return null;
    if (now - row.used_at > TOUCH_AFTER_MS) this.db.prepare("UPDATE reads SET used_at = ? WHERE key = ?").run(now, key);
    return { fetchedAt: row.fetched_at, data: JSON.parse(row.data) };
  }

  set(key: string, account: string, data: unknown, fetchedAt = Date.now()) {
    this.db
      .prepare("INSERT OR REPLACE INTO reads (key, account, fetched_at, used_at, data) VALUES (?, ?, ?, ?, ?)")
      .run(key, account, fetchedAt, fetchedAt, JSON.stringify(data));
  }

  /** Forget every saved read, or just one account's. */
  clear(account?: string) {
    if (account == null) this.db.exec("DELETE FROM reads");
    else this.db.prepare("DELETE FROM reads WHERE account = ?").run(account);
  }

  /** When the oldest saved read was fetched, or null when nothing is saved. */
  oldest(): number | null {
    return (this.db.prepare("SELECT MIN(fetched_at) AS t FROM reads").get() as { t: number | null }).t;
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM reads").get() as { n: number }).n;
  }

  close() {
    this.db.close();
  }
}
