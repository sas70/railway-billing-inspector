import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Background refresh (railway/client.ts): pages keep the saved copy while a refresh renders them
// again, then the refresh's reads swap in at once. Runs the real module with Railway (fetch),
// the disk store, demo mode and Next's request headers stood in for.

const require = createRequire(import.meta.url);
const root = path.resolve('src/lib');

function harness({ mock = false } = {}) {
  const state = { header: null, calls: [], reply: () => ({ data: { n: state.calls.length } }), fail: null, disk: new Map(), swaps: [] };
  class SavedReads {
    get(key) { return state.disk.get(key) ?? null; }
    set(key, _account, data, fetchedAt) { state.disk.set(key, { fetchedAt, data }); }
    swap(entries, replace) { state.swaps.push({ n: entries.length, replace }); if (replace) state.disk.clear(); for (const e of entries) state.disk.set(e.key, { fetchedAt: e.fetchedAt, data: e.data }); }
    clear() { state.disk.clear(); }
    oldest() { let t = null; for (const v of state.disk.values()) if (t == null || v.fetchedAt < t) t = v.fetchedAt; return t; }
  }
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    state.calls.push(body.operationName);
    if (state.fail === 'network') throw new Error('socket hang up');
    const payload = state.fail === 'query' ? { errors: [{ message: 'This usage query is too broad' }] } : state.reply(body);
    return { status: 200, ok: true, headers: new Headers(), text: async () => JSON.stringify(payload) };
  };
  const stubs = {
    [path.join(root, 'config.ts')]: { isMockMode: () => mock },
    [path.join(root, 'railway/mock.ts')]: { mockRequest: async () => ({ mock: true }) },
    [path.join(root, 'railway/saved-reads.ts')]: { SavedReads },
    [path.join(root, 'railway/refresh-context.ts')]: { requestRefreshId: async () => state.header },
  };
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
    const localRequire = (name) => (name === 'server-only' ? {} : name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name));
    new Function('require', 'module', 'exports', 'globalThis', 'process', 'fetch', code)(
      localRequire, module, module.exports, {}, { env: { AUDIT_LOG_DIR: '/tmp/rbi-test' }, cwd: () => process.cwd() }, fetch,
    );
    return module.exports;
  }
  const client = load(path.join(root, 'railway/client.ts'));
  const account = { key: 'main', label: 'Main', token: 't' };
  const doc = (name) => ({ name, kind: 'query', query: `query ${name} { x }` });
  const read = (name, vars = {}) => client.railwayRequest(account, doc(name), vars);
  // As a page rendered for the refresh would read (the browser sends the refresh id in a header).
  const readForRefresh = async (id, name, vars = {}) => {
    state.header = id;
    try { return await read(name, vars); } finally { state.header = null; }
  };
  return { state, client, read, readForRefresh, mutate: () => client.railwayRequest(account, { name: 'M', kind: 'mutation', query: 'mutation M { x }' }, {}) };
}

test('during a refresh, pages keep the saved copy; the refresh reads Railway on the side', async () => {
  const h = harness();
  const before = await h.read('Projects');
  const { id } = h.client.beginRefresh();
  const fresh = await h.readForRefresh(id, 'Projects');
  assert.notDeepEqual(fresh, before);
  assert.deepEqual(await h.read('Projects'), before, 'everyone else still gets the saved copy');
  assert.equal(h.state.calls.length, 2);
});

test('a clean refresh replaces the saved copy, stamped with its start, so windows line up', async () => {
  const h = harness();
  await h.read('Projects');
  await h.read('OldProjectPage');
  const { id, startedAt } = h.client.beginRefresh(Date.now());
  h.state.header = id;
  assert.equal(await h.client.dataClock(), startedAt, 'pages rendered for the refresh anchor windows to its start');
  h.state.header = null;
  const fresh = await h.readForRefresh(id, 'Projects');
  const outcome = h.client.finishRefresh(id);
  assert.deepEqual(outcome, { swapped: true, replaced: true, reads: 1, failed: 0 });
  assert.deepEqual(await h.read('Projects'), fresh, 'pages now get the new read, without asking Railway again');
  assert.equal(h.state.calls.length, 3);
  assert.equal(h.client.oldestCachedAt(), startedAt);
  assert.equal(await h.client.dataClock(), startedAt);
  await h.read('OldProjectPage');
  assert.equal(h.state.calls.length, 4, 'a page the refresh did not render is read again when opened');
  assert.deepEqual(h.state.swaps, [{ n: 1, replace: true }]);
});

