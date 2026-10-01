import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';
const { ArchiveManager } = await importModule('src/integrated/archive.ts');
const { ManagerRuntime } = await importModule('src/integrated/runtime.ts');
const active = '.obsidian/plugins/example';
const root = '.obsidian/plugins/.aigility-archive';
const indexPath = root + '/index.json';
const entry = { id: 'example', name: 'Example', version: '1.0.0', minAppVersion: '1.0.0', archivedAt: '2026-10-01T00:00:00Z' };
function fixture(initialIndex) {
  const files = new Map([
    [active + '/manifest.json', JSON.stringify({ id: 'example', name: 'Example', version: '1.0.0', minAppVersion: '1.0.0' })],
    [active + '/main.js', 'original main'],
    [active + '/styles.css', 'original styles'],
    [active + '/data.json', '{"important":true}'],
    [active + '/extra/nested.bin', 'unknown file'],
  ]);
  const directories = new Set(['.obsidian', '.obsidian/plugins', active, active + '/extra']);
  if (initialIndex) { files.set(indexPath, JSON.stringify(initialIndex)); directories.add(root); }
  const reads = [];
  const writes = [];
  const adapter = {
    async exists(path) { return files.has(path) || directories.has(path); },
    async mkdir(path) { directories.add(path); },
    async read(path) { reads.push(path); if (adapter.onRead) await adapter.onRead(path); if (!files.has(path)) throw Error('Missing ' + path); return files.get(path); },
    async write(path, text) { if (adapter.onWrite) await adapter.onWrite(path, text); files.set(path, text); writes.push(path); },
    async list(path) {
      const prefix = path + '/';
      return {
        files: [...files.keys()].filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')),
        folders: [...directories].filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')),
      };
    },
    async rename(from, to) {
      if (adapter.onRename) await adapter.onRename(from, to);
      assert(directories.has(from)); assert(!directories.has(to));
      for (const [p, value] of [...files]) if (p.startsWith(from + '/')) { files.delete(p); files.set(to + p.slice(from.length), value); }
      for (const p of [...directories]) if (p === from || p.startsWith(from + '/')) { directories.delete(p); directories.add(to + p.slice(from.length)); }
    },
  };
  const enabled = new Set(), loaded = new Set();
  const state = {
    records: { 'community:example': { ref: { kind: 'community', id: 'example' }, name: 'Example', version: '1.0.0', desired: false, tags: ['ipad'], group: 'tools', metadata: { retained: true } } },
    protected: ['community:aigility-plugin-manager'], debug: undefined,
    githubSources: { 'community:example': { repo: 'owner/repo', pinned: '1.0.0' } },
  };
  let restricted = false;
  const app = {
    appId: 'test-installation',
    vault: { configDir: '.obsidian', adapter },
    internalPlugins: { plugins: {} },
    plugins: {
      manifests: { example: JSON.parse(files.get(active + '/manifest.json')) },
      enabledPlugins: enabled,
      plugins: {},
      isEnabled() { return !restricted; },
      async loadManifests() {
        this.manifests = {};
        const listing = await adapter.list('.obsidian/plugins');
        for (const folder of listing.folders) {
          const manifest = files.get(folder + '/manifest.json');
          if (manifest) { const parsed = JSON.parse(manifest); this.manifests[parsed.id] = { ...parsed, dir: folder }; }
        }
      },
    },
  };
  const runtime = {
    state, local: {}, generation: 0, pauses: [], saves: 0, reportWrites: 0,
    pause(reason) { this.pauses.push(reason); this.local.recoveryReason = reason; },
    log() {},
    getMutationGeneration() { return this.generation; },
    list() { return [{ ref: { kind: 'community', id: 'example' }, name: 'Example', installed: Boolean(app.plugins.manifests.example), desired: state.records['community:example']?.desired ?? enabled.has('example'), nativeAutostart: enabled.has('example'), loaded: loaded.has('example'), scheduled: this.scheduled === true, compatible: true }]; },
    async enqueue(label, fn) {
      return fn({
        refresh: async () => state,
        save: async () => { runtime.saves++; },
        writeEffectiveState: async () => { runtime.reportWrites++; },
      });
    },
  };
  const manager = new ArchiveManager(runtime, app, { manifest: { id: 'aigility-plugin-manager' } });
  return { manager, runtime, app, adapter, files, directories, reads, writes, enabled, loaded, setRestricted(value) { restricted = value; } };
}
const initial = (entries = [], pending) => ({ schemaVersion: 1, installationId: 'test-installation', entries, ...(pending ? { pending } : {}) });
const folderImage = (files, prefix) => [...files].filter(([p]) => p.startsWith(prefix + '/')).map(([p, value]) => [p.slice(prefix.length), value]).sort();

