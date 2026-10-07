import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { runNative } from './settings-separation-native-20261007.mjs';

// Execute the emitted helper against CPU-only actuators. This tests helper
// ownership/CAS; it does not establish Obsidian or runtime acceptance.
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ID = 'aigility-plugin-manager', F = 'aigility-manager-toggle-fixture';
async function scenario(fault) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manager016-native-cpu-'));
  const target = root + '/.obsidian/plugins/' + ID, fixture = root + '/.obsidian/plugins/' + F, source = root + '/source', fixtureSource = root + '/fixture-source';
  fs.mkdirSync(target, { recursive: true }); fs.mkdirSync(source); fs.mkdirSync(fixtureSource);
  const put = (p, value) => fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
  const state = { schemaVersion: 1, records: fault === 'reserved-record' ? { ['community:' + F]: { desired: true } } : {}, protected: ['community:' + ID], deferred: [] };
  put(target + '/data.json', state); put(target + '/effective-state.json', { before: true });
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    put(target + '/' + name, name === 'manifest.json' ? { id: ID, version: '0.1.5' } : 'old artifact');
    put(source + '/' + name, name === 'manifest.json' ? { id: ID, version: '0.1.6' } : 'approved artifact ' + name);
    put(fixtureSource + '/' + name, name === 'manifest.json' ? { id: F, version: '0.0.1' } : 'owned fixture ' + name);
    if (fault === 'functional-current') fs.copyFileSync(source + '/' + name, target + '/' + name);
  }
  const community = root + '/.obsidian/community-plugins.json', effective = target + '/effective-state.json';
  put(community, ['foreign', ID]);
  const beforeCommunity = fs.readFileSync(community, 'utf8');
  const values = new Map([['cpu-local', JSON.stringify({ recoveryReason: 'Late load' })]]);
  const window = {}, foreign = { _loaded: true }, leaf = { id: 'leaf', view: { getViewType: () => 'markdown', editor: { getValue: () => 'private-buffer' } } };
  const document = { URL: 'app://obsidian.md/index.html', activeElement: { focus() {} }, querySelector: () => null };
  const nativeWindow = { id: 3, webContents: { id: 3, isCrashed: () => false, capturePage: async () => ({ toPNG: () => Buffer.from('89504e470d0a1a0a', 'hex') }) } };
  const pm = { plugins: { foreign }, manifests: { [ID]: { id: ID } }, enabledPlugins: new Set(['foreign', ID]), async saveConfig() { put(community, [...this.enabledPlugins]); } };
  let pendingNativeSave = false, flushedNativeSave = false;
  pm.requestSaveConfig = () => { pendingNativeSave = true; };
  pm.requestSaveConfig.run = async () => { if (pendingNativeSave) { pendingNativeSave = false; flushedNativeSave = true; await pm.saveConfig(); } };
  const app = {
    appId: 'cpu-app', plugins: pm, internalPlugins: { plugins: {} },
    vault: { configDir: '.obsidian', getName: () => 'Sandbox', adapter: { getBasePath: () => root } },
    setting: { isOpen: false, lastTabId: '', doc: document, modalEl: null, open() {}, settingTabs: [{ id: 'community-plugins', display() {}, renderTab() {}, update() {}, containerEl: { firstChild: {} } }] },
    workspace: { activeLeaf: leaf, getLayout: () => ({ leaf: 'leaf' }), iterateAllLeaves: fn => fn(leaf) },
  };
  let reports = 0, mutations = 0, managerLoads = 0;
  const manager = version => {
    const p = { _loaded: true, manifest: { id: ID, version }, managerBuild: 'aigility-plugin-manager/' + version, debug: {} };
    const runtime = {
      state: JSON.parse(fs.readFileSync(target + '/data.json')), local: { recoveryReason: 'Late load' }, localKey: 'cpu-local', disposed: false,
      list: () => [ID, ...(pm.manifests[F] ? [F] : [])].map(id => ({ ref: { id, kind: 'community' }, loaded: Boolean(pm.plugins[id]?._loaded), nativeAutostart: pm.enabledPlugins.has(id), desired: runtime.state.records['community:' + id]?.desired ?? pm.enabledPlugins.has(id) })),
      async writeEffectiveState() { put(effective, { generatedAt: ++reports, plugins: this.list().map(p => p.ref.id) }); },
      async enqueue(label, callback) {
        if (fault === 'source-after-preflight' && label === 'native016-drain') put(source + '/main.js', 'UNAUTHORIZED SOURCE BYTES');
        return callback({ refresh: async () => runtime.state, save: async () => put(target + '/data.json', runtime.state), writeEffectiveState: () => runtime.writeEffectiveState() });
      },
    };
    p.runtime = runtime;
    const ui = { filterCriteria: {}, ownedModals: new Set(), refreshManagerView() {}, openManagerModal() { this.managerModal = modal(true); }, openOptionsModal() { const m = modal(false); this.ownedModals.add(m); } };
    const modal = list => {
      const m = { modalEl: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }) }, contentEl: { querySelector(selector) {
        if (selector === '.aigility-manager-settings') return list ? null : {};
        if (selector === '.aigility-plugin-row') return null;
        if (selector.startsWith('input')) return input;
        return null;
      } }, close() { if (ui.managerModal === m) ui.managerModal = undefined; ui.ownedModals.delete(m); } };
      const input = { get checked() { return Boolean(pm.plugins[ui.filterCriteria.search]?._loaded); }, disabled: false, click() {
        const id = ui.filterCriteria.search, on = !input.checked; mutations++;
        if (on) { pm.plugins[id] = { _loaded: true }; pm.enabledPlugins.add(id); if (id === F) window.__managerToggleFixtureLoads++; }
        else { delete pm.plugins[id]; pm.enabledPlugins.delete(id); }
        pm.saveConfig();
        if (id === ID) { runtime.disposed = true; m.close(); }
        else { runtime.state.records['community:' + id] = { desired: on }; put(target + '/data.json', runtime.state); runtime.writeEffectiveState(); }
      } };
      return m;
    };
    p.managerUI = ui; return p;
  };
  pm.plugins[ID] = manager(fault === 'functional-current' ? '0.1.6' : '0.1.5');
  pm.disablePlugin = async id => { assert.notEqual(fault, 'functional-current', 'current candidate is never initially unloaded'); delete pm.plugins[id]; };
  pm.loadManifest = async relative => { const data = JSON.parse(fs.readFileSync(root + '/' + relative + '/manifest.json')); pm.manifests[data.id] = data; };
  pm.enablePlugin = async id => { managerLoads++; const p = manager('0.1.6'); pm.plugins[id] = p; await p.runtime.writeEffectiveState(); if (fault === 'leaf-during-load') app.workspace.activeLeaf = { id: 'new-leaf' }; };
  pm.enablePluginAndSave = async id => {
    pm.enabledPlugins.add(id);
    if (id === ID) await pm.enablePlugin(id);
    else { pm.plugins[id] = { _loaded: true }; window.__managerToggleFixtureLoads = (window.__managerToggleFixtureLoads ?? 0) + 1; }
    if (fault === 'delayed-native-save') pm.requestSaveConfig();
    else await pm.saveConfig();
  };
  const stat = fs.statSync(root), token = 'cpu-owned-token';
  const r = {
    root, source, fixtureSource, backup: root + '/private-backup', resultPath: root + '/result.json', job: 'cpu-helper', token,
    mode: fault === 'functional-current' ? 'functional-current' : 'deploy',
    actionBy: new Date(Date.now() + 30000).toISOString(), totalBy: new Date(Date.now() + 45000).toISOString(), rootHardBy: new Date(Date.now() + 60000).toISOString(),
    native: { appId: app.appId, vault: 'Sandbox', window: 3, wc: 3, document: document.URL, physicalRoot: fs.realpathSync(root), dev: stat.dev, ino: stat.ino },
    artifacts: {}, preimages: {}, fixtureArtifacts: {},
  };
  for (const [field, dir] of [['artifacts', source], ['preimages', target], ['fixtureArtifacts', fixtureSource]]) for (const name of ['main.js', 'manifest.json', 'styles.css']) r[field][name] = hash(fs.readFileSync(dir + '/' + name));
  for (const [prefix, value] of [['control', '{}'], ['lease', JSON.stringify({ token })], ['helper', runNative.toString()], ['baseline', JSON.stringify({ root, files: {} })]]) {
    r[prefix + 'Path'] = root + '/' + prefix + '.json'; put(r[prefix + 'Path'], value); r[prefix + 'Sha'] = hash(fs.readFileSync(r[prefix + 'Path']));
  }
  const fakeFs = { ...fs, unlinkSync(file) {
    fs.unlinkSync(file);
    if (file === fixture + '/styles.css' && fault === 'foreign-effective') put(effective, '{"foreign":"report"}');
    if (file === fixture + '/styles.css' && fault === 'foreign-community') fs.writeFileSync(community, fs.readFileSync(community, 'utf8') + '\n');
  } };
  try {
    const foreignWindow = { id: 9, webContents: { id: 11, isCrashed: () => true } };
    const context = { app, document, window, localStorage: { getItem: key => values.get(key) }, requestAnimationFrame: fn => fn(), setTimeout, Buffer, console, require: name => name === 'fs' ? fakeFs : name === 'crypto' ? crypto : name === 'path' ? path : { remote: { getCurrentWindow: () => nativeWindow, BrowserWindow: { getAllWindows: () => fault === 'foreign-already-crashed' ? [nativeWindow, foreignWindow] : [nativeWindow] } } } };
    if (fault === 'reserved-record') {
      assert.throws(() => vm.runInNewContext('(' + runNative.toString() + ')(' + JSON.stringify(r) + ')', context), /reserved fixture identity/);
      assert.equal(mutations, 0); assert.equal(fs.existsSync(r.backup), false); assert.equal(hash(fs.readFileSync(target + '/main.js')), r.preimages['main.js']);
    } else {
      const returned = vm.runInNewContext('(' + runNative.toString() + ')(' + JSON.stringify(r) + ')', context);
      assert.equal(typeof returned, 'string', 'Obsidian eval returns explicit JSON text for the controller');
      assert.equal(JSON.parse(returned).token, token);
      const job = window.__managerSettings016Jobs.get(token); await job.task;
      if (fault === 'foreign-effective') { assert.equal(job.receipt.status, 'FAILED_PRESERVED'); assert.equal(fs.readFileSync(effective, 'utf8'), '{"foreign":"report"}'); }
      else if (fault === 'foreign-community') { assert.equal(job.receipt.status, 'FAILED_PRESERVED'); assert.ok(fs.readFileSync(community, 'utf8').endsWith('\n')); }
      else if (fault === 'leaf-during-load') { assert.equal(job.receipt.status, 'FAILED_PRESERVED'); assert.deepEqual(Array.from(job.receipt.firstGuardFailure.failed), ['active-leaf']); assert.equal(job.receipt.firstGuardFailure.phase, 'load-candidate'); assert.equal(job.receipt.firstGuardFailure.before.activeLeaf, 'leaf'); assert.equal(job.receipt.firstGuardFailure.current.activeLeaf, 'new-leaf'); assert.equal(fs.existsSync(fixture), false); }
      else { assert.equal(job.receipt.status, 'SETTLED', job.receipt.error); assert.equal(hash(fs.readFileSync(target + '/main.js')), r.artifacts['main.js']); assert.equal(fs.readFileSync(community, 'utf8'), beforeCommunity); assert.equal(fs.existsSync(fixture), false); assert.equal(fs.readFileSync(effective, 'utf8').includes(F), false); }
      if (fault === 'functional-current') assert.equal(managerLoads, 1, 'only explicit self re-enable loads the current candidate');
      if (fault === 'delayed-native-save') { assert.equal(flushedNativeSave, true); assert.equal(pendingNativeSave, false); }
    }
    console.log('PASS: emitted helper ownership scenario ' + fault);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
for (const fault of ['normal', 'source-after-preflight', 'reserved-record', 'foreign-effective', 'foreign-community', 'leaf-during-load', 'functional-current', 'delayed-native-save', 'foreign-already-crashed']) await scenario(fault);
