import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importModule } from '../test.config.mjs';

const { ManagerRuntime, collectObserved } = await importModule('src/integrated/runtime.ts');
// Reuse the existing host fixtures; assertions exercise the real bundled runtime.
const fixtureSource = await readFile(new URL('../tests/runtime.test.mjs', import.meta.url), 'utf8');
const fixtures = fixtureSource.slice(fixtureSource.indexOf('class MemoryStorage'), fixtureSource.indexOf("test('collectObserved"));
const { makeState, communityHost, addCommunity, makeHarness } = new Function('ManagerRuntime', 'collectObserved', fixtures + '\nreturn { makeState, communityHost, addCommunity, makeHarness };')(ManagerRuntime, collectObserved);
const ref = { kind: 'community', id: 'manual-fixture' };
const failures = [];
async function verify(name, run) {
  try { await run(); console.log('PASS: ' + name); }
  catch (error) { failures.push(name); console.error('FAIL: ' + name + ': ' + error.message); }
}

await verify('manual ON/OFF works during ordinary pause without resuming automation or touching another plugin', async () => {
  const community = communityHost(ref.id);
  addCommunity(community, 'foreign-fixture', { enabled: true });
  const h = makeHarness({ community });
  h.runtime.pause('Late load: automatic startup skipped.');
  await h.runtime.setEnabled(ref, true);
  assert.equal(community.instance._loaded, true);
  assert.equal(community.enabledIds.has(ref.id), true);
  assert.equal(h.runtime.list().find(p => p.ref.id === ref.id).desired, true);
  assert.equal(h.runtime.local.recoveryReason, 'Late load: automatic startup skipped.');
  assert.equal(h.runtime.isAutomationPaused(), true);
  await h.runtime.setEnabled(ref, false);
  assert.equal(community.instance._loaded, false);
  assert.equal(community.enabledIds.has(ref.id), false);
  assert.equal(h.runtime.list().find(p => p.ref.id === ref.id).desired, false);
  assert.equal(community.enabledIds.has('foreign-fixture'), true);
  assert.equal(community.apiCalls.some(call => call[1] === 'foreign-fixture'), false);
  assert.equal(h.app.__aigilityClock.jobs.size, 0);
  h.runtime.dispose();
});

await verify('manual deferred ON/OFF preserves policy and excludes native autostart', async () => {
  const community = communityHost(ref.id);
  community.api.disablePlugin = async id => { community.apiCalls.push(['disablePlugin', id]); community.manifests.get(id).instance._loaded = false; };
  const policy = { id: ref.id, enabled: true, delayMs: 5000 };
  const h = makeHarness({ community, state: makeState({ deferred: [policy] }) });
  h.runtime.pause('Late load: automatic startup skipped.');
  await h.runtime.setEnabled(ref, true);
  assert.equal(community.instance._loaded, true);
  assert.equal(community.enabledIds.has(ref.id), false);
  assert.deepEqual(h.runtime.state.deferred, [policy]);
  await h.runtime.setEnabled(ref, false);
  assert.equal(community.instance._loaded, false);
  assert.equal(community.enabledIds.has(ref.id), false);
  assert.deepEqual(h.runtime.state.deferred, [policy]);
  assert.equal(h.app.__aigilityClock.jobs.size, 0);
  h.runtime.dispose();
});

for (const gate of ['pending', 'debug', 'diagnostic-pause', 'restricted', 'protected', 'incompatible', 'transaction']) {
  await verify('manual relaxation preserves ' + gate + ' guard', async () => {
    const community = communityHost(ref.id, gate === 'protected');
    const state = makeState(gate === 'protected' ? { protected: ['community:' + ref.id] } : gate === 'debug' ? { debug: { active: true } } : {});
    const h = makeHarness({ community, state, restricted: gate === 'restricted' });
    h.runtime.pause(gate === 'diagnostic-pause' ? 'Debug session is active.' : 'Late load: automatic startup skipped.');
    if (gate === 'pending') h.runtime.local.operationPending = 'profile:interrupted';
    if (gate === 'incompatible') community.manifest.minAppVersion = '999.0.0';
    const action = gate === 'transaction' ? h.runtime.enqueue('bulk-transaction', tx => tx.setEnabled(ref, true)) : h.runtime.setEnabled(ref, gate !== 'protected');
    await assert.rejects(action);
    assert.equal(community.apiCalls.length, 0);
    h.runtime.dispose();
  });
}
if (failures.length) throw new Error(failures.length + ' behavior checks failed: ' + failures.join(', '));
