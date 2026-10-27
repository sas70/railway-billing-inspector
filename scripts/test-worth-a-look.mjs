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
const { DEFAULT_WORTH_RANGE, billState, billStatus, inWorthRange, isWorthRange, recentWindow, sortWorth, splitWorth } = require(join(output, "worth-a-look.js"));

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

test("bill items are listed apart, whatever the range, and never as events", () => {
  const items = [
    item(0.2, { id: "crash-today" }),
    item(40, { id: "crash-old" }),
    item(210, { id: "idle-stopped", ongoing: true, charging: false, periodCost: 4 }),
    item(900, { id: "volume", ongoing: true, charging: true, periodCost: 1 }),
    item(null, { id: "big-stopped", ongoing: true, charging: false, periodCost: 9 }),
  ];
  const today = splitWorth(items, "today", NOW);
  assert.deepEqual(today.events.map((x) => x.id), ["crash-today"]);
  assert.equal(today.hidden, 1);
  assert.deepEqual(today.billing.map((x) => x.id), ["volume", "big-stopped", "idle-stopped"], "still charging first, then the biggest");
  assert.deepEqual(splitWorth(items, "all", NOW).events.map((x) => x.id), ["crash-today", "crash-old"]);
});

test("still charging means Railway charged it in the last two full days", () => {
  const charging = billState({ recent: 0.06, volumeSoFar: 0 });
  assert.equal(charging.charging, true);
  assert.ok(Math.abs(charging.perDay - 0.03) < 1e-9, String(charging.perDay));
  assert.deepEqual(billState({ recent: 0, volumeSoFar: 1.5 }), { charging: false, perDay: null, known: true }, "a volume deleted earlier doesn't count");
  assert.equal(billState({ recent: 0.004, volumeSoFar: 0 }).charging, false, "rounding noise isn't a charge");
});

test("without recent usage, only a volume means still charging", () => {
  assert.deepEqual(billState({ recent: null, volumeSoFar: 0.4 }), { charging: true, perDay: null, known: false });
  assert.deepEqual(billState({ recent: null, volumeSoFar: 0 }), { charging: false, perDay: null, known: false });
});

test("status today: running, still charging, or stopped", () => {
  assert.equal(billStatus({ running: 1, recent: 0, volumeSoFar: 0 }), "running");
  assert.equal(billStatus({ running: 0, recent: 0.2, volumeSoFar: 0 }), "charging");
  assert.equal(billStatus({ running: 0, recent: 0, volumeSoFar: 3 }), "stopped");
});

test("the recent window is the last two complete UTC days", () => {
  assert.deepEqual(recentWindow(new Date("2026-10-25T17:15:00Z")), { start: "2026-10-23T00:00:00.000Z", end: "2026-10-25T00:00:00.000Z" });
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
