import assert from 'node:assert/strict';
import test from 'node:test';
import { importModule, typecheck } from '../test.config.mjs';

test('Obsidian stub exports the host version and platform flags used by modules', async () => {
  const { apiVersion, Platform } = await importModule('tests/obsidian-stub.mjs');
  assert.equal(apiVersion, '1.14.3');
  assert.equal(Platform.isDesktopApp, true);
  assert.equal(Platform.isDesktop, true);
  assert.equal(Platform.isMobile, false);
});

test('plugin references round-trip through canonical record keys', async () => {
  const { key, parseKey } = await importModule('src/integrated/types.ts');
  for (const ref of [
    { kind: 'community', id: 'calendar' },
    { kind: 'core', id: 'sync' },
  ]) {
    assert.equal(parseKey(key(ref)).kind, ref.kind);
    assert.deepEqual(parseKey(key(ref)), ref);
  }
});

test('plugin key parser rejects malformed and unsupported references', async () => {
  const { parseKey } = await importModule('src/integrated/types.ts');
  for (const value of ['', 'calendar', 'theme:calendar', 'community:', ':sync', 'community:a:b', 'community: calendar', null, 1]) {
    assert.equal(parseKey(value), null, `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test('canonical state and observed records satisfy the exported contract', async () => {
  const diagnostics = await typecheck(`
    import type {
      Change, DeferredPolicy, DeviceProfile, EffectivePlugin, FixtureProfile,
      GithubSource, Group, LocalState, ObservedPlugin, PluginKind, PluginRecord,
      PluginRef, Record, Release, State, Tag, UpdateResult
    } from 'aigility-types';

    const ref: PluginRef = { kind: 'community', id: 'calendar' };
    const record: PluginRecord = {
      ref, name: 'Calendar', version: '1.0.0', tags: ['productivity'],
      group: 'work', desired: true, metadata: { author: 'example' }
    };
    const observed: ObservedPlugin = {
      ref, name: record.name, version: record.version, installed: true,
      compatible: true, nativeAutostart: true, loaded: true
    };
    const effective: EffectivePlugin = {
      ...observed, desired: true, tags: record.tags, group: record.group,
      scheduled: false
    };
    const profile: DeviceProfile = {
      id: 'desktop', name: 'Desktop', tagIds: ['productivity'],
      applyAtStart: true, workspaceId: 'macbook'
    };
    const fixture: FixtureProfile = {
      id: 'minimal', name: 'Minimal', members: { 'community:calendar': true }
    };
    const source: GithubSource = {
      repo: 'owner/calendar', version: '1.0.0', trackPrereleases: false
    };
    const local: LocalState = { deviceProfileId: profile.id };
    const kind: PluginKind = 'community';
    const recordAlias: Record = record;
    const tag: Tag = { id: 'productivity', name: 'Productivity', color: '#fff' };
    const group: Group = { id: 'work', name: 'Work', metadata: {} };
    const deferred: DeferredPolicy = { id: 'community:calendar', delayMs: 250, enabled: true };
    const change: Change = { ref, before: false, after: true };
    const release: Release = { tag: '1.0.0', name: 'Release', prerelease: false, assets: [] };
    const update: UpdateResult = { id: 'calendar', current: '1.0.0' };
    const state: State = {
      schemaVersion: 1, records: { 'community:calendar': record },
      tags: [{ id: 'productivity', name: 'Productivity' }],
      groups: [{ id: 'work', name: 'Work', metadata: {} }],
      deviceProfiles: [profile], fixtureProfiles: [fixture], deferred: [],
      protected: ['community:aigility-plugin-manager'], profileBackups: [],
      githubSources: { 'community:calendar': source },
      settings: { staggerMs: 100, automaticUpdates: false }, legacyBpm: {}
    };
    void effective; void local; void state; void kind; void recordAlias;
    void tag; void group; void deferred; void change; void release; void update;
  `);
  assert.deepEqual(diagnostics, []);
});
