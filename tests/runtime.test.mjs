import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';

const { ManagerRuntime, collectObserved } = await importModule('src/integrated/runtime.ts');

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class FakeClock {
  next = 1;
  jobs = new Map();
  history = new Map();
  setTimeout(callback, delay) {
    const id = this.next++;
    this.jobs.set(id, { callback, delay });
    this.history.set(id, { callback, delay });
    return id;
  }
  clearTimeout(id) { this.jobs.delete(id); }
  async runStale(id) { await this.history.get(id)?.callback(); }
  async runNext() {
    const entry = this.jobs.entries().next().value;
    if (!entry) return false;
    const [id, job] = entry;
    this.jobs.delete(id);
    await job.callback();
    return true;
  }
}

function makeState(overrides = {}) {
  return {
    schemaVersion: 1,
    records: {},
    tags: [],
    groups: [],
    deviceProfiles: [],
    fixtureProfiles: [],
    deferred: [],
    protected: [],
    profileBackups: [],
    githubSources: {},
    settings: { staggerMs: 0, automaticUpdates: false },
    legacyBpm: {},
    ...overrides,
  };
}

function communityHost(id, enabled = false, options = {}) {
  const enabledIds = new Set(enabled ? [id] : []);
  const apiCalls = [];
  const manifest = { id, name: options.name || id, version: options.version || '1.0.0', minAppVersion: '1.0.0' };
  const instance = { manifest, _loaded: enabled };
  const instances = new Map([[id, instance]]);
  const manifests = new Map([[id, { manifest, instance }]]);
  const api = {
    isEnabled: () => true,
    getPlugin: (pluginId) => manifests.get(pluginId)?.instance,
    enablePlugin: async (pluginId) => {
      apiCalls.push(['enablePlugin', pluginId]);
      // Nonpersistent load keeps native autostart unchanged.
      if (manifests.get(pluginId)?.instance) manifests.get(pluginId).instance._loaded = true;
      return true;
    },
    enablePluginAndSave: async (pluginId) => {
      apiCalls.push(['enablePluginAndSave', pluginId]);
      enabledIds.add(pluginId);
      if (manifests.get(pluginId)?.instance) manifests.get(pluginId).instance._loaded = true;
      return true;
    },
    disablePluginAndSave: async (pluginId) => {
      apiCalls.push(['disablePluginAndSave', pluginId]);
      enabledIds.delete(pluginId);
      if (manifests.get(pluginId)?.instance) manifests.get(pluginId).instance._loaded = false;
      return true;
    },
    saveConfig: async () => { apiCalls.push(['saveConfig']); },
    setEnable: async (value) => {
      apiCalls.push(['setEnable', value]);
      if (!value) api.disableCalls++;
      return true;
    },
    enabledPlugins: enabledIds,
    manifests: Object.fromEntries([...manifests].map(([key, value]) => [key, value.manifest])),
  };
  api.disableCalls = 0;
  return { api, enabledIds, apiCalls, manifest, instance, manifests };
}

function addCommunity(host, id, { enabled = false, compatible = true, loaded = enabled } = {}) {
  const manifest = { id, name: id, version: '1.0.0', minAppVersion: '1.0.0', compatible };
  const instance = { manifest, _loaded: loaded };
  host.api.manifests[id] = manifest;
  host.manifests.set(id, { manifest, instance });
  if (enabled) host.enabledIds.add(id);
}

let appCounter = 0;
function makeHarness({ state = makeState(), community = {}, core = {}, appId, path = '/vault', restricted = false } = {}) {
  appId ??= `app-${++appCounter}`;
  const storage = globalThis.localStorage ?? new MemoryStorage();
  globalThis.localStorage = storage;
  const files = new Map();
  const reads = [];
  let failReadback = false;
  const adapter = {
    exists: async (file) => files.has(file),
    read: async (file) => {
      reads.push(file);
      if (!files.has(file)) throw new Error(`Missing file: ${file}`);
      return files.get(file);
    },
    write: async (file, text) => {
      files.set(file, text);
      if (failReadback) {
        failReadback = false;
        files.set(file, `${text} `);
      }
    },
  };
  const plugins = community.api || (typeof community.isEnabled === 'function' ? community : communityHost('runtime-test-host').api);
  // Host 1.14.3 exposes a zero-argument global loading gate. Per-plugin native
  // state lives in enabledPlugins and loaded state lives on plugin instances.
  plugins.isEnabled = () => !restricted;
  const wrapperMap = new Map();
  const coreApis = [];
  for (const [id, isEnabled] of Object.entries(core)) {
    const wrapper = {
      enabled: isEnabled,
      instance: { manifest: { id, name: id }, name: id, _loaded: isEnabled },
      enable: async (user = true) => {
        coreApis.push(['wrapper.enable', id, user]);
        wrapper.enabled = true;
        wrapper.instance._loaded = true;
      },
      disable: (user = true) => {
        coreApis.push(['wrapper.disable', id, user]);
        wrapper.enabled = false;
        wrapper.instance._loaded = false;
      },
    };
    wrapperMap.set(id, wrapper);
  }
  const internalPlugins = {
    plugins: Object.fromEntries(wrapperMap),
    getPluginById(id) { return this.plugins[id]; },
    enable: (...args) => { coreApis.push(['bulk.enable', ...args]); throw new Error('bulk core API must not be used'); },
    saveConfig: async () => { coreApis.push(['saveConfig']); },
  };
  const workspaceCallbacks = [];
  const workspaceCalls = [];
  const app = {
    appId,
    vault: { adapter, configDir: '.obsidian', getName: () => path, adapter },
    plugins,
    internalPlugins,
    workspace: {
      onLayoutReady: (callback) => workspaceCallbacks.push(callback),
      getActiveWorkspace: () => 'active',
    },
    __aigilityClock: new FakeClock(),
  };
  const plugin = {
    manifest: { id: 'aigility-plugin-manager', dir: '.obsidian/plugins/aigility-plugin-manager' },
    loadData: async () => state,
    saveData: async (next) => { state = next; },
    notices: [],
    log: (...args) => plugin.logs.push(args),
    logger: Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [level, (...args) => plugin.logs.push([level, ...args])])),
    logs: [],
  };
  files.set('.obsidian/plugins/aigility-plugin-manager/data.json', JSON.stringify(state));
  const runtime = new ManagerRuntime(app, plugin, state);
  return {
    app, plugin, runtime, files, adapter, reads, workspaceCallbacks, workspaceCalls, coreApis, wrapperMap,
    setFailReadback() { failReadback = true; },
    get state() { return state; },
  };
}

