import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

// Compile the pure calculation module with the project's existing TypeScript.
// This keeps the test runner compatible with the app's Node 20+ requirement.
const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-history-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/cost-history.ts", "--outDir", output, "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--esModuleInterop", "--strict"], { stdio: "inherit" });
const { historyWindows, historyRangeLabel, compareHistory, changePercent, changeMoney } = require(join(output, "cost-history.js"));
const cost = (memory, cpu = 0) => ({ cpu, memory, egress: 0, volume: 0, backup: 0, total: memory + cpu });
const project = (id, memory, cpu = 0, deleted = false) => ({ id, name: id, deleted, cost: cost(memory, cpu) });
const usage = (projects) => ({ ok: true, value: { projects, total: cost(projects.reduce((n, p) => n + p.cost.total, 0)) } });
const entry = (before, after, id = "ws") => ({ accountKey: "main", workspace: { id, name: id }, previous: usage(before), recent: usage(after) });

test("equal UTC windows cross leap days and ignore time of day", () => {
  const windows = historyWindows(7, new Date("2024-03-04T23:59:59Z"));
  assert.deepEqual(windows, {
    recent: { start: "2024-02-26T00:00:00.000Z", end: "2024-03-04T00:00:00.000Z" },
    previous: { start: "2024-02-19T00:00:00.000Z", end: "2024-02-26T00:00:00.000Z" },
  });
  assert.equal(historyRangeLabel(windows.recent), "Feb 26, 2024 – Mar 3, 2024");
  const month = historyWindows(30, new Date("2026-03-15T04:00:00Z"));
  for (const range of Object.values(month)) assert.equal(Date.parse(range.end) - Date.parse(range.start), 30 * 86400000);
  assert.equal(month.previous.end, month.recent.start);
});

test("ranked project deltas reconcile to totals, including new and disappeared usage", () => {
  const result = compareHistory([entry([project("api", 10), project("removed", 8, 0, true)], [project("api", 15), project("new", 3)])]);
  assert.equal(result.previous, 18);
  assert.equal(result.recent, 18);
  assert.equal(result.delta, 0);
  assert.deepEqual(result.rows.map((r) => [r.name, r.delta]), [["removed", -8], ["api", 5], ["new", 3]]);
  assert.equal(result.rows.reduce((n, r) => n + r.delta, 0), result.delta);
  assert.equal(result.rows[0].href, undefined);
  assert.equal(result.rows[2].percentage, null);
  assert.equal(changePercent(3, 0), "No earlier usage");
  assert.equal(changePercent(0, 8), "−100%");
});

test("failed reads exclude both sides instead of inventing a reduction", () => {
  const failed = entry([project("api", 100)], []);
  failed.recent = { ok: false, error: "Not authorized" };
  const previousFailed = entry([], [project("api", 500)], "other");
  previousFailed.previous = { ok: false, error: "Unavailable" };
  const result = compareHistory([failed, previousFailed, entry([project("ok", 2)], [project("ok", 4)], "readable")]);
  assert.equal(result.compared, 1);
  assert.equal(result.excluded.length, 2);
  assert.equal(result.delta, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(compareHistory([failed]).compared, 0);
});

test("workspace IDs prevent project collisions; unchanged and unattributed usage are safe", () => {
  const result = compareHistory([entry([project("same", 5)], [project("same", 5)], "one"), entry([], [project("same", 2), project("unknown", 1)], "two")]);
  assert.equal(new Set(result.rows.map((r) => r.key)).size, 3);
  assert.equal(result.rows.find((r) => r.name === "unknown").href, undefined);
  assert.equal(result.rows.find((r) => r.workspace === "one").driver, null);
  assert.equal(changePercent(5, 5), "No change");
  assert.equal(changePercent(0, 0), "No change");
});

test("resource contributor follows the net direction and breakdown reconciles", () => {
  const row = compareHistory([entry([project("api", 30, 0)], [project("api", 20, 15)])]).rows[0];
  assert.equal(row.delta, 5);
  assert.deepEqual(row.driver, { key: "cpu", label: "CPU", delta: 15 });
  assert.equal(row.resources.reduce((n, r) => n + r.delta, 0), row.delta);
  assert.equal(changeMoney(-0.001), "−<$0.01");
  assert.equal(changeMoney(0), "$0.00");
});

test("empty successful windows remain valid rather than unavailable", () => {
  const result = compareHistory([entry([], [])]);
  assert.equal(result.compared, 1);
  assert.equal(result.delta, 0);
  assert.deepEqual(result.rows, []);
});
