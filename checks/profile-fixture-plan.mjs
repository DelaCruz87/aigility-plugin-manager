export const FIXTURE_IDS = Object.freeze(['aigility-manager-fixture-a', 'aigility-manager-fixture-b']);
const TAG = 'aigility-test-tag';
const PROFILE = 'aigility-host-test';
const PARTIAL = 'aigility-host-partial';
const ownSet = new Set(FIXTURE_IDS.map(id => `community:${id}`));
const clone = value => value === undefined ? undefined : structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function fixtureFiles(id) {
  if (!FIXTURE_IDS.includes(id)) throw new TypeError(`Fixture id is not owned: ${String(id)}`);
  return {
    'manifest.json': `${JSON.stringify({ id, name: `AIgility Acceptance Fixture ${id.endsWith('-a') ? 'A' : 'B'}`, version: '1.0.0', minAppVersion: '1.0.0', description: 'Inert profile acceptance fixture.', author: 'AIgility', isDesktopOnly: false }, null, 2)}\n`,
    'main.js': `const { Plugin } = require('obsidian');\nmodule.exports = class extends Plugin { async onload() { const k = 'aigility-host-count:' + this.manifest.id; globalThis[k] = (globalThis[k] || 0) + 1; } };\n`,
    'data.json': '{}\n',
    'custom.txt': 'AIgility inert acceptance fixture\n',
  };
}

export function ownProjection(state) {
  const records = {};
  for (const key of ownSet) if (state?.records && Object.hasOwn(state.records, key)) records[key] = clone(state.records[key]);
  return {
    records,
    tags: clone((state?.tags ?? []).filter(x => x?.id === TAG)),
    deviceProfiles: clone((state?.deviceProfiles ?? []).filter(x => x?.id === PROFILE)),
    fixtureProfiles: clone((state?.fixtureProfiles ?? []).filter(x => x?.id === PARTIAL)),
    deferred: clone((state?.deferred ?? []).filter(x => FIXTURE_IDS.includes(x?.id))),
    profileBackups: clone((state?.profileBackups ?? []).filter(x => x?.profileId === PROFILE)),
    undo: clone(state?.undo),
  };
}

export function purgeOwned(state, before, expected) {
  if (!same(ownProjection(state), expected)) throw new Error('Owned projection changed; refusing purge.');
  const freshState = clone(state);
  if (freshState.records) for (const key of ownSet) delete freshState.records[key];
  for (const [field, predicate] of [
    ['tags', x => x?.id === TAG],
    ['deviceProfiles', x => x?.id === PROFILE],
    ['fixtureProfiles', x => x?.id === PARTIAL],
    ['deferred', x => FIXTURE_IDS.includes(x?.id)],
    ['profileBackups', x => x?.profileId === PROFILE],
  ]) if (Array.isArray(freshState[field])) freshState[field] = freshState[field].filter(x => !predicate(x));
  if (same(freshState.undo, expected.undo)) freshState.undo = clone(before?.undo);
  return freshState;
}

export function restoreUndo(freshState, expectedUndo, beforeState) {
  const result = clone(freshState);
  if (same(result?.undo, expectedUndo)) result.undo = clone(beforeState?.undo);
  return result;
}

export function protectionCleanup(beforeAddedBaselineArray, ownAddedArray, currentArray) {
  const baselineSet = new Set(beforeAddedBaselineArray ?? []);
  const ownAddedSet = new Set(ownAddedArray ?? []);
  const current = Array.isArray(currentArray) ? currentArray : [];
  return current.filter(id => !ownAddedSet.has(id) || baselineSet.has(id));
}

