import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-auto-summary-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/code/auto-summary.ts", "--outDir", output, "--rootDir", "src", "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--strict"], { stdio: "inherit" });
const { reposToAutoSummarize } = require(join(output, "lib", "code", "auto-summary.js"));

test("only repos with no saved summary are picked", () => {
  assert.deepEqual(reposToAutoSummarize(["sas70/a", "sas70/b", "sas70/c"], new Set(["sas70/b"]), new Set()), ["sas70/a", "sas70/c"]);
});

test("a repo already tried since the server started is not retried", () => {
  assert.deepEqual(reposToAutoSummarize(["sas70/a", "sas70/b"], new Set(), new Set(["sas70/a"])), ["sas70/b"]);
});

test("the same repo spelled differently counts once", () => {
  assert.deepEqual(reposToAutoSummarize(["Sas70/Chart_All", "sas70/chart_all.git", " sas70/chart_all "], new Set(), new Set()), ["Sas70/Chart_All"]);
  assert.deepEqual(reposToAutoSummarize(["Sas70/Chart_All.git"], new Set(["sas70/chart_all"]), new Set()), []);
});