test('collectObserved distinguishes installed, desired, native autostart, compatibility, and loaded state', async () => {
  const community = communityHost('alpha', true);
  addCommunity(community, 'native-but-unloaded', { enabled: true, loaded: false });
  const app = {
    plugins: community.api,
    internalPlugins: { plugins: { search: { enabled: true, instance: { name: 'Search' } } } },
    vault: { adapter: { readConfigJson: async (name) => name === 'community-plugins' ? ['alpha'] : { search: true } } },
    manifest: { version: '1.14.3' },
  };
  const observed = await collectObserved(app);
  assert.deepEqual(observed.find((item) => item.ref.id === 'alpha'), {
    ref: { kind: 'community', id: 'alpha' }, name: 'alpha', version: '1.0.0', installed: true,
    compatible: true, nativeAutostart: true, loaded: true,
  });
  assert.equal(observed.find((item) => item.ref.id === 'search').nativeAutostart, true);
  assert.equal(observed.find((item) => item.ref.id === 'search').loaded, true);
  const unloaded = observed.find((item) => item.ref.id === 'native-but-unloaded');
  assert.equal(unloaded.nativeAutostart, true);
  assert.equal(unloaded.loaded, false);
});

test('complete profile applies tag membership and retains protected, incompatible, and manager plugins', async () => {
  const community = communityHost('alpha');
  addCommunity(community, 'beta', { enabled: true });
  addCommunity(community, 'bad', { enabled: true, compatible: false });
  const profile = { id: 'desktop', name: 'Desktop', tagIds: ['desktop'], applyAtStart: true };
  const state = makeState({
    records: {
      'community:alpha': { ref: { kind: 'community', id: 'alpha' }, name: 'Alpha', version: '1', tags: ['desktop'], group: '', desired: false, metadata: {} },
      'community:beta': { ref: { kind: 'community', id: 'beta' }, name: 'Beta', version: '1', tags: [], group: '', desired: true, metadata: {} },
      'community:bad': { ref: { kind: 'community', id: 'bad' }, name: 'Bad', version: '1', tags: ['desktop'], group: '', desired: false, metadata: { compatible: false } },
    },
    tags: [{ id: 'desktop', name: 'Desktop' }],
    deviceProfiles: [profile],
    protected: ['community:beta'],
  });
  const harness = makeHarness({ state, community: community.api });
  const preview = await harness.runtime.previewProfile('desktop');
  assert.deepEqual(preview.map((change) => [change.ref.id, change.before, change.after]), [['alpha', false, true], ['bad', true, false]]);
  await harness.runtime.applyProfile('desktop');
  assert.equal(community.enabledIds.has('alpha'), true);
  assert.equal(community.enabledIds.has('beta'), true);
  assert.equal(community.enabledIds.has('bad'), false);
  assert.ok(state.protected.includes('community:aigility-plugin-manager'));
});

test('complete profile clears desired=true for an outsider whose native flag is already false', async () => {
  const community = communityHost('outsider', false);
  const state = makeState({
    records: { 'community:outsider': { ref: { kind: 'community', id: 'outsider' }, name: 'Outsider', version: '1', tags: ['other'], group: '', desired: true, metadata: {} } },
    tags: [{ id: 'inside', name: 'Inside' }, { id: 'other', name: 'Other' }],
    deviceProfiles: [{ id: 'target', name: 'Target', tagIds: ['inside'], applyAtStart: true }],
  });
  const harness = makeHarness({ state, community: community.api });
  assert.deepEqual(await harness.runtime.previewProfile('target'), [{ ref: { kind: 'community', id: 'outsider' }, before: false, after: false, reason: 'desired-only:profile:target' }]);
  await harness.runtime.applyProfile('target');
  assert.equal(state.records['community:outsider'].desired, false);
  assert.equal(community.enabledIds.has('outsider'), false);
});

