import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { importModule, projectRoot } from '../test.config.mjs';

const { collectObserved, createHostAdapter } = await importModule('src/integrated/adapter.ts');

const COMMUNITY = { id: 'community', kind: 'community' };

/**
 * Fake host with the semantics of the live host 1.14.3: app.plugins.isEnabled()
 * is a global zero-argument boolean, nonpersistent enablePlugin() does not touch
 * the native enabledPlugins Set, and core toggles go through the per-plugin
 * wrapper enable(false)/disable(false) plus internalPlugins.saveConfig().
 */
function makeHost({ loadingEnabled = true, communityIds = ['alpha', 'slow'], coreIds = ['search', 'workspaces'] } = {}) {
    const calls = [];
    const isEnabledArgs = [];
    const manifests = {};
    const instances = {};
    const enabledPlugins = new Set();
    for (const id of communityIds) manifests[id] = { id, name: id.toUpperCase(), version: '1.0.0', minAppVersion: '1.0.0' };

    const community = {
        manifests,
        plugins: instances,
        enabledPlugins,
        isEnabled: (...args) => { isEnabledArgs.push(args); return loadingEnabled; },
        setEnable: (value) => { loadingEnabled = value; calls.push(['setEnable', value]); },
        getPlugin: (id) => instances[id],
        enablePlugin: async (id) => { calls.push(['enablePlugin', id]); instances[id] = { _loaded: true }; return true; },
        enablePluginAndSave: async (id) => { calls.push(['enablePluginAndSave', id]); instances[id] = { _loaded: true }; enabledPlugins.add(id); return true; },
        disablePlugin: async (id) => { calls.push(['disablePlugin', id]); delete instances[id]; return true; },
        disablePluginAndSave: async (id) => { calls.push(['disablePluginAndSave', id]); delete instances[id]; enabledPlugins.delete(id); return true; },
        saveConfig: async () => { calls.push(['community.saveConfig']); },
    };

    const registry = {};
    for (const id of coreIds) {
        const wrapper = {
            id,
            enabled: false,
            instance: null,
            template: { name: id, manifest: { id, name: id } },
            manifest: { id, name: id },
            enable: async (user = true) => { calls.push(['wrapper.enable', id, user]); wrapper.enabled = true; wrapper.instance = wrapper.template; },
            disable: (user = true) => { calls.push(['wrapper.disable', id, user]); wrapper.enabled = false; wrapper.instance = null; },
        };
        registry[id] = wrapper;
    }
    const workspaces = registry['workspaces'];
    workspaces.template = {
        name: 'Workspaces',
        activeWorkspace: 'd',
        workspaces: { d: { name: 'Default', leaves: [] } },
        loadWorkspace: async (id) => { calls.push(['workspaces.loadWorkspace', id]); return true; },
        saveData: async () => { calls.push(['workspaces.saveData']); },
    };
    workspaces.enabled = true;
    workspaces.instance = workspaces.template;

    const app = {
        appId: 'adapter-test',
        // Absent in the live host; present here only to prove it is never used.
        vault: { config: { appVersion: '99.0.0' } },
        workspace: { loadWorkspace: () => { throw new Error('app.workspace.loadWorkspace must never be used.'); } },
        plugins: community,
        internalPlugins: {
            plugins: registry,
            getPluginById: (id) => registry[id],
            enable: (...args) => { calls.push(['internalPlugins.enable', ...args]); throw new Error('Bulk internalPlugins.enable() must never be used.'); },
            saveConfig: async () => { calls.push(['internalPlugins.saveConfig']); },
        },
    };
    return { app, calls, isEnabledArgs, community, registry };
}

function harness(options = {}) {
    const host = makeHost(options);
    const pauses = [];
    const mutations = [];
    const adapter = createHostAdapter(host.app, { app: host.app }, (reason) => pauses.push(reason), (ref, origin) => mutations.push([`${ref.kind}:${ref.id}`, origin]));
    return { ...host, adapter, pauses, mutations };
}

test('restricted detection reads the global zero-argument isEnabled and never passes an id', () => {
    const h = harness();
    assert.equal(h.adapter.isRestricted(), false);
    assert.equal(h.adapter.isLoadingEnabled(), true);
    h.app.plugins.setEnable(false);
    assert.equal(h.adapter.isRestricted(), true);
    assert.equal(h.adapter.isLoadingEnabled(), false);
    h.adapter.isRestricted();
    assert.ok(h.isEnabledArgs.length >= 3);
    assert.deepEqual(h.isEnabledArgs, h.isEnabledArgs.map(() => []));
});

