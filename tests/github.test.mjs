import assert from 'node:assert/strict';
import test from 'node:test';
import { importModule } from '../test.config.mjs';

const API = 'https://api.github.com';
const registryUrl = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';
const localState = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem(key) { return localState.get(key) ?? null; },
  setItem(key, value) { localState.set(key, String(value)); },
  removeItem(key) { localState.delete(key); },
} });

function createHarness({ records = [], sources = {}, appVersion = '1.5.0', mobile = false } = {}) {
  const files = new Map();
  const dirs = new Set(['.obsidian', '.obsidian/plugins']);
  let failWrite = null;
  const adapter = {
    async exists(path) { return files.has(path) || dirs.has(path); },
    async read(path) { if (!files.has(path)) throw new Error(`missing ${path}`); return files.get(path); },
    async write(path, value) { if (failWrite && failWrite(path)) { failWrite = null; throw new Error('injected write failure'); } files.set(path, value); },
    async remove(path) { files.delete(path); dirs.delete(path); },
    async mkdir(path) { dirs.add(path); },
    async rename(from, to) { if (!files.has(from)) throw new Error(`missing staged file ${from}`); files.set(to, files.get(from)); files.delete(from); },
  };
  const runtime = {
    state: {
      schemaVersion: 1, records: Object.fromEntries(records.map((record) => [`community:${record.id}`, { ref: { kind: 'community', id: record.id }, name: record.id, version: record.version, tags: [], group: '', desired: true, metadata: {} }])),
      tags: [], groups: [], deviceProfiles: [], fixtureProfiles: [], deferred: [], protected: ['community:aigility-plugin-manager'], profileBackups: [], githubSources: structuredClone(sources), settings: { staggerMs: 50, automaticUpdates: false }, legacyBpm: {},
    },
    local: {},
    localKey: 'aigility-github-test-state',
    saves: 0,
    queue: Promise.resolve(),
    failSave: false,
    generations: new Map(),
    getMutationGeneration(id) { return this.generations.get(id) ?? 0; },
    enqueue(_name, action) {
      const transaction = {
        async save() {
          if (runtime.failSave) { runtime.failSave = false; throw new Error('injected state save failure'); }
          runtime.saves++;
        },
        async setEnabled(ref, enabled) {
          const id = ref.id;
          if (enabled) app.plugins.enabledPlugins.add(id); else app.plugins.enabledPlugins.delete(id);
          runtime.generations.set(id, runtime.getMutationGeneration(id) + 1);
        },
        async refresh() { await app.plugins.loadManifests(); },
        async writeEffectiveState() { runtime.effectiveWrites = (runtime.effectiveWrites ?? 0) + 1; },
      };
      const run = this.queue.then(() => action(transaction), () => action(transaction));
      this.queue = run.catch(() => {});
      return run;
    },
    list() { return records.map((record) => ({ ref: { kind: 'community', id: record.id }, installed: true, compatible: true, version: record.version })); },
  };
  const app = {
    isMobile: mobile,
    vault: { configDir: '.obsidian', adapter, config: {} },
    secretStorage: { async getSecret() { return 'secret-that-must-not-leak'; } },
    plugins: {
      manifests: {}, plugins: {}, enabledPlugins: new Set(),
      async unloadPlugin(id) { delete this.plugins[id]; },
      async loadPlugin(id) { this.plugins[id] = { id }; },
      async loadManifests() {
        this.manifests = {};
        for (const [path, text] of files) if (path.endsWith('/manifest.json') && path.includes('/plugins/')) {
          try { const manifest = JSON.parse(text); this.manifests[manifest.id] = manifest; } catch {}
        }
      },
    },
  };
  const plugin = { app, manifest: { id: 'aigility-plugin-manager' }, githubRequest: undefined };
  return { app, plugin, runtime, adapter, files, dirs, failNextWrite(testFn = () => true) { failWrite = testFn; } };
}

function response(json, { status = 200, headers = {}, text = undefined } = {}) { return { status, json, headers, text: text ?? (typeof json === 'string' ? json : JSON.stringify(json)) }; }
function release(tag, manifest, extraAssets = {}) {
  const base = `https://github.com/acme/${manifest.id}/releases/download/${tag}`;
  return { tag_name: tag, name: tag, prerelease: tag.includes('beta'), assets: [
    { name: 'manifest.json', browser_download_url: `${base}/manifest.json` },
    { name: 'main.js', browser_download_url: `${base}/main.js` },
    ...(extraAssets.styles ? [{ name: 'styles.css', browser_download_url: `${base}/styles.css` }] : []),
  ] };
}