test('fixture changes only declared members', async () => {
  const a = communityHost('a', false);
  const state = makeState({
    records: {
      'community:a': { ref: { kind: 'community', id: 'a' }, name: 'a', version: '1', tags: [], group: '', desired: false, metadata: {} },
      'community:b': { ref: { kind: 'community', id: 'b' }, name: 'b', version: '1', tags: [], group: '', desired: false, metadata: {} },
    },
    fixtureProfiles: [{ id: 'smoke', name: 'Smoke', members: { 'community:a': true } }],
  });
  const harness = makeHarness({ state, community: a.api });
  await harness.runtime.applyFixture('smoke');
  assert.equal(a.enabledIds.has('a'), true);
  assert.equal(a.enabledIds.has('b'), false);
  assert.equal(state.records['community:b'].desired, false);
});

test('fixture skips protected, absent and incompatible members visibly while the ordinary member still applies', async () => {
  const community = communityHost('beta', true);
  addCommunity(community, 'bad', { enabled: true, compatible: false });
  const state = makeState({
    records: {
      'community:beta': { ref: { kind: 'community', id: 'beta' }, name: 'beta', version: '1', tags: [], group: '', desired: true, metadata: {} },
      'community:bad': { ref: { kind: 'community', id: 'bad' }, name: 'bad', version: '1', tags: [], group: '', desired: false, metadata: { compatible: false } },
      'core:search': { ref: { kind: 'core', id: 'search' }, name: 'search', version: '', tags: [], group: '', desired: true, metadata: {} },
    },
    protected: ['core:search', 'community:keeper'],
    fixtureProfiles: [{
      id: 'partial',
      name: 'Partial',
      members: { 'core:search': false, 'community:keeper': true, 'community:ghost': true, 'community:bad': true, 'community:beta': false },
    }],
  });
  const harness = makeHarness({ state, community: community.api, core: { search: true } });
  await harness.runtime.applyFixture('partial');
  assert.equal(harness.wrapperMap.get('search').enabled, true, 'a protected core member is never disabled');
  assert.equal(state.records['core:search'].desired, true, 'and its desired state is left alone');
  assert.equal(community.enabledIds.has('bad'), true, 'an incompatible member is skipped, not unloaded');
  assert.equal(community.enabledIds.has('beta'), false, 'the ordinary declared member still applies');
  assert.equal(state.records['community:beta'].desired, false);
  const warnings = harness.plugin.logs.filter(([level]) => level === 'warn').map(([, message]) => message).join('\n');
  for (const rawKey of ['core:search', 'community:keeper', 'community:ghost', 'community:bad']) {
    assert.ok(warnings.includes(rawKey), `the skipped ref ${rawKey} must be visible in the log`);
  }
  assert.ok(
    state.fixtureProfiles[0].members['core:search'] === false,
    'the skipped declaration is retained verbatim in the profile',
  );
});

test('an invalid fixture key rejects before any declared member is touched', async () => {
  const community = communityHost('beta', true);
  const state = makeState({
    records: { 'community:beta': { ref: { kind: 'community', id: 'beta' }, name: 'beta', version: '1', tags: [], group: '', desired: true, metadata: {} } },
    fixtureProfiles: [{ id: 'broken', name: 'Broken', members: { 'community:beta': false, 'nonsense': false } }],
  });
  const harness = makeHarness({ state, community: community.api });
  await assert.rejects(harness.runtime.applyFixture('broken'), /invalid plugin key/);
  assert.equal(community.enabledIds.has('beta'), true, 'the valid member declared before the invalid one stays untouched');
  assert.equal(state.records['community:beta'].desired, true);
});

test('fixture undo leaves a manually reasserted state untouched by its mutation generation', async () => {
  const community = communityHost('a');
  const state = makeState({
    records: { 'community:a': { ref: { kind: 'community', id: 'a' }, name: 'a', version: '1', tags: [], group: '', desired: false, metadata: {} } },
    fixtureProfiles: [{ id: 'smoke', name: 'Smoke', members: { 'community:a': true } }],
  });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.start(false);
  await harness.runtime.applyFixture('smoke');
  await community.api.enablePluginAndSave('a');
  await harness.runtime.undoProfile();
  assert.equal(community.enabledIds.has('a'), true);
  assert.equal(state.records['community:a'].desired, true);
});

test('core toggles use wrapper methods and read the wrapper back without invoking bulk enable', async () => {
  const harness = makeHarness({ core: { search: false } });
  await harness.runtime.setEnabled({ kind: 'core', id: 'search' }, true);
  assert.equal(harness.wrapperMap.get('search').enabled, true);
  await harness.runtime.setEnabled({ kind: 'core', id: 'search' }, false);
  assert.equal(harness.wrapperMap.get('search').enabled, false);
  assert.deepEqual(harness.coreApis.filter((call) => call[0].startsWith('wrapper')), [
    ['wrapper.enable', 'search', false], ['wrapper.disable', 'search', false],
  ]);
  assert.equal(harness.coreApis.some((call) => call[0] === 'bulk.enable'), false);
});

