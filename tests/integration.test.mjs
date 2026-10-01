import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const entry = path.join(root, 'main.ts');
const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

const STUB = `
    export class Plugin {
      constructor(app, manifest) { this.app = app; this.manifest = manifest; this.commands = []; this.cleanups = []; }
      addCommand(command) { this.commands.push(command); const fullId = this.manifest.id + ':' + command.id; this.app.commands.commands[fullId] = command; return this.app.commands.commands[fullId]; }
      removeCommand(fullId) { delete this.app.commands.commands[fullId]; this.commands = this.commands.filter((command) => this.manifest.id + ':' + command.id !== fullId); }
      addSettingTab(tab) { this.settingTab = tab; }
      register(fn) { this.cleanups.push(fn); }
      registerEvent() {}
      async loadData() { const p = this.manifest.dir + '/data.json'; return await this.app.vault.adapter.exists(p) ? JSON.parse(await this.app.vault.adapter.read(p)) : null; }
    }
    export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = { empty() {} }; } }
    export class Modal { constructor(app) { this.app = app; } open() { globalThis.__aigilityTestModal = this; } }
    export class Menu {}
    export class Setting {}
    export class Notice { constructor(message) { globalThis.__notices.push(String(message)); } }
    export const Platform = { isDesktop: true, isDesktopApp: true, isMobile: false };
    export const Obsidian = { apiVersion: '1.14.3' };
    export const apiVersion = '1.14.3';
    export function setIcon() {}
    export async function requestUrl() { throw new Error('network disabled in integration test'); }
`;

/**
 * The bundle is written as a real temporary .mjs module and imported by file
 * URL, so a failing stack shows the source line instead of a giant base64
 * data URL payload.
 */
