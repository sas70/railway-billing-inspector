import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Workspace usage limits: Railway's rules (limit-rules.ts) and the review → approve → audit engine
// (limits.ts), run as real TypeScript with Railway, the audit log and settings stubbed (like test-safety.mjs).

const require = createRequire(import.meta.url);
const root = path.resolve('src/lib');

function loader(stubs = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (Object.hasOwn(stubs, file)) return stubs[file];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    function localRequire(name) {
      if (name === 'server-only') return {};
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
      return require(name);
    }
    new Function('require', 'module', 'exports', 'globalThis', code)(localRequire, module, module.exports, {});
    return module.exports;
  }
  return (name) => load(path.join(root, name + '.ts'));
}

const rules = loader()('limit-rules');

// ── Rules ───────────────────────────────────────────────────────────────────

test('amounts parse like the Railway CLI: dollars with up to two decimals', () => {
  assert.deepEqual(rules.parseAmountCents(''), { ok: true, value: null });
  assert.deepEqual(rules.parseAmountCents(' $1,250 '), { ok: true, value: 125000 });
  assert.deepEqual(rules.parseAmountCents('7.5'), { ok: true, value: 750 });
  assert.deepEqual(rules.parseAmountCents('.25'), { ok: true, value: 25 });
  for (const bad of ['-5', '1.234', 'ten', '5e3', '1.2.3']) assert.equal(rules.parseAmountCents(bad).ok, false, bad);
  assert.equal(rules.parseAmountCents('500001').ok, false);
});

test('compute limits: whole dollars, alert $5+, hard $10+, hard at least the alert, blank = none', () => {
  assert.deepEqual(rules.computeFromText('', '15'), { ok: true, value: { alert: null, hard: 15 } });
  assert.deepEqual(rules.computeFromText('0', ''), { ok: true, value: { alert: null, hard: null } });
  assert.deepEqual(rules.computeFromText('8', '10'), { ok: true, value: { alert: 8, hard: 10 } });
  assert.match(rules.computeFromText('4', '').error, /\$5/);
  assert.match(rules.computeFromText('', '9').error, /\$10/);
  assert.match(rules.computeFromText('20', '10').error, /at least the email alert/);
  assert.match(rules.computeFromText('', '10.50').error, /whole dollars/);
  assert.match(rules.computeFromText('', '0').error, /blank/);
  assert.equal(rules.validateCompute({ alert: 5, hard: 10 }), null);
  assert.ok(rules.validateCompute({ alert: null, hard: 10.5 }));
});