function hostRoutes({ releases = [], manifests = {}, registry = [], rateLimit = false, missingAssets = false } = {}) {
  return async ({ url }) => {
    const parsed = new URL(url);
    if (url === registryUrl) return response(registry);
    if (parsed.hostname === 'api.github.com' && parsed.pathname.includes('/releases/tags/')) {
      const tag = decodeURIComponent(parsed.pathname.split('/').at(-1));
      return response(releases.find((item) => item.tag_name === tag) ?? releases[0] ?? {});
    }
    if (parsed.hostname === 'api.github.com' && parsed.pathname.endsWith('/releases/latest')) return response(releases.find((item) => !item.prerelease && !item.draft) ?? {});
    if (parsed.hostname === 'api.github.com' && parsed.pathname.endsWith('/releases')) {
      if (rateLimit) return response({}, { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
      const cap = Number(parsed.searchParams.get('per_page'));
      return response(releases.slice(0, cap));
    }
    const assetName = parsed.pathname.split('/').pop();
    if (parsed.hostname === 'github.com') {
      if (assetName === 'manifest.json') return missingAssets ? response('{}') : response(manifests[parsed.pathname.split('/')[2]] ?? {} , { text: JSON.stringify(manifests[parsed.pathname.split('/')[2]] ?? {}) });
      if (assetName === 'main.js') return response(undefined, { text: 'module.exports = true;' });
      if (assetName === 'styles.css') return response(undefined, { text: '.x {}' });
    }
    return response({}, { status: 404 });
  };
}

test('repository parser accepts canonical forms and rejects malformed paths/traversal', async () => {
  const { parseGithubRepository, compareGithubVersions } = await importModule('src/integrated/github.ts');
  assert.equal(parseGithubRepository('obsidianmd/obsidian-releases'), 'obsidianmd/obsidian-releases');
  assert.equal(parseGithubRepository('https://github.com/owner/plugin.git'), 'owner/plugin');
  for (const bad of ['', 'https://github.com/owner/../secret', 'https://evil.test/owner/repo', 'owner/repo/extra', '../repo', 'owner/%2e%2e']) {
    assert.throws(() => parseGithubRepository(bad), undefined, bad);
  }
  assert.equal(compareGithubVersions('v1.10.0', '1.9.9'), 1);
  assert.equal(compareGithubVersions('1.2.0-beta.2', '1.2.0-beta.10'), -1);
  assert.equal(compareGithubVersions('1.2.0-beta.1', '1.2.0'), -1);
});

test('detailed release picker paginates on demand to at most 100 entries and does not cache arrays', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const calls = [];
  const { app, plugin, runtime } = createHarness(); plugin.githubRequest = async ({ url }) => { calls.push(url); const page = Number(new URL(url).searchParams.get('page')); return response(Array.from({ length: page === 1 ? 50 : 50 }, (_, i) => ({ tag_name: `v${page}.${i}`, assets: [{ name: 'main.js' }] }))); }; const manager = new GithubManager(runtime, app, plugin);
  assert.equal((await manager.releases('owner/repo')).length, 100);
  assert.equal((await manager.releases('owner/repo')).length, 100);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((url) => Number(new URL(url).searchParams.get('page')) <= 2 && Number(new URL(url).searchParams.get('per_page')) === 50));
});

