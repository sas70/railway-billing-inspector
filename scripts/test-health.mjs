import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

// Compile the pure health module with the project's TypeScript, like test-preload.mjs.
const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-health-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/health.ts", "--outDir", output, "--rootDir", "src", "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--strict", "--moduleResolution", "node"], { stdio: "inherit" });
const { instanceHealth } = require(join(output, "lib", "health.js"));

test("a deployment Railway stopped but still lists as active is flagged, not live", () => {
  const d = { id: "d1", status: "SUCCESS", deploymentStopped: true };
  const h = instanceHealth(d, [d]);
  assert.deepEqual(h.liveDeploymentIds, []);
  assert.deepEqual(h.stoppedDeploymentIds, ["d1"]);
  assert.notEqual(h.health, "live");
});

test("a running deployment is live and not flagged as stopped", () => {
  const d = { id: "d2", status: "SUCCESS", deploymentStopped: false };
  const h = instanceHealth(d, [d]);
  assert.deepEqual(h.liveDeploymentIds, ["d2"]);
  assert.deepEqual(h.stoppedDeploymentIds, []);
});

test("removed or still-deploying deployments are never flagged as stopped", () => {
  const gone = { id: "d3", status: "REMOVED", deploymentStopped: true };
  const building = { id: "d4", status: "DEPLOYING", deploymentStopped: true };
  assert.deepEqual(instanceHealth(gone, [gone]).stoppedDeploymentIds, []);
  assert.deepEqual(instanceHealth(building, [building]).stoppedDeploymentIds, []);
});
