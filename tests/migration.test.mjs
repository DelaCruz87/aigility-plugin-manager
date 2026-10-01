// Migration module tests (owned: tests/migration.test.mjs).
// Node runner via the shared esbuild TS helper (test.config.mjs).
// Synthetic data mirrors the real legacy shape (723 plugins / 42 command
// profiles / 69 tags) without copying any production setting value.

import assert from 'node:assert/strict';
import test from 'node:test';
import { importModule } from '../test.config.mjs';

const NOW = '2026-10-01T10:00:00.000Z';
const EQUIPMENT = ['macbook', 'zenbook', 'iphone', 'ipad', 's24', 'lenovo tab', 'boox tab mini c'];
const TEMPLATE_OF = {
    macbook: 'Desktop',
    zenbook: 'Desktop',
    iphone: 'Mobile',
    ipad: 'Tablet',
    s24: 'Mobile',
    'lenovo tab': 'Tablet',
    'boox tab mini c': 'Tablet',
};

function buildLegacyFixture() {
    const plugins = [];
    for (let i = 0; i < 722; i += 1) {
        const id = `fixture-${i}`;
        plugins.push({
            id,
            name: `Fixture ${i}`,
            desc: `Synthetic plugin ${i}`,
            group: i % 2 === 0 ? 'obsidian-community' : '',
            tags: i % 7 === 0 ? ['original-tag', 'desktop-only'] : ['original-tag'],
            enabled: i < 25,
            delay: i % 11 === 0 ? 'default' : '',
            note: i === 3 ? 'manual note' : '',
            customField: { kept: true, index: i },
        });
    }
    // Parked deferred policy on a real record: never observed active.
    plugins.push({
        id: 'folder-links',
        name: 'Folder Links',
        desc: 'Parked deferred plugin',
        group: '',
        tags: [],
        enabled: false,
        delay: '',
        note: '',
    });
    // Source managers and the independent Advanced Debug Mode exist as real
    // records in the legacy catalog.
    plugins.push({
        id: 'better-plugins-manager',
        name: 'Better Manager',
        desc: 'Make plugin management more intuitive and efficient.',
        group: 'obsidian-community',
        tags: ['dev', 'plugins', 'desktop', 'mobile', 'tablet'],
        enabled: true,
        delay: '',
        note: '',
    });
    plugins.push({
        id: 'better-plugins-manager-companion',
        name: 'Better Manager Companion',
        desc: 'Device profiles, BPM fixture profiles, safe boot, default workspaces, manifest compatibility tags, and deferred loading for Better Plugins Manager.',
        group: '',
        tags: [],
        enabled: false,
        delay: '',
        note: '',
    });
    plugins.push({
        id: 'advanced-debug-mode',
        name: 'Advanced Debug Mode',
        desc: 'Enhances debugging experience.',
        group: '',
        tags: [],
        enabled: false,
        delay: '',
        note: '',
    });
    // Omnisearch: desktop profile says false, mobile says true, deferred
    // enabled at 30s (effective activation observed at runtime).
    plugins.push({
        id: 'omnisearch',
        name: 'Omnisearch',
        desc: 'A search engine that just works.',
        group: '',
        tags: ['data', 'nav', 'search'],
        enabled: false,
        delay: '',
        note: '',
    });
    const commandProfiles = [];
    for (let i = 0; i < 42; i += 1) {
        commandProfiles.push({
            id: `tbl-${i}`,
            name: `Tabla ${i}`,
            pluginStates: { 'fixture-0': true, 'fixture-1': false, 'fixture-2': i === 5 },
            createdAt: 1700000000000 + i,
            updatedAt: 1700000100000 + i,
        });
    }
    const tags = [];
    for (let i = 0; i < 69; i += 1) {
        tags.push({ id: `tag-${i}`, name: `Tag ${i}`, color: '#123456' });
    }
    const groups = [
        { id: 'obsidian-core', name: 'Obsidian Core', color: '#8e44ad' },
        { id: 'obsidian-community', name: 'Community Plugin', color: '#54C7DE' },
        { id: 'language-forked', name: 'Lang-Fork Plugin', color: '#DE549F' },
    ];
    const companionProfiles = { desktop: {}, tablet: {}, mobile: {} };
    // Desktop/tablet: 25 members; mobile: 40 members (mirrors real density).
    for (let i = 0; i < 25; i += 1) {
        companionProfiles.desktop[`fixture-${i}`] = i % 2 === 0;
        companionProfiles.tablet[`fixture-${i}`] = i % 3 === 0;
    }
    for (let i = 0; i < 40; i += 1) {
        companionProfiles.mobile[`fixture-${i}`] = i % 4 === 0;
    }
    companionProfiles.desktop.omnisearch = false;
    companionProfiles.tablet.omnisearch = false;
    companionProfiles.mobile.omnisearch = true;
    companionProfiles.desktop['better-plugins-manager'] = true;
    companionProfiles.mobile['better-plugins-manager'] = true;
    companionProfiles.desktop['better-plugins-manager-companion'] = true;

    const bpm = {
        DEBUG: false,
        GITHUB_TOKEN: 'ghp_supersecret-token-value',
        GITHUB_PROXY: '',
        COMMAND_PROFILES: commandProfiles,
        GROUPS: groups,
        TAGS: tags,
        DELAYS: [{ id: 'default', name: 'Default delay', time: 10 }],
        Plugins: plugins,
        HIDES: ['fixture-9'],
        PLUGIN_LAYOUT: [{ id: 'fixture-0', type: 'plugin' }],
        BETA_SOURCES: [
            {
                id: 'my-beta',
                repo: 'owner/repo-beta',
                type: 'plugin',
                mode: 'frozen',
                frozenVersion: '1.2.3',
                includePrerelease: true,
                autoUpdate: true,
                enabled: true,
                localVersion: '1.1.0',
            },
            { id: 'broken-source', repo: 'not-a-repo', type: 'plugin', autoUpdate: false },
            { id: 'leaky-source', repo: 'owner/leaky', token: 'leaked-credential', type: 'plugin', autoUpdate: false },
        ],
        TROUBLESHOOT_STATE: { status: 'idle', suspectPool: [] },
        COMMAND_LAST_STATE: { pluginStates: { 'fixture-0': true }, createdAt: 1, label: 'x' },
    };
    const companion = {
        deferred: [
            { id: 'folder-links', delayMs: 5000, enabled: false },
            { id: 'backlink-cache', delayMs: 20000, enabled: false },
            { id: 'omnisearch', delayMs: 30000, enabled: true },
            { id: 'block-reference-enhancer', delayMs: 30000, enabled: false },
            { id: 'vscode-editor', delayMs: 30000, enabled: false },
        ],
        selfHealMode: 'auto',
        deviceTagIds: { desktop: 'desktop', tablet: 'tablet', mobile: 'mobile' },
        profiles: companionProfiles,
        workspaceIds: { desktop: 'd', tablet: 't', mobile: 'm' },
        enforceDeviceProfiles: true,
        safeBoot: false,
        logActions: true,
        bootDelayMs: 8000,
        profileBackups: {
            desktop: { name: 'Desktop profile', savedAt: 1790817689625, pluginStates: { 'fixture-0': false, omnisearch: false } },
            mobile: { name: 'Mobile profile', savedAt: 1786913221770, pluginStates: {} },
            tablet: { name: 'Tablet profile', savedAt: 1789998785122, pluginStates: { 'fixture-1': true } },
        },
        bpmPluginId: 'better-plugins-manager',
    };
    const observed = [];
    for (const plugin of plugins) {
        const active = plugin.enabled || plugin.id === 'omnisearch';
        observed.push({
            ref: { kind: 'community', id: plugin.id },
            name: plugin.name,
            version: '1.0.0',
            installed: true,
            compatible: plugin.id !== 'desktop-only-blocked',
            nativeAutostart: plugin.enabled,
            loaded: active,
        });
    }
    // Omnisearch loads late (deferred), not at native start.
    observed.find((entry) => entry.ref.id === 'omnisearch').nativeAutostart = false;
    // Incompatible-but-loaded deferred plugin: runtime host decides, the
    // migration must not invent membership for it.
    observed.push({
        ref: { kind: 'community', id: 'desktop-only-blocked' },
        name: 'Desktop Only Blocked',
        version: '2.0.0',
        installed: true,
        compatible: false,
        nativeAutostart: false,
        loaded: true,
    });
    companion.deferred.push({ id: 'desktop-only-blocked', delayMs: 15000, enabled: true });
    observed.push({
        ref: { kind: 'community', id: 'untracked-plugin' },
        name: 'Untracked Plugin',
        version: '0.9.0',
        installed: true,
        compatible: true,
        nativeAutostart: true,
        loaded: true,
    });
    observed.push({
        ref: { kind: 'core', id: 'backlink' },
        name: 'Backlinks',
        version: '1.14.3',
        installed: true,
        compatible: true,
        nativeAutostart: true,
        loaded: true,
    });
    observed.push({
        ref: { kind: 'core', id: 'sync' },
        name: 'Sync',
        version: '1.14.3',
        installed: true,
        compatible: true,
        nativeAutostart: false,
        loaded: false,
    });
    return { bpm, companion, observed };
}