test('install validates complete assets and exact manifest identity/version, then preserves data and unknown files', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const manifest = { id: 'calendar', version: '2.0.0', minAppVersion: '1.2.0' };
  const selected = release('v2.0.0', manifest);
  const { app, plugin, runtime, files } = createHarness();
  plugin.githubRequest = hostRoutes({ releases: [selected], manifests: { calendar: manifest } });
  const root = '.obsidian/plugins/calendar'; files.set(`${root}/data.json`, '{"user":true}'); files.set(`${root}/custom.json`, 'keep'); files.set(`${root}/manifest.json`, '{"id":"calendar","version":"1.0.0"}'); files.set(`${root}/main.js`, 'old');
  app.plugins.enabledPlugins.add('calendar'); app.plugins.plugins.calendar = { id: 'calendar' };
  const manager = new GithubManager(runtime, app, plugin);
  assert.equal(await manager.install('acme/calendar', 'v2.0.0'), 'calendar');
  assert.equal(files.get(`${root}/data.json`), '{"user":true}');
  assert.equal(files.get(`${root}/custom.json`), 'keep');
  assert.equal(JSON.parse(files.get(`${root}/manifest.json`)).version, '2.0.0');
  assert.equal(files.has(`${root}/styles.css`), false);
  assert.equal(runtime.state.githubSources['community:calendar'].version, '2.0.0');
  assert.equal(app.plugins.plugins.calendar.id, 'calendar');
  assert.equal(runtime.local.operationPending, undefined);
});

test('install rejects missing required assets, manifest mismatch, minimum version and desktop-only builds before mutation', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  for (const scenario of [
    { manifest: { id: 'calendar', version: '2.0.0' }, missingAssets: true, message: /required asset/ },
    { manifest: { id: 'other', version: '2.0.0' }, message: /id does not match/ },
    { manifest: { id: 'calendar', version: '1.0.0' }, message: /tag and manifest version/ },
    { manifest: { id: 'calendar', version: '2.0.0', minAppVersion: '2.0.0' }, message: /Incompatible/ },
    { manifest: { id: 'calendar', version: '2.0.0', isDesktopOnly: true }, mobile: true, message: /desktop-only/ },
  ]) {
    const item = release('v2.0.0', scenario.manifest);
    if (scenario.missingAssets) item.assets = item.assets.filter((asset) => asset.name !== 'main.js');
  const { app, plugin, runtime, files } = createHarness({ appVersion: '1.5.0', mobile: scenario.mobile });
    assert.equal(app.version, undefined);
    assert.equal(app.appVersion, undefined);
    assert.equal(app.vault.config.appVersion, undefined);
    if (scenario.manifest.id === 'other') runtime.state.githubSources['community:calendar'] = { repo: 'acme/calendar', trackPrereleases: false };
    plugin.githubRequest = hostRoutes({ releases: [item], manifests: { calendar: scenario.manifest, other: scenario.manifest }, missingAssets: scenario.missingAssets });
    const manager = new GithubManager(runtime, app, plugin);
    await assert.rejects(manager.install('acme/calendar', 'v2.0.0'), scenario.message);
    assert.equal(files.has('.obsidian/plugins/calendar/main.js'), false);
  }
});

test('failed staged write restores exact managed files, data, and current enablement', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const manifest = { id: 'calendar', version: '2.0.0' };
  const { app, plugin, runtime, files, failNextWrite } = createHarness();
  plugin.githubRequest = hostRoutes({ releases: [release('v2.0.0', manifest, { styles: true })], manifests: { calendar: manifest } });
  const root = '.obsidian/plugins/calendar';
  files.set(`${root}/data.json`, 'unchanged data'); files.set(`${root}/manifest.json`, '{"id":"calendar","version":"1.0.0"}'); files.set(`${root}/main.js`, 'old-main'); files.set(`${root}/styles.css`, 'old-style');
  const before = [...files.entries()].filter(([path]) => path.startsWith(root)).sort();
  app.plugins.enabledPlugins.add('calendar'); app.plugins.plugins.calendar = { id: 'calendar' };
  failNextWrite((path) => path.includes('main.js.aigility'));
  const manager = new GithubManager(runtime, app, plugin);
  await assert.rejects(manager.install('acme/calendar', 'v2.0.0'), /injected write failure/);
  const after = [...files.entries()].filter(([path]) => path.startsWith(root)).sort();
  assert.deepEqual(after, before);
  assert.equal(app.plugins.plugins.calendar.id, 'calendar');
  assert.equal(runtime.local.operationPending, undefined);
});

