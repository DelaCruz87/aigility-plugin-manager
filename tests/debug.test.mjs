import assert from 'node:assert/strict';
import test from 'node:test';
import { importModule } from '../test.config.mjs';

globalThis.self ??= globalThis;

const plugins = [
  { ref: { kind: 'community', id: 'a' }, name: 'A', version: '1', installed: true, compatible: true, nativeAutostart: false, loaded: true, desired: true, tags: [], group: '', scheduled: false },
  { ref: { kind: 'community', id: 'b' }, name: 'B', version: '1', installed: true, compatible: true, nativeAutostart: true, loaded: true, desired: true, tags: [], group: '', scheduled: false },
  { ref: { kind: 'core', id: 'sync' }, name: 'Sync', version: '1', installed: true, compatible: true, nativeAutostart: true, loaded: true, desired: true, tags: [], group: '', scheduled: false },
  { ref: { kind: 'community', id: 'manager' }, name: 'Manager', version: '1', installed: true, compatible: true, nativeAutostart: true, loaded: true, desired: true, tags: [], group: '', scheduled: false },
];

function fixture({ generations = true, mobile = false } = {}) {
  const items = [...plugins];
  const current = new Map(items.map((item) => [`${item.ref.kind}:${item.ref.id}`, { desired: item.desired, nativeAutostart: item.nativeAutostart, loaded: item.loaded }]));
  const generation = new Map([...current.keys()].map((key) => [key, 0]));
  const state = { schemaVersion: 1, records: {}, tags: [], groups: [], deviceProfiles: [], fixtureProfiles: [], deferred: [{ id: 'community:a', delayMs: 100, enabled: true }], protected: ['community:manager'], profileBackups: [], githubSources: {}, settings: { staggerMs: 0, automaticUpdates: true }, debug: undefined, legacyBpm: {} };
  let queue = Promise.resolve();
  const runtime = {
    state,
    local: { recoveryReason: 'preexisting reason' },
    paused: [],
    saves: 0,
    changes: [],
    pause(reason) { this.local.recoveryReason = reason; this.paused.push(reason); },
    enqueue(_label, operation) {
      const tx = {
        async refresh() {},
        async save() { runtime.saves++; },
        async writeEffectiveState() { runtime.effectiveWrites++; },
        async setEnabled(ref, enabled, options = {}) {
          const id = `${ref.kind}:${ref.id}`;
          const state = current.get(id);
          if (enabled && id === 'community:a' && state.nativeAutostart === false && options.loadNow !== true) throw new Error('deferred load requires loadNow');
          state.desired = enabled;
          if (ref.kind === 'community' && options.loadNow) { state.loaded = enabled; }
          else { state.nativeAutostart = enabled; state.loaded = enabled; }
          if (generations) generation.set(id, generation.get(id) + 1);
          runtime.changes.push([id, enabled, options]);
        },
      };
      const run = queue.then(() => operation(tx), () => operation(tx));
      queue = run.catch(() => {});
      return run;
    },
    getMutationGeneration(ref) { return generations ? generation.get(`${ref.kind}:${ref.id}`) : undefined; },
    externalSet(id, enabled) { Object.assign(current.get(id), { desired: enabled }); if (generations) generation.set(id, generation.get(id) + 1); },
    current,
    addPlugin(item) {
      items.push(item);
      const id = `${item.ref.kind}:${item.ref.id}`;
      current.set(id, { desired: item.desired, nativeAutostart: item.nativeAutostart, loaded: item.loaded });
      generation.set(id, 0);
    },
    timeout(ms = 250) { return new Promise((_, reject) => setTimeout(() => reject(new Error('serial queue timed out')), ms)); },
  };
  runtime.list = () => items.map((plugin) => ({ ...plugin, ...current.get(`${plugin.ref.kind}:${plugin.ref.id}`) }));
  const app = {
    isMobile: mobile,
    loadLocalStorage(key) { return key === 'DebugMode' ? (this.debugModeValue ? '1' : '0') : null; },
    debugMode(value) { this.debugModeValue = value; },
    vault: { adapter: { thingsHappening() { return 'native'; } } },
  };
  return { runtime, app, plugin: { manifest: { id: 'aigility-plugin-manager' } }, generation };
}

