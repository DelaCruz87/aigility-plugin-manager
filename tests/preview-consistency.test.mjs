import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';
const { ManagerRuntime } = await importModule('src/integrated/runtime.ts');

function fixture() {
  globalThis.localStorage ??= { values: new Map(), getItem(k) { return this.values.get(k) ?? null; }, setItem(k, v) { this.values.set(k, String(v)); }, removeItem(k) { this.values.delete(k); } };
  const apiCalls = [], enabledPlugins = new Set();
  const manifest = { id: 'alpha', name: 'alpha', version: '1.0.0', minAppVersion: '1.0.0' }, instance = { manifest, _loaded: false };
  const plugins = { enabledPlugins, manifests: { alpha: manifest }, isEnabled: () => true, getPlugin: () => instance,
    enablePluginAndSave: async id => { apiCalls.push(['enable', id]); enabledPlugins.add(id); instance._loaded = true; },
    disablePluginAndSave: async id => { apiCalls.push(['disable', id]); enabledPlugins.delete(id); instance._loaded = false; },
    enablePlugin: async () => {}, saveConfig: async () => {}, setEnable: async () => true };
  let disk;
  const adapter = { exists: async () => disk !== undefined, read: async () => disk, write: async (_p, value) => { disk = value; } };
  const app = { appId: 'test-app', vault: { adapter, configDir: '.obsidian', getName: () => 'Sandbox' }, plugins, internalPlugins: { plugins: {} }, workspace: { getActiveWorkspace: () => 'active' } };
  const state = { schemaVersion: 1, records: { 'community:alpha': { ref: { kind: 'community', id: 'alpha' }, name: 'alpha', version: '1', tags: ['on'], group: '', desired: false, metadata: {} } }, tags: [{ id: 'on', name: 'On' }], groups: [], deviceProfiles: [{ id: 'target', name: 'Target', tagIds: ['on'] }], fixtureProfiles: [], deferred: [], protected: [], profileBackups: [], githubSources: {}, settings: { staggerMs: 0, automaticUpdates: false }, legacyBpm: {} };
  disk = JSON.stringify(state);
  const plugin = { manifest: { dir: '.obsidian/plugins/aigility-plugin-manager' }, loadData: async () => state, saveData: async () => {}, logger: {} };
  const files = new Map([[plugin.manifest.dir + '/data.json', disk]]);
  adapter.write = async (path, value) => { disk = value; files.set(path, value); };
  const runtime = new ManagerRuntime(app, plugin, state);
  return { runtime, app, state, apiCalls, files, get disk() { return disk; }, set disk(v) { disk = v; } };
}
test('manual preview rejects queued tag mutation before host writes', async () => {
  const h = fixture(), preview = await h.runtime.previewProfile('target');
  await h.runtime.setTags({ kind: 'community', id: 'alpha' }, []);
  await assert.rejects(h.runtime.applyProfile('target', preview), /vista previa.*vigente|nueva vista previa/i);
  assert.deepEqual(h.apiCalls, []);
});
test('manual preview rejects external disk change', async () => {
  const h = fixture(), preview = await h.runtime.previewProfile('target'); h.disk += ' ';
  await assert.rejects(h.runtime.applyProfile('target', preview));
  assert.deepEqual(h.apiCalls, []);
});
test('manual preview applies unchanged snapshot and rejects wrong profile id', async () => {
  const h = fixture(), preview = await h.runtime.previewProfile('target');
  await assert.rejects(h.runtime.applyProfile('other', preview), /vista previa/i);
  assert.deepEqual(h.apiCalls, []);
  await h.runtime.applyProfile('target', preview);
  assert.deepEqual(h.apiCalls, [['enable', 'alpha']]);
});
test('effective report includes source app identity without vault path', async () => {
  const h = fixture(); await h.runtime.writeEffectiveState();
  const report = JSON.parse(h.files.get('.obsidian/plugins/aigility-plugin-manager/effective-state.json'));
  assert.equal(report.installation.appId, 'test-app');
  assert.equal(report.installation.vaultName, 'Sandbox');
  assert.equal(JSON.stringify(report).includes('/vault'), false);
});
