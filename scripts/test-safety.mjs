import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, realpathSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve('src/lib');

// Run the actual TypeScript modules with isolated module/global state and injected I/O.
// Type correctness is checked separately by npm run typecheck.
function loader(stubs = {}, globals = {}, env = {}) {
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
    new Function('require', 'module', 'exports', 'globalThis', 'process', 'fetch', code)(
      localRequire, module, module.exports, globals, { env, cwd: () => process.cwd() },
      globals.fetch ?? (() => { throw new Error('Unexpected network access'); }),
    );
    return module.exports;
  }
  return (name) => load(path.join(root, name + '.ts'));
}

function approvalHarness() {
  const state = {
    project: { id: 'p1', name: 'original', workspace: { id: 'w1', name: 'Workspace' }, services: [], environments: [{ id: 'e1', name: 'Production' }] },
    instance: { healthInfo: { health: 'offline', liveDeploymentIds: [] }, latestDeployment: null },
    volume: { id: 'vi1', volume: { id: 'v1', name: 'data' }, serviceId: 's1', mountPath: '/data', currentSizeMB: 100, sizeMB: 1000 },
    readOnly: false, protected: false, auditFails: false, mutations: [], events: [], reads: [],
  };
  const account = { key: 'main', label: 'Main', token: 'test', workspaceId: 'w1' };
  const deployment = { id: 'd1', projectId: 'p1', serviceId: 's1', environmentId: 'e1', status: 'REMOVED', canRedeploy: true };
  const load = loader({
    [path.join(root, 'config.ts')]: {
      getAccount: () => account, isMockMode: () => false,
      isProtectedProject: () => state.protected,
      workspaceAllowed: (a, id) => !a.workspaceId || a.workspaceId === id,
    },
    [path.join(root, 'write-mode.ts')]: { isReadOnly: async () => state.readOnly },
    [path.join(root, 'audit.ts')]: {
      readAudit: async () => [],
      appendAudit: async (events) => { if (state.auditFails) throw new Error('Disk full'); state.events.push(...events); },
    },
    [path.join(root, 'railway/api.ts')]: {
      friendlyError: (e) => e.message,
      loadProject: async () => structuredClone(state.project),
      loadWorkspaceProjects: async () => [],
      loadEnvironment: async () => ({ id: 'e1', name: 'Production', volumes: [structuredClone(state.volume)], instances: [{ ...structuredClone(state.instance), serviceId: 's1', serviceName: 'Service' }] }),
      loadServiceInstance: async (...args) => { state.reads.push(args); return structuredClone(state.instance); },
      loadDeployment: async () => ({ ...deployment }),
    },
    [path.join(root, 'railway/client.ts')]: {
      clearCache: () => {},
      railwayRequest: async (a, doc, variables) => {
        if (doc.kind === 'query') return { volumeInstanceBackupList: [] };
        assert.equal(state.events.at(-1)?.outcome, 'started', 'audit must precede mutation');
        state.mutations.push({ doc, variables });
        return { volumeDelete: true, deploymentRedeploy: { id: 'new', status: 'BUILDING' }, projectUpdate: { id: 'p1', name: variables.input?.name } };
      },
    },
  });
  const bulk = load('bulk');
  const plans = load('plans');
  const createBulk = () => bulk.createBulkPlan({ mode: 'on', targets: [{ accountKey: 'main', projectId: 'p1', projectName: 'original', serviceId: 's1', serviceName: 'Service', environmentId: 'e1', latestId: 'd1' }] });
  const createRename = () => plans.createPlan({ kind: 'project.rename', accountKey: 'main', projectId: 'p1', targetIds: ['p1'], newName: 'proposed' });
  const createVolume = () => plans.createPlan({ kind: 'volume.delete', accountKey: 'main', projectId: 'p1', environmentId: 'e1', targetIds: ['v1'] });
  return { state, bulk, plans, createBulk, createRename, createVolume };
}