async function loadPluginClass() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aigility-integration-'));
  const stubPath = path.join(dir, 'obsidian.mjs');
  await writeFile(stubPath, STUB);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    alias: { obsidian: stubPath },
  });
  const bundlePath = path.join(dir, 'bundle.mjs');
  await writeFile(bundlePath, result.outputFiles[0].text);
  const module = await import(pathToFileURL(bundlePath).href);
  return { PluginClass: module.default, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function makeState(overrides = {}) {
  return {
    schemaVersion: 1, records: {}, tags: [], groups: [], deviceProfiles: [], fixtureProfiles: [], deferred: [], protected: [],
    profileBackups: [], githubSources: {}, settings: { staggerMs: 0, automaticUpdates: false }, legacyBpm: {}, ...overrides,
  };
}

function makeHost({ layoutReady = false, initial = null, legacy = false, loadingEnabled = true } = {}) {
  const files = new Map();
  const writes = [];
  const adapter = {
    async exists(path) { return files.has(path); },
    async read(path) { if (!files.has(path)) throw new Error(`Missing ${path}`); return files.get(path); },
    async write(path, text) { writes.push(path); files.set(path, text); },
    async mkdir() {}, async remove(path) { files.delete(path); },
    async rename(from, to) { files.set(to, files.get(from)); files.delete(from); },
  };
  const layoutCallbacks = [];
  const legacyBpm = { _loaded: true, onload() { throw new Error('Legacy lifecycle must not be called'); }, async loadData() { return {}; } };
  const legacyCompanion = { _loaded: legacy, onload() { throw new Error('Legacy lifecycle must not be called'); }, async loadData() { return {}; } };
  // Host 1.14.3 semantics: app.plugins.isEnabled() is the global, zero-argument
  // community-plugin loading gate. It carries no plugin id and is completely
  // independent from the persisted native autostart set.
  const plugins = {
    manifests: {}, plugins: { 'better-plugins-manager': legacyBpm, 'better-plugins-manager-companion': legacyCompanion },
    enabledPlugins: new Set(), loadingEnabled,
    isEnabled() { return this.loadingEnabled === true; },
    async setEnable(enabled) { this.loadingEnabled = enabled === true; },
    async saveConfig() {},
  };
  const app = {
    appId: 'test-app', version: '1.14.3',
    vault: { adapter },
    workspace: { layoutReady, onLayoutReady(callback) { layoutCallbacks.push(callback); } },
    plugins,
    internalPlugins: { plugins: {} },
    commands: { commands: {}, removeCommand(id) { delete this.commands[id]; } },
  };
  const manifest = { id: 'aigility-plugin-manager', version: '0.1.0', dir: '.obsidian/plugins/aigility-plugin-manager' };
  if (initial !== null) files.set(`${manifest.dir}/data.json`, JSON.stringify(initial));
  if (legacy) files.set('.obsidian/plugins/better-plugins-manager-companion/data.json', JSON.stringify({ profiles: { desktop: {} } }));
  return { app, adapter, files, writes, layoutCallbacks, manifest };
}

async function start(host) {
  const { PluginClass, cleanup } = await loadPluginClass();
  const plugin = new PluginClass(host.app, host.manifest);
  await plugin.onload();
  return { plugin, cleanup };
}

test('interrupted operation does not prevent the manager from loading its manual recovery UI', async () => {
  globalThis.__notices = []; storage.clear();
  storage.set('aigility-plugin-manager:local:v1:test-app:vault', JSON.stringify({operationPending:'profile-apply:interrupted',recoveryReason:'interrupted'}));
  const host=makeHost({layoutReady:true,initial:makeState()});
  const {PluginClass,cleanup}=await loadPluginClass();
  const plugin=new PluginClass(host.app,host.manifest);
  try {
    await assert.doesNotReject(()=>plugin.onload(),'the recovery latch must not make the plugin itself unloadable');
    assert.equal(plugin.runtime.local.operationPending,'profile-apply:interrupted');
    await plugin.runtime.resume();
    assert.equal(plugin.runtime.local.operationPending,undefined);
  } finally {plugin.onunload();await cleanup();storage.clear();}
});

async function collectConsole(fn) {
  const captured = [];
  const levels = ['info', 'warn', 'error'];
  const originals = {};
  for (const level of levels) {
    originals[level] = console[level];
    console[level] = (...args) => { captured.push(args.map((item) => String(item)).join(' ')); };
  }
  try { return { captured, result: await fn() }; }
  finally { for (const level of levels) console[level] = originals[level]; }
}

test('schemaVersion 1 loads without legacy migration and registers stable manager/profile commands', async () => {
  globalThis.__notices = [];
  const state = makeState({
    deviceProfiles: [{ id: 'macbook', name: 'MacBook', tagIds: [], applyAtStart: true }, { id: 'lenovo tab', name: 'Lenovo Tab', tagIds: [] }],
    fixtureProfiles: [{ id: 'fixture-a', name: 'Fixture A', members: {} }],
  });
  const host = makeHost({ initial: state });
  const { plugin, cleanup } = await start(host);
  try {
    assert.equal(plugin.runtime.state.schemaVersion, 1);
    assert.equal(host.files.has('.obsidian/plugins/aigility-plugin-manager/migration-backups/before-migration-any.json'), false);
    assert.deepEqual(plugin.commands.map((command) => command.id), [
      'manager-options', 'manager-view', 'manager-apply-profile', 'manager-undo', 'restore-previous-command-state', 'manager-resume',
      'manager-profile-macbook-apply', 'manager-profile-lenovo-tab-apply', 'manager-profile-fixture-a-apply',
    ]);
    assert.equal(plugin.managerBuild, 'aigility-plugin-manager/0.1.0');
  } finally { plugin.onunload(); await cleanup(); }
});

test('bound and device profile commands preview first and apply only after modal confirmation', async () => {
  globalThis.__notices = [];
  const host = makeHost({ initial: makeState({
    deviceProfiles: [{ id: 'macbook', name: 'MacBook', tagIds: [] }, { id: 'lenovo tab', name: 'Lenovo Tab', tagIds: [] }],
  }) });
  const { plugin, cleanup } = await start(host);
  try {
    const previews = [];
    const applies = [];
    plugin.runtime.previewProfile = async (id) => { previews.push(id); return [{ ref: { kind: 'community', id: 'sample' }, before: false, after: true, reason: 'test' }]; };
    plugin.runtime.applyProfile = async (id) => { applies.push(id); };
    plugin.runtime.local.deviceProfileId = 'macbook';
    for (const [index, [commandId, profileId]] of [['manager-apply-profile', 'macbook'], ['manager-profile-lenovo-tab-apply', 'lenovo tab']].entries()) {
      globalThis.__aigilityTestModal = undefined;
      plugin.commands.find((command) => command.id === commandId).callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(previews.at(-1), profileId, `${commandId} requests a preview`);
      assert.equal(applies.length, index, `${commandId} does not apply before confirmation`);
      assert.ok(globalThis.__aigilityTestModal, `${commandId} opens the comparison modal`);
      await globalThis.__aigilityTestModal.onConfirm();
      assert.deepEqual(applies.at(-1), profileId, `${commandId} applies its profile on confirmation`);
    }
    assert.deepEqual(previews, ['macbook', 'lenovo tab']);
    assert.deepEqual(applies, ['macbook', 'lenovo tab']);
  } finally { plugin.onunload(); await cleanup(); }
});

test('legacy migration stores exact local backups before schemaVersion 1 write and redacts persisted State', async () => {
  globalThis.__notices = [];
  const host = makeHost();
  const bpmRaw = JSON.stringify({ Plugins: [{ id: 'community-one', name: 'One', enabled: true }], GITHUB_TOKEN: 'local-secret', COMMAND_PROFILES: [{id:'raw-identity-regression',name:'Raw',pluginStates:{'secret-placeholders':false,'token-counter':true}}] });
  const companionRaw = JSON.stringify({ profiles: { desktop: { 'community-one': true } } });
  const communityRaw = JSON.stringify(['community-one']);
  const coreRaw = JSON.stringify({ 'file-explorer': true });
  host.files.set('.obsidian/plugins/better-plugins-manager/data.json', bpmRaw);
  host.files.set('.obsidian/plugins/better-plugins-manager-companion/data.json', companionRaw);
  host.files.set('.obsidian/community-plugins.json', communityRaw);
  host.files.set('.obsidian/core-plugins.json', coreRaw);
  const { plugin, cleanup } = await start(host);
  try {
    const backupPath = [...host.files.keys()].find((key) => key.includes('/migration-backups/before-migration-'));
    assert.ok(backupPath, 'migration backup exists');
    const backup = JSON.parse(host.files.get(backupPath));
    assert.equal(backup.legacyBpm, bpmRaw);
    assert.equal(backup.legacyCompanion, companionRaw);
    assert.equal(backup.communityPlugins, communityRaw);
    assert.equal(backup.corePlugins, coreRaw);
    const statePath = '.obsidian/plugins/aigility-plugin-manager/data.json';
    assert.ok(host.writes.indexOf(backupPath) < host.writes.indexOf(statePath), 'backup write precedes integrated State write');
    assert.equal(host.files.get(statePath).includes('local-secret'), false);
    assert.equal(plugin.runtime.state.legacyBpm.GITHUB_TOKEN, '[redacted]');
    assert.equal(plugin.runtime.state.legacyBpm.COMMAND_PROFILES[0].pluginStates['secret-placeholders'], false);
    assert.equal(plugin.runtime.state.legacyBpm.COMMAND_PROFILES[0].pluginStates['token-counter'], true);
    assert.equal(plugin.runtime.state.schemaVersion, 1);
    assert.equal(host.app.plugins.plugins['better-plugins-manager']._loaded, true);
  } finally { plugin.onunload(); await cleanup(); }
});

test('credential redaction preserves plugin identities through load save refresh and list', async () => {
  globalThis.__notices = []; storage.clear();
  const ids = ['enso-secret-placeholders', 'token-counter', 'password-tools'];
  const records = Object.fromEntries(ids.map(id => ['community:' + id, {
    ref: { kind: 'community', id }, name: id, version: '1.0.0', tags: ['ipad'], group: 'tools',
    desired: false, metadata: { actualSecret: 'metadata-secret', preserved: 'ok' },
  }]));
  const members = Object.fromEntries(ids.map(id => ['community:' + id, false]));
  const host = makeHost({ layoutReady: true, initial: makeState({
    records, fixtureProfiles: [{id:'credential-name-regression',name:'Fixture',members}],
    githubSources: Object.fromEntries(ids.map(id => [id, {repo:'owner/'+id,trackPrereleases:true}])),
    debug: {active:false,originals:members,owned:{},snapshot:{plugins:records}},
    profileBackups: [{profileId:'credential-name-regression',members,backups:{tablet:{pluginStates:Object.fromEntries(ids.map(id=>[id,false]))}}}],
    legacyBpm: {GITHUB_TOKEN:'legacy-secret',nested:{authorization:'auth-secret',normal:'ok'},COMMAND_PROFILES:[{id:'test',pluginStates:Object.fromEntries(ids.map(id=>[id,false]))}]},
  })});
  for (const id of ids) host.app.plugins.manifests[id] = {id,name:id,version:'1.0.0',isDesktopOnly:false};
  const {plugin,cleanup} = await start(host);
  try {
    await plugin.runtime.enqueue('credential-name-regression-save',async tx => {await tx.refresh();await tx.save();});
    await plugin.runtime.refresh();
    const persisted = JSON.parse(host.files.get('.obsidian/plugins/aigility-plugin-manager/data.json'));
    for(const id of ids) {
      const k='community:'+id;
      assert.deepEqual(persisted.records[k].ref,{kind:'community',id});
      assert.equal(persisted.fixtureProfiles[0].members[k],false);
      assert.equal(persisted.githubSources[id].repo,'owner/'+id);
      assert.equal(persisted.debug.originals[k],false);
      assert.deepEqual(persisted.debug.snapshot.plugins[k].ref,{kind:'community',id});
      assert.equal(persisted.profileBackups[0].members[k],false);
      assert.equal(persisted.profileBackups[0].backups.tablet.pluginStates[id],false);
      assert.equal(persisted.legacyBpm.COMMAND_PROFILES[0].pluginStates[id],false);
      assert.equal(plugin.runtime.list().some(item=>item.ref.id===id),true);
      assert.equal(persisted.records[k].metadata.actualSecret,'[redacted]');
    }
    assert.equal(persisted.legacyBpm.GITHUB_TOKEN,'[redacted]');
    assert.equal(persisted.legacyBpm.nested.authorization,'[redacted]');
    assert.equal(persisted.legacyBpm.nested.normal,'ok');
    assert.equal(JSON.stringify(persisted).includes('metadata-secret'),false);
    assert.equal(JSON.stringify(persisted).includes('legacy-secret'),false);
  } finally {plugin.onunload();await cleanup();storage.clear();}
});

test('early load starts unrestricted and runs layout-ready automation; late load skips it', async () => {
  globalThis.__notices = [];
  const early = makeHost({ initial: makeState() });
  const first = await start(early);
  try {
    const baselineAt = early.writes.indexOf('.obsidian/plugins/aigility-plugin-manager/data.json');
    assert.ok(baselineAt >= 0);
    // The global host gate is enabled, so a normal early start must not latch a
    // restricted pause. A per-id isEnabled() fake used to hide exactly this.
    assert.equal(early.app.plugins.isEnabled(), true);
    assert.equal(first.plugin.runtime.local.recoveryReason, undefined);
    assert.equal(globalThis.__notices.some((message) => message.includes('plugin loading is disabled')), false);
    assert.equal(early.layoutCallbacks.length, 2, 'one guard lifecycle hook and one early runtime startup hook');

    let automationRuns = 0;
    const realResume = first.plugin.runtime.resumeAutomation.bind(first.plugin.runtime);
    first.plugin.runtime.resumeAutomation = async () => { automationRuns++; return realResume(); };
    for (const callback of early.layoutCallbacks) callback();
    await first.plugin.runtime.enqueue('integration-test-barrier', async () => undefined);
    assert.ok(automationRuns >= 1, 'early load runs startup automation when layout readiness arrives');
    assert.ok(early.writes.includes('.obsidian/plugins/aigility-plugin-manager/effective-state.json'), 'unpaused automation completes its effective-state report');
  } finally { first.plugin.onunload(); await first.cleanup(); }

  const late = makeHost({ layoutReady: true, initial: makeState() });
  const second = await start(late);
  try {
    assert.equal(late.layoutCallbacks.length, 2, 'late load retains only the guard hook and paused runtime hook');
    assert.ok(globalThis.__notices.some((message) => message.includes('layout readiness')) === false);
    assert.equal(second.plugin.runtime.local.recoveryReason, 'Manager loaded after layout readiness; startup automation was skipped.');
    let automationRuns = 0;
    second.plugin.runtime.resumeAutomation = async () => { automationRuns++; };
    for (const callback of late.layoutCallbacks) callback();
    await second.plugin.runtime.enqueue('integration-test-barrier', async () => undefined);
    assert.equal(automationRuns, 0, 'late-load recovery latch prevents startup automation when layout callbacks fire');
  } finally { second.plugin.onunload(); await second.cleanup(); }
});

test('global plugin loading gate drives the restricted pause, independent of the native autostart set', async () => {
  globalThis.__notices = [];
  const host = makeHost({ initial: makeState(), loadingEnabled: false });
  // A non-empty native autostart set must not make the global gate look enabled.
  host.app.plugins.enabledPlugins.add('community-one');
  const { plugin, cleanup } = await start(host);
  try {
    assert.equal(host.app.plugins.isEnabled(), false);
    assert.equal(plugin.runtime.local.recoveryReason, 'Obsidian plugin loading is disabled.');
  } finally { plugin.onunload(); await cleanup(); }
});

test('manager-options command opens the owned options modal instead of searching general setting tabs', async () => {
  globalThis.__notices = [];
  const host = makeHost({ initial: makeState() });
  // Host 1.14.3 keeps installed plugin tabs in setting.pluginTabs. The manager
  // tab is therefore absent from setting.settingTabs, which used to produce a
  // Notice instead of opening Opciones.
  let openedTabs = 0;
  host.app.setting = {
    settingTabs: [{ id: 'general' }, { id: 'community-plugins' }],
    pluginTabs: [{ id: 'aigility-plugin-manager', name: 'AIgility' }],
    open() {},
    openTabById() { openedTabs++; },
  };
  const { plugin, cleanup } = await start(host);
  try {
    let modalOpen = 0;
    plugin.managerUI.openOptionsModal = () => { modalOpen++; };
    const command = plugin.commands.find((item) => item.id === 'manager-options');
    assert.ok(command, 'manager-options is registered');
    assert.equal(typeof command.callback, 'function');
    command.callback();
    assert.equal(modalOpen, 1, 'manager-options opens the manager options modal');
    assert.equal(openedTabs, 0, 'no general settings tab is opened or searched');
    assert.equal(globalThis.__notices.some((message) => message.includes('Open Settings and select')), false, 'no false Notice');
  } finally { plugin.onunload(); await cleanup(); }
});

test('manager-view opens the native community plugins settings tab and restore alias undoes the last profile', async () => {
  globalThis.__notices = [];
  const host = makeHost({ initial: makeState() });
  const calls = [];
  host.app.setting = { open() { calls.push('open'); }, openTabById(id) { calls.push(id); } };
  const { plugin, cleanup } = await start(host);
  try {
    let undoCount = 0;
    plugin.runtime.undoProfile = async () => { undoCount++; };
    plugin.commands.find((command) => command.id === 'manager-view').callback();
    assert.deepEqual(calls, ['open', 'community-plugins']);
    plugin.commands.find((command) => command.id === 'restore-previous-command-state').callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(undoCount, 1);

    host.app.setting = { open() { calls.push('open-without-tab-api'); } };
    plugin.commands.find((command) => command.id === 'manager-view').callback();
    assert.ok(globalThis.__notices.some((message) => message.includes('no se puede abrir la pestaña Community plugins')));
  } finally { plugin.onunload(); await cleanup(); }
});

test('guard diagnostics reach plugin.runtime and remain visible for incompatible host signatures', async () => {
  globalThis.__notices = [];
  const host = makeHost({ initial: makeState() });
  const { captured, result } = await collectConsole(async () => {
    const started = await start(host);
    // The two queue guards are compatibility-gated on layout readiness, so the
    // registered callbacks must fire before their diagnostics exist.
    for (const callback of host.layoutCallbacks) callback();
    await started.plugin.runtime.enqueue('integration-test-barrier', async () => undefined);
    return started;
  });
  const { plugin, cleanup } = result;
  try {
    assert.equal(plugin.managerRuntime, undefined, 'the manager runtime is published only as plugin.runtime');
    assert.ok(plugin.runtime, 'plugin.runtime exists when guards are installed');
    const diagnostics = plugin.guardDiagnostics;
    assert.deepEqual(Object.keys(diagnostics).sort(), ['linkResolverSchedule', 'relatedLinkBatch', 'startupCache']);
    for (const diagnostic of Object.values(diagnostics)) {
      assert.equal(diagnostic.active, false, `${diagnostic.id} keeps native behavior on this host`);
      assert.ok(typeof diagnostic.reason === 'string' && diagnostic.reason.length > 0, `${diagnostic.id} reports a compatibility reason`);
    }
    assert.ok(captured.some((line) => line.includes('Runtime guard startupCache')), 'guard report is logged through plugin.runtime');
    assert.ok(globalThis.__notices.some((message) => message.includes('startupCache')), 'guard reason stays visible to the user');
  } finally { plugin.onunload(); await cleanup(); }
});

test('unload synchronously disposes UI, debug, guards, then runtime without legacy lifecycle calls', async () => {
  globalThis.__notices = [];
  const host = makeHost({ initial: makeState() });
  const { plugin, cleanup } = await start(host);
  const order = [];
  const uiDispose = plugin.managerUI.dispose.bind(plugin.managerUI);
  plugin.managerUI.dispose = () => { order.push('ui'); uiDispose(); };
  const debugDispose = plugin.debug.dispose.bind(plugin.debug);
  plugin.debug.dispose = () => { order.push('debug'); debugDispose(); };
  const removeGuards = plugin.removeGuards.bind(plugin);
  plugin.removeGuards = () => { order.push('guards'); removeGuards(); };
  const runtimeDispose = plugin.runtime.dispose.bind(plugin.runtime);
  plugin.runtime.dispose = () => { order.push('runtime'); runtimeDispose(); };
  try {
    plugin.onunload();
    assert.deepEqual(order, ['ui', 'debug', 'guards', 'runtime']);
    assert.equal(plugin.runtime.disposed, true);
    assert.equal(host.app.plugins.plugins['better-plugins-manager']._loaded, true);
  } finally { await cleanup(); }
});

test('dynamic device profile commands follow queued create, rename, and delete operations', async () => {
  globalThis.__notices = [];
  const host = makeHost({ initial: makeState() });
  const { plugin, cleanup } = await start(host);
  const fullId = 'aigility-plugin-manager:manager-profile-dynamic-profile-apply';
  try {
    await plugin.runtime.enqueue('integration-create-profile', async (tx) => {
      const state = await tx.refresh();
      state.deviceProfiles.push({ id: 'dynamic profile', name: 'First name', tagIds: [] });
      await tx.save();
    });
    const first = host.app.commands.commands[fullId];
    assert.equal(first.name, 'Apply manager profile: First name');

    await plugin.runtime.enqueue('integration-rename-profile', async (tx) => {
      const state = await tx.refresh();
      state.deviceProfiles.find((profile) => profile.id === 'dynamic profile').name = 'Renamed';
      await tx.save();
    });
    const renamed = host.app.commands.commands[fullId];
    assert.equal(renamed.name, 'Apply manager profile: Renamed');
    assert.notEqual(renamed, first, 'changed descriptor replaces the owned command and callback');

    await plugin.runtime.enqueue('integration-delete-profile', async (tx) => {
      const state = await tx.refresh();
      state.deviceProfiles = state.deviceProfiles.filter((profile) => profile.id !== 'dynamic profile');
      await tx.save();
    });
    assert.equal(host.app.commands.commands[fullId], undefined, 'delete removes the owned command');
  } finally { plugin.onunload(); await cleanup(); }
});

test('dynamic command cleanup preserves foreign replacements and later enqueue wrappers', async () => {
  globalThis.__notices = [];
  const host = makeHost({ initial: makeState() });
  const { plugin, cleanup } = await start(host);
  const fullId = 'aigility-plugin-manager:manager-profile-owned-apply';
  try {
    await plugin.runtime.enqueue('integration-create-owned-profile', async (tx) => {
      const state = await tx.refresh();
      state.deviceProfiles.push({ id: 'owned', name: 'Owned', tagIds: [] });
      await tx.save();
    });
    const owned = host.app.commands.commands[fullId];
    const foreign = { id: 'manager-profile-owned-apply', name: 'Foreign replacement', callback() {} };
    host.app.commands.commands[fullId] = foreign;

    const ownedWrapper = plugin.runtime.enqueue;
    const laterWrapper = function(...args) { return ownedWrapper.apply(this, args); };
    plugin.runtime.enqueue = laterWrapper;
    plugin.onunload();
    assert.equal(host.app.commands.commands[fullId], foreign, 'unload leaves a foreign replacement at an owned ID');
    assert.equal(plugin.runtime.enqueue, laterWrapper, 'unload preserves a wrapper installed after the manager wrapper');
  } finally { plugin.onunload(); await cleanup(); }
});

test('installed community and core aliases use fresh runtime state and exclude protected and manager plugins', async () => {
  globalThis.__notices = [];
  const host = makeHost({ initial: makeState({ protected: ['community:protected'] }) });
  const { plugin, cleanup } = await start(host);
  try {
    let fresh = [
      { ref: { kind: 'community', id: 'community-one' }, installed: true, desired: true, name: 'Community One' },
      { ref: { kind: 'core', id: 'search' }, installed: true, desired: false, name: 'Search' },
      { ref: { kind: 'community', id: 'protected' }, installed: true, desired: false, name: 'Protected' },
      { ref: { kind: 'community', id: host.manifest.id }, installed: true, desired: true, name: 'Manager' },
      { ref: { kind: 'community', id: 'gone' }, installed: false, desired: false, name: 'Gone' },
    ];
    const lookedUp = [];
    const toggled = [];
    plugin.runtime.list = () => fresh;
    plugin.runtime.refresh = async () => { lookedUp.push('refresh'); };
    plugin.runtime.setEnabled = async (ref, enabled) => { toggled.push([ref.kind, ref.id, enabled]); };
    await plugin.runtime.enqueue('integration-install-aliases', async () => undefined);

    const communityId = 'aigility-plugin-manager:manager-community-one';
    const coreId = 'aigility-plugin-manager:manager-core-search';
    const community = host.app.commands.commands[communityId];
    const core = host.app.commands.commands[coreId];
    assert.ok(community && core, 'community and core aliases are registered in the manager namespace');
    assert.equal(host.app.commands.commands['aigility-plugin-manager:manager-protected'], undefined);
    assert.equal(host.app.commands.commands[`aigility-plugin-manager:manager-${host.manifest.id}`], undefined);

    community.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    core.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(lookedUp, ['refresh', 'refresh']);
    assert.deepEqual(toggled, [['community', 'community-one', false], ['core', 'search', true]]);

    fresh = fresh.filter((item) => item.ref.id !== 'community-one');
    community.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(toggled, [['community', 'community-one', false], ['core', 'search', true]], 'deleted refs are never applied from stale command data');
    assert.ok(globalThis.__notices.some((message) => message.includes('no longer available')));
  } finally { plugin.onunload(); await cleanup(); }
});