test('start protects core/community manager state, snapshots and pauses before any mutation', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  assert.equal(f.runtime.paused[0], 'debugging');
  assert.equal(f.runtime.local.recoveryReason, 'debugging');
  assert.equal(f.runtime.current.get('community:manager').desired, true);
  assert.ok(f.runtime.state.debug.active);
  assert.equal(f.runtime.state.debug.interrupted, false);
  assert.equal(f.runtime.state.debug.snapshot.plugins['community:a'].version, '1');
  assert.deepEqual(Object.keys(f.runtime.state.debug.snapshot.plugins), plugins.map((item) => `${item.ref.kind}:${item.ref.id}`));
  assert.equal(f.runtime.state.debug.snapshot.deferred[0].delayMs, 100);
  assert.ok(f.runtime.saves >= 1);
});

test('default candidate universe excludes every installed but inactive plugin', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  f.runtime.addPlugin({ ref: { kind: 'community', id: 'active-five' }, name: 'Active', version: '1', installed: true, compatible: true, nativeAutostart: false, loaded: true, desired: true, tags: [], group: '', scheduled: false });
  for (let index = 0; index < 718; index++) {
    f.runtime.addPlugin({ ref: { kind: 'community', id: `off-${index}` }, name: 'Off', version: '1', installed: true, compatible: true, nativeAutostart: false, loaded: false, desired: false, tags: [], group: '', scheduled: false });
  }
  assert.equal(f.runtime.list().length, 723);
  assert.equal(f.runtime.list().filter((item) => item.desired || item.nativeAutostart || item.loaded).length, 5);
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  assert.deepEqual(manager.session.candidates, ['community:a', 'community:b', 'core:sync', 'community:active-five']);
  assert.equal(manager.session.experimentUniverse.length, 4);
  assert.equal(f.runtime.changes.length, 0);
});

test('default set excludes desired-only plugins that are neither loaded, native nor scheduled', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  f.runtime.addPlugin({ ref: { kind: 'community', id: 'inert' }, name: 'Inert', version: '1', installed: true, compatible: true, nativeAutostart: false, loaded: false, desired: true, tags: [], group: '', scheduled: false });
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  assert.equal(manager.session.candidates.includes('community:inert'), false, 'desired alone cannot enter a real diagnostic run');
  assert.equal(manager.session.experimentUniverse.includes('community:inert'), false, 'inactive unselected plugin stays outside isolation mutations');
  assert.equal(manager.session.originals['community:inert'], undefined);
  assert.deepEqual(manager.session.candidates, ['community:a', 'community:b', 'core:sync']);
});

test('explicit selection still admits an installed compatible but inactive plugin', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  f.runtime.addPlugin({ ref: { kind: 'community', id: 'inert' }, name: 'Inert', version: '1', installed: true, compatible: true, nativeAutostart: false, loaded: false, desired: true, tags: [], group: '', scheduled: false });
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start([{ kind: 'community', id: 'inert' }]);
  assert.deepEqual(manager.session.candidates, ['community:inert']);
  assert.equal(manager.session.experimentUniverse.includes('community:inert'), true, 'explicit opt-in keeps the plugin in the universe');
  assert.equal(manager.session.originals['community:inert'], true);
});

test('default set includes scheduled-and-desired plugins and skips scheduled-but-undesired ones', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  f.runtime.addPlugin({ ref: { kind: 'community', id: 'pending' }, name: 'Pending', version: '1', installed: true, compatible: true, nativeAutostart: false, loaded: false, desired: true, tags: [], group: '', scheduled: true });
  f.runtime.addPlugin({ ref: { kind: 'community', id: 'parked' }, name: 'Parked', version: '1', installed: true, compatible: true, nativeAutostart: false, loaded: false, desired: false, tags: [], group: '', scheduled: true });
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  assert.deepEqual(manager.session.candidates, ['community:a', 'community:b', 'core:sync', 'community:pending']);
  assert.equal(manager.session.experimentUniverse.includes('community:pending'), true);
  assert.equal(manager.session.experimentUniverse.includes('community:parked'), false);
});

