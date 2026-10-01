import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCasesBody, fixtureFiles, ownProjection, protectionCleanup, purgeOwned, restoreUndo } from '../checks/profile-fixture-plan.mjs';

const base = () => ({
  schemaVersion: 1,
  records: {
    'community:aigility-manager-fixture-a': { desired: false },
    'community:foreign': { desired: true },
    'core:backlinks': { desired: true },
  },
  tags: [{ id: 'aigility-test-tag' }, { id: 'foreign-tag' }],
  groups: [{ id: 'g' }],
  deviceProfiles: [{ id: 'aigility-host-test' }, { id: 'foreign-profile' }],
  fixtureProfiles: [{ id: 'aigility-host-partial' }, { id: 'foreign-fixture' }],
  deferred: [{ id: 'aigility-manager-fixture-a' }, { id: 'foreign' }],
  profileBackups: [{ profileId: 'aigility-host-test' }, { profileId: 'foreign-profile' }],
  protected: ['core:backlinks'],
  githubSources: {},
  settings: { automaticUpdates: false, staggerMs: 0 },
  legacyBpm: {},
  undo: { marker: 'old' },
  debug: { marker: 'keep' },
});

test('fixtureFiles allows only the two named fixture IDs and safe exact filenames', () => {
  for (const id of ['aigility-manager-fixture-a', 'aigility-manager-fixture-b']) {
    const files = fixtureFiles(id);
    assert.deepEqual(Object.keys(files).sort(), ['custom.txt', 'data.json', 'main.js', 'manifest.json']);
    assert.equal(JSON.parse(files['manifest.json']).id, id);
    assert.match(files['main.js'], /aigility-host-count:/);
    assert.doesNotMatch(files['main.js'], /aigility-host-bug|loadManifests/);
  }
  for (const id of ['../foreign', 'aigility-manager-fixture-slow', 'aigility-manager-fixture-a/']) {
    assert.throws(() => fixtureFiles(id));
  }
});

test('purgeOwned removes only unchanged owned rows and preserves foreign fields', () => {
  const before = base();
  const current = structuredClone(before);
  current.records['community:aigility-manager-fixture-b'] = { desired: true };
  const expected = ownProjection(current);
  const result = purgeOwned(current, before, expected);
  assert.deepEqual(result.records, { 'community:foreign': { desired: true }, 'core:backlinks': { desired: true } });
  assert.deepEqual(result.tags, [{ id: 'foreign-tag' }]);
  assert.deepEqual(result.deviceProfiles, [{ id: 'foreign-profile' }]);
  assert.deepEqual(result.fixtureProfiles, [{ id: 'foreign-fixture' }]);
  assert.deepEqual(result.deferred, [{ id: 'foreign' }]);
  assert.deepEqual(result.profileBackups, [{ profileId: 'foreign-profile' }]);
  assert.deepEqual(result.undo, before.undo);
  assert.deepEqual(result.groups, before.groups);
  assert.deepEqual(result.protected, before.protected);
  assert.deepEqual(result.debug, before.debug);
  const changed = structuredClone(current);
  changed.records['community:aigility-manager-fixture-a'].desired = true;
  assert.throws(() => purgeOwned(changed, before, expected), /changed/);
});

test('restoreUndo uses owned compare-and-swap and keeps manual undo edits', () => {
  const before = base();
  const expectedUndo = { marker: 'harness-postimage' };
  const state = structuredClone(before);
  state.undo = structuredClone(expectedUndo);
  // Owned matching postimage => restore
  assert.deepEqual(restoreUndo(state, expectedUndo, before).undo, before.undo);
  // Manual different postimage => preserve
  state.undo = { marker: 'manual edit' };
  assert.deepEqual(restoreUndo(state, expectedUndo, before).undo, state.undo);
});

test('protectionCleanup removes only added non-baseline IDs and preserves all foreign additions and order', () => {
  const beforeBaseline = ['core:backlinks', 'community:foreign-1'];
  const ownAdded = ['community:aigility-manager-fixture-a', 'community:aigility-manager-fixture-b'];
  const current = [
    'core:backlinks',
    'community:foreign-1',
    'community:aigility-manager-fixture-a',
    'community:foreign-new-1',
    'community:aigility-manager-fixture-b',
    'community:foreign-new-2',
  ];

  const cleaned = protectionCleanup(beforeBaseline, ownAdded, current);
  assert.deepEqual(cleaned, [
    'core:backlinks',
    'community:foreign-1',
    'community:foreign-new-1',
    'community:foreign-new-2',
  ]);

  // If an own fixture was already in baseline, it is kept
  const baselineWithA = ['core:backlinks', 'community:aigility-manager-fixture-a'];
  assert.deepEqual(protectionCleanup(baselineWithA, ownAdded, current), [
    'core:backlinks',
    'community:foreign-1',
    'community:aigility-manager-fixture-a',
    'community:foreign-new-1',
    'community:foreign-new-2',
  ]);
});