test('a failed host readback rejects and preserves a recovery latch', async () => {
  const community = communityHost('alpha');
  const harness = makeHarness({ community: community.api });
  community.api.enablePluginAndSave = async () => {};
  await assert.rejects(harness.runtime.setEnabled({ kind: 'community', id: 'alpha' }, true), /readback/i);
  assert.ok(harness.runtime.local.recoveryReason);
});

test('the shared queue serializes mutations and each write verifies a fresh disk preimage', async () => {
  const community = communityHost('alpha');
  const harness = makeHarness({ community: community.api });
  const order = [];
  const first = harness.runtime.enqueue('first', async () => {
    order.push('first:start');
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push('first:end');
  });
  const second = harness.runtime.enqueue('second', async () => { order.push('second'); });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first:start', 'first:end', 'second']);
  await harness.runtime.enqueue('transaction-save', async (tx) => tx.save());
  await harness.runtime.save();
  const dataPath = '.obsidian/plugins/aigility-plugin-manager/data.json';
  harness.files.set(dataPath, JSON.stringify({ schemaVersion: 1, externally: true }));
  await assert.rejects(harness.runtime.save(), /conflict.*refresh/i);
  assert.match(harness.files.get(dataPath), /externally/);
});

test('profile undo skips plugins changed manually after the profile operation', async () => {
  const community = communityHost('alpha');
  const state = makeState({
    records: { 'community:alpha': { ref: { kind: 'community', id: 'alpha' }, name: 'Alpha', version: '1', tags: ['desktop'], group: '', desired: false, metadata: {} } },
    tags: [{ id: 'desktop', name: 'Desktop' }],
    deviceProfiles: [{ id: 'desktop', name: 'Desktop', tagIds: ['desktop'], applyAtStart: true }],
  });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.start(false);
  await harness.runtime.applyProfile('desktop');
  await harness.runtime.setEnabled({ kind: 'community', id: 'alpha' }, false);
  await harness.runtime.undoProfile();
  assert.equal(community.enabledIds.has('alpha'), false);
});

test('local profile binding is isolated by app id and vault path', async () => {
  const state = makeState({ deviceProfiles: [{ id: 'desktop', name: 'Desktop', tagIds: [], applyAtStart: true }] });
  const first = makeHarness({ state: structuredClone(state), appId: 'same', path: '/one' });
  const second = makeHarness({ state: structuredClone(state), appId: 'same', path: '/two' });
  await first.runtime.bindProfile('desktop');
  assert.equal(first.runtime.local.deviceProfileId, 'desktop');
  assert.equal(second.runtime.local.deviceProfileId, undefined);
});

test('deferred plugins are excluded from autostart and enabled once after their delay', async () => {
  const community = communityHost('slow', true);
  const state = makeState({ deferred: [{ id: 'slow', delayMs: 100, enabled: true }] });
  state.tags = [{ id: 'auto', name: 'Auto' }];
  state.records['community:slow'] = { ref: { kind: 'community', id: 'slow' }, name: 'slow', version: '1', tags: ['auto'], group: '', desired: true, metadata: {} };
  state.deviceProfiles = [{ id: 'auto', name: 'Auto', tagIds: ['auto'], applyAtStart: true }];
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.bindProfile('auto');
  await harness.runtime.applyProfile('auto');
  await harness.runtime.start(false);
  await harness.runtime.start(false);
  harness.workspaceCallbacks[0]();
  await harness.runtime.enqueue('flush-layout-ready', async () => {});
  assert.equal(community.enabledIds.has('slow'), false);
  assert.equal(harness.app.__aigilityClock.jobs.size, 1);
  await harness.app.__aigilityClock.runNext();
  assert.equal(community.apiCalls.filter(([name]) => name === 'enablePlugin').length, 1);
});

test('profile intent schedules a deferred member instead of loading it immediately, then undo restores it', async () => {
  const community = communityHost('slow');
  const state = makeState({
    records: { 'community:slow': { ref: { kind: 'community', id: 'slow' }, name: 'Slow', version: '1', tags: ['desktop'], group: '', desired: false, metadata: {} } },
    tags: [{ id: 'desktop', name: 'Desktop' }],
    deviceProfiles: [{ id: 'desktop', name: 'Desktop', tagIds: ['desktop'], applyAtStart: true }],
    deferred: [{ id: 'slow', delayMs: 25, enabled: true }],
  });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.bindProfile('desktop');
  await harness.runtime.start(false);
  harness.workspaceCallbacks[0]();
  await harness.runtime.enqueue('flush-layout-ready', async () => {});
  assert.equal(community.enabledIds.has('slow'), false);
  assert.equal(state.records['community:slow'].desired, true);
  assert.equal(harness.app.__aigilityClock.jobs.size, 1);
  await harness.app.__aigilityClock.runNext();
  await harness.runtime.undoProfile();
  assert.equal(community.enabledIds.has('slow'), false);
  assert.equal(state.records['community:slow'].desired, false);
});