export function buildCasesBody({ deadline }) {
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)) throw new TypeError('deadline must be a finite epoch millisecond value');
  return `async()=>{\n` +
    `const A='aigility-manager-fixture-a',B='aigility-manager-fixture-b',TAG='aigility-test-tag',PROFILE='aigility-host-test',PARTIAL='aigility-host-partial';\n` +
    `const gate=()=>{if(Date.now()>=${deadline})throw Error('deadline exceeded');};\n` +
    `const run=async(name,fn)=>{gate();try{await fn();}catch(e){throw Error(name+': '+(e?.message||String(e)));}gate();};\n` +
    `const check=(name,ok,detail='assertion failed')=>{if(!ok)throw Error(name+': '+detail);};\n` +
    `const ref=id=>({kind:'community',id}), row=id=>rt.list().find(x=>x.ref.kind==='community'&&x.ref.id===id), native=id=>app.plugins.enabledPlugins.has(id), loaded=id=>app.plugins.plugins[id]?._loaded===true, count=id=>globalThis['aigility-host-count:'+id]??0;\n` +
    `const initial={a:count(A),b:count(B)};\n` +
    `const assertState=(name,id,on)=>{const x=row(id);check(name,x?.desired===on&&x?.nativeAutostart===on&&x?.loaded===on&&native(id)===on&&loaded(id)===on,'desired/native/loaded mismatch '+JSON.stringify(x));};\n` +
    `const changes=p=>p.map(x=>[x.ref.kind,x.ref.id,x.before,x.after]).sort((a,b)=>a[1].localeCompare(b[1]));\n` +
    `await run('enable B before preview',()=>rt.setEnabled(ref(B),true));assertState('enable B before preview',B,true);\n` +
    `let preview;await run('profile preview',async()=>{preview=await rt.previewProfile(PROFILE);check('profile preview',JSON.stringify(changes(preview))===JSON.stringify([['community',A,false,true],['community',B,true,false]].sort((a,b)=>a[1].localeCompare(b[1]))),'unexpected changes '+JSON.stringify(changes(preview)));});\n` +
    `await run('profile apply',()=>rt.applyProfile(PROFILE,preview));\n` +
    `assertState('profile apply A',A,true);assertState('profile apply B',B,false);check('profile apply counter',count(A)-initial.a===1&&count(B)-initial.b===1,'unexpected fixture load deltas');\n` +
    `await run('profile undo',()=>rt.undoProfile());assertState('profile undo A',A,false);assertState('profile undo B',B,true);\n` +
    `await run('disable B',()=>rt.setEnabled(ref(B),false));assertState('disable B',B,false);\n` +
    `await run('edit B tags',()=>rt.setTags(ref(B),[TAG]));assertState('edit B tags',B,false);check('edit B tags counter unchanged',count(B)-initial.b===2,'B counter changed during setTags');\n` +
    `let previewBoth;await run('preview both fixtures',async()=>{previewBoth=await rt.previewProfile(PROFILE);});\n` +
    `await run('apply both fixtures',()=>rt.applyProfile(PROFILE,previewBoth));\n` +
    `assertState('fixture apply A',A,true);assertState('fixture apply B',B,true);check('fixture apply counters',count(A)-initial.a===2&&count(B)-initial.b===3,'unexpected fixture load deltas');\n` +
    `await run('fixture undo',()=>rt.undoProfile());assertState('fixture undo A',A,false);assertState('fixture undo B',B,false);\n` +
    `await run('apply partial fixture',()=>rt.applyFixture(PARTIAL));assertState('partial fixture A',A,true);assertState('partial fixture B',B,false);check('partial fixture counters',count(A)-initial.a===3&&count(B)-initial.b===3,'unexpected fixture load deltas');\n` +
    `await run('final disable A',()=>rt.setEnabled(ref(A),false));assertState('final disable A',A,false);\n` +
    `return {cases:['enable B before preview','profile preview','profile apply','profile undo','disable B','edit B tags','preview both fixtures','apply both fixtures','fixture undo','apply partial fixture','final disable A'],counterDeltas:{a:count(A)-initial.a,b:count(B)-initial.b}};\n` +
    `}`;
}
