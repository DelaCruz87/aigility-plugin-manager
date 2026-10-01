import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_ID, VAULT, VAULT_PATH, MANAGER_ID, OWN, assertInertResume,
  compileEval, PREAMBLE, STATEVARS,
  evaluateOwnedPostimage, safeLocalRestore,
  fixtureMain, fixtureManifest, cli,
  ADAPTER_MK, ADAPTER_WRITE, ADAPTER_REMOVE, ADAPTER_EXISTS,
} from '../scripts/sandbox-community.mjs';

test('adapter generators return executable code strings and preserve encoded write bytes', async () => {
  const fixture = { id: 'fixture-ñ' }, name = 'main "quoted".js';
  const bytes = 'const x = "línea\\nsegunda";\n';
  const calls = [];
  const app = { vault: { adapter: Object.fromEntries(['mkdir', 'write', 'remove', 'exists'].map(method => [method, async (...args) => { calls.push([method, ...args]); return method === 'exists'; }])) } };
  const snippets = [ADAPTER_MK(fixture), ADAPTER_WRITE(fixture, name, JSON.stringify(bytes)), ADAPTER_REMOVE(fixture, name), ADAPTER_EXISTS(fixture, name)];
  for (const snippet of snippets) assert.equal(typeof snippet, 'string');
  await newFunction('app', ADAPTER_MK(fixture))(app);
  await newFunction('app', ADAPTER_WRITE(fixture, name, JSON.stringify(bytes)))(app);
  await newFunction('app', ADAPTER_REMOVE(fixture, name))(app);
  assert.equal(await newFunction('app', ADAPTER_EXISTS(fixture, name))(app), true);
  assert.deepEqual(calls, [
    ['mkdir', '.obsidian/plugins/fixture-ñ', true],
    ['write', `.obsidian/plugins/fixture-ñ/${name}`, bytes],
    ['remove', `.obsidian/plugins/fixture-ñ/${name}`],
    ['exists', `.obsidian/plugins/fixture-ñ/${name}`],
  ]);
});

function newFunction(appParam, snippet) { return new Function(appParam, `return ${snippet}`); }

test('strict eval preamble and template compilation', () => {
  // Checks that every generated eval includes strict guards
  const fn = compileEval('value = 42;');
  assert.equal(typeof fn, 'function');
  assert.doesNotThrow(() => fn());

  // PREAMBLE contains strict identity assertions
  assert.ok(PREAMBLE.includes(JSON.stringify(VAULT)));
  assert.ok(PREAMBLE.includes(JSON.stringify(VAULT_PATH)));
  assert.ok(PREAMBLE.includes(JSON.stringify(APP_ID)));
  assert.ok(PREAMBLE.includes(JSON.stringify(MANAGER_ID)));
  assert.match(PREAMBLE, /app\.vault\.getName\(\)/);
  assert.match(PREAMBLE, /app\.vault\.adapter\.getBasePath\(\)/);

  // PREAMBLE declares let S = null exactly once, STATEVARS assigns S = null without re-declaring let
  const preambleLetMatches = PREAMBLE.match(/\blet\s+S\b/g);
  assert.equal(preambleLetMatches?.length, 1, 'let S must be declared exactly once in PREAMBLE');
  assert.doesNotMatch(STATEVARS, /\blet\s+S\b/, 'STATEVARS must not re-declare let S');
  assert.match(STATEVARS, /^S\s*=\s*null;/, 'STATEVARS should re-assign S = null');
});

test('fake CLI with no execution compiles and passes code', async () => {
  let capturedCode = null;
  const fakeExec = async (cmd, args) => {
    capturedCode = args.find(a => a.startsWith('code='))?.slice(5);
    return { stdout: '{"ok":true,"value":{"mock":true}}' };
  };

  const res = await cli('value = { ran: true };', { execFn: fakeExec });
  assert.deepEqual(res, { mock: true });
  assert.ok(capturedCode.includes(PREAMBLE));
  assert.ok(capturedCode.includes('value = { ran: true };'));
});

test('fixture templates contain no foreign code and generate valid structures', () => {
  for (const id of OWN) {
    const main = fixtureMain(id);
    const manifestStr = fixtureManifest(id);
    assert.match(main, /require\('obsidian'\)/);
    assert.match(main, /class\s+extends\s+Plugin/);
    const manifest = JSON.parse(manifestStr);
    assert.equal(manifest.id, id);
    assert.equal(manifest.version, '1.0.0');
  }
});