test('selected experiment switches every active outsider off and tests a disabled deferred candidate', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  f.runtime.addPlugin({ ref: { kind: 'community', id: 'disabled' }, name: 'Disabled', version: '3', installed: true, compatible: true, nativeAutostart: false, loaded: false, desired: false, tags: [], group: '', scheduled: false });
  f.runtime.state.deferred.push({ id: 'disabled', delayMs: 900, enabled: true });
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start([{ kind: 'community', id: 'disabled' }]);
  await manager.testSingle({ kind: 'community', id: 'disabled' });
  assert.equal(f.runtime.current.get('community:disabled').loaded, true);
  assert.equal(f.runtime.current.get('community:disabled').nativeAutostart, false);
  for (const id of ['community:a', 'community:b', 'core:sync']) assert.equal(f.runtime.current.get(id).loaded, false, `${id} must be off during the selected experiment`);
  assert.ok(f.runtime.changes.some(([, , options]) => options.loadNow === true && options.origin === 'debugging'));
  await manager.finish();
  assert.deepEqual(f.runtime.current.get('community:disabled'), { desired: false, nativeAutostart: false, loaded: false });
});

test('one remaining suspect is tested as a single candidate by testHalf', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start([{ kind: 'community', id: 'a' }]);
  await manager.testHalf();
  assert.equal(manager.session.currentStep.mode, 'single');
  assert.deepEqual(manager.session.currentStep.testRefs, ['community:a']);
});

test('half/complement observations narrow suspects and pair mode records interaction without blaming a plugin', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.testHalf();
  const half = manager.session.currentStep.testRefs;
  await manager.observe('reproduces', 'fails');
  assert.deepEqual(manager.session.suspects, half);
  await manager.testHalf(true);
  const complement = manager.session.currentStep.testRefs;
  await manager.observe('not reproduced', 'passes');
  const remaining = half.filter((id) => !complement.includes(id));
  assert.deepEqual(manager.session.suspects, remaining);
  await manager.testPair({ kind: 'community', id: 'a' }, { kind: 'core', id: 'sync' });
  await manager.observe('only the pair reproduces', 'fails');
  assert.equal(manager.session.currentStep.mode, 'pair');
  assert.deepEqual(manager.session.suspects, remaining);
  assert.deepEqual(manager.session.interactions.at(-1).refs, ['community:a', 'core:sync']);
});

test('previous restores the last experiment and finish leaves runtime automation paused', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.testHalf();
  await manager.previous();
  assert.equal(f.runtime.current.get('community:a').desired, true);
  assert.equal(f.runtime.current.get('community:b').desired, true);
  await manager.testHalf(true);
  await manager.finish();
  assert.equal(f.runtime.current.get('community:a').desired, true);
  assert.equal(f.runtime.current.get('community:b').desired, true);
  assert.equal(f.runtime.local.recoveryReason, 'debugging');
  assert.equal(f.runtime.state.debug.active, false);
});

test('finish preserves external edits, including a same-state edit when generations are available', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.testHalf();
  const touched = 'core:sync';
  const current = f.runtime.current.get(touched).desired;
  f.runtime.externalSet(touched, !current);
  f.runtime.externalSet(touched, current);
  await manager.finish();
  assert.equal(f.runtime.current.get(touched).desired, current);
  assert.ok(manager.session.conflicts.some((conflict) => conflict.ref === touched));
});

test('interrupted session is persisted and never resumes candidate mutations automatically', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.testHalf();
  manager.dispose();
  assert.equal(f.runtime.state.debug.active, true);
  const changes = [...f.runtime.changes];
  const resumed = new DebugManager(f.runtime, f.app, f.plugin);
  assert.equal(resumed.session.interrupted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.runtime.state.debug.interrupted, true);
  assert.deepEqual(f.runtime.changes, changes);
  await assert.rejects(resumed.testHalf(), /reanudar|resume/i);
  await resumed.resume();
  assert.equal(resumed.session.interrupted, false);
  assert.equal(resumed.session.actualOnResume['community:a'].desired, f.runtime.current.get('community:a').desired);
  assert.deepEqual(f.runtime.changes, changes, 'explicit resume records live state and never replays prior mutations');
});

