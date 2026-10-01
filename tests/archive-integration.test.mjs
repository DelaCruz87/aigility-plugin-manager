import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';

const { ManagerRuntime } = await importModule('src/integrated/runtime.ts');
let fixtureNumber = 0;

function fixture({ compatible = true, protectedPlugin = false, deferred = false, failRestore = false, fixtureMembers = undefined } = {}) {
  globalThis.localStorage ??= { values: new Map(), getItem(k) { return this.values.get(k) ?? null; }, setItem(k, v) { this.values.set(k, String(v)); }, removeItem(k) { this.values.delete(k); } };
  const id = 'archived-addon', calls = [], manifests = {}, enabledPlugins = new Set();
  const state = {
    schemaVersion: 1,
    records: { [`community:${id}`]: { ref: { kind: 'community', id }, name: 'Archived addon', version: '1.0.0', tags: ['target'], group: '', desired: false, metadata: {} } },
    tags: [{ id: 'target', name: 'Target' }], groups: [],
    deviceProfiles: [{ id: 'target-profile', name: 'Target', tagIds: ['target'] }], fixtureProfiles: [{ id: 'declared', name: 'Declared', members: fixtureMembers ?? {} }],
    deferred: deferred ? [{ id, delayMs: 1000, enabled: true }] : [], protected: protectedPlugin ? [`community:${id}`] : [],
    profileBackups: [], githubSources: {}, settings: { staggerMs: 0, automaticUpdates: false }, legacyBpm: {},
  };
  const files = new Map([['.obsidian/plugins/aigility-plugin-manager/data.json', JSON.stringify(state)]]);
  const adapter = { exists: async (p) => files.has(p), read: async (p) => files.get(p), write: async (p, v) => files.set(p, v) };
  const plugins = {
    manifests, enabledPlugins, plugins: {}, isEnabled: () => true,
    enablePluginAndSave: async (pluginId) => { calls.push(['enable', pluginId]); enabledPlugins.add(pluginId); plugins.plugins[pluginId]._loaded = true; },
    disablePluginAndSave: async (pluginId) => { calls.push(['disable', pluginId]); enabledPlugins.delete(pluginId); if (plugins.plugins[pluginId]) plugins.plugins[pluginId]._loaded = false; },
    enablePlugin: async () => {}, saveConfig: async () => {}, loadManifests: async () => {},
  };
  const app = { appId: `archive-test-${++fixtureNumber}`, vault: { adapter, configDir: '.obsidian', getName: () => 'Sandbox' }, plugins, internalPlugins: { plugins: {} }, workspace: { getActiveWorkspace: () => 'active' } };
  const plugin = { manifest: { dir: '.obsidian/plugins/aigility-plugin-manager' }, loadData: async () => state, saveData: async () => {}, logger: {} };
  const runtime = new ManagerRuntime(app, plugin, state);
  const archiveEntry = { id, name: 'Archived addon', version: '1.0.0', minAppVersion: compatible ? '1.0.0' : '99.0.0' };
  let archived = true;
  const archive = {
    list: () => archived ? [archiveEntry] : [],
    has: (pluginId) => archived && pluginId === id,
    fingerprint: () => archived ? 'archived-v1' : 'restored-v1',
    restoreInTransaction: async (pluginId) => {
      calls.push(['restore', pluginId]);
      if (failRestore) throw new Error('fixture restore failure');
      archived = false;
      const manifest = { id, name: archiveEntry.name, version: archiveEntry.version, minAppVersion: archiveEntry.minAppVersion };
      manifests[id] = manifest;
      plugins.plugins[id] = { manifest, _loaded: false };
    },
  };
  runtime.archive = archive;
  return { runtime, app, state, calls, files, archive };
}

test('archived profile preview is read-only; applying restores once inside profile operation', async () => {
  const h = fixture();
  const preview = await h.runtime.previewProfile('target-profile');
  assert.deepEqual(preview.map(({ ref, before, after }) => [ref.id, before, after]), [['archived-addon', false, true]]);
  assert.deepEqual(h.calls, []);
  await h.runtime.applyProfile('target-profile', preview);
  assert.equal(h.calls.filter(([op]) => op === 'restore').length, 1);
  assert.equal(h.calls.some(([op, id]) => op === 'enable' && id === 'archived-addon'), true);
});