test('evaluateOwnedPostimage detects identical and modified projections', () => {
  const base = {
    records: [['community:aigility-manager-fixture-a', { desired: false, tags: ['tag1'], group: '', version: '1.0.0', name: 'A' }]],
    tags: ['tag1'],
    deviceProfiles: [['aigility-host-test', ['tag1'], false, null]],
    fixtureProfiles: [],
    deferred: [],
    undo: null,
    ownProfileBackups: 0,
  };

  // Identical projections evaluate as ok
  const copy = JSON.parse(JSON.stringify(base));
  const res1 = evaluateOwnedPostimage(base, copy);
  assert.equal(res1.ok, true);
  assert.equal(res1.conflict, false);
  assert.deepEqual(res1.differences, []);

  // Modified records projection detects conflict
  const modRecords = JSON.parse(JSON.stringify(base));
  modRecords.records[0][1].desired = true;
  const res2 = evaluateOwnedPostimage(base, modRecords);
  assert.equal(res2.ok, false);
  assert.equal(res2.conflict, true);
  assert.deepEqual(res2.differences, ['records']);

  // Modified tags projection detects conflict
  const modTags = JSON.parse(JSON.stringify(base));
  modTags.tags = [];
  const res3 = evaluateOwnedPostimage(base, modTags);
  assert.equal(res3.ok, false);
  assert.equal(res3.conflict, true);
  assert.deepEqual(res3.differences, ['tags']);

  // Modified profile backups detects conflict
  const modBackups = JSON.parse(JSON.stringify(base));
  modBackups.ownProfileBackups = 1;
  const res4 = evaluateOwnedPostimage(base, modBackups);
  assert.equal(res4.ok, false);
  assert.equal(res4.conflict, true);
  assert.deepEqual(res4.differences, ['ownProfileBackups']);
});

test('safeLocalRestore preserves external changes and deletes absent fields on restore', () => {
  const baseline = {
    recoveryReason: null,
    appliedProfileId: null,
    deviceProfileId: null,
  };

  const ownedAfter = {
    recoveryReason: 'acceptance-cleanup',
    appliedProfileId: 'aigility-host-test',
    deviceProfileId: null,
  };

  // Case 1: current matches ownedAfter exactly -> restore baseline (null -> delete instructions)
  const currentUnchanged = { ...ownedAfter };
  const res1 = safeLocalRestore(baseline, ownedAfter, currentUnchanged);
  assert.equal(res1.conflicts.length, 0);
  assert.deepEqual(res1.restored, baseline);
  assert.ok(res1.instructions.some(i => i.includes('delete rt.local["recoveryReason"]')));
  assert.ok(res1.instructions.some(i => i.includes('delete rt.local["appliedProfileId"]')));

  // Case 2: external change occurred (e.g. user or external process changed appliedProfileId)
  const currentChanged = {
    recoveryReason: 'acceptance-cleanup',
    appliedProfileId: 'foreign-profile-override',
    deviceProfileId: null,
  };
  const res2 = safeLocalRestore(baseline, ownedAfter, currentChanged);
  assert.equal(res2.conflicts.length, 1);
  assert.match(res2.conflicts[0], /appliedProfileId changed externally/);
  // Preserves current value instead of forcing baseline or ownedAfter
  assert.equal(res2.restored.appliedProfileId, 'foreign-profile-override');
  assert.equal(res2.restored.recoveryReason, null); // recoveryReason matched, so it restores to baseline
});

test('safeLocalRestore sets defined baseline values correctly when baseline had values', () => {
  const baseline = {
    recoveryReason: 'initial-state',
    appliedProfileId: 'default-profile',
    deviceProfileId: 'desk-profile',
  };

  const ownedAfter = {
    recoveryReason: 'test-reason',
    appliedProfileId: 'test-applied',
    deviceProfileId: 'test-profile',
  };

  const current = { ...ownedAfter };
  const res = safeLocalRestore(baseline, ownedAfter, current);
  assert.equal(res.conflicts.length, 0);
  assert.deepEqual(res.restored, baseline);
  assert.ok(res.instructions.some(i => i.includes('rt.local["recoveryReason"] = "initial-state"')));
  assert.ok(res.instructions.some(i => i.includes('rt.local["appliedProfileId"] = "default-profile"')));
  assert.ok(res.instructions.some(i => i.includes('rt.local["deviceProfileId"] = "desk-profile"')));
});