test('transaction save failure compensates an installed release without nesting the shared queue', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const manifest = { id: 'calendar', version: '2.0.0' };
  const { app, plugin, runtime, files } = createHarness();
  plugin.githubRequest = hostRoutes({ releases: [release('v2.0.0', manifest)], manifests: { calendar: manifest } });
  const root = '.obsidian/plugins/calendar'; files.set(`${root}/manifest.json`, '{"id":"calendar","version":"1.0.0"}'); files.set(`${root}/main.js`, 'old-main');
  const originalManifest = files.get(`${root}/manifest.json`);
  runtime.failSave = true;
  const manager = new GithubManager(runtime, app, plugin);
  await assert.rejects(manager.install('acme/calendar', 'v2.0.0'), /injected state save failure/);
  assert.equal(files.get(`${root}/manifest.json`), originalManifest);
  assert.equal(files.get(`${root}/main.js`), 'old-main');
  assert.equal(runtime.state.githubSources['community:calendar'], undefined);
  assert.equal(runtime.local.operationPending, undefined);
});

test('rollback restores existing and absent styles while never replacing plugin data', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const manifest = { id: 'calendar', version: '2.0.0' };
  const { app, plugin, runtime, files } = createHarness();
  plugin.githubRequest = hostRoutes({ releases: [release('v2.0.0', manifest)], manifests: { calendar: manifest } });
  runtime.state.githubSources['community:calendar'] = { repo: 'acme/calendar', version: '1.0.0', trackPrereleases: false };
  const root = '.obsidian/plugins/calendar'; files.set(`${root}/data.json`, 'user-data'); files.set(`${root}/manifest.json`, '{"id":"calendar","version":"1.0.0"}'); files.set(`${root}/main.js`, 'old main'); files.set(`${root}/styles.css`, 'old css');
  const manager = new GithubManager(runtime, app, plugin);
  await manager.install('acme/calendar', 'v2.0.0');
  await manager.rollback('calendar');
  assert.equal(files.get(`${root}/manifest.json`), '{"id":"calendar","version":"1.0.0"}'); assert.equal(files.get(`${root}/main.js`), 'old main'); assert.equal(files.get(`${root}/styles.css`), 'old css'); assert.equal(files.get(`${root}/data.json`), 'user-data');
  assert.equal(runtime.state.githubSources['community:calendar'].version, '1.0.0');
  assert.equal(runtime.local.operationPending, undefined);
});

test('rollback of a first install removes the new managed files and its GitHub source record', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const manifest = { id: 'calendar', version: '2.0.0' };
  const { app, plugin, runtime, files } = createHarness();
  plugin.githubRequest = hostRoutes({ releases: [release('v2.0.0', manifest)], manifests: { calendar: manifest } });
  const manager = new GithubManager(runtime, app, plugin);
  await manager.install('acme/calendar', 'v2.0.0');
  await manager.rollback('calendar');
  assert.equal(files.has('.obsidian/plugins/calendar/manifest.json'), false);
  assert.equal(files.has('.obsidian/plugins/calendar/main.js'), false);
  assert.equal(runtime.state.githubSources['community:calendar'], undefined);
  assert.equal(runtime.local.operationPending, undefined);
});

test('setPin persists and clearing it removes the pin; prerelease tracking and pins drive checks', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const records = [{ id: 'beta', version: '1.0.0' }, { id: 'pinned', version: '1.0.0' }];
  const sources = { 'community:beta': { repo: 'acme/beta', trackPrereleases: true }, 'community:pinned': { repo: 'acme/pinned', trackPrereleases: false, pinned: 'v2.0.0-beta.1' } };
  const betaManifest = { id: 'beta', version: '1.1.0-beta.1' }; const pinManifest = { id: 'pinned', version: '2.0.0-beta.1' };
  const betaRelease = { ...release('v1.1.0-beta.1', betaManifest), prerelease: true };
  const pinRelease = { ...release('v2.0.0-beta.1', pinManifest), prerelease: true };
  const transport = async ({ url }) => {
    const parsed = new URL(url);
    if (url === registryUrl) return response([{ id: 'beta', repo: 'acme/beta' }, { id: 'pinned', repo: 'acme/pinned' }]);
    if (parsed.pathname.endsWith('/releases/tags/v2.0.0-beta.1')) return response(pinRelease);
    if (parsed.pathname.endsWith('/releases')) return response(parsed.pathname.includes('/beta/') ? [betaRelease] : []);
    if (parsed.pathname.endsWith('/manifest.json')) return response(parsed.pathname.includes('/beta/') ? betaManifest : pinManifest, { text: JSON.stringify(parsed.pathname.includes('/beta/') ? betaManifest : pinManifest) });
    return response({}, { status: 404 });
  };
  const { app, plugin, runtime } = createHarness({ records, sources }); plugin.githubRequest = transport; const manager = new GithubManager(runtime, app, plugin);
  const results = await manager.checkAll();
  assert.equal(results.find((result) => result.id === 'beta').proposed, '1.1.0-beta.1');
  assert.equal(results.find((result) => result.id === 'pinned').proposed, '2.0.0-beta.1');
  await manager.setPin('pinned', 'v3.0.0'); assert.equal(runtime.state.githubSources['community:pinned'].pinned, 'v3.0.0');
  await manager.setPin('pinned'); assert.equal(runtime.state.githubSources['community:pinned'].pinned, undefined);
  assert.equal(runtime.saves, 2);
  assert.equal(runtime.local.operationPending, undefined);
});

