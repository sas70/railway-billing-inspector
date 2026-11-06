import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-volume-kind-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/volume-kind.ts", "--outDir", output, "--rootDir", "src", "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--strict"], { stdio: "inherit" });
const { guessVolumeKind, volumeCostPerDay } = require(join(output, "lib", "volume-kind.js"));

test("known database images are recognized from the image", () => {
  const cases = [
    ["redis:8.2.9", "Redis data"],
    ["bitnami/redis:7", "Redis data"],
    ["ghcr.io/railwayapp-templates/postgres-ssl:16", "PostgreSQL database"],
    ["postgres:16-alpine", "PostgreSQL database"],
    ["mysql:8", "MySQL database"],
    ["mongo:7", "MongoDB database"],
    ["minio/minio:latest", "Object storage"],
    ["jupyter/base-notebook", "Notebook files"],
  ];
  for (const [image, label] of cases) {
    const k = guessVolumeKind({ image, mountPath: "/x", hasRepo: false });
    assert.equal(k.label, label, image);
    assert.equal(k.basis, "image", image);
  }
});

test("with no image, the mount path is a weaker hint", () => {
  assert.equal(guessVolumeKind({ image: null, mountPath: "/var/lib/postgresql/data", hasRepo: false }).basis, "path");
  assert.equal(guessVolumeKind({ image: null, mountPath: "/data", hasRepo: false }).label, "Unknown data");
});

test("an app built from a repo is judged by its code, not the path", () => {
  const k = guessVolumeKind({ image: null, mountPath: "/data", hasRepo: true });
  assert.equal(k.basis, "unknown");
  assert.equal(k.label, "Files the app wrote");
});

test("cost per day uses Railway's list price on used space", () => {
  // 1.03 GB at $0.15 / GB / month is about half a cent a day.
  assert.ok(Math.abs(volumeCostPerDay(1030) - 0.00515) < 1e-6);
});

test("generic mount paths do not identify an unknown Docker image as Redis", () => {
  for (const image of [null, "acme/uploads:latest"]) {
    assert.equal(guessVolumeKind({ image, mountPath: "/data", hasRepo: false }).basis, "unknown");
  }
  assert.equal(guessVolumeKind({ image: null, mountPath: "/var/lib/redis", hasRepo: false }).label, "Redis data");
});
