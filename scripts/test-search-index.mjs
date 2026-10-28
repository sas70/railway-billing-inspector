import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

// Compile the pure helpers with the project's TypeScript, like the other tests.
const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-index-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/search-index/text.ts", "--outDir", output, "--module", "commonjs", "--target", "es2022", "--skipLibCheck", "--strict"], { stdio: "inherit" });
const { chunkLines, dot, ftsExpression, fuseRankings, isIndexableFile, linesWithTerms, queryTerms, textHash, wordForms } = require(join(output, "text.js"));

test("indexes source and docs, skips binaries, lockfiles, vendored and huge files", () => {
  for (const p of ["src/app.py", "README.md", "app/page.tsx", "Dockerfile", "requirements.txt", "docs/guide.md"]) assert.equal(isIndexableFile(p), true, p);
  for (const p of ["node_modules/x/index.js", "package-lock.json", "yarn.lock", "public/logo.png", "dist/app.js", "model.onnx", "data/rows.csv", "app.min.js", "venv/lib/x.py", ".railway-inspector/summary.json"]) {
    assert.equal(isIndexableFile(p), false, p);
  }
  assert.equal(isIndexableFile("src/big.ts", 300 * 1024), false);
});

test("chunks keep line numbers and drop blank chunks", () => {
  const text = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n");
  const chunks = chunkLines(text, 50);
  assert.deepEqual(chunks.map((c) => c.line), [1, 51, 101]);
  assert.ok(chunks[1].body.startsWith("line 51"));
  assert.deepEqual(chunkLines("\n\n\n", 2), []);
});

test("query terms: words and quoted phrases, lower-cased, operators stripped", () => {
  assert.deepEqual(queryTerms('Stripe "bank reconciliation" OPENAI_API_KEY'), ["stripe", "bank reconciliation", "openai api key"]);
  assert.deepEqual(queryTerms("  "), []);
  assert.deepEqual(queryTerms('AND OR NOT "*" segment*'), ["and", "or", "not", "segment"]);
});

test("FTS expressions: prefix on the last token, NEAR for phrases, safe quoting", () => {
  assert.equal(ftsExpression("segment"), '"segment"*');
  assert.equal(ftsExpression("ai"), '"ai"');
  assert.equal(ftsExpression("bank reconciliation"), 'NEAR("bank" "reconciliation"*, 2)');
  assert.equal(ftsExpression(""), null);
});

test("reciprocal-rank fusion rewards items ranked well in both lists", () => {
  const fused = fuseRankings([["a", "b", "c"], ["c", "a"]]);
  assert.equal(fused[0].id, "a");
  assert.deepEqual(fused.map((x) => x.id).sort(), ["a", "b", "c"]);
  assert.ok(fused.find((x) => x.id === "c").score > fused.find((x) => x.id === "b").score);
});

test("dot product of normalized vectors is cosine similarity", () => {
  const a = new Float32Array([0.6, 0.8]);
  assert.ok(Math.abs(dot(a, a) - 1) < 1e-6);
  assert.ok(Math.abs(dot(a, new Float32Array([0.8, -0.6]))) < 1e-6);
});

test("lines with terms carry real line numbers and trim long lines", () => {
  const hits = linesWithTerms("import x\nconst stripe = new Stripe()\nfoo\nstripe.charge()", ["stripe"], 2, 41);
  assert.deepEqual(hits.map((h) => h.line), [42, 44]);
  const long = linesWithTerms(`${"a".repeat(300)} target ${"b".repeat(300)}`, ["target"], 1)[0].text;
  assert.ok(long.startsWith("…") && long.endsWith("…") && long.includes("target"));
});

test("text hash changes with the text", () => {
  assert.equal(textHash("abc"), textHash("abc"));
  assert.notEqual(textHash("abc"), textHash("abd"));
});

test("word forms find the line a stemmed match came from", () => {
  assert.deepEqual(wordForms("segmentation"), ["segmentation", "segment"]);
  assert.deepEqual(wordForms("invoices"), ["invoices", "invoic"]);
  assert.deepEqual(wordForms("api"), ["api"]);
  assert.deepEqual(linesWithTerms("a\nconst payment = charge()\nb", ["payments"], 1).map((h) => h.line), [2]);
});
