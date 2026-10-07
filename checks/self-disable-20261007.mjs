import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importModule } from '../test.config.mjs';

const { ManagerRuntime, collectObserved } = await importModule('src/integrated/runtime.ts');
const fixtureSource = await readFile(new URL('../tests/runtime.test.mjs', import.meta.url), 'utf8');
const fixtures = fixtureSource.slice(fixtureSource.indexOf('class MemoryStorage'), fixtureSource.indexOf("test('collectObserved"));
const { communityHost, addCommunity, makeHarness } = new Function('ManagerRuntime', 'collectObserved', fixtures + '\nreturn { communityHost, addCommunity, makeHarness };')(ManagerRuntime, collectObserved);
const ref = { kind: 'community', id: 'aigility-plugin-manager' };
for (const paused of [false, true]) {
  const community = communityHost(ref.id, true);
  addCommunity(community, 'foreign-fixture', { enabled: true });
  const h = makeHarness({ community });
  if (paused) h.runtime.pause('Late load: automatic startup skipped.');
  const beforeState = [...h.files.entries()];
  const beforeLocal = globalThis.localStorage.getItem(h.runtime.localKey);
  let unloaded = false;
  let writesAfterUnload = 0;
  const realWrite = h.adapter.write;
  h.adapter.write = async (...args) => { if (unloaded) writesAfterUnload++; return realWrite(...args); };
  const realLocalWrite = globalThis.localStorage.setItem.bind(globalThis.localStorage);
  globalThis.localStorage.setItem = (...args) => { if (unloaded) writesAfterUnload++; return realLocalWrite(...args); };
  const disable = community.api.disablePluginAndSave;
  community.api.disablePluginAndSave = async id => {
    assert.equal(id, ref.id, 'self-disable targets only Manager');
    await disable(id);
    unloaded = true;
    h.runtime.dispose();
  };
  try {
    await h.runtime.setEnabled(ref, false);
    assert.equal(unloaded, true, 'explicit manual self-disable reaches native host');
    assert.equal(community.instance._loaded, false);
    assert.equal(community.enabledIds.has(ref.id), false);
    assert.equal(community.enabledIds.has('foreign-fixture'), true);
    assert.equal(writesAfterUnload, 0, 'no State/Local writes after synchronous disposal');
    assert.deepEqual([...h.files.entries()], beforeState, 'self handoff is not a Manager State write');
    assert.equal(globalThis.localStorage.getItem(h.runtime.localKey), beforeLocal, 'self handoff creates no pending operation');
    await assert.rejects(h.runtime.setEnabled(ref, true), /disposed/i);
    const reloaded = makeHarness({ community });
    await community.api.enablePluginAndSave(ref.id);
    assert.equal(reloaded.runtime.list().find(p => p.ref.id === ref.id).loaded, true, 'native re-enable can load a fresh manager');
    await assert.rejects(reloaded.runtime.enqueue('bulk-off', tx => tx.setEnabled(ref, false)), /protected/i);
    reloaded.runtime.dispose();
    console.log('PASS: self-disable lifecycle handoff, native re-enable, and bulk protection; paused=' + paused);
  } finally { globalThis.localStorage.setItem = realLocalWrite; h.runtime.dispose(); }
}
