import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

// Compile the pure modules with the project's TypeScript, like test-cost-history.mjs.
const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-names-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "src/lib/name-suggest.ts", "src/lib/project-name.ts", "--outDir", output, "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--strict"],
  { stdio: "inherit" },
);
const { cleanProjectName, slugify, suggestName, uniqueSuggestions } = require(join(output, "name-suggest.js"));
const { isGeneratedRailwayName, projectNameHints } = require(join(output, "project-name.js"));

test("slugs are lowercase ASCII words joined by dashes", () => {
  assert.equal(slugify("Room shell image matcher"), "room-shell-image-matcher");
  assert.equal(slugify("Flask PDF (unmodified template)"), "flask-pdf-unmodified-template");
  assert.equal(slugify("Café & Crème — API"), "cafe-and-creme-api");
  assert.equal(slugify("  --  "), "");
  const long = slugify("PDF to Google Slides generator with extra words that go on");
  assert.ok(long.length <= 40 && !long.endsWith("-"), long);
});

test("generated names: two random words, not ones the repos, services or people use", () => {
  assert.equal(isGeneratedRailwayName("laughable-addition", ["sas70/pinterest", "pinterest"]), true);
  assert.equal(isGeneratedRailwayName("steadfast-fascination"), true);
  assert.equal(isGeneratedRailwayName("marketing-site", ["acme/site", "web"]), false, "site is a project word");
  assert.equal(isGeneratedRailwayName("upwork-proposals", ["sas70/upwork-proposals"]), false, "matches its repo");
  assert.equal(isGeneratedRailwayName("socket-relay", ["acme/relay", "relay"]), false, "matches its service");
  assert.equal(isGeneratedRailwayName("old-experiments", ["notebook"]), false, "old is a project word");
  assert.equal(isGeneratedRailwayName("googleslides", ["sas70/googleslides"]), false, "one word");
  assert.equal(isGeneratedRailwayName("pdf2t2c"), false);
  assert.equal(isGeneratedRailwayName("My App"), false);
  assert.equal(isGeneratedRailwayName("flask-starter-template"), false, "three words");
});

test("hints are the repo and service names", () => {
  const project = { repos: ["acme/status"], environments: [{ instances: [{ serviceName: "status" }, { serviceName: "Postgres" }] }] };
  assert.deepEqual(projectNameHints(project), ["acme/status", "status", "Postgres"]);
});

test("one summary name wins; several share their leading words", () => {
  assert.deepEqual(suggestName({ aiNames: ["Room shell image matcher"], repos: ["sas70/roomgpt-shells-prod"] }), { name: "room-shell-image-matcher", source: "ai" });
  assert.deepEqual(suggestName({ aiNames: ["Client portal API", "Client portal front end"], repos: [] }), { name: "client-portal", source: "ai" });
});

test("falls back to repo names, then nothing", () => {
  assert.deepEqual(suggestName({ aiNames: [], repos: ["sas70/pinterest"] }), { name: "pinterest", source: "repo" });
  assert.deepEqual(suggestName({ aiNames: [], repos: ["studio/portal-web", "studio/portal-api"] }), { name: "portal", source: "repo" });
  assert.deepEqual(suggestName({ aiNames: ["Web app", "Data worker"], repos: [] }), { name: "web-app", source: "ai" });
  assert.equal(suggestName({ aiNames: [], repos: [] }), null);
});

test("suggestions don't collide with existing names or each other", () => {
  const rows = uniqueSuggestions([
    { name: "flask-starter-template", suggestion: { name: "flask-starter-template", source: "ai" } },
    { name: "industrious-simplicity", suggestion: { name: "flask-starter-template", source: "ai" } },
    { name: "foregoing-lace", suggestion: { name: "Flask-Starter-Template", source: "ai" } },
    { name: "lively-vision", suggestion: null },
  ]);
  assert.equal(rows[0].suggestion, null, "already named that");
  assert.equal(rows[1].suggestion.name, "flask-starter-template-2");
  assert.equal(rows[2].suggestion.name, "Flask-Starter-Template-3", "case-insensitive");
  assert.equal(rows[3].suggestion, null);
});

test("names follow the single-rename rules", () => {
  assert.equal(cleanProjectName("  room   shell  "), "room shell");
  assert.equal(cleanProjectName(""), null);
  assert.equal(cleanProjectName("x".repeat(64)), "x".repeat(64));
  assert.equal(cleanProjectName("x".repeat(65)), null);
  assert.equal(cleanProjectName("bad\u0007name"), null);
});