async function loadMigration() {
    // test.config.mjs resolves entry points relative to the plugin root.
    const module = await importModule('src/integrated/migration.ts');
    return module.migrateLegacy;
}

test('real-shape synthetic catalog: 723 community records, 42 fixture profiles, 69+7 tags', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    assert.equal(state.schemaVersion, 1);
    const keys = Object.keys(state.records);
    assert.equal(keys.filter((key) => key.startsWith('community:')).length, 727 + 2);
    assert.equal(keys.filter((key) => key.startsWith('core:')).length, 2);
    assert.equal(state.fixtureProfiles.length, 42);
    assert.equal(state.tags.length, 69 + 7);
    assert.equal(state.groups.length, 3);
    assert.equal(state.deviceProfiles.length, 7);
    assert.equal(state.deferred.length, 6);
    // Original 69 tags keep id/name/color and come first; the 7 equipment
    // tags are appended with their template ids.
    assert.deepEqual(state.tags[0], { id: 'tag-0', name: 'Tag 0', color: '#123456' });
    assert.deepEqual(state.tags.slice(69).map((tag) => tag.id), EQUIPMENT);
    assert.equal(state.migration.migratedAt, NOW);
    assert.equal(state.migration.timestamp, NOW);
    assert.equal(state.migration.coreOrigin, 'observed-at-migration');
});