test('archive removes one native manifest and restores every byte and metadata while remaining off', async () => {
  const f = fixture(); await f.manager.initialize();
  const image = folderImage(f.files, active);
  const metadata = JSON.stringify(f.runtime.state);
  await f.manager.archive('example');
  assert.equal(f.app.plugins.manifests.example, undefined);
  assert.equal(f.manager.has('example'), true);
  assert.deepEqual(folderImage(f.files, root + '/example'), image);
  assert(!f.files.has(root + '/manifest.json'));
  await f.manager.restore('example');
  assert.equal(f.manager.has('example'), false);
  assert.deepEqual(folderImage(f.files, active), image);
  assert.equal(JSON.stringify(f.runtime.state), metadata);
  assert.equal(f.enabled.has('example'), false); assert.equal(f.loaded.has('example'), false);
});

test('every active state, protection, self, restricted mode and diagnosis denies archival before rename', async () => {
  for (const mutate of [
    f => { f.runtime.state.records['community:example'].desired = true; },
    f => f.enabled.add('example'), f => f.loaded.add('example'),
    f => { f.runtime.scheduled = true; },
    f => { f.runtime.state.protected.push('community:example'); },
    f => { f.runtime.state.debug = { active: true }; },
    f => { f.runtime.local.operationPending = 'other-operation'; },
    f => f.setRestricted(true),
  ]) {
    const f = fixture(); await f.manager.initialize(); mutate(f);
    await assert.rejects(f.manager.archive('example'));
    assert(f.files.has(active + '/data.json')); assert(!f.directories.has(root + '/example'));
  }
  const f = fixture(); await f.manager.initialize();
  await assert.rejects(f.manager.archive('aigility-plugin-manager'));
  await assert.rejects(f.manager.archive('core:sync'));
});

test('path traversal, identity mismatch and destination conflict preserve both folders', async () => {
  for (const id of ['../example', '.example', 'example/child', 'example\\child']) {
    const f = fixture(); await f.manager.initialize(); await assert.rejects(f.manager.archive(id)); assert(f.files.has(active + '/data.json'));
  }
  const f = fixture(); await f.manager.initialize();
  f.files.set(active + '/manifest.json', '{"id":"someone-else","name":"Other","version":"1.0.0"}');
  await assert.rejects(f.manager.archive('example')); assert(f.files.has(active + '/data.json'));
  const collision = fixture(); await collision.manager.initialize();
  collision.directories.add(root + '/example'); collision.files.set(root + '/example/data.json', 'external');
  await assert.rejects(collision.manager.archive('example'));
  assert.equal(collision.files.get(root + '/example/data.json'), 'external');
});

test('Sync distinguishes inactive, verified local catalog, propagated installation and unknown client', async () => {
  for (const [wrapper, allowed] of [
    [{ enabled: false }, true],
    [{ enabled: true, instance: { vaultId: null, filter: { allowSpecialFiles: new Set() } } }, true],
    [{ enabled: true, instance: { vaultId: 'remote', filter: { allowSpecialFiles: new Set() } } }, true],
    [{ enabled: true, instance: { vaultId: 'remote', filter: { allowSpecialFiles: new Set(['community-plugin-data']) } } }, false],
    [{ enabled: true, instance: {} }, false],
  ]) {
    const f = fixture(); await f.manager.initialize(); f.app.internalPlugins.plugins.sync = wrapper;
    assert.equal(f.manager.safety().allowed, allowed);
    if (!allowed) { await assert.rejects(f.manager.archive('example')); assert(f.files.has(active + '/data.json')); }
  }
});