test('cleanup validation rejects changed file hash and extra unknown files', () => {
  const expectedHashes = {
    'aigility-manager-fixture-a/main.js': 'hash_main_a',
    'aigility-manager-fixture-a/manifest.json': 'hash_man_a',
  };

  // 1. Changed file hash detection
  const actualHashesChanged = {
    'aigility-manager-fixture-a/main.js': 'tampered_hash',
    'aigility-manager-fixture-a/manifest.json': 'hash_man_a',
  };

  const hashMatch = Object.entries(expectedHashes).every(
    ([k, h]) => actualHashesChanged[k] === h
  );
  assert.equal(hashMatch, false, 'Expected file hash mismatch to be detected');

  // 2. Extra unknown files detection
  const knownFiles = ['main.js', 'manifest.json'].map(n => `.obsidian/plugins/aigility-manager-fixture-a/${n}`);
  const listDirFilesWithExtra = [
    '.obsidian/plugins/aigility-manager-fixture-a/main.js',
    '.obsidian/plugins/aigility-manager-fixture-a/manifest.json',
    '.obsidian/plugins/aigility-manager-fixture-a/foreign-extra.js',
  ];

  const extraFiles = listDirFilesWithExtra.filter(f => !knownFiles.some(k => f.endsWith(k)));
  assert.equal(extraFiles.length, 1);
  assert.equal(extraFiles[0], '.obsidian/plugins/aigility-manager-fixture-a/foreign-extra.js');
  // Extra files must prevent recursive rmdir
  const shouldRemoveDir = extraFiles.length === 0;
  assert.equal(shouldRemoveDir, false, 'Directory with unknown extra files must not be deleted');
});


test('resume preflight rejects missing workspace clones before any fixture write',()=>{
 for(const workspaces of [{hasD:true,hasT:false,hasM:true},{hasD:true,hasT:true,hasM:false}])assert.throws(()=>assertInertResume({},workspaces),/workspace/i);
});
test('resume preflight preserves installation profile binding and pending operation',()=>{
 const workspaces={hasD:true,hasT:true,hasM:true};
 assert.throws(()=>assertInertResume({deviceProfileId:'macbook'},workspaces),/profile|binding/i);
 assert.throws(()=>assertInertResume({operationPending:'profile:macbook'},workspaces),/pending|operation/i);
});
test('resume preflight accepts existing recovery reason and complete legacy variants',()=>{
 assert.equal(assertInertResume({recoveryReason:'protected-deferred-conflict'},{hasD:true,hasT:true,hasM:true}),true);
 assert.equal(assertInertResume({},{hasD:false,hasT:false,hasM:false}),true);
});
test('owned projection detects metadata changed after fixture setup',()=>{
 const baseline={records:[['community:aigility-manager-fixture-a',{desired:false,metadata:{}}]],tags:[],deviceProfiles:[],fixtureProfiles:[],deferred:[],undo:null,ownProfileBackups:0};
 const after=structuredClone(baseline);after.records[0][1].metadata.external='preserve';
 assert.equal(evaluateOwnedPostimage(baseline,after).ok,false);
});


test('actual cleanup guard accepts matching current local state and rejects a later edit',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../scripts/sandbox-community.mjs',import.meta.url),'utf8');
 const start=source.indexOf('if(JSON.stringify(localOf())!==');
 const end=source.indexOf('\n${localDecision.instructions',start);
 assert(start>=0&&end>start);
 const template=source.slice(start,end);
 const expected={deviceProfileId:null,appliedProfileId:'own',recoveryReason:'own',operationPending:null};
 const expanded=new Function('J','freshBefore','return `'+template+'`;')(JSON.stringify,{local:expected});
 const guard=new Function('localOf',expanded);
 assert.doesNotThrow(()=>guard(()=>({...expected})));
 assert.throws(()=>guard(()=>({...expected,deviceProfileId:'user-choice'})),/preserve external/);
});