test('seven device templates keep exact ids, applyAtStart true, template mapping and companion workspaces', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    assert.deepEqual(state.deviceProfiles.map((profile) => profile.id), EQUIPMENT);
    assert.deepEqual(state.deviceProfiles.map((profile) => profile.name), EQUIPMENT);
    assert.ok(state.deviceProfiles.every((profile) => profile.applyAtStart === true));
    const byId = Object.fromEntries(state.deviceProfiles.map((profile) => [profile.id, profile]));
    for (const id of EQUIPMENT) {
        assert.equal(byId[id].template, TEMPLATE_OF[id], `template mapping for ${id}`);
        assert.deepEqual(byId[id].tagIds, [id]);
    }
    assert.equal(byId.macbook.workspaceId, 'd');
    assert.equal(byId.zenbook.workspaceId, 'd');
    assert.equal(byId.iphone.workspaceId, 'm');
    assert.equal(byId.s24.workspaceId, 'm');
    assert.equal(byId.ipad.workspaceId, 't');
    assert.equal(byId['lenovo tab'].workspaceId, 't');
    assert.equal(byId['boox tab mini c'].workspaceId, 't');
});

test('existing records copy all original tags then add equipment tags from saved legacy template booleans', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    // fixture-6: desktop true, tablet true, mobile false; original tags kept.
    const record = state.records['community:fixture-6'];
    assert.deepEqual(record.tags.slice(0, 1), ['original-tag']);
    assert.ok(record.tags.includes('macbook') && record.tags.includes('zenbook'));
    assert.ok(record.tags.includes('ipad') && record.tags.includes('lenovo tab') && record.tags.includes('boox tab mini c'));
    assert.ok(!record.tags.includes('iphone') && !record.tags.includes('s24'));
    assert.equal(record.group, 'obsidian-community');
    assert.equal(record.desired, true);
    // Unknown per-record legacy metadata is preserved opaquely.
    assert.deepEqual(record.metadata.legacyBpm.customField, { kept: true, index: 6 });
    assert.equal(record.metadata.legacyBpm.note, '');
    assert.deepEqual(record.metadata.companionProfiles, { desktop: true, tablet: true, mobile: false });
    // Desired state follows the observation; version comes from observation.
    assert.equal(state.records['community:fixture-500'].desired, false);
    assert.equal(state.records['community:fixture-6'].version, '1.0.0');
});