test('loaded state and native autostart are independent fields', async () => {
    const h = harness();
    const ref = { ...COMMUNITY, id: 'alpha' };
    h.app.plugins.enabledPlugins.add('alpha');
    const before = collectObserved(h.app).find((item) => item.ref.id === 'alpha');
    assert.equal(before.nativeAutostart, true);
    assert.equal(before.loaded, false);
    assert.equal(h.adapter.isNativeEnabled(ref), true);
    assert.equal(h.adapter.isEnabled(ref), false, 'a persisted flag without an instance is not enabled');

    await h.adapter.excludeDeferred(ref);
    await h.adapter.loadDeferred(ref);
    assert.equal(h.adapter.isEnabled(ref), true);
    assert.equal(h.adapter.isNativeEnabled(ref), false);
    const after = collectObserved(h.app).find((item) => item.ref.id === 'alpha');
    assert.equal(after.nativeAutostart, false);
    assert.equal(after.loaded, true);
});

test('deferred activation never persists native ids and never calls saveConfig', async () => {
    const h = harness();
    await h.adapter.loadDeferred({ ...COMMUNITY, id: 'slow' });
    assert.ok(h.app.plugins.plugins.slow, 'instance really loaded');
    assert.equal(h.app.plugins.enabledPlugins.has('slow'), false);
    assert.deepEqual(h.calls.filter((call) => call[0] === 'community.saveConfig'), []);
    assert.equal(h.calls.some((call) => call[0] === 'enablePluginAndSave'), false);
    assert.equal(h.calls.some((call) => call[0] === 'enablePlugin' && call[1] === 'slow'), true);
});

test('deferred activation refuses while the id is still in native autostart', async () => {
    const h = harness();
    h.app.plugins.enabledPlugins.add('slow');
    await assert.rejects(h.adapter.loadDeferred({ ...COMMUNITY, id: 'slow' }), /native autostart/);
});

test('enabling requires a real loaded instance, native flag alone is a readback failure', async () => {
    const h = harness();
    h.app.plugins.enablePluginAndSave = async (id) => { h.app.plugins.enabledPlugins.add(id); return true; };
    await assert.rejects(h.adapter.setEnabled({ ...COMMUNITY, id: 'slow' }, true), /readback/);
    h.calls.length = 0;
    await h.adapter.setEnabled({ ...COMMUNITY, id: 'slow' }, false);
    assert.equal(h.app.plugins.enabledPlugins.has('slow'), false);
    assert.equal(h.calls.some((call) => call[0] === 'disablePluginAndSave'), true);
});

test('persistent enable persists the native id and the load readback', async () => {
    const h = harness();
    await h.adapter.setEnabled({ ...COMMUNITY, id: 'slow' }, true);
    assert.equal(h.app.plugins.enabledPlugins.has('slow'), true);
    assert.ok(h.app.plugins.plugins.slow);
    assert.equal(h.adapter.isNativeEnabled({ ...COMMUNITY, id: 'slow' }), true);
});

test('loadNow keeps the host native state untouched, exactly like a deferred load', async () => {
    const h = harness();
    await h.adapter.setEnabled({ ...COMMUNITY, id: 'slow' }, true, { loadNow: true, origin: 'debug' });
    assert.ok(h.app.plugins.plugins.slow);
    assert.equal(h.app.plugins.enabledPlugins.has('slow'), false);
    assert.deepEqual(h.calls.filter((call) => call[0] === 'community.saveConfig'), []);
});

test('deferred exclusion deletes the id and persists without unloading a delayed instance', async () => {
    const h = harness();
    await h.adapter.loadDeferred({ ...COMMUNITY, id: 'slow' });
    h.app.plugins.enabledPlugins.add('slow');
    h.calls.length = 0;

    await h.adapter.excludeDeferred({ ...COMMUNITY, id: 'slow' });
    assert.equal(h.app.plugins.enabledPlugins.has('slow'), false, 'native id removed');
    assert.equal(h.calls.some((call) => call[0] === 'community.saveConfig'), true, 'removal persisted');
    assert.ok(h.app.plugins.plugins.slow, 'a legitimately loaded instance is not unloaded by exclusion');
    assert.equal(h.calls.some((call) => call[0] === 'disablePluginAndSave'), false);
});