for (const health of ['live', 'sleeping', 'deploying']) {
  test(`bulk turn-on skips a service that became ${health} after review`, async () => {
    const h = approvalHarness();
    const plan = await h.createBulk();
    assert.equal(plan.runnableCount, 1);
    h.state.instance.healthInfo = { health, liveDeploymentIds: health === 'deploying' ? [] : ['newer'] };
    const result = await h.bulk.executeBulkPlan(plan.id, plan.phrase);
    assert.equal(result.skipped, 1);
    assert.equal(h.state.mutations.length, 0);
    assert.equal(h.state.reads.at(-1)[3].fresh, true);
  });
}

test('bulk review skips a service already deploying', async () => {
  const h = approvalHarness();
  h.state.instance.healthInfo = { health: 'deploying', liveDeploymentIds: [] };
  const plan = await h.createBulk();
  assert.equal(plan.runnableCount, 0);
  assert.ok(plan.blockedReason);
});

test('incorrect approval phrase does not consume the bulk plan', async () => {
  const h = approvalHarness();
  const plan = await h.createBulk();
  await assert.rejects(h.bulk.executeBulkPlan(plan.id, 'wrong'), /To approve/);
  assert.equal(h.state.mutations.length, 0);
  assert.equal((await h.bulk.executeBulkPlan(plan.id, plan.phrase)).succeeded, 1);
});

test('single rename skips a name changed after review' , async () => {
  const h = approvalHarness();
  const plan = await h.createRename();
  h.state.project.name = 'someone-elses-name';
  const result = await h.plans.executePlan(plan.id, '');
  assert.equal(result.skipped, 1);
  assert.equal(h.state.mutations.length, 0);
});

