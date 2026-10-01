import assert from 'node:assert/strict';
import test from 'node:test';
import { importModule } from '../test.config.mjs';

const localState = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem(key) { return localState.get(key) ?? null; },
  setItem(key, value) { localState.set(key, String(value)); },
  removeItem(key) { localState.delete(key); },
} });

function harness() {
  const files = new Map();
  const dirs = new Set(['.obsidian', '.obsidian/plugins']);
  const adapter = {
    async exists(path) { return files.has(path) || dirs.has(path); },
    async read(path) { if (!files.has(path)) throw new Error(`missing ${path}`); return files.get(path); },
    async write(path, value) { files.set(path, value); },
    async remove(path) { files.delete(path); dirs.delete(path); },
    async mkdir(path) { dirs.add(path); },
    async rename(from, to) { files.set(to, files.get(from)); files.delete(from); },
  };
  const runtime = {
    state: { githubSources: { 'community:calendar': { repo: 'acme/calendar' } }, protected: [], records: {}, settings: {}, deferred: [] },
    local: {}, queue: Promise.resolve(),
    enqueue(_label, action) {
      const run = this.queue.then(() => action({ save: async () => {}, setEnabled: async () => {}, refresh: async () => {}, writeEffectiveState: async () => {} }));
      this.queue = run.catch(() => {}); return run;
    },
    getMutationGeneration() { return 0; },
    list() { return []; },
    archive: { has() { return false; } },
  };
  const app = { vault: { configDir: '.obsidian', adapter, config: {} }, plugins: { enabledPlugins: new Set(), plugins: {}, manifests: {} }, secretStorage: { async getSecret() { return 'test'; } } };
  const plugin = { app, manifest: { id: 'aigility-plugin-manager' } };
  return { files, dirs, runtime, app, plugin };
}

test('install rejects a disk-archived plugin with a stale false cache before downloading main.js', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const h = harness();
  h.dirs.add('.obsidian/plugins/_archive/calendar');
  let mainAssetRequested = false;
  h.plugin.githubRequest = async ({ url }) => {
    if (url.includes('/releases/tags/')) return { status: 200, json: { tag_name: 'v2.0.0', assets: [
      { name: 'manifest.json', browser_download_url: 'https://github.com/acme/calendar/manifest.json' },
      { name: 'main.js', browser_download_url: 'https://github.com/acme/calendar/main.js' },
    ] } };
    if (url.endsWith('/manifest.json')) return { status: 200, text: JSON.stringify({ id: 'calendar', version: '2.0.0' }) };
    if (url.endsWith('/main.js')) { mainAssetRequested = true; return { status: 200, text: 'asset' }; }
    return { status: 404, json: {} };
  };
  const manager = new GithubManager(h.runtime, h.app, h.plugin);
  await assert.rejects(manager.install('acme/calendar', 'v2.0.0'), /archived; restore it/);
  assert.equal(mainAssetRequested, false);
  assert.equal(h.files.size, 0);
});

test('rollback rechecks the archive folder after entering the runtime queue before writing files', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const h = harness();
  let queued = false;
  h.runtime.enqueue = (_label, action) => {
    queued = true;
    h.dirs.add('.obsidian/plugins/_archive/calendar');
    const run = Promise.resolve().then(() => action({ save: async () => {}, setEnabled: async () => {}, refresh: async () => {}, writeEffectiveState: async () => {} }));
    return run;
  };
  const manager = new GithubManager(h.runtime, h.app, h.plugin);
  await assert.rejects(manager.rollback('calendar'), /archived; restore it/);
  assert.equal(queued, true);
  assert.equal(h.files.size, 0);
});