test('reports export chronological steps and redact secret-shaped fields', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.testHalf();
  await manager.observe('safe note', 'unknown');
  manager.session.observations.push({ at: new Date().toISOString(), note: 'token=do-not-export', result: 'unknown' });
  const report = await manager.exportReports();
  assert.match(report.markdown, /safe note/);
  assert.equal(JSON.parse(report.json).session.steps.length, 1);
  assert.doesNotMatch(report.json, /do-not-export/);
});

test('advanced integration applies actual upstream-backed controls and restores only owned state', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture({ mobile: true });
  let namespaces = ['old'];
  f.app.debugNamespaceController = { get: () => [...namespaces], set: (items) => { namespaces = [...items]; }, enable: (items) => { namespaces = typeof items === 'string' ? items.split(',') : [...items]; }, disable: () => { namespaces = []; } };
  f.app.showMobileConsole = () => { f.app.consoleShown = true; return () => { f.app.consoleShown = false; }; };
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.advanced(true);
  await manager.configureAdvanced('debugMode', true);
  await manager.configureAdvanced('namespaces', ['plugin:a']);
  await manager.configureAdvanced('mobileConsole', true);
  assert.equal(f.app.debugModeValue, true);
  assert.deepEqual(namespaces, ['plugin:a']);
  assert.equal(f.app.consoleShown, true);
  await manager.advanced(false);
  assert.equal(f.app.debugModeValue, false);
  assert.deepEqual(namespaces, ['old']);
  assert.equal(f.app.consoleShown, false);
});

test('DebugManager exposes desktop stack capabilities and restores configured callback and async hooks exactly', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const previousWindow = globalThis.window;
  const originalThen = Promise.prototype.then;
  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  const scheduled = [];
  const originalSetTimeout = function (handler, ...args) { scheduled.push([handler, args]); return scheduled.length; };
  globalThis.window = { setTimeout: originalSetTimeout };
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  try {
    await manager.start();
    const capabilities = new Map(manager.advancedCapabilities().map((entry) => [entry.id, entry]));
    assert.equal(capabilities.get('longStackTraces').supported, true);
    assert.equal(capabilities.get('asyncLongStackTraces').supported, true);
    await manager.advanced(true);
    await manager.configureAdvanced('longStackTraces', true);
    await manager.configureAdvanced('asyncLongStackTraces', true);
    assert.notEqual(Promise.prototype.then, originalThen);
    function namedIntegratedPromiseParent() {
      return Promise.resolve().then(() => { throw new Error('integrated callback failed'); });
    }
    await assert.rejects(namedIntegratedPromiseParent(), (error) => {
      assert.match(error.stack, /namedIntegratedPromiseParent/);
      assert.match(error.stack, /Promise\.then/);
      return true;
    });
    async function namedIntegratedAwaitParent() {
      await Promise.resolve();
      throw new Error('integrated await failed');
    }
    await assert.rejects(namedIntegratedAwaitParent().catch((error) => { throw error; }), (error) => {
      assert.match(error.stack, /namedIntegratedAwaitParent/);
      assert.match(error.stack, /async_hooks\.PROMISE/);
      return true;
    });
    await manager.advanced(false);
    assert.equal(Promise.prototype.then, originalThen);
    assert.equal(EventTarget.prototype.addEventListener, originalAdd);
    assert.equal(EventTarget.prototype.removeEventListener, originalRemove);
    assert.equal(window.setTimeout, originalSetTimeout);
  } finally {
    if (manager.session?.advanced?.active) await manager.advanced(false);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('advanced options fail explicitly when an upstream capability is unavailable', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.advanced(true);
  await assert.rejects(manager.configureAdvanced('mobileEmulation', true), /incompatibility|incompatibilidad|compatibilidad|compatible/i);
  await assert.rejects(manager.configureAdvanced('mobileConsole', true), /incompatibility|incompatibilidad|compatibilidad|compatible/i);
});

test('upstream timeout patch and shared abort controller perform their operations and teardown', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  class FileSystemAdapter { thingsHappening() { return 'native'; } }
  f.app.vault.adapter = new FileSystemAdapter();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.advanced(true);
  await manager.configureAdvanced('timeouts', true);
  const patched = f.app.vault.adapter.thingsHappening;
  assert.notEqual(patched(), 'native');
  const controller = new AbortController();
  globalThis.__obsidianDevUtils = { sharedAbortController: { value: controller } };
  await manager.cancelRunningTask();
  assert.equal(controller.signal.aborted, true);
  await manager.advanced(false);
  assert.notEqual(f.app.vault.adapter.thingsHappening, patched);
  assert.equal(f.app.vault.adapter.thingsHappening(), 'native');
  delete globalThis.__obsidianDevUtils;
});