for (const engine of ['bulk', 'single']) {
  async function setup() {
    const h = approvalHarness();
    const plan = await (engine === 'bulk' ? h.createBulk() : h.createRename());
    const run = () => engine === 'bulk' ? h.bulk.executeBulkPlan(plan.id, plan.phrase) : h.plans.executePlan(plan.id, '');
    return { ...h, plan, run };
  }
  test(`${engine}: concurrent approval and replay execute at most once`, async () => {
    const h = await setup();
    const results = await Promise.allSettled([h.run(), h.run()]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(h.state.mutations.length, 1);
    await assert.rejects(h.run(), /expired|already used/);
  });
  test(`${engine}: expired plan cannot execute`, async () => {
    const h = await setup();
    const original = Date.now;
    try {
      Date.now = () => original() + 11 * 60_000;
      await assert.rejects(h.run(), /expired/);
      assert.equal(h.state.mutations.length, 0);
    } finally { Date.now = original; }
  });
  test(`${engine}: audit failure prevents a mutation`, async () => {
    const h = await setup();
    h.state.auditFails = true;
    const result = await h.run();
    assert.equal(result.auditWritten, false);
    assert.equal(h.state.mutations.length, 0);
  });
  test(`${engine}: changed workspace prevents a mutation`, async () => {
    const h = await setup();
    h.state.project.workspace.id = 'other';
    try { await h.run(); } catch (e) { assert.match(e.message, /workspace/); }
    assert.equal(h.state.mutations.length, 0);
  });
  test(`${engine}: read-only mode is checked again at execution`, async () => {
    const h = await setup();
    h.state.readOnly = true;
    await assert.rejects(h.run(), /Read-only/);
    assert.equal(h.state.mutations.length, 0);
  });
  test(`${engine}: protected project is checked again at execution`, async () => {
    const h = await setup();
    h.state.protected = true;
    try { await h.run(); } catch (e) { assert.match(e.message, /PROTECTED_PROJECTS/); }
    assert.equal(h.state.mutations.length, 0);
  });
}

test('saved Railway reads isolate tokens, workspace scope and query changes across restarts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rbi-cache-safety-'));
  let calls = 0;
  const stores = [];
  const client = () => {
    const globals = { fetch: async () => new Response(JSON.stringify({ data: { call: ++calls } }), { status: 200 }) };
    const load = loader({}, globals, { AUDIT_LOG_DIR: dir });
    const module = load('railway/client');
    stores.push(globals);
    return module;
  };
  try {
    const account = { key: 'main', label: 'Main', token: 'token-a' };
    const doc = { name: 'Projects', kind: 'query', query: 'query Projects { projects { id } }' };
    assert.equal((await client().railwayRequest(account, doc)).call, 1);
    const restarted = client();
    assert.equal((await restarted.railwayRequest(account, doc)).call, 1);
    assert.equal((await restarted.railwayRequest({ ...account, token: 'token-b' }, doc)).call, 2);
    assert.equal((await restarted.railwayRequest({ ...account, workspaceId: 'w1' }, doc)).call, 3);
    assert.equal((await restarted.railwayRequest(account, { ...doc, query: 'query Projects { projects { id name } }' })).call, 4);
    restarted.clearCache('main');
    assert.equal((await restarted.railwayRequest(account, doc)).call, 5);
    assert.equal(readFileSync(path.join(dir, 'railway-cache.sqlite')).includes(Buffer.from('token-a')), false);
  } finally {
    for (const store of stores) store.__rbiSaved?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('index excludes credentials, traversal and file/directory symlinks while keeping source files', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rbi-index-safety-'));
  const repo = path.join(dir, 'repo');
  mkdirSync(repo);
  const load = loader();
  const { isIndexableFile } = load('search-index/text');
  const { safeIndexFile } = load('search-index/safe-file');
  try {
    for (const file of ['.env', '.env.production', '.npmrc', '.netrc', 'credentials.json', 'secrets.yaml', '.aws/credentials', '.ssh/config', 'id_ed25519', 'private.pem', 'nested/.env.local']) {
      assert.equal(isIndexableFile(file), false, file);
    }
    writeFileSync(path.join(repo, 'app.ts'), 'export const value = 1;');
    writeFileSync(path.join(dir, 'outside.ts'), 'private content');
    symlinkSync(path.join(dir, 'outside.ts'), path.join(repo, 'linked.ts'));
    symlinkSync(dir, path.join(repo, 'linked-dir'));
    assert.equal(await safeIndexFile(repo, 'app.ts'), realpathSync(path.join(repo, 'app.ts')));
    assert.equal(await safeIndexFile(repo, '../outside.ts'), null);
    assert.equal(await safeIndexFile(repo, 'linked.ts'), null);
    assert.equal(await safeIndexFile(repo, 'linked-dir/outside.ts'), null);
    assert.equal(await safeIndexFile(repo, path.join(dir, 'outside.ts')), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const change of ['live', 'sleeping', 'deploying', 'attachment', 'mount', 'instance']) {
  test(`volume deletion skips changed ${change} after review`, async () => {
    const h = approvalHarness();
    const plan = await h.createVolume();
    assert.equal(plan.runnableCount, 1);
    if (change === 'attachment') h.state.volume.serviceId = 'other';
    else if (change === 'mount') h.state.volume.mountPath = '/other';
    else if (change === 'instance') h.state.volume.id = 'replacement';
    else h.state.instance.healthInfo.health = change;
    const result = await h.plans.executePlan(plan.id, plan.phrase);
    assert.equal(result.skipped, 1);
    assert.equal(h.state.mutations.length, 0);
  });
}

test('unchanged volume deletion succeeds with audit before mutation', async () => {
  const h = approvalHarness();
  const plan = await h.createVolume();
  assert.equal((await h.plans.executePlan(plan.id, plan.phrase)).succeeded, 1);
  assert.equal(h.state.mutations.length, 1);
});

for (const scope of ['wrong-workspace', 'unknown-workspace', 'wrong-environment', 'allowed']) {
  test(`volume explanation enforces scope: ${scope}`, async () => {
    let environmentReads = 0;
    const load = loader({
      [path.join(root, 'plans.ts')]: { UserFacingError: class extends Error {} },
      [path.join(root, 'config.ts')]: {
        getAccount: () => ({ workspaceId: 'w1' }), isMockMode: () => true,
        workspaceAllowed: (a, id) => a.workspaceId === id,
      },
      [path.join(root, 'code/ai-summary.ts')]: { aiSummariesAvailable: () => true },
      [path.join(root, 'railway/api.ts')]: {
        loadProject: async (a, id, opts) => {
          assert.equal(opts.fresh, true);
          return { id: 'p1', workspace: scope === 'unknown-workspace' ? null : { id: scope === 'wrong-workspace' ? 'w2' : 'w1' }, environments: [{ id: 'e1' }] };
        },
        loadEnvironment: async (a, p, e, opts) => {
          environmentReads++;
          assert.equal(opts.fresh, true);
          return { instances: [], volumes: [{ volume: { id: 'v1' }, mountPath: '/data', currentSizeMB: 100 }] };
        },
      },
    });
    const request = { accountKey: 'main', projectId: 'p1', environmentId: scope === 'wrong-environment' ? 'e2' : 'e1', volumeId: 'v1' };
    const explain = load('volume-insight').explainVolume;
    if (scope === 'allowed') {
      assert.equal((await explain(request)).volumeId, 'v1');
      assert.equal(environmentReads, 1);
    } else {
      await assert.rejects(explain(request), /workspace|environment/);
      assert.equal(environmentReads, 0, 'reject before gathering volume or code context');
    }
  });
}

for (const missing of ['usage', 'recent', 'projects', 'account', 'none']) {
  test(`chat snapshot preserves missing ${missing} data`, async () => {
    const ok = (value) => ({ ok: true, value });
    const failed = { ok: false, error: 'unavailable' };
    const project = { id: 'p1', name: 'test-project', repos: [], health: { live: 0, sleeping: 0, crashed: 0, failed: 0, degraded: 0 }, environments: [], serviceCount: 1 };
    const bundle = { account: { key: 'main' }, workspace: { name: 'Work' }, projects: missing === 'projects' ? failed : ok([project]), usage: missing === 'usage' ? failed : ok({}), recent: missing === 'recent' ? failed : ok({}) };
    const load = loader({
      [path.join(root, 'config.ts')]: { isProtectedProject: () => false },
      [path.join(root, 'code/ai-summary.ts')]: { savedSummaries: async () => new Map() },
      [path.join(root, 'code/sources.ts')]: { repoKey: (r) => r },
      [path.join(root, 'railway/api.ts')]: {
        loadAccountViews: async () => [{ label: 'Main', error: missing === 'account' ? 'unavailable' : null }],
        uniqueWorkspaceTargets: () => missing === 'account' ? [] : [{ account: {}, workspace: {} }],
        loadWorkspaceBundle: async () => bundle,
      },
      [path.join(root, 'summaries.ts')]: {
        workspaceFigures: () => ({ usageByProject: new Map(), usageToDate: null }),
        billStructure: () => ({ charging: { projects: 0, perDay: 0 } }),
        stoppedBillingSummary: () => ({ services: 0, perDay: null }),
      },
    });
    const snapshot = await load('chat/context').chatSnapshot();
    assert.equal(snapshot.dataIssues.length > 0, missing !== 'none');
    if (missing === 'usage') assert.equal(snapshot.projects[0].costThisPeriod, null);
    if (missing === 'recent') assert.equal(snapshot.projects[0].status, 'unknown');
    if (missing === 'none') assert.equal(snapshot.projects[0].costThisPeriod, 0);
    const answer = load('chat/built-in').builtInAnswer(snapshot, 'what costs money?', { demo: true });
    if (missing !== 'none') {
      assert.match(answer, /incomplete/);
      assert.doesNotMatch(answer, /Nothing has cost anything/);
    } else assert.match(answer, /Nothing has cost anything/);
  });
}