test('external index edit rejects without overwriting it or moving files', async () => {
  const f = fixture(initial()); await f.manager.initialize();
  const external = JSON.stringify(initial([{ ...entry, id: 'external' }]));
  f.files.set(indexPath, external);
  await assert.rejects(f.manager.archive('example'));
  assert.equal(f.files.get(indexPath), external); assert(f.files.has(active + '/data.json'));
});

test('newly downloaded inactive plugins can be archived before acquiring a manager metadata record', async () => {
  const f = fixture(); delete f.runtime.state.records['community:example'];
  await f.manager.initialize(); await f.manager.archive('example');
  assert.equal(f.manager.has('example'), true);
  assert.equal(f.files.get(root + '/example/data.json'), '{"important":true}');
  assert.equal(f.app.plugins.manifests.example, undefined);
});

test('failure after rename keeps journal and can only be recovered explicitly with the same files', async () => {
  const f = fixture(); await f.manager.initialize();
  const image = folderImage(f.files, active);
  f.adapter.onWrite = async (p, raw) => {
    if (p === indexPath && f.directories.has(root + '/example') && !JSON.parse(raw).pending) throw Error('Injected index write failure');
  };
  await assert.rejects(f.manager.archive('example'));
  assert(JSON.parse(f.files.get(indexPath)).pending); assert(f.runtime.pauses.length > 0);
  assert.equal(f.manager.needsRecovery(), true, 'failed move must expose its recovery action');
  assert.deepEqual(folderImage(f.files, root + '/example'), image);
  delete f.adapter.onWrite;
  await f.manager.recover();
  assert.equal(JSON.parse(f.files.get(indexPath)).pending, undefined);
  assert.equal(f.manager.needsRecovery(), false, 'successful recovery clears its local journal indicator');
  assert.equal(f.manager.safety().allowed, true, 'recovered archive operations are available while automation remains paused');
  assert.equal(f.manager.has('example'), true); assert(f.runtime.local.recoveryReason);
});

test('pending startup and foreign installation never move folders or auto-load plugins', async () => {
  const pending = { id: 'example', operation: 'archive', phase: 'before-rename', entry };
  const f = fixture(initial([], pending)); await f.manager.initialize();
  assert(f.runtime.pauses.length > 0); assert(f.files.has(active + '/data.json')); assert.equal(f.writes.length, 0);
  await f.manager.recover(); assert.equal(JSON.parse(f.files.get(indexPath)).pending, undefined);
  const foreign = fixture({ ...initial(), installationId: 'different-installation' }); await foreign.manager.initialize();
  assert(foreign.runtime.pauses.length > 0); assert.equal(foreign.manager.safety().allowed, false);
  assert.equal(foreign.writes.length, 0);
});

test('a 723-entry archive reads only its index and exposes defensive metadata copies', async () => {
  const entries = Array.from({ length: 723 }, (_, i) => ({ ...entry, id: 'archived-' + i }));
  const f = fixture(initial(entries)); await f.manager.initialize();
  assert.deepEqual(f.reads, [indexPath]); assert.equal(f.manager.list().length, 723);
  const first = f.manager.list(); first[0].name = 'Changed outside';
  assert.equal(f.manager.get('archived-0').name, 'Example');
  assert.deepEqual(f.reads, [indexPath]);
  assert.equal(typeof f.manager.needsRecovery(), 'boolean', 'UI query is synchronous and cached');
  assert.deepEqual(f.reads, [indexPath], 'render cannot trigger archive filesystem reads');
});

