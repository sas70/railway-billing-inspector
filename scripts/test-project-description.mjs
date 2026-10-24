import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

// Compile the pure text module with the project's TypeScript, like test-cost-history.mjs.
const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-description-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/project-description.ts", "--outDir", output, "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--strict"], { stdio: "inherit" });
const { DESCRIPTION_MAX, clipDescription, descriptionFromSummaries, normalizeDescription, sameDescription } = require(join(output, "project-description.js"));

const source = (repo, name, summary) => ({ repo, name, summary });

test("one repo: just its summary, ending with a period", () => {
  const { text, clipped } = descriptionFromSummaries([source("me/api", "Shop API", "  Serves the  catalog and checkout ")]);
  assert.equal(text, "Serves the catalog and checkout.");
  assert.equal(clipped, false);
});

test("several repos: name each one, skip empty and repeated summaries", () => {
  const { text } = descriptionFromSummaries([
    source("me/web", "Web app", "React front end."),
    source("me/api", "", "GraphQL API!"),
    source("me/copy", "Copy", "react front end."),
    source("me/empty", "Empty", "   "),
  ]);
  assert.equal(text, "Web app: React front end. me/api: GraphQL API!");
});

test("no summaries means no description", () => {
  assert.deepEqual(descriptionFromSummaries([]), { text: "", clipped: false });
  assert.deepEqual(descriptionFromSummaries([source("me/x", "X", " ")]), { text: "", clipped: false });
});

test("long text is cut at a word and stays within the limit", () => {
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const { text, clipped } = descriptionFromSummaries([source("me/x", "X", long)]);
  assert.equal(clipped, true);
  assert.ok(text.length <= DESCRIPTION_MAX, `length ${text.length}`);
  assert.ok(text.endsWith("…"));
  assert.ok(!/\s…$/.test(text));
  assert.equal(clipDescription("short"), "short");
  assert.equal(clipDescription("a".repeat(600), 100).length, 100);
});

test("comparisons ignore spacing and treat null as empty", () => {
  assert.equal(normalizeDescription(null), "");
  assert.equal(normalizeDescription("  a \n b "), "a b");
  assert.equal(sameDescription(null, "   "), true);
  assert.equal(sameDescription("Serves  the catalog.", "Serves the catalog."), true);
  assert.equal(sameDescription("a", "b"), false);
});