test('active deferred Omnisearch keeps effective desktop/tablet membership despite legacy desktop false', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    const omnisearch = state.records['community:omnisearch'];
    assert.ok(EQUIPMENT.every((tag) => omnisearch.tags.includes(tag)), 'macbook/zenbook etc. added for effective activation');
    assert.ok(omnisearch.tags.includes('data') && omnisearch.tags.includes('search'), 'original tags preserved');
    assert.equal(omnisearch.metadata.deferred.enabled, true);
    assert.equal(omnisearch.desired, true, 'effective activation is not lost');
    assert.equal(omnisearch.metadata.deferred.delayMs, 30000);
    // Parked policy without observation of activity gains no membership.
    const parked = state.records['community:folder-links'];
    assert.equal(EQUIPMENT.some((tag) => parked.tags.includes(tag)), false);
    // Incompatible record: the deferred rule must not invent membership, and
    // desktopOnly metadata is left for the runtime host to judge.
    const blocked = state.records['community:desktop-only-blocked'];
    assert.equal(EQUIPMENT.some((tag) => blocked.tags.includes(tag)), false);
    assert.equal(blocked.metadata.deferred.enabled, true);
});

test('core records take initial native/loaded state from observation with provenance', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    const backlink = state.records['core:backlink'];
    assert.ok(EQUIPMENT.every((tag) => backlink.tags.includes(tag)), 'enabled core gets all seven device tags');
    assert.equal(backlink.desired, true);
    assert.equal(backlink.metadata.coreOrigin, 'observed');
    assert.equal(backlink.metadata.nativeAutostartAtMigration, true);
    assert.equal(backlink.metadata.migratedAt, NOW);
    const sync = state.records['core:sync'];
    assert.equal(EQUIPMENT.some((tag) => sync.tags.includes(tag)), false, 'disabled core gets no device tags');
    assert.equal(sync.desired, false);
    assert.equal(sync.metadata.loadedAtMigration, false);
});

test('source managers and independent Advanced Debug Mode stay out of new device membership', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    for (const id of ['better-plugins-manager', 'better-plugins-manager-companion', 'advanced-debug-mode']) {
        const record = state.records[`community:${id}`];
        assert.ok(record, `${id} keeps its historical record`);
        assert.equal(EQUIPMENT.some((tag) => record.tags.includes(tag)), false, `${id} excluded from device membership`);
        assert.equal(record.metadata.excludedFromDeviceMembership, true);
    }
    assert.equal(state.records['community:better-plugins-manager'].metadata.legacyManager, 'bpm');
    assert.equal(state.records['community:better-plugins-manager-companion'].metadata.legacyManager, 'companion');
    assert.equal(state.records['community:advanced-debug-mode'].metadata.independentAdvancedDebug, true);
    assert.equal(state.records['community:better-plugins-manager'].desired, true, 'historical enabled state preserved');
    assert.equal(state.records['community:advanced-debug-mode'].desired, false, 'AMD not auto-enabled by integration');
    assert.equal(state.protected.includes('better-plugins-manager'), false);
});