test('a canceled deferred callback cannot outrun its replacement timer', async () => {
  const community = communityHost('slow');
  const state = makeState({
    records: { 'community:slow': { ref: { kind: 'community', id: 'slow' }, name: 'Slow', version: '1', tags: ['auto'], group: '', desired: true, metadata: {} } },
    tags: [{ id: 'auto', name: 'Auto' }],
    deviceProfiles: [{ id: 'auto', name: 'Auto', tagIds: ['auto'], applyAtStart: true }],
    deferred: [{ id: 'slow', delayMs: 20, enabled: true }],
  });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.bindProfile('auto');
  await harness.runtime.start(false);
  harness.workspaceCallbacks[0]();
  await harness.runtime.enqueue('flush-layout-ready', async () => {});
  const clock = harness.app.__aigilityClock;
  const staleId = [...clock.jobs.keys()][0];
  await harness.runtime.applyProfile('auto');
  const replacementId = [...clock.jobs.keys()][0];
  assert.notEqual(replacementId, staleId);
  await clock.runStale(staleId);
  assert.equal(community.enabledIds.has('slow'), false);
  assert.equal(clock.jobs.size, 1);
});

test('parked deferred plugins stay off, and pause cancels scheduled timers', async () => {
  const community = communityHost('parked', true);
  const state = makeState({ deferred: [{ id: 'parked', delayMs: 100, enabled: true, parked: true }] });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.start(false);
  harness.workspaceCallbacks[0]();
  await harness.runtime.enqueue('flush-layout-ready', async () => {});
  assert.equal(community.enabledIds.has('parked'), false);
  assert.equal(harness.app.__aigilityClock.jobs.size, 0);
  harness.runtime.pause('debugging');
  assert.equal(harness.app.__aigilityClock.jobs.size, 0);
});

test('manual plugin-off, debug pause, recovery pause, and unload cancel delayed generations', async () => {
  const makeScheduled = async (id) => {
    const community = communityHost(id, true);
    const state = makeState({
      deferred: [{ id, delayMs: 100, enabled: true }],
      tags: [{ id: 'auto', name: 'Auto' }],
      records: { [`community:${id}`]: { ref: { kind: 'community', id }, name: id, version: '1', tags: ['auto'], group: '', desired: true, metadata: {} } },
      deviceProfiles: [{ id: 'auto', name: 'Auto', tagIds: ['auto'], applyAtStart: true }],
    });
    const harness = makeHarness({ state, community: community.api });
    await harness.runtime.bindProfile('auto');
    await harness.runtime.start(false);
    harness.workspaceCallbacks[0]();
    await harness.runtime.enqueue('flush-layout-ready', async () => {});
    assert.equal(harness.app.__aigilityClock.jobs.size, 1);
    return { community, harness };
  };
  const manual = await makeScheduled('manual-off');
  await manual.harness.runtime.setEnabled({ kind: 'community', id: 'manual-off' }, false);
  assert.equal(manual.harness.app.__aigilityClock.jobs.size, 0);
  const debug = await makeScheduled('debug-pause');
  debug.harness.runtime.pause('debug session started');
  assert.equal(debug.harness.app.__aigilityClock.jobs.size, 0);
  const recovery = await makeScheduled('recovery-pause');
  recovery.harness.runtime.pause('recovery requested');
  assert.equal(recovery.harness.app.__aigilityClock.jobs.size, 0);
  const unload = await makeScheduled('unload');
  unload.harness.runtime.dispose();
  assert.equal(unload.harness.app.__aigilityClock.jobs.size, 0);
});

test('workspace selection occurs only after normal layout-ready startup', async () => {
  const state = makeState({ deviceProfiles: [{ id: 'desktop', name: 'Desktop', tagIds: [], applyAtStart: false, workspaceId: 'desktop-layout' }] });
  const harness = makeHarness({ state });
  harness.app.workspace.loadWorkspace = undefined;
  const savedWorkspaces = {
    activeWorkspace: 'old-layout',
    loadWorkspace: async (id) => {
      harness.workspaceCalls.push(id);
      savedWorkspaces.activeWorkspace = id;
    },
  };
  harness.app.internalPlugins.plugins.workspaces = { enabled: true, instance: { ...savedWorkspaces, loadWorkspace: async (workspace) => { harness.workspaceCalls.push(workspace); return true; } } };
  await harness.runtime.bindProfile('desktop');
  await harness.runtime.start(false);
  assert.deepEqual(harness.workspaceCalls, []);
  harness.workspaceCallbacks[0]();
  await harness.runtime.enqueue('flush-layout-ready', async () => {});
  assert.deepEqual(harness.workspaceCalls, ['desktop-layout']);
});

test('normal startup clones desktop workspace d into only missing t and m variants', async () => {
  const harness = makeHarness();
  const desktop = { main: { id: 'files', type: 'leaf' } };
  const existingTablet = { main: { id: 'user-tablet-layout', type: 'leaf' } };
  let saves = 0;
  harness.app.internalPlugins.plugins.workspaces = {
    enabled: true,
    instance: {
      workspaces: { d: desktop, t: existingTablet },
      saveData: async () => { saves++; },
      loadWorkspace: async (workspace) => { harness.workspaceCalls.push(workspace); return true; },
    },
  };
  await harness.runtime.start(false);
  assert.equal(harness.app.internalPlugins.plugins.workspaces.instance.workspaces.m, undefined);
  harness.workspaceCallbacks[0]();
  await harness.runtime.enqueue('flush-layout-ready', async () => {});
  const workspaces = harness.app.internalPlugins.plugins.workspaces.instance.workspaces;
  assert.deepEqual(workspaces.t, existingTablet);
  assert.deepEqual(workspaces.m, desktop);
  assert.notEqual(workspaces.m, desktop);
  assert.equal(saves, 1);
});