test('manual restore clears desired on the current state after transaction refresh replaced its object', async () => {
  const f = fixture(initial([entry]));
  await f.adapter.rename(active, root + '/example'); await f.app.plugins.loadManifests();
  f.runtime.state.records['community:example'].desired = true;
  f.runtime.list = () => [{ ref: { kind: 'community', id: 'example' }, installed: Boolean(f.app.plugins.manifests.example), desired: f.runtime.state.records['community:example'].desired, nativeAutostart: false, loaded: false, scheduled: false }];
  f.runtime.enqueue = async (_label, fn) => fn({
    refresh: async () => { f.runtime.state = JSON.parse(JSON.stringify(f.runtime.state)); return f.runtime.state; },
    save: async () => {}, writeEffectiveState: async () => {},
  });
  await f.manager.initialize(); await f.manager.restore('example');
  assert.equal(f.runtime.state.records['community:example'].desired, false);
  assert(f.files.has(active + '/data.json')); assert(!f.enabled.has('example')); assert(!f.loaded.has('example'));
});

test('manual inert archival is available during recovery but rejects unload and newly protected state', async () => {
  const paused = fixture(); await paused.manager.initialize(); paused.runtime.local.recoveryReason = 'late load';
  await paused.manager.archive('example'); assert(paused.manager.has('example'));
  const disposed = fixture(); await disposed.manager.initialize(); disposed.runtime.disposed = true;
  await assert.rejects(disposed.manager.archive('example')); assert(disposed.files.has(active + '/data.json'));
  const changed = fixture(); await changed.manager.initialize();
  changed.adapter.onRead = async path => { if (path === active + '/manifest.json') changed.runtime.state.protected.push('community:example'); };
  await assert.rejects(changed.manager.archive('example')); assert(changed.files.has(active + '/data.json'));
});

test('real ArchiveManager and ManagerRuntime restore only a selected profile member in one transaction', async () => {
  const f = fixture();
  globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const state = Object.assign(f.runtime.state, {
    schemaVersion: 1, tags: [{ id: 'ipad', name: 'ipad' }], groups: [{ id: 'tools', name: 'Tools' }],
    deviceProfiles: [{ id: 'ipad', name: 'ipad', tagIds: ['ipad'], applyAtStart: true }],
    fixtureProfiles: [], deferred: [], profileBackups: [],
    settings: { staggerMs: 0, automaticUpdates: false }, legacyBpm: {},
  });
  const dir = '.obsidian/plugins/aigility-plugin-manager';
  f.files.set(dir + '/data.json', JSON.stringify(state));
  f.app.vault.getName = () => 'Test Sandbox';
  const plugin = { manifest: { id: 'aigility-plugin-manager', dir }, loadData: async () => state, logger: {} };
  f.app.plugins.enablePluginAndSave = async id => {
    f.enabled.add(id); f.loaded.add(id);
    f.app.plugins.plugins[id] = { manifest: f.app.plugins.manifests[id], _loaded: true };
  };
  f.app.plugins.disablePluginAndSave = async id => {
    f.enabled.delete(id); f.loaded.delete(id);
    if (f.app.plugins.plugins[id]) f.app.plugins.plugins[id]._loaded = false;
  };
  f.app.plugins.saveConfig = async () => {};
  const runtime = new ManagerRuntime(f.app, plugin, state);
  const manager = new ArchiveManager(runtime, f.app, plugin);
  runtime.archive = manager; await manager.initialize();
  await manager.archive('example');
  const image = folderImage(f.files, root + '/example');
  const preview = await runtime.previewProfile('ipad');
  assert.equal(preview.length, 1); assert.equal(preview[0].after, true);
  assert.deepEqual(folderImage(f.files, root + '/example'), image, 'preview cannot move files');
  await runtime.applyProfile('ipad', preview);
  assert.equal(manager.has('example'), false);
  assert.equal(f.enabled.has('example'), true); assert.equal(f.loaded.has('example'), true);
  assert.equal(runtime.local.operationPending, undefined);
  assert.deepEqual(folderImage(f.files, active), image);
  assert.equal(runtime.state.records['community:example'].desired, true);
  await runtime.undoProfile();
  assert.equal(f.enabled.has('example'), false);
  assert(f.files.has(active + '/data.json'), 'undo keeps restored files available without losing configuration');
});