test('deferred exclusion unloads only when recovery or the off path asks for it', async () => {
    const h = harness();
    await h.adapter.loadDeferred({ ...COMMUNITY, id: 'slow' });
    await h.adapter.excludeDeferred({ ...COMMUNITY, id: 'slow' }, { unload: true, origin: 'recovery' });
    assert.equal(h.app.plugins.plugins.slow, undefined);
    assert.equal(h.calls.some((call) => call[0] === 'disablePlugin'), true);
});

test('core toggles use wrapper enable(false)/disable(false) and save the core config', async () => {
    const h = harness();
    const ref = { kind: 'core', id: 'search' };
    await h.adapter.setEnabled(ref, true, { origin: 'profile' });
    assert.deepEqual(h.calls.filter((call) => call[0] === 'wrapper.enable'), [['wrapper.enable', 'search', false]]);
    assert.equal(h.calls.some((call) => call[0] === 'internalPlugins.saveConfig'), true);
    assert.equal(h.registry.search.enabled, true);
    assert.equal(h.adapter.isEnabled(ref), true);
    assert.equal(h.adapter.isNativeEnabled(ref), true);

    h.calls.length = 0;
    await h.adapter.setEnabled(ref, false);
    assert.deepEqual(h.calls.filter((call) => call[0] === 'wrapper.disable'), [['wrapper.disable', 'search', false]]);
    assert.equal(h.registry.search.instance, null);
    assert.equal(h.adapter.isEnabled(ref), false);
});

test('core deferred exclusion disables the wrapper and persists the core config', async () => {
    const h = harness();
    h.registry['workspaces'].enabled = true;
    await h.adapter.excludeDeferred({ kind: 'core', id: 'workspaces' });
    assert.equal(h.registry['workspaces'].enabled, false);
    assert.equal(h.calls.some((call) => call[0] === 'internalPlugins.saveConfig'), true);
    assert.equal(h.adapter.isEnabled({ kind: 'core', id: 'workspaces' }), false);
});

test('workspace application uses the core Workspaces instance and never app.workspace', async () => {
    const h = harness();
    await h.adapter.loadWorkspace('d');
    assert.equal(h.calls.some((call) => call[0] === 'workspaces.loadWorkspace' && call[1] === 'd'), true);
    h.registry['workspaces'].instance.activeWorkspace = 'other';
    await assert.rejects(h.adapter.loadWorkspace('d'), /readback/);
});

test('workspace readback failure is reported when the host exposes no loadWorkspace', async () => {
    const h = harness();
    h.registry['workspaces'].instance.loadWorkspace = undefined;
    await assert.rejects(h.adapter.loadWorkspace('d'), /loadWorkspace/);
});

test('legacy workspace clones d into t and m only when the ids are absent', async () => {
    const h = harness();
    const workspaces = h.registry['workspaces'].instance.workspaces;
    const cloned = await h.adapter.ensureLegacyWorkspaceClones();
    assert.deepEqual(cloned, ['t', 'm']);
    assert.deepEqual(workspaces.t, { name: 'Default', leaves: [] });
    assert.equal(h.calls.filter((call) => call[0] === 'workspaces.saveData').length, 1);

    h.calls.length = 0;
    delete workspaces.t;
    workspaces.m = { name: 'Kept' };
    assert.deepEqual(await h.adapter.ensureLegacyWorkspaceClones(), ['t']);
    assert.equal(h.calls.filter((call) => call[0] === 'workspaces.saveData').length, 1);
    assert.deepEqual(workspaces.m, { name: 'Kept' });

    h.calls.length = 0;
    assert.deepEqual(await h.adapter.ensureLegacyWorkspaceClones(), []);
    assert.equal(h.calls.filter((call) => call[0] === 'workspaces.saveData').length, 0, 'nothing missing, nothing saved');
});

test('legacy workspace clone rolls back when saveData fails', async () => {
    const h = harness();
    h.registry['workspaces'].instance.saveData = async () => { throw new Error('disk full'); };
    await assert.rejects(h.adapter.ensureLegacyWorkspaceClones(), /disk full/);
    const workspaces = h.registry['workspaces'].instance.workspaces;
    assert.deepEqual(Object.keys(workspaces), ['d']);
});