test('global plugin disable synchronously pauses and persists before unload, then dispose restores the method', async () => {
  const community = communityHost('slow', true);
  const state = makeState({
    deferred: [{ id: 'slow', delayMs: 100, enabled: true }],
    tags: [{ id: 'auto', name: 'Auto' }],
    records: { 'community:slow': { ref: { kind: 'community', id: 'slow' }, name: 'Slow', version: '1', tags: ['auto'], group: '', desired: true, metadata: {} } },
    deviceProfiles: [{ id: 'auto', name: 'Auto', tagIds: ['auto'], applyAtStart: true }],
  });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.bindProfile('auto');
  const original = community.api.setEnable;
  await harness.runtime.start(false);
  harness.workspaceCallbacks[0]();
  await harness.runtime.enqueue('flush-layout-ready', async () => {});
  assert.equal(harness.app.__aigilityClock.jobs.size, 1);
  const disabling = community.api.setEnable(false);
  assert.equal(harness.app.__aigilityClock.jobs.size, 0);
  assert.equal(harness.runtime.local.recoveryReason, 'Obsidian plugin manager was disabled.');
  assert.match(globalThis.localStorage.getItem(harness.runtime.localKey), /recoveryReason/);
  await disabling;
  harness.runtime.dispose();
  assert.equal(community.api.setEnable, original);
});

test('a deferred plugin that leaks into loaded state is removed from native autostart', async () => {
  const community = communityHost('leaked', false);
  community.instance._loaded = true;
  const state = makeState({ deferred: [{ id: 'leaked', delayMs: 100, enabled: true, parked: true }] });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.start(false);
  assert.equal(community.instance._loaded, false);
  assert.equal(community.enabledIds.has('leaked'), false);
  assert.equal(harness.runtime.list().find((item) => item.ref.id === 'leaked').loaded, false);
  assert.equal(harness.app.__aigilityClock.jobs.size, 0);
});

test('late load, restricted mode, and interrupted operations persistently pause startup automation', async () => {
  for (const setup of [
    { late: true },
    { restricted: true },
    { pending: true },
  ]) {
    const community = communityHost('slow', true);
    const state = makeState({
      deferred: [{ id: 'slow', delayMs: 100, enabled: true }],
      deviceProfiles: [{ id: 'desktop', name: 'Desktop', tagIds: [], applyAtStart: true, workspaceId: 'desktop-layout' }],
    });
    const harness = makeHarness({ state, community: community.api, restricted: setup.restricted });
    if (setup.pending) harness.runtime.local.deviceProfileId = 'desktop';
    if (setup.pending) harness.runtime.local.operationPending = 'profile:desktop';
    await harness.runtime.start(Boolean(setup.late));
    assert.ok(harness.runtime.local.recoveryReason);
    assert.equal(community.enabledIds.has('slow'), false);
    assert.equal(harness.app.__aigilityClock.jobs.size, 0);
    assert.deepEqual(harness.workspaceCalls, []);
  }
});

test('resume refreshes disk state before clearing an interrupted-operation latch', async () => {
  const state = makeState({ records: { 'community:alpha': { ref: { kind: 'community', id: 'alpha' }, name: 'Alpha', version: '1', tags: [], group: '', desired: false, metadata: {} } } });
  const community = communityHost('alpha');
  const harness = makeHarness({ state, community: community.api });
  harness.runtime.local.operationPending = 'profile:desktop';
  await harness.runtime.start(true);
  const disk = JSON.parse(harness.files.get('.obsidian/plugins/aigility-plugin-manager/data.json'));
  disk.records['community:alpha'].name = 'Changed elsewhere';
  harness.files.set('.obsidian/plugins/aigility-plugin-manager/data.json', JSON.stringify(disk));
  await harness.runtime.resume();
  assert.equal(harness.runtime.state.records['community:alpha'].name, 'Changed elsewhere');
  assert.equal(harness.runtime.local.operationPending, undefined);
  assert.equal(harness.runtime.local.recoveryReason, undefined);
  assert.equal(harness.app.__aigilityClock.jobs.size, 0);
  assert.equal(harness.runtime.local.abandonedOperations?.[0]?.operation, 'profile:desktop');
});

test('explicit late resume schedules the bound profile after layout readiness', async () => {
  const community = communityHost('slow');
  const state = makeState({
    records: { 'community:slow': { ref: { kind: 'community', id: 'slow' }, name: 'Slow', version: '1', tags: ['auto'], group: '', desired: true, metadata: {} } },
    tags: [{ id: 'auto', name: 'Auto' }],
    deviceProfiles: [{ id: 'auto', name: 'Auto', tagIds: ['auto'], applyAtStart: true }],
    deferred: [{ id: 'slow', delayMs: 30, enabled: true }],
  });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.bindProfile('auto');
  await harness.runtime.start(true);
  assert.equal(harness.app.__aigilityClock.jobs.size, 0);
  await harness.runtime.resume();
  assert.equal(harness.runtime.local.recoveryReason, undefined);
  assert.equal(harness.app.__aigilityClock.jobs.size, 1);
});