test('a refresh with a network failure keeps the rest of the saved copy', async () => {
  const h = harness();
  const billing = await h.read('Billing');
  await h.read('Projects');
  const { id } = h.client.beginRefresh();
  const fresh = await h.readForRefresh(id, 'Projects');
  h.state.fail = 'network';
  await assert.rejects(h.readForRefresh(id, 'Billing'));
  h.state.fail = null;
  const outcome = h.client.finishRefresh(id);
  assert.equal(outcome.replaced, false);
  assert.equal(outcome.failed, 1);
  assert.deepEqual(await h.read('Billing'), billing, 'the failed read keeps its saved copy');
  assert.deepEqual(await h.read('Projects'), fresh);
});

test('a refused query is not a failure: it fails the same way when read live', async () => {
  const h = harness();
  await h.read('Projects');
  const { id } = h.client.beginRefresh();
  h.state.fail = 'query';
  await assert.rejects(h.readForRefresh(id, 'UsageByEnvironment'));
  h.state.fail = null;
  await h.readForRefresh(id, 'Projects');
  assert.equal(h.client.finishRefresh(id).replaced, true);
});

test('a change made during a refresh voids it', async () => {
  const h = harness();
  const before = await h.read('Projects');
  const { id } = h.client.beginRefresh();
  await h.readForRefresh(id, 'Projects');
  h.state.reply = () => ({ data: { M: true } });
  await h.mutate();
  const outcome = h.client.finishRefresh(id);
  assert.equal(outcome.swapped, false);
  assert.match(outcome.reason, /change was made/);
  assert.notDeepEqual(await h.read('Projects'), before, 'the change cleared the saved copy, as before');
});

test('one refresh at a time: a second tab joins it; an abandoned one is replaced', () => {
  const h = harness();
  const now = Date.now();
  const first = h.client.beginRefresh(now);
  assert.equal(h.client.beginRefresh(now + 1000).id, first.id);
  assert.ok(h.client.isRefreshing(now + 1000));
  assert.notEqual(h.client.beginRefresh(now + 6 * 60_000).id, first.id);
  assert.equal(h.client.finishRefresh(first.id).swapped, false, 'the abandoned id is gone');
});

test('two tabs rendering the same read during a refresh ask Railway once', async () => {
  const h = harness();
  const { id } = h.client.beginRefresh();
  h.state.header = id;
  await Promise.all([h.read('Projects'), h.read('Projects')]);
  await h.read('Projects');
  h.state.header = null;
  assert.equal(h.state.calls.length, 1);
});

test('demo mode keeps nothing, so there is no background refresh', () => {
  const h = harness({ mock: true });
  assert.equal(h.client.beginRefresh(), null);
});

test('refresh routes: the page on screen first, then every other tab once', async () => {
  const output = ts.transpileModule(readFileSync('src/lib/preload.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', output)(mod, mod.exports);
  const { refreshRoutes, PRELOAD_ROUTES } = mod.exports;
  const routes = refreshRoutes('/a/main/p/123', '');
  assert.equal(routes[0], '/a/main/p/123');
  assert.equal(routes.length, PRELOAD_ROUTES.length + 1);
  const billing = refreshRoutes('/billing', '?period=previous');
  assert.equal(billing[0], '/billing?period=previous');
  assert.equal(billing.length, PRELOAD_ROUTES.length);
  assert.equal(new Set(billing).size, billing.length);
});