test('install does not reload a plugin after a newer manual disable', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const manifest = { id: 'calendar', version: '2.0.0' };
  const { app, plugin, runtime } = createHarness();
  plugin.githubRequest = hostRoutes({ releases: [release('v2.0.0', manifest)], manifests: { calendar: manifest } });
  app.plugins.enabledPlugins.add('calendar'); app.plugins.plugins.calendar = { id: 'calendar' };
  let loadCalls = 0;
  app.plugins.loadPlugin = async (id) => { loadCalls++; app.plugins.plugins[id] = { id }; };
  app.plugins.unloadPlugin = async (id) => { delete app.plugins.plugins[id]; app.plugins.enabledPlugins.delete(id); };
  const manager = new GithubManager(runtime, app, plugin);
  await manager.install('acme/calendar', 'v2.0.0');
  assert.equal(loadCalls, 0);
  assert.equal(app.plugins.enabledPlugins.has('calendar'), false);
});

test('checkAll fetches the registry once, caps active requests at three, and handles 723 installed plugins', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const records = Array.from({ length: 723 }, (_, index) => ({ id: `plug-${index}`, version: '1.0.0' }));
  let registryCalls = 0; let activeReleases = 0; let maxActive = 0;
  const checkedUrls = [];
  const transport = async ({ url }) => {
    const parsed = new URL(url);
    checkedUrls.push(url);
    if (url === registryUrl) { registryCalls++; return response(records.map(({ id }) => ({ id, repo: `acme/${id}` }))); }
    if (parsed.hostname === 'api.github.com') {
      activeReleases++; maxActive = Math.max(maxActive, activeReleases); await new Promise((resolve) => setTimeout(resolve, 1)); activeReleases--;
      return response({ ...release('v2.0.0', { id: parsed.pathname.split('/')[3], version: '2.0.0' }), prerelease: false });
    }
    const match = parsed.pathname.match(/\/releases\/download\/v2\.0\.0\/manifest\.json$/);
    if (match) { const id = parsed.pathname.split('/')[2]; return response({ id, version: '2.0.0' }, { text: JSON.stringify({ id, version: '2.0.0' }) }); }
    return response({}, { status: 404 });
  };
  const { app, plugin, runtime } = createHarness({ records }); plugin.githubRequest = transport; const manager = new GithubManager(runtime, app, plugin);
  const result = await manager.checkAll();
  assert.equal(result.length, 723); assert.equal(result.filter((item) => item.proposed).length, 723);
  assert.equal(registryCalls, 1); assert.ok(maxActive <= 3, `observed concurrency ${maxActive}`);
  assert.equal(maxActive, 3);
  assert.equal(result.length, 723);
  assert.ok(checkedUrls.filter((url) => new URL(url).pathname.endsWith('/releases')).every((url) => Number(new URL(url).searchParams.get('per_page')) <= 3));
  assert.equal(checkedUrls.filter((url) => new URL(url).pathname.endsWith('/releases/latest')).length, 723);
});