test('command profiles become fixture profiles with prefixed member keys and explicit booleans', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    const first = state.fixtureProfiles[0];
    assert.equal(first.id, 'tbl-0');
    assert.equal(first.name, 'Tabla 0');
    assert.equal(first.members['community:fixture-0'], true);
    assert.equal(first.members['community:fixture-1'], false);
    assert.equal(first.members['community:fixture-2'], false);
    assert.equal(Object.keys(first.members).every((key) => key.startsWith('community:')), true);
    assert.equal(Object.values(first.members).every((value) => typeof value === 'boolean'), true);
    assert.equal(first.metadata.createdAt, 1700000000000);
    assert.equal(first.metadata.updatedAt, 1700000100000);
    const sixth = state.fixtureProfiles[5];
    assert.equal(sixth.members['community:fixture-2'], true);
});

test('deferred keeps parked disabled policies with their delays and marks them parked', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    const omnisearch = state.deferred.find((policy) => policy.id === 'omnisearch');
    assert.deepEqual(omnisearch, { id: 'omnisearch', delayMs: 30000, enabled: true, parked: false });
    const folderLinks = state.deferred.find((policy) => policy.id === 'folder-links');
    assert.deepEqual(folderLinks, { id: 'folder-links', delayMs: 5000, enabled: false, parked: true });
    const backlinkCache = state.deferred.find((policy) => policy.id === 'backlink-cache');
    assert.equal(backlinkCache.delayMs, 20000);
    assert.equal(backlinkCache.parked, true);
});

test('companion profileBackups object keeps its exact original structure inside the backup entry', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    assert.ok(Array.isArray(state.profileBackups));
    assert.equal(state.profileBackups.length, 1);
    const entry = state.profileBackups[0];
    assert.equal(entry.source, 'better-plugins-manager-companion');
    assert.equal(entry.migratedAt, NOW);
    const backups = entry.backups;
    assert.equal(typeof backups, 'object');
    assert.deepEqual(Object.keys(backups).sort(), ['desktop', 'mobile', 'tablet']);
    assert.deepEqual(backups.desktop, { name: 'Desktop profile', savedAt: 1790817689625, pluginStates: { 'fixture-0': false, omnisearch: false } });
    assert.deepEqual(backups.tablet, { name: 'Tablet profile', savedAt: 1789998785122, pluginStates: { 'fixture-1': true } });
    assert.deepEqual(backups.mobile, { name: 'Mobile profile', savedAt: 1786913221770, pluginStates: {} });
});

test('beta sources are format-verified and imported without secret material', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    const beta = state.githubSources['community:my-beta'];
    assert.deepEqual(beta, { repo: 'owner/repo-beta', trackPrereleases: true, version: '1.1.0', pinned: '1.2.3' });
    assert.equal(state.githubSources['community:broken-source'], undefined, 'invalid repo format is not imported');
    const leaky = state.githubSources['community:leaky-source'];
    assert.deepEqual(leaky, { repo: 'owner/leaky', trackPrereleases: false });
    const serialized = JSON.stringify(state);
    assert.equal(serialized.includes('ghp_supersecret-token-value'), false, 'no BPM token in State');
    assert.equal(serialized.includes('leaked-credential'), false, 'no source token in State');
    const issues = state.migration.issues.join('\n');
    assert.ok(issues.includes('broken-source'), 'rejected sources are reported');
    assert.equal(state.migration.counts.githubSources, 2);
});

test('protected baseline lists sync, toolbar, git, tasknotes and the own manager only', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    assert.deepEqual(state.protected, ['enso-sync-manager', 'note-toolbar', 'obsidian-git', 'tasknotes', 'aigility-plugin-manager']);
});

test('returned settings are staggerMs 250 and automaticUpdates false', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    assert.deepEqual(state.settings, { staggerMs: 250, automaticUpdates: false });
});