test('compatibility uses the public apiVersion export, not fabricated app version fields', () => {
    const h = harness();
    h.app.plugins.manifests.alpha.minAppVersion = '99.0.0';
    h.app.plugins.manifests.slow.minAppVersion = '1.0.0';
    const observed = collectObserved(h.app);
    assert.equal(observed.find((item) => item.ref.id === 'alpha').compatible, false, 'high minAppVersion rejected');
    assert.equal(observed.find((item) => item.ref.id === 'slow').compatible, true);
    h.app.plugins.manifests.alpha.minAppVersion = '1.0.0';
    assert.equal(collectObserved(h.app).find((item) => item.ref.id === 'alpha').compatible, true);
});

test('compatibility rejects a host without a public version authority', async () => {
    const noVersionStub = {
        name: 'virtual-obsidian-no-version',
        setup(builder) {
            builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'virtual-obsidian' }));
            builder.onLoad({ filter: /.*/, namespace: 'virtual-obsidian' }, () => ({
                contents: "export const Platform={isDesktopApp:true,isMobile:false,isDesktop:true};export const apiVersion='';",
                loader: 'js',
            }));
        },
    };
    const result = await build({
        absWorkingDir: projectRoot,
        entryPoints: [path.join(projectRoot, 'src/integrated/adapter.ts')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
        target: 'node22',
        plugins: [noVersionStub],
    });
    const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    const h = harness();
    assert.equal(module.collectObserved(h.app).find((item) => item.ref.id === 'alpha').compatible, false);
    h.app.plugins.manifests.alpha.minAppVersion = undefined;
    assert.equal(module.collectObserved(h.app).find((item) => item.ref.id === 'alpha').compatible, true);
});

test('desktop-only manifests are judged against Platform, not against app fields', async () => {
    const mobileStub = {
        name: 'virtual-obsidian-mobile',
        setup(builder) {
            builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'virtual-obsidian' }));
            builder.onLoad({ filter: /.*/, namespace: 'virtual-obsidian' }, () => ({
                contents: "export const Platform={isDesktopApp:false,isMobile:true,isDesktop:false};export const apiVersion='1.14.3';",
                loader: 'js',
            }));
        },
    };
    const result = await build({
        absWorkingDir: projectRoot,
        entryPoints: [path.join(projectRoot, 'src/integrated/adapter.ts')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
        target: 'node22',
        plugins: [mobileStub],
    });
    const mobile = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    const h = harness();
    h.app.plugins.manifests.alpha.isDesktopOnly = true;
    h.app.plugins.manifests.slow.isDesktopOnly = false;
    const observed = mobile.collectObserved(h.app);
    assert.equal(observed.find((item) => item.ref.id === 'alpha').compatible, false, 'desktop only on a mobile host');
    assert.equal(observed.find((item) => item.ref.id === 'slow').compatible, true);
    assert.equal(collectObserved(h.app).find((item) => item.ref.id === 'alpha').compatible, true, 'desktop host keeps it');
});

test('native manual toggles are reported, including calls that return to the same value', async () => {
    const h = harness();
    const teardown = h.adapter.installMutationTracking();
    assert.equal(h.adapter.isMutationTrackingInstalled(), true);

    await h.app.plugins.enablePluginAndSave('slow');
    await h.app.plugins.disablePluginAndSave('slow');
    await h.app.plugins.enablePluginAndSave('slow');
    assert.deepEqual(h.mutations, [
        ['community:slow', 'host'],
        ['community:slow', 'host'],
        ['community:slow', 'host'],
    ]);

    h.mutations.length = 0;
    await h.app.internalPlugins.getPluginById('search').enable(true);
    assert.deepEqual(h.mutations, [['core:search', 'host']]);

    h.mutations.length = 0;
    await h.adapter.setEnabled({ ...COMMUNITY, id: 'slow' }, true);
    await h.adapter.setEnabled({ kind: 'core', id: 'search' }, false);
    assert.deepEqual(h.mutations, [], 'adapter owned writes are not reported as manual intent');

    teardown();
    assert.equal(h.adapter.isMutationTrackingInstalled(), false);
    await h.app.plugins.disablePluginAndSave('slow');
    assert.deepEqual(h.mutations, [], 'tracking is silent after teardown');
});