test('agent limits: cents, hard limit required (0 blocks), alert at most the hard limit', () => {
  assert.deepEqual(rules.agentFromText('5', '7.50'), { ok: true, value: { alertCents: 500, hardCents: 750 } });
  assert.deepEqual(rules.agentFromText('', '0'), { ok: true, value: { alertCents: null, hardCents: 0 } });
  assert.deepEqual(rules.agentFromText('0', '20'), { ok: true, value: { alertCents: null, hardCents: 2000 } });
  assert.match(rules.agentFromText('5', '').error, /can't be removed/);
  assert.match(rules.agentFromText('10', '5').error, /at least its email alert/);
});

test('what is sent: both values every time, no hard limit is null, never a $0 compute hard limit', () => {
  assert.deepEqual(rules.computeMutation('cus', { alert: null, hard: null }), { op: 'remove', input: { customerId: 'cus' } });
  assert.deepEqual(rules.computeMutation('cus', { alert: null, hard: 15 }), { op: 'set', input: { customerId: 'cus', softLimitDollars: 0, hardLimitDollars: 15 } });
  assert.deepEqual(rules.computeMutation('cus', { alert: 8, hard: null }), { op: 'set', input: { customerId: 'cus', softLimitDollars: 8, hardLimitDollars: null } });
  assert.throws(() => rules.computeMutation('cus', { alert: null, hard: 0 }), /\$0/);
  assert.deepEqual(rules.agentMutationInput('ws', { alertCents: null, hardCents: 700 }), { workspaceId: 'ws', hardLimitCents: 700, softLimitCents: 0 });
});

test("Railway's usageLimit maps to alert/hard (softLimit 0 and null mean none)", () => {
  assert.deepEqual(rules.computeFromRailway(null), { alert: null, hard: null });
  assert.deepEqual(rules.computeFromRailway({ softLimit: 0, hardLimit: 10 }), { alert: null, hard: 10 });
  assert.deepEqual(rules.computeFromRailway({ softLimit: 8, hardLimit: null }), { alert: 8, hard: null });
});

// The workspace in the screenshots: $7.54 used, $8.45 projected, $10 hard limit.
const roomgpt = { usage: 7.54, projected: 8.45 };
const tenCap = { alert: null, hard: 10 };

test('raising a hard limit above the projected bill needs only a confirm click', () => {
  const a = rules.assessCompute(tenCap, { alert: null, hard: 15 }, roomgpt);
  assert.equal(a.phrase, null);
  assert.ok(!a.flags.some((f) => f.tone === 'danger'));
});

test('a hard limit at or below usage or the projected bill needs a typed phrase', () => {
  const belowUsage = rules.assessCompute(tenCap, { alert: null, hard: 7 }, roomgpt);
  assert.equal(belowUsage.phrase, 'SET HARD LIMIT $7');
  assert.match(belowUsage.flags[0].text, /usage so far/);
  const belowProjection = rules.assessCompute({ alert: null, hard: 20 }, { alert: null, hard: 8 }, roomgpt);
  assert.equal(belowProjection.phrase, 'SET HARD LIMIT $8');
  assert.match(belowProjection.flags[0].text, /projected bill/);
});

test('removing the hard limit needs a typed phrase; changing only the alert never does', () => {
  assert.equal(rules.assessCompute(tenCap, { alert: 5, hard: null }, roomgpt).phrase, 'REMOVE HARD LIMIT');
  assert.equal(rules.assessCompute(tenCap, { alert: null, hard: null }, roomgpt).phrase, 'REMOVE HARD LIMIT');
  const alertOnly = rules.assessCompute({ alert: null, hard: 8 }, { alert: 5, hard: 8 }, roomgpt);
  assert.equal(alertOnly.phrase, null);
  assert.ok(alertOnly.flags.some((f) => /already above/.test(f.text)), 'still warns that the bill is past the cap');
});

test('unknown projection: lowering or adding a hard limit asks for the phrase, raising does not', () => {
  const unknown = { usage: 7.54, projected: null };
  assert.equal(rules.assessCompute(tenCap, { alert: null, hard: 12 }, unknown).phrase, null);
  assert.equal(rules.assessCompute({ alert: null, hard: 50 }, { alert: null, hard: 12 }, unknown).phrase, 'SET HARD LIMIT $12');
  assert.equal(rules.assessCompute({ alert: null, hard: null }, { alert: null, hard: 12 }, unknown).phrase, 'SET HARD LIMIT $12');
});

test('a hard limit with under 15% headroom over the projection gets a warning, not a phrase', () => {
  const a = rules.assessCompute({ alert: null, hard: 20 }, { alert: null, hard: 9 }, roomgpt);
  assert.equal(a.phrase, null);
  assert.ok(a.flags.some((f) => f.tone === 'warning' && /15%/.test(f.text)));
});

test('agent changes never need a phrase but warn when they pause the agent', () => {
  assert.ok(rules.assessAgent({ alertCents: null, hardCents: 700 }, { alertCents: null, hardCents: 0 }, 0).some((f) => /Blocks/.test(f.text)));
  assert.ok(rules.assessAgent({ alertCents: null, hardCents: 700 }, { alertCents: null, hardCents: 300 }, 312).some((f) => /pauses/.test(f.text)));
  assert.deepEqual(rules.assessAgent({ alertCents: null, hardCents: 700 }, { alertCents: null, hardCents: 2000 }, 312), []);
});

test('status and suggested hard limit', () => {
  assert.equal(rules.computeStatus(tenCap, roomgpt, false), 'near');
  assert.equal(rules.computeStatus({ alert: null, hard: 8 }, roomgpt, false), 'projected-over');
  assert.equal(rules.computeStatus({ alert: null, hard: 7 }, roomgpt, false), 'at-limit');
  assert.equal(rules.computeStatus({ alert: null, hard: 50 }, roomgpt, true), 'at-limit');
  assert.equal(rules.computeStatus({ alert: 5, hard: null }, roomgpt, false), 'no-cap');
  assert.equal(rules.computeStatus({ alert: null, hard: 50 }, roomgpt, false), 'ok');
  assert.equal(rules.suggestHardLimit(roomgpt), 15);
  assert.equal(rules.suggestHardLimit({ usage: 0, projected: 0 }), 10);
  assert.equal(rules.suggestHardLimit({ usage: null, projected: null }), null);
});

// ── Engine ──────────────────────────────────────────────────────────────────

class UserFacingError extends Error {}

function harness() {
  const state = {
    usageLimit: { softLimit: 0, hardLimit: 10, isOverLimit: false },
    agent: { usedCents: 0, softCents: null, hardCents: 700, custom: true },
    usage: 7.54, metered: 7.54, estimated: 8.45,
    readOnly: false, auditFails: false, applyMutations: true, mutations: [], events: [],
  };
  const account = { key: 'main', label: 'Main', token: 't' };
  const billing = () => ({
    customerId: 'cus1', workspaceName: 'roomgpt2', plan: 'PRO', currentUsage: state.usage,
    period: { start: '2026-10-17T00:00:00Z', end: '2026-11-17T00:00:00Z' },
    usageLimit: state.usageLimit ? structuredClone(state.usageLimit) : null,
  });
  const load = loader({
    [path.join(root, 'config.ts')]: { getAccount: (k) => (k === 'main' ? account : undefined), isMockMode: () => false, workspaceAllowed: (_a, id) => id === 'w1' },
    [path.join(root, 'write-mode.ts')]: { isReadOnly: async () => state.readOnly },
    [path.join(root, 'plans.ts')]: { UserFacingError },
    [path.join(root, 'audit.ts')]: {
      appendAudit: async (events) => { if (state.auditFails) throw new Error('Disk full'); state.events.push(...events); },
    },
    [path.join(root, 'railway/api.ts')]: {
      friendlyError: (e) => e.message,
      settle: async (p) => { try { return { ok: true, value: await p }; } catch (e) { return { ok: false, error: e.message }; } },
      loadWorkspaceBilling: async (_a, id, opts) => { assert.equal(id, 'w1'); assert.equal(opts?.fresh, true, 'limits are always read fresh'); return billing(); },
      loadWorkspaceUsage: async () => ({ total: { total: state.metered } }),
      loadWorkspaceEstimates: async () => ({ total: { total: state.estimated } }),
      loadAgentUsage: async () => structuredClone(state.agent),
    },
    [path.join(root, 'railway/client.ts')]: {
      clearCache: () => {},
      railwayRequest: async (_a, doc, variables) => {
        assert.equal(doc.kind, 'mutation');
        assert.equal(state.events.at(-1)?.outcome, 'started', 'the audit line must come before the change');
        state.mutations.push({ name: doc.name, input: variables.input });
        const i = variables.input;
        if (state.applyMutations) {
          if (doc.name === 'UsageLimitSet') state.usageLimit = { softLimit: i.softLimitDollars, hardLimit: i.hardLimitDollars, isOverLimit: false };
          if (doc.name === 'UsageLimitRemove') state.usageLimit = null;
          if (doc.name === 'AgentUsageLimitSet') state.agent = { ...state.agent, hardCents: i.hardLimitCents, softCents: i.softLimitCents || null };
        }
        return { usageLimitSet: true, usageLimitRemove: true, agentUsageLimitSet: true };
      },
    },
  });
  const limits = load('limits');
  const create = (change) => limits.createLimitPlan({ accountKey: 'main', workspaceId: 'w1', ...change });
  return { state, limits, create, run: (plan, phrase = '') => limits.executeLimitPlan(plan.id, phrase) };
}

test('raise $10 → $15: one confirm, sent as a full set, logged, then read back', async () => {
  const h = harness();
  const plan = await h.create({ compute: { alert: null, hard: 15 } });
  assert.equal(plan.requiresPhrase, false);
  assert.equal(plan.runnableCount, 1);
  assert.match(plan.impact[0], /whole roomgpt2 workspace/);
  const result = await h.run(plan);
  assert.equal(result.succeeded, 1);
  assert.deepEqual(h.state.mutations, [{ name: 'UsageLimitSet', input: { customerId: 'cus1', softLimitDollars: 0, hardLimitDollars: 15 } }]);
  assert.deepEqual(h.state.events.map((e) => [e.kind, e.outcome]), [['workspace.usageLimit', 'started'], ['workspace.usageLimit', 'success']]);
  assert.equal(h.state.events[0].approvedWith, 'confirm button');
  assert.equal(h.state.events[0].projectId, '');
});

test('lowering below the projected bill needs the exact phrase; a wrong one keeps the review', async () => {
  const h = harness();
  Object.assign(h.state, { usageLimit: { softLimit: 0, hardLimit: 25, isOverLimit: false }, usage: 9, metered: 9, estimated: 12 });
  const plan = await h.create({ compute: { alert: null, hard: 11 } });
  assert.equal(plan.phrase, 'SET HARD LIMIT $11');
  await assert.rejects(h.run(plan, 'yes'), /To approve, type SET HARD LIMIT \$11/);
  assert.equal(h.state.mutations.length, 0);
  const result = await h.run(plan, '  SET HARD LIMIT   $11 ');
  assert.equal(result.succeeded, 1);
  assert.equal(h.state.events[0].approvedWith, 'SET HARD LIMIT $11');
});

test('clearing every compute limit uses usageLimitRemove behind REMOVE HARD LIMIT', async () => {
  const h = harness();
  const plan = await h.create({ compute: { alert: null, hard: null } });
  assert.equal(plan.phrase, 'REMOVE HARD LIMIT');
  const result = await h.run(plan, 'REMOVE HARD LIMIT');
  assert.equal(result.succeeded, 1);
  assert.deepEqual(h.state.mutations.map((m) => m.name), ['UsageLimitRemove']);
});

test('agent limit: alert cleared with 0, no phrase even when blocking the agent', async () => {
  const h = harness();
  h.state.agent.softCents = 500;
  const plan = await h.create({ agent: { alertCents: null, hardCents: 0 } });
  assert.equal(plan.requiresPhrase, false);
  assert.ok(plan.items[0].flags.some((f) => /Blocks/.test(f.text)));
  const result = await h.run(plan);
  assert.equal(result.succeeded, 1);
  assert.deepEqual(h.state.mutations, [{ name: 'AgentUsageLimitSet', input: { workspaceId: 'w1', hardLimitCents: 0, softLimitCents: 0 } }]);
  assert.equal(h.state.events.at(-1).kind, 'workspace.agentLimit');
});

test('no change → blocked; invalid requests are refused before Railway is read', async () => {
  const h = harness();
  const same = await h.create({ compute: { alert: null, hard: 10 } });
  assert.ok(same.blockedReason);
  await assert.rejects(h.run(same), /Nothing to change/);
  await assert.rejects(h.create({ compute: { alert: null, hard: 5 } }), /\$10/);
  await assert.rejects(h.create({ compute: { alert: 20, hard: 10 } }), /at least the email alert/);
  await assert.rejects(h.create({ agent: { alertCents: null } }), /Invalid agent limit/);
  await assert.rejects(h.create({}), /Nothing to change/);
  await assert.rejects(h.limits.createLimitPlan({ accountKey: 'main', workspaceId: 'w2', compute: { alert: null, hard: 20 } }), /different workspace/);
  assert.equal(h.state.mutations.length, 0);
});

test('read-only mode blocks both review and approval', async () => {
  const h = harness();
  const plan = await h.create({ compute: { alert: null, hard: 15 } });
  h.state.readOnly = true;
  await assert.rejects(h.run(plan), /Read-only/);
  await assert.rejects(h.create({ compute: { alert: null, hard: 15 } }), /Read-only/);
  assert.equal(h.state.mutations.length, 0);
});

test('limits changed on Railway after the review → skipped', async () => {
  const h = harness();
  const plan = await h.create({ compute: { alert: null, hard: 15 } });
  h.state.usageLimit = { softLimit: 0, hardLimit: 25, isOverLimit: false };
  const result = await h.run(plan);
  assert.equal(result.skipped, 1);
  assert.match(result.results[0].message, /changed after you reviewed/);
  assert.equal(h.state.mutations.length, 0);
});

test('usage grew after the review so the change could now stop services → skipped', async () => {
  const h = harness();
  const plan = await h.create({ compute: { alert: null, hard: 15 } });
  assert.equal(plan.requiresPhrase, false);
  h.state.usage = 12; h.state.metered = 12; h.state.estimated = 16;
  const result = await h.run(plan);
  assert.equal(result.skipped, 1);
  assert.match(result.results[0].message, /Review it again/);
  assert.equal(h.state.mutations.length, 0);
});

test('a plan runs at most once, and not after it expires', async () => {
  const h = harness();
  const plan = await h.create({ compute: { alert: null, hard: 15 } });
  const results = await Promise.allSettled([h.run(plan), h.run(plan)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(h.state.mutations.length, 1);
  await assert.rejects(h.run(plan), /expired|already used/);

  const later = await h.create({ compute: { alert: null, hard: 20 } });
  const original = Date.now;
  try {
    Date.now = () => original() + 11 * 60_000;
    await assert.rejects(h.run(later), /expired/);
  } finally {
    Date.now = original;
  }
  assert.equal(h.state.mutations.length, 1);
});

test('no audit line, no change', async () => {
  const h = harness();
  const plan = await h.create({ compute: { alert: null, hard: 15 } });
  h.state.auditFails = true;
  const result = await h.run(plan);
  assert.equal(result.auditWritten, false);
  assert.equal(h.state.mutations.length, 0);
});

test('success is only reported when Railway shows the new values', async () => {
  const h = harness();
  h.state.applyMutations = false;
  const plan = await h.create({ compute: { alert: 5, hard: 15 } });
  const result = await h.run(plan);
  assert.equal(result.succeeded, 0);
  assert.equal(result.unknown, 1);
  assert.match(result.results[0].message, /now shows/);
});
