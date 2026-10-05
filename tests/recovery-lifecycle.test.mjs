import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';

const { ManagerRuntime } = await importModule('src/integrated/runtime.ts');
let appCounter = 0;

function harness() {
  const values = new Map();
  const storage = {
    fail: false,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (this.fail) throw new Error('Storage unavailable');
      values.set(key, value);
    },
  };
  globalThis.localStorage = storage;
  const state = {
    schemaVersion: 1, records: {}, tags: [], groups: [], deviceProfiles: [],
    fixtureProfiles: [], deferred: [], protected: ['community:aigility-plugin-manager'],
    profileBackups: [], githubSources: {}, legacyBpm: {},
    settings: { staggerMs: 0, automaticUpdates: false },
  };
  const path = '.obsidian/plugins/aigility-plugin-manager/data.json';
  const files = new Map([[path, JSON.stringify(state)]]);
  const writes = [];
  const adapter = {
    exists: async p => files.has(p),
    read: async p => files.get(p),
    write: async (p, value) => { writes.push(p); files.set(p, value); },
  };
  const app = {
    appId: `recovery-regression-${++appCounter}`,
    vault: { adapter, getName: () => 'isolated-recovery-test' },
    plugins: { manifests: {}, plugins: {}, enabledPlugins: new Set(), isEnabled: () => true },
    internalPlugins: { plugins: {} },
    workspace: { onLayoutReady() {} },
  };
  const plugin = {
    manifest: { id: 'aigility-plugin-manager', dir: '.obsidian/plugins/aigility-plugin-manager' },
    logger: Object.fromEntries(['warn', 'error', 'info'].map(k => [k, () => {}])),
  };
  const runtime = new ManagerRuntime(app, plugin, state);
  return { runtime, adapter, storage, values, files, writes, path };
}

test('unload rejects already queued work before it can save State', async () => {
  const h = harness();
  let release;
  const holder = h.runtime.enqueue('holder', () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  let called = false;
  const queued = h.runtime.enqueue('queued-save', async tx => {
    called = true;
    h.runtime.state.settings.staggerMs = 17;
    await tx.save();
  });
  h.runtime.dispose();
  const rejected = assert.rejects(queued, /disposed|unloading/i);
  release();
  await holder;
  await rejected;
  assert.equal(called, false);
  assert.deepEqual(h.writes, []);
});

test('resume retains in-memory and durable recovery if local persistence fails', async () => {
  const h = harness();
  h.runtime.local.operationPending = 'interrupted-operation';
  h.runtime.pause('Existing recovery');
  const before = JSON.stringify(h.runtime.local);
  const persisted = h.values.get(h.runtime.localKey);
  h.storage.fail = true;
  await assert.rejects(h.runtime.resume(), /Storage unavailable/);
  assert.equal(JSON.stringify(h.runtime.local), before);
  assert.equal(h.values.get(h.runtime.localKey), persisted);
  h.runtime.dispose();
});

test('an already running transaction rejects save after unload', async () => {
  const h = harness();
  let release, entered;
  const running = new Promise(resolve => { entered = resolve; });
  const operation = h.runtime.enqueue('running-save', async tx => {
    entered();
    await new Promise(resolve => { release = resolve; });
    h.runtime.state.settings.staggerMs = 21;
    await tx.save();
  });
  await running;
  h.runtime.dispose();
  const rejected = assert.rejects(operation, /disposed|unloading/i);
  release();
  await rejected;
  assert.deepEqual(h.writes, []);
});

test('unload during State freshness read prevents the later disk write', async () => {
  const h = harness();
  const read = h.adapter.read;
  let release, entered;
  const reading = new Promise(resolve => { entered = resolve; });
  h.adapter.read = async p => {
    entered();
    await new Promise(resolve => { release = resolve; });
    return read(p);
  };
  h.runtime.state.settings.staggerMs = 23;
  const save = h.runtime.save();
  await reading;
  h.adapter.read = read;
  h.runtime.dispose();
  const rejected = assert.rejects(save, /disposed|unloading/i);
  release();
  await rejected;
  assert.deepEqual(h.writes, []);
});

test('a pause arriving during resume refresh remains latched', async () => {
  const h = harness();
  h.runtime.pause('Original recovery');
  const read = h.adapter.read;
  let release, entered;
  const reading = new Promise(resolve => { entered = resolve; });
  h.adapter.read = async p => {
    entered();
    await new Promise(resolve => { release = resolve; });
    return read(p);
  };
  const resume = h.runtime.resume();
  await reading;
  h.runtime.pause('New explicit pause');
  const rejected = assert.rejects(resume, /pause|cancel/i);
  release();
  await rejected;
  assert.equal(h.runtime.local.recoveryReason, 'New explicit pause');
  assert.equal(JSON.parse(h.values.get(h.runtime.localKey)).recoveryReason, 'New explicit pause');
  assert.deepEqual(h.writes, []);
  h.runtime.dispose();
});

test('a queued resume cannot acknowledge a pause newer than its request', async () => {
  const h = harness();
  h.runtime.pause('Original recovery');
  let release;
  const holder = h.runtime.enqueue('holder', () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const resume = h.runtime.resume();
  h.runtime.pause('New pause while resume is queued');
  const rejected = assert.rejects(resume, /pause|cancel/i);
  release();
  await holder;
  await rejected;
  assert.equal(h.runtime.local.recoveryReason, 'New pause while resume is queued');
  assert.equal(JSON.parse(h.values.get(h.runtime.localKey)).recoveryReason, 'New pause while resume is queued');
  h.runtime.dispose();
});

test('unload during refresh rejects before publishing a new in-memory State', async () => {
  const h = harness();
  const state = h.runtime.state;
  const fresh = JSON.parse(h.files.get(h.path));
  fresh.settings.staggerMs = 29;
  h.files.set(h.path, JSON.stringify(fresh));
  const read = h.adapter.read;
  let release, entered;
  const reading = new Promise(resolve => { entered = resolve; });
  h.adapter.read = async p => {
    entered();
    await new Promise(resolve => { release = resolve; });
    return read(p);
  };
  const refresh = h.runtime.refresh();
  await reading;
  h.runtime.dispose();
  const rejected = assert.rejects(refresh, /disposed|unloading/i);
  release();
  await rejected;
  assert.equal(h.runtime.state, state);
  assert.deepEqual(h.writes, []);
});
