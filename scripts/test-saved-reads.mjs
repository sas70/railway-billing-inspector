import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

// Compile into node_modules/.cache so the compiled file can require better-sqlite3.
const require = createRequire(import.meta.url);
mkdirSync("node_modules/.cache", { recursive: true });
const output = mkdtempSync(join("node_modules/.cache", "saved-reads-test-"));
const dbDir = mkdtempSync(join(tmpdir(), "saved-reads-db-"));
after(() => {
  rmSync(output, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
});
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/railway/saved-reads.ts", "--outDir", output, "--module", "commonjs", "--target", "es2022", "--skipLibCheck", "--strict", "--esModuleInterop"], { stdio: "inherit" });
const { SavedReads, UNUSED_FOR_MS } = require(join(process.cwd(), output, "saved-reads.js"));

const DAY = 24 * 60 * 60_000;

test("a saved read comes back after the store is reopened (a server restart)", () => {
  const file = join(dbDir, "a.sqlite");
  const first = new SavedReads(file, 1000);
  first.set("main|Projects|{}", "main", { projects: [1, 2] }, 1000);
  first.close();
  const again = new SavedReads(file, 2000);
  assert.deepEqual(again.get("main|Projects|{}", 2000), { fetchedAt: 1000, data: { projects: [1, 2] } });
  assert.equal(again.oldest(), 1000);
  again.close();
});

test("there is no time limit: a read from a week ago is still used", () => {
  const store = new SavedReads(join(dbDir, "b.sqlite"), 0);
  store.set("k", "main", 42, 0);
  assert.equal(store.get("k", 7 * DAY).data, 42);
  store.close();
});

test("Refresh clears everything; a change clears only its account", () => {
  const store = new SavedReads(join(dbDir, "c.sqlite"));
  store.set("main|A|{}", "main", 1);
  store.set("work|A|{}", "work", 2);
  store.clear("main");
  assert.equal(store.get("main|A|{}"), null);
  assert.equal(store.get("work|A|{}").data, 2);
  store.clear();
  assert.equal(store.count(), 0);
  assert.equal(store.oldest(), null);
  store.close();
});

test("reads nobody has used for a month are dropped when the store opens", () => {
  const file = join(dbDir, "d.sqlite");
  const store = new SavedReads(file, 0);
  store.set("old", "main", 1, 0);
  store.set("used", "main", 2, 0);
  store.get("used", UNUSED_FOR_MS - DAY); // touched recently
  store.close();
  const later = new SavedReads(file, UNUSED_FOR_MS + DAY);
  assert.equal(later.get("old", UNUSED_FOR_MS + DAY), null);
  assert.equal(later.get("used", UNUSED_FOR_MS + DAY).data, 2);
  later.close();
});