test('an equal manual enable advances the mutation generation and protects profile undo', async () => {
  const community = communityHost('alpha');
  const state = makeState({
    records: { 'community:alpha': { ref: { kind: 'community', id: 'alpha' }, name: 'Alpha', version: '1', tags: ['desktop'], group: '', desired: false, metadata: {} } },
    tags: [{ id: 'desktop', name: 'Desktop' }],
    deviceProfiles: [{ id: 'desktop', name: 'Desktop', tagIds: ['desktop'], applyAtStart: true }],
  });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.start(false);
  await harness.runtime.applyProfile('desktop');
  const beforeManual = harness.runtime.getMutationGeneration({ kind: 'community', id: 'alpha' });
  await community.api.enablePluginAndSave('alpha');
  assert.ok(harness.runtime.getMutationGeneration({ kind: 'community', id: 'alpha' }) > beforeManual);
  await harness.runtime.undoProfile();
  assert.equal(community.enabledIds.has('alpha'), true);
});

test('queued transaction can save and debug-load without reentering or persisting native enablement', async () => {
  const community = communityHost('debug-target');
  const state = makeState({ deferred: [{ id: 'debug-target', delayMs: 10, enabled: true }] });
  const harness = makeHarness({ state, community: community.api });
  harness.runtime.pause('debug session active');
  await harness.runtime.enqueue('debug-step', async (tx) => {
    await tx.setEnabled({ kind: 'community', id: 'debug-target' }, true, { loadNow: true, origin: 'debugging' });
    await tx.save();
  });
  assert.equal(community.instance._loaded, true);
  assert.equal(community.enabledIds.has('debug-target'), false);
});

test('a deferred policy edit on a loaded native plugin drops native autostart, keeps desired, and cancels timers', async () => {
  const community = communityHost('alpha', true);
  const state = makeState({
    deferred: [{ id: 'alpha', delayMs: 100, enabled: true }],
    tags: [{ id: 'auto', name: 'Auto' }],
    records: { 'community:alpha': { ref: { kind: 'community', id: 'alpha' }, name: 'alpha', version: '1', tags: ['auto'], group: '', desired: true, metadata: {} } },
    deviceProfiles: [{ id: 'auto', name: 'Auto', tagIds: ['auto'], applyAtStart: true }],
  });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.bindProfile('auto');
  await harness.runtime.start(false);
  harness.workspaceCallbacks[0]();
  await harness.runtime.enqueue('flush-layout-ready', async () => {});
  assert.equal(harness.app.__aigilityClock.jobs.size, 1);

  // The UI path: pause first, so the edit itself invalidates every timer.
  await harness.runtime.enqueue('ui:deferred-policy-save:alpha', async (tx) => {
    harness.runtime.pause('deferred-policy-edit');
    assert.equal(typeof tx.reconcileDeferred, 'function');
    await tx.reconcileDeferred({ kind: 'community', id: 'alpha' });
  });
  assert.equal(community.enabledIds.has('alpha'), false, 'native autostart is excluded even while the plugin was loaded');
  assert.equal(community.instance._loaded, false, 'a loaded deferred candidate is unloaded nonpersistently');
  assert.equal(state.records['community:alpha'].desired, true, 'policy desired is retained for the later scheduled load');
  assert.equal(harness.app.__aigilityClock.jobs.size, 0, 'no scheduled load survives a policy edit');
  assert.equal(harness.runtime.local.operationPending, undefined, 'the helper saves nothing of its own');
});

test('deferred reconciliation never loads a plugin and ignores membership, and an off policy keeps native off', async () => {
  const community = communityHost('alpha');
  const state = makeState({ deferred: [{ id: 'alpha', delayMs: 100, enabled: true }] });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.start(false);
  await harness.runtime.enqueue('reconcile-alpha', async (tx) => {
    // No bound profile and no desired record: the policy is still a host-level
    // claim, so exclusion happens and nothing is loaded.
    await tx.reconcileDeferred({ kind: 'community', id: 'alpha' });
  });
  assert.equal(community.instance._loaded, false);
  assert.equal(community.enabledIds.has('alpha'), false);

  // A policy turned off must not re-enable native autostart on its own.
  state.deferred = [{ id: 'alpha', delayMs: 100, enabled: false }];
  await harness.runtime.enqueue('reconcile-alpha-off', async (tx) => {
    await tx.reconcileDeferred({ kind: 'community', id: 'alpha' });
  });
  assert.equal(community.enabledIds.has('alpha'), false, 'an off policy leaves native autostart off until an explicit reapply');
  assert.equal(community.instance._loaded, false);
});