function createMinimalRuntimeFake() {
  const calls = {
    previewProfile: 0,
    applyProfile: 0,
    undoProfile: 0,
    setEnabled: 0,
    setTags: 0,
    applyFixture: 0,
  };

  const records = {
    'aigility-manager-fixture-a': { desired: false, nativeAutostart: false, loaded: false },
    'aigility-manager-fixture-b': { desired: false, nativeAutostart: false, loaded: false },
  };

  const app = {
    plugins: {
      enabledPlugins: new Set(),
      plugins: {},
    },
  };

  let profileUndo = null;

  const loadPlugin = (id) => {
    app.plugins.plugins[id] = { _loaded: true };
    const k = 'aigility-host-count:' + id;
    globalThis[k] = (globalThis[k] || 0) + 1;
  };

  const unloadPlugin = (id) => {
    delete app.plugins.plugins[id];
  };

  const syncState = (id, on) => {
    records[id].desired = on;
    records[id].nativeAutostart = on;
    records[id].loaded = on;
    if (on) {
      app.plugins.enabledPlugins.add(id);
      loadPlugin(id);
    } else {
      app.plugins.enabledPlugins.delete(id);
      unloadPlugin(id);
    }
  };

  const rt = {
    calls,
    list: () => [
      { ref: { kind: 'community', id: 'aigility-manager-fixture-a' }, ...records['aigility-manager-fixture-a'] },
      { ref: { kind: 'community', id: 'aigility-manager-fixture-b' }, ...records['aigility-manager-fixture-b'] },
    ],
    setEnabled: async (ref, on) => {
      calls.setEnabled++;
      // Note: setEnabled DOES NOT modify profileundo
      syncState(ref.id, on);
    },
    setTags: async (_ref, _tags) => {
      calls.setTags++;
      // Does not change enable state or trigger onload
    },
    previewProfile: async (profileId) => {
      calls.previewProfile++;
      if (profileId === 'aigility-host-test') {
        if (calls.previewProfile === 1) {
          // Preview 1: A is false -> true, B is true -> false
          return [
            { ref: { kind: 'community', id: 'aigility-manager-fixture-a' }, before: false, after: true },
            { ref: { kind: 'community', id: 'aigility-manager-fixture-b' }, before: true, after: false },
          ];
        } else {
          // Preview 2: both are false -> true
          return [
            { ref: { kind: 'community', id: 'aigility-manager-fixture-a' }, before: false, after: true },
            { ref: { kind: 'community', id: 'aigility-manager-fixture-b' }, before: false, after: true },
          ];
        }
      }
      return [];
    },
    applyProfile: async (profileId, preview) => {
      calls.applyProfile++;
      const entries = preview || [];
      const undoEntries = [];
      for (const ch of entries) {
        undoEntries.push({ ref: ch.ref, before: records[ch.ref.id].desired, after: ch.after });
        syncState(ch.ref.id, ch.after);
      }
      profileUndo = undoEntries;
    },
    undoProfile: async () => {
      calls.undoProfile++;
      if (profileUndo) {
        for (const entry of [...profileUndo].reverse()) {
          syncState(entry.ref.id, entry.before);
        }
        profileUndo = null;
      }
    },
    applyFixture: async (fixtureId) => {
      calls.applyFixture++;
      if (fixtureId === 'aigility-host-partial') {
        // partial fixture turns A on, B untouched
        syncState('aigility-manager-fixture-a', true);
      }
    },
  };

  return { rt, app, calls };
}

test('executes buildCasesBody against behavioral minimal runtime fake', async () => {
  const deadline = Date.now() + 10000;
  const body = buildCasesBody({ deadline });
  assert.doesNotMatch(body, /loadManifests|workspace|resume\(/i);

  const fake = createMinimalRuntimeFake();
  const A = 'aigility-manager-fixture-a';
  const B = 'aigility-manager-fixture-b';
  globalThis['aigility-host-count:' + A] = 0;
  globalThis['aigility-host-count:' + B] = 0;

  const fn = new Function('rt', 'app', `return (${body})`)(fake.rt, fake.app);
  const result = await fn();

  assert.equal(typeof result, 'object');
  assert.equal(fake.calls.applyProfile, 2, 'Assert applyProfile called 2');
  assert.equal(fake.calls.previewProfile, 2, 'Assert previewProfile called 2');
  assert.equal(fake.calls.applyFixture, 1, 'Assert applyFixture called 1');
  assert.equal(fake.calls.undoProfile, 2, 'Assert undoProfile called 2');

  // Verify counters
  assert.deepEqual(result.counterDeltas, { a: 3, b: 3 });
});

test('deadline expiry prevents next operation', async () => {
  const fake = createMinimalRuntimeFake();
  let callCount = 0;
  // Delay during setEnabled to trigger deadline expiry
  const origSetEnabled = fake.rt.setEnabled;
  fake.rt.setEnabled = async (ref, on) => {
    callCount++;
    await new Promise((r) => setTimeout(r, 20));
    return origSetEnabled(ref, on);
  };

  const deadline = Date.now() + 10;
  const body = buildCasesBody({ deadline });
  const fn = new Function('rt', 'app', `return (${body})`)(fake.rt, fake.app);

  await assert.rejects(async () => {
    await fn();
  }, /deadline exceeded/);

  // Assert that after deadline exceeded, subsequent native calls were prevented
  assert.equal(fake.calls.applyProfile, 0, 'Subsequent native operation was prevented');
});