test('advanced teardown preserves a later manual debug mode edit', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.advanced(true);
  await manager.configureAdvanced('debugMode', true);
  f.app.debugModeValue = false;
  await manager.advanced(false);
  assert.equal(f.app.debugModeValue, false);
});

test('advanced mode suspends an independently enabled upstream plugin and restores it only while owned', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const advancedId = 'advanced-debug-mode';
  const enabledPlugins = new Set([advancedId]);
  const generations = new Map([[advancedId, 0]]);
  f.app.plugins = {
    enabledPlugins,
    plugins: { [advancedId]: { manifest: { id: advancedId }, _loaded: true } },
    getPluginGeneration(id) { return generations.get(id); },
    async disablePlugin(id) { delete this.plugins[id]; },
    async enablePlugin(id) { this.plugins[id] = { manifest: { id }, _loaded: true }; },
  };
  f.plugin.runtime = { getMutationGeneration(id) { return generations.get(id) ?? 0; } };
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.advanced(true);
  assert.equal(Boolean(f.app.plugins.plugins[advancedId]), false);
  assert.equal(manager.session.advanced.restore.independentPlugin.after, false);
  await manager.advanced(false);
  assert.equal(Boolean(f.app.plugins.plugins[advancedId]), true);

  await manager.advanced(true);
  f.app.plugins.plugins[advancedId] = { manifest: { id: advancedId }, _loaded: true };
  generations.set(advancedId, generations.get(advancedId) + 1);
  await manager.advanced(false);
  assert.equal(Boolean(f.app.plugins.plugins[advancedId]), true);
});

test('advanced snapshots rehydrate owned debug mode for explicit finish after reload', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.advanced(true);
  await manager.configureAdvanced('debugMode', true);
  const afterReload = new DebugManager(f.runtime, f.app, f.plugin);
  assert.equal(afterReload.session.interrupted, true);
  await afterReload.finish();
  assert.equal(f.app.debugModeValue, false);
});

test('stack trace limit applies a real Error.stackTraceLimit postimage and restores it', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const initial = Error.stackTraceLimit;
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await manager.advanced(true);
  await manager.configureAdvanced('stackTraceLimit', 0);
  assert.equal(Error.stackTraceLimit, Number.POSITIVE_INFINITY);
  await manager.advanced(false);
  assert.equal(Error.stackTraceLimit, initial);
});

test('failed plugin mutations persist the error branch and keep explicit finish available', async () => {
  const { DebugManager } = await importModule('src/integrated/debug.ts');
  const f = fixture();
  const enqueue = f.runtime.enqueue.bind(f.runtime);
  f.runtime.enqueue = (label, operation) => enqueue(label, (tx) => operation({ ...tx, setEnabled: async (ref, enabled, options) => {
    if (ref.kind === 'core') throw new Error('host rejected core toggle');
    await tx.setEnabled(ref, enabled, options);
  } }));
  const manager = new DebugManager(f.runtime, f.app, f.plugin);
  await manager.start();
  await assert.rejects(manager.testHalf(), /host rejected core toggle/);
  assert.equal(f.runtime.state.debug.steps.at(-1).status, 'error');
  assert.match(f.runtime.state.debug.steps.at(-1).error, /host rejected core toggle/);
  await manager.finish();
  assert.equal(f.runtime.state.debug.active, false);
  assert.equal(f.runtime.current.get('community:a').desired, true);
});

