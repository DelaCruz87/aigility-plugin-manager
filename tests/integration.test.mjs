import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const entry = path.join(root, 'main.ts');
const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

async function loadPluginClass() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aigility-integration-'));
  const stubPath = path.join(dir, 'obsidian.mjs');
  await writeFile(stubPath, `
    export class Plugin {
      constructor(app, manifest) { this.app = app; this.manifest = manifest; this.commands = []; this.cleanups = []; }
      addCommand(command) { this.commands.push(command); }
      addSettingTab(tab) { this.settingTab = tab; }
      register(fn) { this.cleanups.push(fn); }
      registerEvent() {}
      async loadData() { const p = this.manifest.dir + '/data.json'; return await this.app.vault.adapter.exists(p) ? JSON.parse(await this.app.vault.adapter.read(p)) : null; }
    }
    export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = { empty() {} }; } }
    export class Modal { constructor(app) { this.app = app; } }
    export class Menu {}
    export class Setting {}
    export class Notice { constructor(message) { globalThis.__notices.push(String(message)); } }
    export const Platform = { isDesktop: true, isDesktopApp: true, isMobile: false };
    export const Obsidian = { apiVersion: '1.14.3' };
    export const apiVersion = '1.14.3';
    export function setIcon() {}
    export async function requestUrl() { throw new Error('network disabled in integration test'); }
  `);
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
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  return { PluginClass: module.default, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function makeState(overrides = {}) {
  return {
    schemaVersion: 1, records: {}, tags: [], groups: [], deviceProfiles: [], fixtureProfiles: [], deferred: [], protected: [],
    profileBackups: [], githubSources: {}, settings: { staggerMs: 0, automaticUpdates: false }, legacyBpm: {}, ...overrides,
  };
}

function makeHost({ layoutReady = false, initial = null, legacy = false } = {}) {
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
  const plugins = {
    manifests: {}, plugins: { 'better-plugins-manager': legacyBpm, 'better-plugins-manager-companion': legacyCompanion },
    enabledPlugins: new Set(), isEnabled(id) { return this.enabledPlugins.has(id); },
    async setEnable(enabled) { this.globalEnabled = enabled; },
    async saveConfig() {},
  };
  const app = {
    appId: 'test-app', version: '1.14.3',
    vault: { adapter },
    workspace: { layoutReady, onLayoutReady(callback) { layoutCallbacks.push(callback); } },
    plugins,
    internalPlugins: { plugins: {} },
    commands: { commands: {} },
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

test('schemaVersion 1 loads without legacy migration and registers stable manager/profile commands', async () => {
  globalThis.__notices = [];
  const state = makeState({
    deviceProfiles: [{ id: 'macbook', name: 'MacBook', tagIds: [], applyAtStart: true }],
    fixtureProfiles: [{ id: 'fixture-a', name: 'Fixture A', members: {} }],
  });
  const host = makeHost({ initial: state });
  const { plugin, cleanup } = await start(host);
  try {
    assert.equal(plugin.runtime.state.schemaVersion, 1);
    assert.equal(host.files.has('.obsidian/plugins/aigility-plugin-manager/migration-backups/before-migration-any.json'), false);
    assert.deepEqual(plugin.commands.map((command) => command.id), [
      'manager-options', 'manager-apply-profile', 'manager-undo', 'manager-resume',
      'manager-profile-macbook-apply', 'manager-profile-fixture-a-apply',
    ]);
    assert.equal(plugin.managerBuild, 'aigility-plugin-manager/0.1.0');
  } finally { plugin.onunload(); await cleanup(); }
});

test('legacy migration stores exact local backups before schemaVersion 1 write and redacts persisted State', async () => {
  globalThis.__notices = [];
  const host = makeHost();
  const bpmRaw = JSON.stringify({ Plugins: [{ id: 'community-one', name: 'One', enabled: true }], GITHUB_TOKEN: 'local-secret' });
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
    assert.equal(plugin.runtime.state.schemaVersion, 1);
    assert.equal(host.app.plugins.plugins['better-plugins-manager']._loaded, true);
  } finally { plugin.onunload(); await cleanup(); }
});

test('early load registers startup automation after baseline; late load skips it', async () => {
  globalThis.__notices = [];
  const early = makeHost({ initial: makeState() });
  const first = await start(early);
  try {
    const baselineAt = early.writes.indexOf('.obsidian/plugins/aigility-plugin-manager/data.json');
    assert.ok(baselineAt >= 0);
    assert.equal(early.layoutCallbacks.length, 2, 'one guard lifecycle hook and one early runtime startup hook');
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