test('self suppression spans synchronous host nesting only, never a still pending promise', async () => {
    const h = harness();
    const teardown = h.adapter.installMutationTracking();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    // Live shape: enablePluginAndSave reaches enablePlugin synchronously, then
    // stays pending. The nested call is adapter owned, the later one is a user.
    h.app.plugins.enablePluginAndSave = async (id) => {
        await h.app.plugins.enablePlugin(id);
        await gate;
        h.app.plugins.plugins[id] = { _loaded: true };
        h.app.plugins.enabledPlugins.add(id);
        return true;
    };

    const pending = h.adapter.setEnabled({ ...COMMUNITY, id: 'slow' }, true);
    await Promise.resolve();
    assert.deepEqual(h.mutations, [], 'a nested synchronous self call is not manual intent');
    assert.ok(
        h.calls.some((call) => call[0] === 'enablePlugin' && call[1] === 'slow'),
        'the nested self call really reached the host',
    );

    await h.app.plugins.disablePlugin('slow');
    assert.deepEqual(
        h.mutations,
        [['community:slow', 'host']],
        'an equal manual call arriving while the adapter call is pending is still intent',
    );

    release();
    await pending;
    assert.deepEqual(h.mutations, [['community:slow', 'host']], 'settling the adapter call reports nothing');
    teardown();
});

test('mutation tracking teardown is reversible and preserves wrappers installed later', async () => {
    const h = harness();
    const before = h.app.plugins.enablePluginAndSave;
    const coreEnable = h.registry.search.enable;
    const teardown = h.adapter.installMutationTracking();
    assert.notEqual(h.app.plugins.enablePluginAndSave, before);

    const laterCommunity = async () => 'later';
    const laterCore = async () => 'later';
    h.app.plugins.enablePluginAndSave = laterCommunity;
    h.registry.search.enable = laterCore;

    teardown();
    assert.equal(h.app.plugins.enablePluginAndSave, laterCommunity, 'a later wrapper survives teardown');
    assert.equal(h.registry.search.enable, laterCore);

    h.app.plugins.enablePluginAndSave = before;
    h.registry.search.enable = coreEnable;
    h.adapter.installMutationTracking();
    h.adapter.dispose();
    assert.equal(h.app.plugins.enablePluginAndSave, before);
    assert.equal(h.registry.search.enable, coreEnable);
    assert.equal(h.adapter.isMutationTrackingInstalled(), false);
});

test('the global pause guard is reversible and keeps a later wrapper', () => {
    const h = harness();
    const original = h.app.plugins.setEnable;
    const teardown = h.adapter.installGlobalPauseGuard();
    h.app.plugins.setEnable(false);
    assert.equal(h.pauses.length, 1);
    const later = () => {};
    h.app.plugins.setEnable = later;
    teardown();
    assert.equal(h.app.plugins.setEnable, later);
    h.app.plugins.setEnable = original;
});

test('missing host capabilities throw explicitly instead of guessing', async () => {
    const h = harness();
    delete h.app.plugins.isEnabled;
    assert.throws(() => h.adapter.isRestricted(), /isEnabled/);
    h.app.plugins.isEnabled = () => true;

    delete h.app.plugins.enablePluginAndSave;
    await assert.rejects(h.adapter.setEnabled({ ...COMMUNITY, id: 'slow' }, true), /enablePluginAndSave/);
    h.app.plugins.enablePluginAndSave = async (id) => { h.app.plugins.enabledPlugins.add(id); h.app.plugins.plugins[id] = { _loaded: true }; return true; };

    delete h.app.internalPlugins.saveConfig;
    await assert.rejects(h.adapter.setEnabled({ kind: 'core', id: 'search' }, true), /saveConfig/);
    h.app.internalPlugins.saveConfig = async () => {};

    delete h.app.plugins.enablePlugin;
    await assert.rejects(h.adapter.loadDeferred({ ...COMMUNITY, id: 'slow' }), /enablePlugin/);
});

test('uninstalled plugins are rejected before any host call', async () => {
    const h = harness();
    h.calls.length = 0;
    await assert.rejects(h.adapter.setEnabled({ ...COMMUNITY, id: 'missing' }, true), /not installed/);
    assert.deepEqual(h.calls, []);
});
