import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

// Compile the pure filter module with the project's TypeScript, like test-cost-history.mjs.
const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-worth-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/worth-a-look.ts", "--outDir", output, "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--strict"], { stdio: "inherit" });
const { DEFAULT_WORTH_RANGE, inWorthRange, isWorthRange, sortWorth } = require(join(output, "worth-a-look.js"));

const NOW = Date.parse("2026-10-24T12:00:00Z");
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();
const item = (days, extra = {}) => ({ at: days == null ? null : ago(days), ongoing: false, severity: 0, ...extra });

test("default is this week", () => {
  assert.equal(DEFAULT_WORTH_RANGE, "week");
});

test("ranges keep what happened inside them", () => {
  assert.equal(inWorthRange(item(0.5), "today", NOW), true);
  assert.equal(inWorthRange(item(2), "today", NOW), false);
  assert.equal(inWorthRange(item(6.9), "week", NOW), true);
  assert.equal(inWorthRange(item(8), "week", NOW), false);
  assert.equal(inWorthRange(item(29), "month", NOW), true);
  assert.equal(inWorthRange(item(31), "month", NOW), false);
  assert.equal(inWorthRange(item(364), "year", NOW), true);
  assert.equal(inWorthRange(item(3 * 365), "year", NOW), false);
  assert.equal(inWorthRange(item(3 * 365), "all", NOW), true);
});

test("anything still costing money always shows", () => {
  assert.equal(inWorthRange(item(900, { ongoing: true }), "today", NOW), true);
  assert.equal(inWorthRange(item(null, { ongoing: true }), "week", NOW), true);
});

test("no known time only shows under All", () => {
  assert.equal(inWorthRange(item(null), "year", NOW), false);
  assert.equal(inWorthRange(item(null), "all", NOW), true);
  assert.equal(inWorthRange({ at: "not a date", ongoing: false, severity: 0 }, "week", NOW), false);
});

test("most severe first, then newest", () => {
  const sorted = sortWorth([item(5, { severity: 1, id: "a" }), item(9, { severity: 0, id: "b" }), item(1, { severity: 1, id: "c" }), item(2, { severity: 0, id: "d" })]);
  assert.deepEqual(sorted.map((x) => x.id), ["d", "b", "c", "a"]);
});

test("only known ranges are accepted from storage", () => {
  assert.equal(isWorthRange("month"), true);
  assert.equal(isWorthRange("decade"), false);
  assert.equal(isWorthRange(null), false);
});