test('incompatible and protected archived profile members are never restored', async () => {
  const incompatible = fixture({ compatible: false });
  assert.deepEqual(await incompatible.runtime.previewProfile('target-profile'), []);
  await incompatible.runtime.applyProfile('target-profile');
  assert.equal(incompatible.calls.some(([op]) => op === 'restore'), false);
  const protectedFixture = fixture({ protectedPlugin: true });
  await protectedFixture.runtime.applyProfile('target-profile');
  assert.equal(protectedFixture.calls.some(([op]) => op === 'restore'), false);
});

test('declared archived fixture member restores once inside its pending operation and activates', async () => {
  const h = fixture({ fixtureMembers: { 'community:archived-addon': true } });
  await h.runtime.applyFixture('declared');
  assert.equal(h.calls.filter(([op]) => op === 'restore').length, 1);
  assert.equal(h.calls.findIndex(([op]) => op === 'restore') < h.calls.findIndex(([op]) => op === 'enable'), true);
  assert.equal(h.state.records['community:archived-addon'].desired, true);
  assert.equal(h.state.undo?.fixtureId, 'declared');
});

test('declared false archived fixture member records desired state without restore, activation, or deferred exclusion', async () => {
  const h = fixture({ deferred: true, fixtureMembers: { 'community:archived-addon': false } });
  await h.runtime.applyFixture('declared');
  assert.equal(h.calls.some(([op]) => ['restore', 'enable', 'disable'].includes(op)), false);
  assert.deepEqual(h.state.deferred, [{ id: 'archived-addon', delayMs: 1000, enabled: true }]);
  assert.equal(h.state.records['community:archived-addon'].desired, false);
  assert.equal(h.archive.has('archived-addon'), true);
});

test('fixture preserves archived protected and incompatible declarations and skips undeclared archived members', async () => {
  const protectedFixture = fixture({ protectedPlugin: true, fixtureMembers: { 'community:archived-addon': true } });
  await protectedFixture.runtime.applyFixture('declared');
  assert.equal(protectedFixture.calls.some(([op]) => op === 'restore'), false);
  assert.equal(protectedFixture.state.records['community:archived-addon'].desired, false);
  assert.equal(protectedFixture.archive.has('archived-addon'), true);

  const incompatibleFixture = fixture({ compatible: false, fixtureMembers: { 'community:archived-addon': true } });
  await incompatibleFixture.runtime.applyFixture('declared');
  assert.equal(incompatibleFixture.calls.some(([op]) => op === 'restore'), false);
  assert.equal(incompatibleFixture.state.records['community:archived-addon'].desired, false);
  assert.equal(incompatibleFixture.archive.has('archived-addon'), true);

  const undeclaredFixture = fixture();
  await undeclaredFixture.runtime.applyFixture('declared');
  assert.equal(undeclaredFixture.calls.length, 0);
  assert.equal(undeclaredFixture.archive.has('archived-addon'), true);
});

test('failed restore pauses the operation and leaves archived plugin unactivated', async () => {
  const h = fixture({ failRestore: true });
  await assert.rejects(h.runtime.applyProfile('target-profile'), /fixture restore failure/);
  assert.equal(h.runtime.local.recoveryReason?.includes('Operation interrupted'), true);
  assert.equal(h.calls.some(([op]) => op === 'enable'), false);
});

test('deferred restore stays natively off; effective report marks restored and still-archived states', async () => {
  const h = fixture({ deferred: true });
  await h.runtime.applyProfile('target-profile');
  assert.equal(h.calls.some(([op]) => op === 'restore'), true);
  assert.equal(h.calls.some(([op]) => op === 'enable'), false);
  await h.runtime.writeEffectiveState();
  const report = JSON.parse(h.files.get('.obsidian/plugins/aigility-plugin-manager/effective-state.json'));
  const record = report.plugins.find((item) => item.id === 'archived-addon');
  assert.equal(record.installed, true);
  assert.equal(record.archived, false);
  const stillArchived = fixture();
  await stillArchived.runtime.writeEffectiveState();
  const archivedReport = JSON.parse(stillArchived.files.get('.obsidian/plugins/aigility-plugin-manager/effective-state.json'));
  const archivedRecord = archivedReport.plugins.find((item) => item.id === 'archived-addon');
  assert.equal(archivedRecord.installed, false);
  assert.equal(archivedRecord.archived, true);
});