test('legacyBpm keeps full opaque metadata with secrets redacted', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    assert.equal(state.legacyBpm.GITHUB_TOKEN, '[redacted]');
    assert.equal(state.legacyBpm.DEBUG, false);
    assert.deepEqual(state.legacyBpm.TROUBLESHOOT_STATE, { status: 'idle', suspectPool: [] });
    assert.equal(state.legacyBpm.Plugins.length, 727);
    assert.equal(state.legacyBpm.TAGS.length, 69);
    assert.equal(state.legacyBpm.HIDES[0], 'fixture-9');
    assert.equal(state.migration.sources.bpm, 'better-plugins-manager');
    assert.equal(state.migration.sources.companion, 'better-plugins-manager-companion');
    assert.equal(state.migration.counts.communityRecords, 729);
    assert.equal(state.migration.counts.coreRecords, 2);
    assert.equal(state.migration.counts.totalRecords, 731);
    assert.equal(state.migration.profileBackupsPreserved, true);
});

test('community plugins observed but absent from the BPM list get records', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    const untracked = state.records['community:untracked-plugin'];
    assert.equal(untracked.name, 'Untracked Plugin');
    assert.equal(untracked.version, '0.9.0');
    assert.equal(untracked.desired, true);
    assert.equal(untracked.metadata.addedFromObservation, true);
});

test('migration never mutates its inputs', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const before = JSON.stringify({ bpm, companion, observed });
    migrateLegacy(bpm, companion, observed, NOW);
    assert.equal(JSON.stringify({ bpm, companion, observed }), before);
    assert.equal(bpm.GITHUB_TOKEN, 'ghp_supersecret-token-value');
    assert.equal(companion.profiles.desktop.omnisearch, false);
    assert.equal(bpm.Plugins[0].tags.length, 2);
});

test('idempotent: already-migration data supplied returns the same schema-1 state', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const state = migrateLegacy(bpm, companion, observed, NOW);
    const rerun = migrateLegacy(state, {}, [], '2099-01-01T00:00:00.000Z');
    assert.deepEqual(rerun, state);
    assert.equal(rerun.migration.migratedAt, NOW, 'migration record is not refreshed');
    assert.equal(rerun.tags.length, state.tags.length, 'no duplicated tags');
    assert.equal(rerun.profileBackups.length, 1, 'no duplicated backups');
    assert.equal(rerun.deviceProfiles.length, 7);
});

test('deterministic: same inputs and timestamp produce the same state', async () => {
    const migrateLegacy = await loadMigration();
    const { bpm, companion, observed } = buildLegacyFixture();
    const first = migrateLegacy(bpm, companion, observed, NOW);
    const second = migrateLegacy(bpm, companion, observed, NOW);
    assert.deepEqual(first, second);
});

test('defensive: empty or malformed legacy data still yields a valid schema-1 state', async () => {
    const migrateLegacy = await loadMigration();
    const state = migrateLegacy(null, null, [], NOW);
    assert.equal(state.schemaVersion, 1);
    assert.deepEqual(state.records, {});
    assert.deepEqual(state.deviceProfiles.map((profile) => profile.id), EQUIPMENT);
    assert.deepEqual(state.protected, ['enso-sync-manager', 'note-toolbar', 'obsidian-git', 'tasknotes', 'aigility-plugin-manager']);
    assert.deepEqual(state.profileBackups, []);
    assert.deepEqual(state.settings, { staggerMs: 250, automaticUpdates: false });
    const broken = migrateLegacy(
        { Plugins: [{ id: '' }, 'nope', { id: 'ok', name: 'Ok' }], COMMAND_PROFILES: [{ id: 'x' }], BETA_SOURCES: 'bad' },
        { deferred: [{ id: 'no-delay' }], profiles: { desktop: 'bad' } },
        [{ ref: { kind: 'core', id: 'files' }, name: 'Files', version: '1', installed: true, compatible: true, nativeAutostart: true, loaded: true }],
        NOW,
    );
    assert.ok(broken.records['community:ok']);
    assert.ok(broken.records['core:files'].tags.includes('macbook'));
    assert.equal(broken.fixtureProfiles.length, 1);
    assert.deepEqual(broken.deferred, [{ id: 'no-delay', delayMs: 0, enabled: false, parked: true }]);
    assert.ok(broken.migration.issues.length >= 3, 'malformed entries are reported, never silent');
});
