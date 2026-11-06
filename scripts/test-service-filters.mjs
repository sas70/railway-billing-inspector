import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

// Compile the pure filter module with the project's TypeScript, like test-health.mjs.
const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-filters-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/service-stats.ts", "--outDir", output, "--rootDir", "src", "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--strict", "--moduleResolution", "node"], { stdio: "inherit" });
const { rowStatusTags, isStatusFilter } = require(join(output, "lib", "service-stats.js"));

const row = (health, extra = {}) => ({ online: ["live", "sleeping", "deploying"].includes(health), health, degraded: false, stoppedDeploymentIds: [], ...extra });

test("each health lands in the filter the Overview tile counts it under", () => {
  assert.deepEqual(rowStatusTags(row("live")), ["online"]);
  assert.deepEqual(rowStatusTags(row("sleeping")), ["online"]);
  assert.deepEqual(rowStatusTags(row("crashed")), ["attention"]);
  assert.deepEqual(rowStatusTags(row("failed")), ["attention"]);
  assert.deepEqual(rowStatusTags(row("offline")), ["offline"]);
});

test("a degraded live service is online and needs attention", () => {
  assert.deepEqual(rowStatusTags(row("live", { degraded: true })), ["online", "attention"]);
});

test("a stopped-but-billed service is offline and stopped", () => {
  assert.deepEqual(rowStatusTags(row("offline", { stoppedDeploymentIds: ["d1"] })), ["offline", "stopped"]);
});

test("only known filters are accepted from the URL", () => {
  for (const f of ["all", "online", "attention", "offline", "stopped"]) assert.equal(isStatusFilter(f), true);
  for (const f of ["", "live", "ATTENTION", undefined, 3]) assert.equal(isStatusFilter(f), false);
});
