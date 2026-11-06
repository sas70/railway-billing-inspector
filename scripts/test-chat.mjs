import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), "railway-chat-test-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/lib/chat/built-in.ts", "src/lib/chat/messages.ts", "--outDir", output, "--rootDir", "src", "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--strict"], { stdio: "inherit" });
const { builtInAnswer, findProject } = require(join(output, "lib", "chat", "built-in.js"));
const { parseMessages } = require(join(output, "lib", "chat", "messages.js"));

const project = (name, extra = {}) => ({
  name, href: `/a/main/p/${name}`, workspace: "Personal", about: null, repos: [], services: 1, live: 0, sleeping: 0, attention: 0,
  status: "stopped", costThisPeriod: 0, costPerDayRecent: 0, biggestCost: null, stoppedButBilled: [], stoppedHref: null,
  randomName: false, protected: false, lastDeployAt: null, ...extra,
});
const snapshot = {
  dataIssues: [],
  projects: [
    project("heroic-contentment", { status: "charging", costThisPeriod: 1.06, costPerDayRecent: 0.035, biggestCost: "memory", stoppedButBilled: ["chart_all"], stoppedHref: "/a/main/p/heroic-contentment/s/svc?env=e", randomName: true }),
    project("upwork-proposals", { status: "running", live: 1, costThisPeriod: 1.24 }),
    project("banking", { attention: 1 }),
  ],
  workspaces: [{ workspace: "Personal", usageSoFar: 8.44, projected: 66.73 }],
  offStillCharging: { projects: 1, perDay: 0.035 },
  stoppedBilling: { services: 1, perDay: 0.035 },
};

test("a project named in the question gets its own answer with a link", () => {
  const a = builtInAnswer(snapshot, "what is heroic-contentment doing?", { demo: true });
  assert.match(a, /\*\*heroic-contentment\*\*/);
  assert.match(a, /\[remove the stopped deployment\]\(\/a\/main\/p\/heroic-contentment\/s\/svc\?env=e\)/);
  assert.match(a, /\[rename it\]\(\/rename\)/);
});

test("charging questions list what's still charging and link the bill list", () => {
  const a = builtInAnswer(snapshot, "what is still charging me?", { demo: false });
  assert.match(a, /heroic-contentment/);
  assert.match(a, /\(\/#still-on-bill\)/);
});

test("stopped, attention and rename questions link the right screens", () => {
  assert.match(builtInAnswer(snapshot, "any stopped deployments?", { demo: true }), /\(\/services\?show=stopped\)/);
  assert.match(builtInAnswer(snapshot, "what crashed?", { demo: true }), /\(\/services\?show=attention\)/);
  assert.match(builtInAnswer(snapshot, "which can I rename?", { demo: true }), /\(\/rename\)/);
});

test("anything else gets a short help answer", () => {
  assert.match(builtInAnswer(snapshot, "tell me a joke", { demo: true }), /I can answer questions about your Railway projects/);
});

test("the longest matching project name wins", () => {
  const s = { ...snapshot, projects: [project("pdf"), project("pdf-splitter")] };
  assert.equal(findProject(s, "about pdf-splitter").name, "pdf-splitter");
});

test("messages are trimmed to the last turns and must end with the user", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  many.push({ role: "user", content: "x".repeat(5000) });
  const out = parseMessages(many);
  assert.ok(out.length <= 12);
  assert.equal(out[0].role, "user");
  assert.equal(out.at(-1).content.length, 1500);
  assert.throws(() => parseMessages([{ role: "assistant", content: "hi" }]));
  assert.throws(() => parseMessages([{ role: "system", content: "hi" }]));
});

test("'still charging' leads with the charging list", () => {
  const a = builtInAnswer(snapshot, "what's still charging me?", { demo: true });
  assert.ok(a.indexOf("nothing running still charge") < a.indexOf("Biggest costs"));
});

test("unavailable project costs and recent charges are never described as zero", () => {
  const s = { ...snapshot, dataIssues: ["Personal: project costs unavailable.", "Personal: recent charges unavailable."], projects: [project("example", { costThisPeriod: null, costPerDayRecent: null, status: "unknown" })] };
  const a = builtInAnswer(s, "what about example?", { demo: false });
  assert.match(a, /Cost this period: unavailable/);
  assert.match(a, /recent charges unavailable/);
  assert.doesNotMatch(a, /no recent charges|\$0.00/);
});