test('manual disable generation during asset download aborts before replacing managed files', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const manifest = { id: 'calendar', version: '2.0.0' };
  const { app, plugin, runtime, files } = createHarness({ sources: { 'community:calendar': { repo: 'acme/calendar', trackPrereleases: false } } });
  const root = '.obsidian/plugins/calendar';
  files.set(`${root}/manifest.json`, '{"id":"calendar","version":"1.0.0"}');
  files.set(`${root}/main.js`, 'old-main');
  app.plugins.enabledPlugins.add('calendar'); app.plugins.plugins.calendar = { id: 'calendar' };
  const routes = hostRoutes({ releases: [release('v2.0.0', manifest)], manifests: { calendar: manifest } });
  let changed = false;
  plugin.githubRequest = async (request) => {
    if (!changed && request.url.endsWith('/manifest.json')) {
      changed = true;
      app.plugins.enabledPlugins.delete('calendar');
      runtime.generations.set('calendar', runtime.getMutationGeneration('calendar') + 1);
    }
    return routes(request);
  };
  const manager = new GithubManager(runtime, app, plugin);
  await assert.rejects(manager.install('acme/calendar', 'v2.0.0'), /generation changed/);
  assert.equal(app.plugins.enabledPlugins.has('calendar'), false);
  assert.equal(files.get(`${root}/manifest.json`), '{"id":"calendar","version":"1.0.0"}');
  assert.equal(files.get(`${root}/main.js`), 'old-main');
});

test('beta install owns one serial runtime transaction without nesting save and preserves later queued manual/profile actions', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const manifest = { id: 'beta', version: '2.0.0-beta.1' };
  const item = release('v2.0.0-beta.1', manifest);
  const { app, plugin, runtime } = createHarness();
  let announceRequest;
  let continueRequest;
  const requested = new Promise((resolve) => { announceRequest = resolve; });
  const held = new Promise((resolve) => { continueRequest = resolve; });
  const routes = hostRoutes({ releases: [item], manifests: { beta: manifest } });
  plugin.githubRequest = async (request) => {
    if (request.url.includes('/releases/tags/')) { announceRequest(); await held; }
    return routes(request);
  };
  const manager = new GithubManager(runtime, app, plugin);
  const startedAt = Date.now();
  const install = manager.install('acme/beta', 'v2.0.0-beta.1');
  await requested;
  let laterActionRan = false;
  const laterAction = runtime.enqueue('manual-profile-action', async () => { laterActionRan = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(laterActionRan, false);
  continueRequest();
  assert.equal(await Promise.race([install, new Promise((_, reject) => setTimeout(() => reject(new Error('nested transaction deadlock')), 500))]), 'beta');
  await laterAction;
  assert.equal(laterActionRan, true);
  assert.ok(Date.now() - startedAt < 500, 'fake network and filesystem transaction should finish under 500ms');
});

test('old runtime queue fails explicitly when it does not supply a transaction context', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const { app, plugin, runtime } = createHarness();
  runtime.enqueue = async (_label, action) => action();
  const manager = new GithubManager(runtime, app, plugin);
  await assert.rejects(manager.setPin('calendar', 'v2.0.0'), /transaction-aware runtime queue/);
});

test('checkAll returns explicit API rate-limit errors without exposing the SecretStorage token', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const transport = async ({ url }) => {
    if (url === registryUrl) return response([{ id: 'calendar', repo: 'acme/calendar' }]);
    return response({}, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1234' } });
  };
  const { app, plugin, runtime } = createHarness({ records: [{ id: 'calendar', version: '1.0.0' }] }); plugin.githubRequest = transport;
  const manager = new GithubManager(runtime, app, plugin); const results = await manager.checkAll();
  assert.match(results[0].error, /rate limit/i); assert.equal(JSON.stringify(results).includes('secret-that-must-not-leak'), false);
});

test('updates are skipped during recovery or debug, protected manager cannot overwrite itself', async () => {
  const { GithubManager } = await importModule('src/integrated/github.ts');
  const { app, plugin, runtime } = createHarness(); const manager = new GithubManager(runtime, app, plugin);
  runtime.local.recoveryReason = 'interrupted'; assert.deepEqual(await manager.checkAll(), []);
  await assert.rejects(manager.install('acme/calendar', 'v2.0.0'), /recovery/i);
  runtime.local.recoveryReason = undefined; runtime.state.debug = { active: true };
  await assert.rejects(manager.setPin('calendar', 'v2.0.0'), /debug/i);
  runtime.state.debug = undefined;
  plugin.githubRequest = hostRoutes({ releases: [release('v2.0.0', { id: 'aigility-plugin-manager', version: '2.0.0' })], manifests: { 'aigility-plugin-manager': { id: 'aigility-plugin-manager', version: '2.0.0' } } });
  await assert.rejects(manager.install('acme/aigility-plugin-manager', 'v2.0.0'), /Protected/);
});
