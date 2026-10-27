import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

// Compile the pure preload module with the project's TypeScript, like test-worth-a-look.mjs.
const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-preload-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/preload.ts", "--outDir", output, "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--strict"], { stdio: "inherit" });
const { KEEP_PAGES_SECONDS, PRELOAD_ROUTES, routesToPreload } = require(join(output, "preload.js"));

test("preloads every main tab plus last billing period", () => {
  for (const route of ["/", "/services", "/search", "/billing", "/billing?period=previous", "/audit"]) {
    assert.ok(PRELOAD_ROUTES.includes(route), route);
  }
});

test("skips the page already on screen", () => {
  assert.ok(!routesToPreload("/services").includes("/services"));
  assert.equal(routesToPreload("/services").length, PRELOAD_ROUTES.length - 1);
  assert.ok(!routesToPreload("/billing", "?period=previous").includes("/billing?period=previous"));
  assert.ok(routesToPreload("/billing", "?period=previous").includes("/billing"));
});

test("a project page preloads all the tabs", () => {
  assert.equal(routesToPreload("/a/main/p/123").length, PRELOAD_ROUTES.length);
});

test("pages are kept as long as Next allows for prefetched pages", () => {
  // staleTimes.static must be at least 30 s; an hour matches the server's read cache.
  assert.ok(KEEP_PAGES_SECONDS >= 30);
  assert.equal(KEEP_PAGES_SECONDS, 3600);
});