test('real ManagerRuntime serial queue completes diagnostic transaction atomically without deadlock', async () => {
  const [{ DebugManager }, { ManagerRuntime }] = await Promise.all([
    importModule('src/integrated/debug.ts'),
    importModule('src/integrated/runtime.ts'),
  ]);
  globalThis.localStorage ??= { values: new Map(), getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, String(value)); }, removeItem(key) { this.values.delete(key); } };
  const files = new Map();
  const events = [];
  const adapter = {
    async exists(path) { return files.has(path); },
    async read(path) { if (!files.has(path)) throw new Error(`Missing ${path}`); return files.get(path); },
    async write(path, value) { files.set(path, value); if (path.endsWith('/data.json')) events.push('state-write'); },
  };
  const instance = { manifest: { id: 'candidate', name: 'Candidate', version: '1' }, _loaded: true };
  const outsider = { manifest: { id: 'outsider', name: 'Outsider', version: '1' }, _loaded: true };
  const enabledPlugins = new Set(['candidate', 'outsider']);
  const appPlugins = {
    enabledPlugins,
    manifests: { candidate: instance.manifest, outsider: outsider.manifest },
    plugins: { candidate: instance, outsider },
    isEnabled() { return true; },
    async enablePlugin(id) { events.push(`load:${id}`); this.plugins[id]._loaded = true; },
    async enablePluginAndSave(id) { enabledPlugins.add(id); this.plugins[id]._loaded = true; },
    async disablePlugin(id) { events.push(`unload:${id}`); this.plugins[id]._loaded = false; },
    async disablePluginAndSave(id) { enabledPlugins.delete(id); this.plugins[id]._loaded = false; },
    async saveConfig() {},
  };
  const state = { schemaVersion: 1, records: {}, tags: [], groups: [], deviceProfiles: [], fixtureProfiles: [], deferred: [], protected: [], profileBackups: [], githubSources: {}, settings: { staggerMs: 0, automaticUpdates: false }, legacyBpm: {} };
  files.set('.obsidian/plugins/aigility-plugin-manager/data.json', JSON.stringify(state));
  const app = { appId: 'debug-real-queue', plugins: appPlugins, internalPlugins: { plugins: {} }, vault: { adapter, configDir: '.obsidian', getName: () => 'Sandbox' }, workspace: { getActiveWorkspace: () => 'active' } };
  const plugin = { manifest: { id: 'aigility-plugin-manager', dir: '.obsidian/plugins/aigility-plugin-manager' }, log() {} };
  const runtime = new ManagerRuntime(app, plugin, state);
  const manager = new DebugManager(runtime, app, plugin);
  const withinDeadline = (promise) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('debug transaction timed out')), 1200))]);
  await withinDeadline(manager.start([{ kind: 'community', id: 'candidate' }]));
  const writesBeforeStep = events.length;
  const step = manager.testSingle({ kind: 'community', id: 'candidate' });
  const next = runtime.enqueue('after-debug-step', async () => { events.push('later-operation'); });
  await withinDeadline(Promise.all([step, next]));
  assert.ok(events.includes('unload:outsider'), 'the transaction performs a real nonpersistent host unload for an enabled outsider');
  assert.equal(enabledPlugins.has('candidate'), true, 'diagnostic toggles preserve native autostart');
  assert.equal(enabledPlugins.has('outsider'), true, 'outsider native autostart is preserved during the experiment');
  assert.equal(instance._loaded, true, 'the selected plugin is restored to its actual preimage before the next queued action');
  assert.equal(outsider._loaded, false, 'the outsider remains off for the selected experiment');
  assert.ok(events.indexOf('later-operation') > writesBeforeStep, 'the queued action starts only after every state write in the debug step');
  await withinDeadline(manager.observe('real transaction completed', 'unknown'));
  await withinDeadline(manager.finish());
  runtime.dispose();
});