test('a deferred policy for the protected manager keeps its native startup, surfaces the conflict, and rejects the edit', async () => {
  const id = 'aigility-plugin-manager';
  const community = communityHost(id, true);
  const state = makeState({ deferred: [{ id, delayMs: 50, enabled: true }] });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.start(false);
  assert.ok(state.protected.includes('community:aigility-plugin-manager'), 'the manager protects itself on load');
  assert.equal(community.enabledIds.has(id), true, 'self protection includes retaining native startup');
  assert.equal(community.instance._loaded, true, 'the manager keeps its own loaded instance');
  assert.match(harness.runtime.local.recoveryReason, /protect|conflict/i, 'the contradictory policy is surfaced in recovery');
  await assert.rejects(
    harness.runtime.enqueue('reconcile-self', (tx) => tx.reconcileDeferred({ kind: 'community', id })),
    /protect|manager|conflict/i,
  );
  assert.equal(community.enabledIds.has(id), true, 'a rejected edit leaves native autostart alone');
  assert.equal(community.instance._loaded, true);
  assert.equal(state.deferred[0].id, id, 'the imported policy is retained, not silently dropped');
});

test('an enabled deferred policy for any other protected plugin is refused before the host is touched', async () => {
  const community = communityHost('keeper', true);
  addCommunity(community, 'alpha', { enabled: true });
  const state = makeState({
    protected: ['community:keeper'],
    deferred: [{ id: 'keeper', delayMs: 50, enabled: true }, { id: 'alpha', delayMs: 50, enabled: true }],
  });
  const harness = makeHarness({ state, community: community.api });
  await harness.runtime.start(false);
  assert.equal(community.enabledIds.has('keeper'), true, 'a protected ref keeps native autostart through start');
  assert.equal(community.instance._loaded, true);
  assert.equal(community.enabledIds.has('alpha'), false, 'a normal unprotected deferred plugin is still excluded');
  assert.match(harness.runtime.local.recoveryReason, /keeper|protect|conflict/i);
  await assert.rejects(
    harness.runtime.enqueue('reconcile-keeper', (tx) => tx.reconcileDeferred({ kind: 'community', id: 'keeper' })),
    /protect|conflict/i,
  );
  assert.equal(community.enabledIds.has('keeper'), true);
  assert.equal(community.instance._loaded, true);
});

test('a core deferred policy is rejected before its persistent native flag is mutated', async () => {
  const community = communityHost('alpha');
  const state = makeState({ deferred: [{ id: 'recorder', delayMs: 50, enabled: true }] });
  const harness = makeHarness({ state, community: community.api, core: { recorder: true } });
  await harness.runtime.start(false);
  assert.equal(harness.wrapperMap.get('recorder').enabled, true, 'core exclusion never fakes a nonpersistent deferment');
  await assert.rejects(
    harness.runtime.enqueue('reconcile-core', (tx) => tx.reconcileDeferred({ kind: 'core', id: 'recorder' })),
    /core/i,
  );
  assert.equal(harness.wrapperMap.get('recorder').enabled, true, 'the rejected edit leaves the core native flag untouched');
  assert.equal(harness.coreApis.some(([call]) => call === 'wrapper.disable'), false, 'no core disable was issued');
});

test('unrelated interrupted operations still reject diagnostic host mutations', async () => {
  const community = communityHost('alpha');
  const harness = makeHarness({ community: community.api });
  harness.runtime.local.operationPending = 'profile:desktop';
  await assert.rejects(
    harness.runtime.enqueue('diagnostic-step', async (tx) => {
      await tx.setEnabled({ kind: 'community', id: 'alpha' }, true, { loadNow: true, origin: 'debugging' });
    }),
    /automation is paused/,
  );
  assert.equal(community.instance._loaded, false);
});

test('an interrupted-operation pause is a latch, not a diagnosis, so a diagnostic origin still rejects', async () => {
  const community = communityHost('alpha');
  const harness = makeHarness({ community: community.api });
  await harness.runtime.start(false);
  harness.runtime.local.operationPending = 'profile-apply:interrupted';
  harness.runtime.pause('Interrupted operation: profile-apply:interrupted');
  await assert.rejects(
    harness.runtime.enqueue('diagnostic-bypass-attempt', async (tx) => {
      await tx.setEnabled({ kind: 'community', id: 'alpha' }, false, { loadNow: true, origin: 'debugging' });
    }),
    /paused|pending|recovery/i,
  );
  assert.equal(community.enabledIds.has('alpha'), false, 'recovery leaves the host exactly as it was');
  assert.equal(community.instance._loaded, false);
  assert.equal(harness.runtime.local.operationPending, 'profile-apply:interrupted', 'the latch survives the rejected diagnostic mutation');
});

test('unload restores the restricted-mode wrapper and pauses before host unload', async () => {
  const community = communityHost('alpha');
  const harness = makeHarness({ community: community.api });
  const original = community.api.setEnable;
  await harness.runtime.start(false);
  await community.api.setEnable(false);
  assert.ok(harness.runtime.local.recoveryReason);
  harness.runtime.dispose();
  assert.equal(community.api.setEnable, original);
});

test('effective state is written inside the plugin folder without secrets', async () => {
  const state = makeState({ legacyBpm: { token: 'do-not-write' } });
  const harness = makeHarness({ state });
  await harness.runtime.writeEffectiveState();
  const report = harness.files.get('.obsidian/plugins/aigility-plugin-manager/effective-state.json');
  assert.ok(report);
  assert.equal(report.includes('do-not-write'), false);
  const parsed = JSON.parse(report);
  assert.ok(parsed.profile);
  assert.ok(parsed.recovery);
  assert.equal(parsed.plugins[0].membership, false);
});
