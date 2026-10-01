#!/usr/bin/env node
/**
 * Real Obsidian host acceptance harness for the integrated manager, Sandbox vault.
 * Historical note: Initial harness attempt established strict Sandbox vault identity guards,
 * bounded eval wrappers, and three isolated fixture namespaces (aigility-manager-fixture-a/-b/-slow).
 *
 * Scope: three own fixture namespaces (aigility-manager-fixture-a/-b/-slow) and
 * nothing else. Every foreign community/core plugin is protected and must stay
 * byte-identical in native autostart and loaded state. Manager-owned files are
 * never rewritten by this script: state changes go through the live runtime
 * transaction API, and the only direct writes are the three own plugin
 * directories through the Obsidian vault adapter.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OBSIDIAN = '/opt/homebrew/bin/obsidian';
export const VAULT = 'Sandbox';
export const VAULT_PATH = '/Users/eme/Obsidian/Sandbox';
export const APP_ID = 'd137282e82167d84';
export const MANAGER_ID = 'aigility-plugin-manager';
export const EVIDENCE = path.join(ROOT, 'evidence/sandbox-community.json');

export const A = 'aigility-manager-fixture-a';
export const B = 'aigility-manager-fixture-b';
export const SLOW = 'aigility-manager-fixture-slow';
export const OWN = [A, B, SLOW];
export const TAG = 'aigility-test-tag';
export const PROFILE = 'aigility-host-test';
export const PARTIAL = 'aigility-host-partial';
export const GROUP = 'obsidian-community';
const PAUSE_SETTLE = 200;
const DEFERRED_SETTLE = 300;
const TIMEOUT = 15000;

export const J = JSON.stringify;
export const hash = b => createHash('sha256').update(b).digest('hex');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function assert(ok, msg) { if (!ok) throw new Error(msg); }

export function assertInertResume(local, ws) {
  if (local?.deviceProfileId) throw new Error(`Resume would use a device profile binding: ${local.deviceProfileId}`);
  if (local?.operationPending) throw new Error(`Resume would encounter a pending operation: ${local.operationPending}`);
  if (ws?.hasD && (!ws?.hasT || !ws?.hasM)) throw new Error('Workspace restore state is incomplete; refusing resume');
  return true;
}

/** Canonical projection of ONLY the entities this harness owns. */
export const PROJECT = `const ownProj=(s)=>({records:${J(OWN)}.map(id=>{const k='community:'+id;const r=s?.records?.[k];return r?[k,{desired:r.desired,tags:[...r.tags].sort(),group:r.group||'',version:r.version??null,name:r.name||null,metadata:r.metadata??{}}]:null;}),tags:(s?.tags||[]).filter(t=>t.id===${J(TAG)}).map(t=>t.id),deviceProfiles:(s?.deviceProfiles||[]).filter(x=>x.id===${J(PROFILE)}).map(x=>[x.id,x.tagIds,x.applyAtStart,x.workspaceId===undefined?null:x.workspaceId]),fixtureProfiles:(s?.fixtureProfiles||[]).filter(x=>x.id===${J(PARTIAL)}).map(x=>[x.id,x.members]),deferred:(s?.deferred||[]).filter(d=>d.id===${J(SLOW)}).map(d=>[d.id,d.enabled,d.delayMs,d.parked===true]),undo:s?.undo===undefined?null:s.undo,ownProfileBackups:(s?.profileBackups||[]).filter(b=>b&&b.profileId===${J(PROFILE)}).length});`;

/** Strict prefix on EVERY eval: right vault, right base path, right app, manager loaded. */
export const PREAMBLE = `try{
const __n=app.vault.getName(),__b=app.vault.adapter.getBasePath(),__a=app.appId;
if(__n!==${J(VAULT)})throw Error('Eval refused: active vault is '+__n);
if(__b!==${J(VAULT_PATH)})throw Error('Eval refused: base path is '+__b);
if(__a!==${J(APP_ID)})throw Error('Eval refused: appId is '+__a);
const P=app.plugins&&app.plugins.plugins&&app.plugins.plugins[${J(MANAGER_ID)}];
if(!P||P._loaded!==true)throw Error('Eval refused: manager ${MANAGER_ID} is not loaded');
const rt=P.runtime;
if(!rt||typeof rt.enqueue!=='function')throw Error('Eval refused: manager runtime is unavailable');
if(typeof globalThis!=='object')throw Error('Eval refused: globalThis is unavailable');
const OWNJ=${J(OWN)},REF=(id)=>({kind:'community',id}),K=(id)=>'community:'+id;
let S=null;
${PROJECT}
const row=(id)=>({id,version:app.plugins.manifests?.[id]?.version??null,native:app.plugins.enabledPlugins?.has(id)===true,loaded:app.plugins.plugins?.[id]?._loaded===true});
const ownRows=()=>OWNJ.map(row);
const foreignCommunity=()=>Object.entries(app.plugins.manifests||{}).filter(([id])=>!OWNJ.includes(id)).map(([id,m])=>({id,version:m.version??null,native:app.plugins.enabledPlugins?.has(id)===true,loaded:app.plugins.plugins?.[id]?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
const coreRows=()=>Object.entries(app.internalPlugins?.plugins||{}).map(([id,w])=>({id,enabled:w.enabled===true,loaded:w.instance?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
const counter=(id)=>globalThis['aigility-host-count:'+id]??0;
const bug=(id)=>globalThis['aigility-host-bug:'+id]===true;
const counters=()=>Object.fromEntries(OWNJ.map(id=>[id,counter(id)]));
const faults=()=>({a:bug(${J(A)}),b:bug(${J(B)})});
const restricted=()=>typeof rt.host?.isRestricted==='function'?rt.host.isRestricted():null;
const localOf=()=>({deviceProfileId:rt.local?.deviceProfileId??null,recoveryReason:rt.local?.recoveryReason??null,appliedProfileId:rt.local?.appliedProfileId??null,operationPending:rt.local?.operationPending??null});
`;

/** Injected into every eval that persists or reads manager state. */
export const STATEVARS = `S=null;await rt.enqueue('acceptance-read',async(tx)=>{S=await tx.refresh();});if(!S)throw Error('State refresh produced no state');`;

export const compileEval = (body) => {
  const code = `(async()=>{let value;${PREAMBLE}${body}\nreturn JSON.stringify({ok:true,value});}catch(error){return JSON.stringify({ok:false,error:String(error?.message||error)});}})()`;
  return new Function('return ' + code);
};

export const parseCliJson = output => {
  const text = String(output).trim();
  if (!text) throw new Error('Obsidian CLI returned no eval response; Sandbox must be open and responsive.');
  const i = text.indexOf('=> ');
  try { return JSON.parse((i < 0 ? text : text.slice(i + 3)).trim()); }
  catch { throw new Error(`Obsidian eval returned malformed JSON: ${text.slice(0, 1000)}`); }
};

export async function cli(body, { execFn = execFileAsync } = {}) {
  compileEval(body);
  const code = `(async()=>{let value;${PREAMBLE}${body}\nreturn JSON.stringify({ok:true,value});}catch(error){return JSON.stringify({ok:false,error:String(error?.message||error)});}})()`;
  let stdout;
  try {
    ({ stdout } = await execFn(OBSIDIAN, [`vault=${VAULT}`, 'eval', `code=${code}`], { timeout: TIMEOUT, maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    throw new Error(`Obsidian CLI eval failed (${TIMEOUT}ms cap): ${String(error.stderr || error.message).slice(0, 500)}`);
  }
  const out = parseCliJson(stdout);
  if (!out?.ok) throw new Error(`Sandbox eval rejected: ${String(out?.error).slice(0, 800)}`);
  return out.value;
}

export const fixtureMain = id => `const { Plugin } = require('obsidian');
module.exports = class extends Plugin {
  async onload() {
    const k = 'aigility-host-count:' + this.manifest.id;
    globalThis[k] = (globalThis[k] || 0) + 1;
    globalThis['aigility-host-bug:' + this.manifest.id] = true;
  }
  onunload() {
    globalThis['aigility-host-bug:' + this.manifest.id] = false;
  }
};
// fixture: ${id}
`;

export const fixtureManifest = id => `${JSON.stringify({
  id,
  name: `AIgility Acceptance Fixture ${id.slice(-1).toUpperCase()}`,
  version: '1.0.0',
  minAppVersion: '1.0.0',
  description: 'Acceptance fixture owned by scripts/sandbox-community.mjs.',
  author: 'AIgility',
  isDesktopOnly: false,
}, null, 2)}\n`;

export const ADAPTER_MK = v => `app.vault.adapter.mkdir(${JSON.stringify(`.obsidian/plugins/${v.id}`)},true)`;
export const ADAPTER_WRITE = (v, name, text) => `app.vault.adapter.write(${JSON.stringify(`.obsidian/plugins/${v.id}/${name}`)},${text})`;
export const ADAPTER_REMOVE = (v, name) => `app.vault.adapter.remove(${JSON.stringify(`.obsidian/plugins/${v.id}/${name}`)})`;
export const ADAPTER_EXISTS = (v, name) => `app.vault.adapter.exists(${JSON.stringify(`.obsidian/plugins/${v.id}/${name}`)})`;
export const nodeHash = async f => { try { return hash(await readFile(f)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

/**
 * Pure evaluation helper comparing expected owned projection vs current projection.
 * Returns { ok: boolean, conflict: boolean, differences: string[] }.
 */
export function evaluateOwnedPostimage(expected, current) {
  if (!expected && !current) return { ok: true, conflict: false, differences: [] };
  if (!expected || !current) return { ok: false, conflict: true, differences: ['One projection is null/missing'] };
  const diffs = [];
  if (!same(expected.records, current.records)) diffs.push('records');
  if (!same(expected.tags, current.tags)) diffs.push('tags');
  if (!same(expected.deviceProfiles, current.deviceProfiles)) diffs.push('deviceProfiles');
  if (!same(expected.fixtureProfiles, current.fixtureProfiles)) diffs.push('fixtureProfiles');
  if (!same(expected.deferred, current.deferred)) diffs.push('deferred');
  if (!same(expected.undo, current.undo)) diffs.push('undo');
  if (expected.ownProfileBackups !== current.ownProfileBackups) diffs.push('ownProfileBackups');
  return { ok: diffs.length === 0, conflict: diffs.length > 0, differences: diffs };
}

/** Update only the verified deferred plugin's undo entry in an expected projection. */
export function ownSlowUndoExpected(expected, verified, id, generation) {
  if (!expected?.undo || !Array.isArray(expected.undo.entries) || !verified?.undo || !Array.isArray(verified.undo.entries)) {
    return { expected: null, error: 'Undo projection or entries are unavailable' };
  }
  const verifiedEntry = verified.undo.entries.find(entry => entry?.ref?.kind === 'community' && entry.ref.id === id && entry.generation === generation);
  if (!verifiedEntry || typeof verifiedEntry.expectedPostimage !== 'boolean') {
    return { expected: null, error: `Verified undo entry missing for community:${id} at generation ${generation}` };
  }
  const next = structuredClone(expected);
  const index = next.undo.entries.findIndex(entry => entry?.ref?.kind === 'community' && entry.ref.id === id);
  if (index < 0) return { expected: null, error: `Expected undo entry missing for community:${id}` };
  next.undo.entries[index] = { ...next.undo.entries[index], generation: verifiedEntry.generation, expectedPostimage: verifiedEntry.expectedPostimage };
  return { expected: next, error: null };
}

/**
 * Pure local restore decision helper.
 * Compares current local state against own postimage after own actions.
 * Only fields matching ownedAfter are restored to baseline; absent fields in baseline are deleted.
 * Returns { restored: Record<string, any>, conflicts: string[], instructions: string[] }.
 */
export function safeLocalRestore(before, ownedAfter, current) {
  const result = { restored: {}, conflicts: [], instructions: [] };
  const fields = ['recoveryReason', 'appliedProfileId', 'deviceProfileId'];
  for (const field of fields) {
    const curVal = current?.[field] ?? null;
    const expVal = ownedAfter?.[field] ?? null;
    const baseVal = before?.[field] ?? null;

    if (curVal !== expVal) {
      result.conflicts.push(`Field ${field} changed externally (expected ${expVal}, got ${curVal}); preserving current value`);
      result.restored[field] = curVal;
    } else {
      result.restored[field] = baseVal;
      if (baseVal === null || baseVal === undefined) {
        result.instructions.push(`delete rt.local[${J(field)}];`);
      } else {
        result.instructions.push(`rt.local[${J(field)}] = ${J(baseVal)};`);
      }
    }
  }
  return result;
}

export async function run() {
  assert(process.env.AIGILITY_SANDBOX_RUN_AUTHORIZED === '1', 'Set AIGILITY_SANDBOX_RUN_AUTHORIZED=1 to execute this harness against the live Sandbox host.');
  const cases = [];
  const push = (name, passed, actual) => { cases.push({ name, passed: passed === true, actual }); if (passed !== true) throw new Error(`Case failed: ${name} :: ${JSON.stringify(actual).slice(0, 400)}`); };
  let cleanup = { attempted: false, completed: false, foreignPreserved: null, ownNamespacesAbsent: null, localRestored: false, conflicts: [] };
  let foreignBefore = null, foreignAfter = null, receipts = [], baseline = null, ownPostimage = null, foreignBaselineHash = null, deferredRan = false;
  let ownWritesStarted = false, ownLastLocal = null, fixtureLoads = {};
  let expectedFixtureHashes = {};

  const persist = async () => await (await import('node:fs/promises')).writeFile(EVIDENCE, JSON.stringify({
    schemaVersion: 1, harness: 'sandbox-community', status: 'running', vault: VAULT, appId: APP_ID,
    capturedAt: new Date().toISOString(), cases, foreignBefore, foreignAfter, receipts, cleanup,
    baseline, ownPostimage, deferredRan,
  }, null, 2) + '\n', { flag: 'w' });

  try {
    // ---------- baseline ----------
    const base = await cli(`${STATEVARS}
const ns=await Promise.all(OWNJ.map(async id=>({id,exists:await app.vault.adapter.exists('.obsidian/plugins/'+id),files:{main:await app.vault.adapter.exists('.obsidian/plugins/'+id+'/main.js'),manifest:await app.vault.adapter.exists('.obsidian/plugins/'+id+'/manifest.json')}})));
value={ns,ownRecords:OWNJ.map(id=>S.records[K(id)]??null),ownTag:S.tags.some(t=>t.id===${J(TAG)}),ownProfile:S.deviceProfiles.some(x=>x.id===${J(PROFILE)}),ownPartial:S.fixtureProfiles.some(x=>x.id===${J(PARTIAL)}),ownDeferred:S.deferred.filter(d=>d.id===${J(SLOW)}),ownSourceKeys:Object.keys(S.githubSources||{}).filter(k=>${J(OWN)}.some(id=>k.includes(id))),local:localOf(),proj:ownProj(S),undo:S.undo===undefined?null:JSON.stringify(S.undo),protected:S.protected||[],protectedCount:(S.protected||[]).length,groupExists:S.groups.some(g=>g.id===${J(GROUP)}),deferredCount:(S.deferred||[]).length,profileBackupCount:(S.profileBackups||[]).length,stagger:S.settings?.staggerMs??null,foreignCommunity:foreignCommunity(),core:coreRows(),counters:counters(),faults:faults(),restricted:restricted(),workspaces:(()=>{const i=app.internalPlugins?.getPluginById?.('workspaces')?.instance;const w=i?.workspaces;const has=(x)=>w instanceof Map?w.has(x):Object.prototype.hasOwnProperty.call(w||{},x);return {hasD:has('d'),hasT:has('t'),hasM:has('m'),active:i?.activeWorkspace??null};})()};`);
    baseline = { local: base.local, undo: base.undo, protectedCount: base.protectedCount, deferredCount: base.deferredCount, profileBackupCount: base.profileBackupCount, groupExists: base.groupExists, staggerMs: base.stagger, workspaces: base.workspaces };
    ownPostimage = base.proj;
    ownLastLocal = base.local;
    foreignBefore = { community: base.foreignCommunity, core: base.core };
    foreignBaselineHash = { community: hash(J(base.foreignCommunity)), core: hash(J(base.core)) };

    const rawManager = await Promise.all([
      nodeHash(path.join(VAULT_PATH, `.obsidian/plugins/${MANAGER_ID}/data.json`)),
      nodeHash(path.join(VAULT_PATH, '.obsidian/community-plugins.json')),
      nodeHash(path.join(VAULT_PATH, '.obsidian/core-plugins.json')),
    ]);
    baseline.rawManagerHashes = { 'data.json': rawManager[0], 'community-plugins.json': rawManager[1], 'core-plugins.json': rawManager[2] };

    push('baseline-identity', base.ns.length === OWN.length && base.foreignCommunity.length > 0 && base.core.length > 0, { vault: VAULT, foreignCommunityCount: base.foreignCommunity.length, coreCount: base.core.length });
    push('baseline-fixtures-absent', base.ns.every(x => !x.exists && !x.files.main && !x.files.manifest), { namespaces: base.ns });
    push('baseline-records-absent', base.ownRecords.every(r => r === null) && !base.ownTag && !base.ownProfile && !base.ownPartial && base.ownDeferred.length === 0 && base.ownSourceKeys.length === 0, { records: base.ownRecords, tag: base.ownTag, profile: base.ownProfile, partial: base.ownPartial, deferred: base.ownDeferred, sourceKeys: base.ownSourceKeys });
    push('baseline-group-available', base.groupExists === true, { group: GROUP, exists: base.groupExists });
    assertInertResume(base.local, base.workspaces);
    push('baseline-workspaces-inert', true, { workspaces: base.workspaces });
    push('baseline-host-not-restricted', base.restricted === false, { restricted: base.restricted });

    const isProtected = (kind, id) => base.protected.includes(`${kind}:${id}`) || base.protected.includes(id) || (kind === 'community' && id === MANAGER_ID);
    const missingProtections = [
      ...base.foreignCommunity.filter(row => !isProtected('community', row.id)).map(row => `community:${row.id}`),
      ...base.core.filter(row => !isProtected('core', row.id)).map(row => `core:${row.id}`),
    ];
    push('foreign-protection-preflight', missingProtections.length === 0, { missing: missingProtections });

    // ---------- create own fixtures ----------
    ownWritesStarted = true;
    const created = [];
    for (const id of OWN) {
      const files = [['main.js', fixtureMain(id)], ['manifest.json', fixtureManifest(id)]];
      const expected = Object.fromEntries(files.map(([n, t]) => [`${id}/${n}`, hash(t)]));
      Object.assign(expectedFixtureHashes, expected);
      const receipt = { id, action: 'create-fixture-namespace', startedAt: new Date().toISOString(), files: expected, beforeHashes: {}, afterHashes: {} };
      for (const [n] of files) receipt.beforeHashes[`${id}/${n}`] = await nodeHash(path.join(VAULT_PATH, `.obsidian/plugins/${id}/${n}`));
      receipts.push(receipt);
      await persist();
      await cli(`await ${ADAPTER_MK({ id })};await ${ADAPTER_WRITE({ id }, 'main.js', J(fixtureMain(id)))};await ${ADAPTER_WRITE({ id }, 'manifest.json', J(fixtureManifest(id)))};value=ownRows();`);
      for (const [n] of files) receipt.afterHashes[`${id}/${n}`] = await nodeHash(path.join(VAULT_PATH, `.obsidian/plugins/${id}/${n}`));
      assert(Object.entries(expected).every(([k, h]) => receipt.afterHashes[k] === h), `Fixture write readback hash mismatch for ${id}`);
      created.push({ id, files });
      await persist();
    }
    const manifestLoad = await cli(`await app.plugins.loadManifests();value={rows:ownRows(),manifestIds:Object.keys(app.plugins.manifests||{}).filter(i=>OWNJ.includes(i)).sort(),foreignCount:Object.keys(app.plugins.manifests||{}).filter(i=>!OWNJ.includes(i)).length};`);
    push('fixtures-created', manifestLoad.manifestIds.length === OWN.length && manifestLoad.rows.every(r => r.version === '1.0.0' && r.native === false && r.loaded === false), { rows: manifestLoad.rows });
    push('fixtures-foreign-count-stable', manifestLoad.foreignCount === base.foreignCommunity.length, { foreignCount: manifestLoad.foreignCount, expected: base.foreignCommunity.length });

    // ---------- protection audit ----------
    const audit = await cli(`${STATEVARS}
const all=[...Object.entries(app.plugins.manifests||{}).map(([id])=>['community',id]),...Object.keys(app.internalPlugins?.plugins||{}).map(id=>['core',id])];
const isProt=([k,id])=>{const key=k+':'+id;return (S.protected||[]).includes(key)||(S.protected||[]).includes(id)||key==='community:'+${J(MANAGER_ID)};};
value={unprotected:all.filter(x=>!OWNJ.includes(x[1])&&!isProt(x)).map(x=>x.join(':')),ownProtected:OWNJ.filter(id=>isProt(['community',id]))};`);
    push('foreign-protection-audit', audit.unprotected.length === 0 && audit.ownProtected.length === 0, { unprotectedInstalled: audit.unprotected, ownProtected: audit.ownProtected });

    // ---------- setup records/tag/profile/partial fixture ----------
    const setup = await cli(`let proj=null;await rt.enqueue('acceptance-setup',async(tx)=>{
S=await tx.refresh();
for(const id of [${J(A)},${J(B)},${J(SLOW)}]){
  const key='community:'+id,item=rt.list().find(x=>x.ref.kind==='community'&&x.ref.id===id);
  if(!item||!item.installed)throw Error('Fixture '+id+' is not installed');
  if(S.records[key])throw Error('Fixture record already exists for '+key);
  S.records[key]={ref:{kind:'community',id},name:item.name,version:item.version,tags:[${J(TAG)}],group:'',desired:false,metadata:{}};
}
S.tags=S.tags.filter(t=>t.id!==${J(TAG)});
S.tags.push({id:${J(TAG)},name:'AIgility Host Test Tag',color:'#4a90d9'});
if(S.deviceProfiles.some(x=>x.id===${J(PROFILE)}))throw Error('Own profile already exists');
S.deviceProfiles.push({id:${J(PROFILE)},name:'AIgility Host Test Profile',tagIds:[${J(TAG)}],applyAtStart:false});
S.fixtureProfiles=S.fixtureProfiles.filter(x=>x.id!==${J(PARTIAL)});
S.fixtureProfiles.push({id:${J(PARTIAL)},name:'AIgility Host Partial Fixture',members:{'community:${A}':false}});
S.deferred=S.deferred.filter(d=>d.id!==${J(SLOW)});
delete S.undo;
await tx.save();
proj=ownProj(rt.state);
});
value={proj,records:OWNJ.map(id=>rt.state.records[K(id)]),protectedKept:(rt.state.protected||[]).length};`);
    ownPostimage = setup.proj;
    push('setup-records', setup.records.every(r => r && r.desired === false && r.metadata && r.metadata.constructor === Object), { records: setup.records.map(r => r && ({ key: K(r.ref.id), desired: r.desired, tags: r.tags, group: r.group })) });
    push('setup-tag-and-profile', setup.proj.tags.length === 1 && setup.proj.deviceProfiles.length === 1 && setup.proj.deviceProfiles[0][2] === false && setup.proj.deviceProfiles[0][3] === null, { tag: setup.proj.tags, profile: setup.proj.deviceProfiles });
    push('setup-partial-fixture', setup.proj.fixtureProfiles.length === 1 && setup.proj.fixtureProfiles[0][1]['community:' + A] === false, { fixture: setup.proj.fixtureProfiles });
    push('setup-protection-untouched', setup.protectedKept === base.protectedCount, { protectedBefore: base.protectedCount, protectedAfter: setup.protectedKept });
    push('setup-loaded-none', (await cli('value=ownRows();')).every(r => r.loaded === false && r.native === false), { rows: await cli('value=ownRows();') });

    // ---------- explicit own tag assignment ----------
    const tags = await cli(`await rt.setTags(REF(${J(A)}),[${J(TAG)}]);await rt.setTags(REF(${J(SLOW)}),[${J(TAG)}]);await rt.setTags(REF(${J(B)}),[]);let proj=null;await rt.enqueue('acceptance-read',async(tx)=>{S=await tx.refresh();proj=ownProj(S);});value={proj,rows:ownRows(),counters:counters()};`);
    ownPostimage = tags.proj;
    push('own-tag-membership', tags.proj.records[0][1].tags.join() === TAG && tags.proj.records[1][1].tags.length === 0 && tags.proj.records[2][1].tags.join() === TAG, { a: tags.proj.records[0][1].tags, b: tags.proj.records[1][1].tags, slow: tags.proj.records[2][1].tags });

    // ---------- resume so the manual phase can mutate ----------
    const resumed = await cli(`await rt.resume();value={local:localOf(),rows:ownRows(),counters:counters(),proj:ownProj(rt.state)};`);
    ownPostimage = resumed.proj;
    ownLastLocal = resumed.local;
    push('resume-for-manual-phase', resumed.local.recoveryReason === null && resumed.rows.every(r => !r.loaded && !r.native), { local: resumed.local, rows: resumed.rows });

    // ---------- enable b first, then preview ----------
    const bOn = await cli(`await rt.setEnabled(REF(${J(B)}),true);value={rows:ownRows(),counters:counters(),faults:faults(),proj:ownProj(rt.state)};`); ownPostimage = bOn.proj;
    push('b-enabled-first', bOn.rows.find(r => r.id === B).loaded === true && bOn.rows.find(r => r.id === B).native === true, { b: bOn.rows.find(r => r.id === B), counters: bOn.counters });
    const preview = await cli(`const ch=await rt.previewProfile(${J(PROFILE)});value={changes:ch.map(c=>({id:c.ref.id,kind:c.ref.kind,before:c.before,after:c.after,reason:c.reason})),foreign:ch.filter(c=>!OWNJ.includes(c.ref.id)).map(c=>c.ref.kind+':'+c.ref.id)};`);
    const pv = Object.fromEntries(preview.changes.filter(c => OWN.includes(c.id)).map(c => [c.id, `${c.before}->${c.after}`]));
    push('preview-own-changes-only', preview.foreign.length === 0, { changes: preview.changes, foreignChanges: preview.foreign });
    push('preview-a-on-slow-on-b-off', pv[A] === 'false->true' && pv[SLOW] === 'false->true' && pv[B] === 'true->false', { preview: pv });

    // ---------- apply ----------
    const applied = await cli(`await rt.applyProfile(${J(PROFILE)});value={rows:ownRows(),counters:counters(),faults:faults(),local:localOf(),proj:ownProj(rt.state)};`); ownPostimage = applied.proj;
    ownLastLocal = applied.local;
    push('apply-own-loaded-native-on', applied.rows.find(r => r.id === A).loaded && applied.rows.find(r => r.id === A).native && applied.rows.find(r => r.id === SLOW).loaded && applied.rows.find(r => r.id === SLOW).native, { rows: applied.rows });
    push('apply-b-disabled', applied.rows.find(r => r.id === B).loaded === false && applied.rows.find(r => r.id === B).native === false, { b: applied.rows.find(r => r.id === B) });
    push('apply-bug-flags', applied.faults.a === true && applied.faults.b === false, { faults: applied.faults });
    push('apply-load-counters', applied.counters[A] === 1 && applied.counters[SLOW] === 1, { counters: applied.counters });
    push('apply-applied-profile', applied.local.appliedProfileId === PROFILE, { local: applied.local });

    // ---------- undo ----------
    const undone = await cli(`await rt.undoProfile();value={rows:ownRows(),counters:counters(),faults:faults(),proj:ownProj(rt.state)};`); ownPostimage = undone.proj;
    push('undo-restores-before-actual', undone.rows.find(r => r.id === A).loaded === false && undone.rows.find(r => r.id === A).native === false && undone.rows.find(r => r.id === SLOW).loaded === false && undone.rows.find(r => r.id === SLOW).native === false && undone.rows.find(r => r.id === B).loaded === true && undone.rows.find(r => r.id === B).native === true, { rows: undone.rows });
    push('undo-no-reload', undone.counters[A] === applied.counters[A] && undone.counters[SLOW] === applied.counters[SLOW], { before: applied.counters, after: undone.counters });

    // ---------- tag edit adds membership without loading ----------
    const bOff = await cli(`await rt.setEnabled(REF(${J(B)}),false);value={rows:ownRows(),counters:counters(),proj:ownProj(rt.state)};`); ownPostimage = bOff.proj;
    push('b-disabled-for-tag-edit', bOff.rows.find(r => r.id === B).loaded === false && bOff.rows.find(r => r.id === B).native === false, { b: bOff.rows.find(r => r.id === B), counters: bOff.counters });
    const tagEdit = await cli(`let proj=null;await rt.enqueue('acceptance-setup',async(tx)=>{S=await tx.refresh();S.records[${J('community:' + B)}].tags=[${J(TAG)}];await tx.save();proj=ownProj(S);});value={proj,rows:ownRows(),counters:counters()};`);
    ownPostimage = tagEdit.proj;
    push('tag-edit-no-load', tagEdit.rows.find(r => r.id === B).loaded === false && tagEdit.rows.find(r => r.id === B).native === false && tagEdit.counters[B] === bOff.counters[B], { rows: tagEdit.rows, counters: tagEdit.counters, before: bOff.counters });
    push('tag-edit-membership', tagEdit.proj.records[1][1].tags.join() === TAG, { bTags: tagEdit.proj.records[1][1].tags });
    const tagApply = await cli(`await rt.applyProfile(${J(PROFILE)});value={rows:ownRows(),counters:counters(),faults:faults(),proj:ownProj(rt.state)};`); ownPostimage = tagApply.proj;
    push('tag-membership-applies-on-apply', tagApply.rows.find(r => r.id === B).loaded === true && tagApply.counters[B] === tagEdit.counters[B] + 1 && tagApply.faults.b === true, { rows: tagApply.rows, counters: tagApply.counters, faults: tagApply.faults });
    const undoTag = await cli(`await rt.undoProfile();value={rows:ownRows(),counters:counters(),proj:ownProj(rt.state)};`); ownPostimage = undoTag.proj;
    push('undo-after-tag-apply', undoTag.rows.find(r => r.id === B).loaded === false && undoTag.rows.find(r => r.id === A).loaded === false && undoTag.rows.find(r => r.id === SLOW).loaded === false, { rows: undoTag.rows });

    // ---------- group is independent of tags ----------
    const grouped = await cli(`await rt.setGroup(REF(${J(B)}),${J(GROUP)});let proj=null;await rt.enqueue('acceptance-read',async(tx)=>{S=await tx.refresh();proj=ownProj(S);});value={proj,rows:ownRows(),groupCount:rt.state.groups.length};`);
    ownPostimage = grouped.proj;
    push('group-independent', grouped.proj.records[1][1].group === GROUP && grouped.groupCount > 0, { group: grouped.proj.records[1][1].group, tags: grouped.proj.records[1][1].tags });
    push('group-no-host-change', grouped.rows.every(r => r.loaded === false && r.native === false), { rows: grouped.rows });

    // ---------- partial fixture: a off, b untouched ----------
    const prePartial = await cli(`await rt.setEnabled(REF(${J(A)}),true);value={rows:ownRows(),counters:counters(),proj:ownProj(rt.state)};`); ownPostimage = prePartial.proj;
    push('a-enabled-for-partial', prePartial.rows.find(r => r.id === A).loaded === true, { a: prePartial.rows.find(r => r.id === A) });
    const partial = await cli(`const before=ownRows();const cBefore=counters();await rt.applyFixture(${J(PARTIAL)});value={before,after:ownRows(),counters:counters(),faults:faults(),proj:ownProj(rt.state)};`); ownPostimage = partial.proj;
    push('partial-fixture-a-off-b-left-off', partial.after.find(r => r.id === A).loaded === false && partial.after.find(r => r.id === A).native === false && partial.after.find(r => r.id === B).loaded === false, { before: partial.before, after: partial.after });
    push('partial-fixture-no-new-loads', partial.counters[A] === prePartial.counters[A] && partial.counters[B] === prePartial.counters[B], { countersBefore: prePartial.counters, countersAfter: partial.counters });

    // ---------- deferred case ----------
    deferredRan = true;
    const slowOn = await cli(`await rt.setEnabled(REF(${J(SLOW)}),true);value={rows:ownRows(),counters:counters(),proj:ownProj(rt.state)};`); ownPostimage = slowOn.proj;
    push('slow-enabled-for-deferred', slowOn.rows.find(r => r.id === SLOW).loaded === true && slowOn.counters[SLOW] === prePartial.counters[SLOW] + 1, { rows: slowOn.rows, counters: slowOn.counters });
    const pauseAdd = await cli(`rt.pause('acceptance-deferred-exclusion');let proj=null;await rt.enqueue('acceptance-setup',async(tx)=>{
S=await tx.refresh();
S.deferred=S.deferred.filter(d=>d.id!==${J(SLOW)});
S.deferred.push({id:${J(SLOW)},delayMs:100,enabled:true,parked:false});
if(!S.records[${J('community:' + SLOW)}])throw Error('slow record missing');
await tx.reconcileDeferred(REF(${J(SLOW)}));
await tx.save();
proj=ownProj(S);
});value={proj,rows:ownRows(),local:localOf()};`);
    ownPostimage = pauseAdd.proj;
    ownLastLocal = pauseAdd.local;
    push('deferred-policy-added-while-paused', pauseAdd.proj.deferred.length === 1 && pauseAdd.proj.deferred[0][1] === true && pauseAdd.proj.deferred[0][2] === 100, { deferred: pauseAdd.proj.deferred });
    await sleep(PAUSE_SETTLE);
    const whilePaused = await cli(`value={rows:ownRows(),counters:counters(),local:localOf()};`);
    push('deferred-slow-off-while-paused', whilePaused.rows.find(r => r.id === SLOW).native === false && whilePaused.rows.find(r => r.id === SLOW).loaded === false, { slow: whilePaused.rows.find(r => r.id === SLOW) });

    const applyPaused = await cli(`await rt.applyProfile(${J(PROFILE)});value={rows:ownRows(),local:localOf(),counters:counters(),proj:ownProj(rt.state)};`); ownPostimage = applyPaused.proj;
    ownLastLocal = applyPaused.local;
    push('apply-while-paused-establishes-profile', applyPaused.local.appliedProfileId === PROFILE, { local: applyPaused.local });
    push('apply-while-paused-keeps-slow-off', applyPaused.rows.find(r => r.id === SLOW).loaded === false && applyPaused.rows.find(r => r.id === SLOW).native === false, { slow: applyPaused.rows.find(r => r.id === SLOW) });

    const resumeDeferred = await cli(`await rt.resume();value={local:localOf(),rows:ownRows(),counters:counters(),proj:ownProj(rt.state),workspaces:(()=>{const i=app.internalPlugins?.getPluginById?.('workspaces')?.instance;const w=i?.workspaces;const has=(x)=>w instanceof Map?w.has(x):Object.prototype.hasOwnProperty.call(w||{},x);return {hasD:has('d'),hasT:has('t'),hasM:has('m'),active:i?.activeWorkspace??null};})()};`); ownPostimage = resumeDeferred.proj;
    ownLastLocal = resumeDeferred.local;
    push('deferred-resume-no-workspace-clone', resumeDeferred.workspaces.hasD === base.workspaces.hasD && resumeDeferred.workspaces.hasT === base.workspaces.hasT && resumeDeferred.workspaces.hasM === base.workspaces.hasM && resumeDeferred.workspaces.active === base.workspaces.active, { workspaces: resumeDeferred.workspaces, baseline: base.workspaces });
    await sleep(DEFERRED_SETTLE);
    const deferredLoaded = await cli(`value={rows:ownRows(),counters:counters(),faults:faults(),proj:ownProj(rt.state),generation:rt.getMutationGeneration(REF(${J(SLOW)}))};`);
    const deferredExpected = ownSlowUndoExpected(ownPostimage, deferredLoaded.proj, SLOW, deferredLoaded.generation);
    assert(deferredLoaded.rows.find(r => r.id === SLOW).loaded === true && deferredLoaded.rows.find(r => r.id === SLOW).native === false, 'Deferred event was not a single loaded non-native slow fixture');
    assert(deferredLoaded.counters[SLOW] === slowOn.counters[SLOW] + 1, 'Deferred slow fixture did not load exactly once');
    assert(deferredExpected.error === null, deferredExpected.error || 'Could not reconcile verified slow undo entry');
    const deferredProjectionCheck = evaluateOwnedPostimage(deferredExpected.expected, deferredLoaded.proj);
    assert(deferredProjectionCheck.ok, `Deferred event changed unexpected owned projection fields: ${deferredProjectionCheck.differences.join(', ')}`);
    ownPostimage = deferredExpected.expected;
    push('deferred-slow-loaded-nonpersistent', deferredLoaded.rows.find(r => r.id === SLOW).loaded === true && deferredLoaded.rows.find(r => r.id === SLOW).native === false, { slow: deferredLoaded.rows.find(r => r.id === SLOW) });
    push('deferred-counter-delta-one', deferredLoaded.counters[SLOW] === slowOn.counters[SLOW] + 1, { before: slowOn.counters[SLOW], after: deferredLoaded.counters[SLOW] });
    await sleep(DEFERRED_SETTLE);
    const stillOnce = await cli('value=counters();');
    push('deferred-loads-exactly-once', stillOnce[SLOW] === deferredLoaded.counters[SLOW], { first: deferredLoaded.counters[SLOW], second: stillOnce[SLOW] });
    const pauseAgain = await cli(`rt.pause('acceptance-deferred-cancelled');value={local:localOf(),rows:ownRows()};`);
    ownLastLocal = pauseAgain.local;
    push('pause-after-deferred', pauseAgain.local.recoveryReason === 'acceptance-deferred-cancelled', { local: pauseAgain.local });

    const cancelRefresh = await cli(`let proj=null;await rt.enqueue('acceptance-cancel-refresh',async(tx)=>{S=await tx.refresh();await tx.reconcileDeferred(REF(${J(SLOW)}));await tx.save();proj=ownProj(S);});value={proj};`);
    ownPostimage = cancelRefresh.proj;
    const cancel = await cli(`await rt.applyProfile(${J(PROFILE)});const before=counters();await rt.resume();rt.pause('acceptance-deferred-cancel-before-fire');value={before,after:counters(),rows:ownRows(),local:localOf(),proj:ownProj(rt.state)};`); ownPostimage = cancel.proj;
    ownLastLocal = cancel.local;
    push('cancel-setup', cancel.local.recoveryReason === 'acceptance-deferred-cancel-before-fire', { local: cancel.local });
    await sleep(PAUSE_SETTLE);
    const cancelled = await cli(`value={rows:ownRows(),counters:counters()};`);
    push('cancel-slow-not-loaded', cancelled.rows.find(r => r.id === SLOW).loaded === false && cancelled.rows.find(r => r.id === SLOW).native === false, { slow: cancelled.rows.find(r => r.id === SLOW) });
    push('cancel-no-second-load', cancelled.counters[SLOW] === cancel.before[SLOW], { atResume: cancel.after[SLOW], afterWait: cancelled.counters[SLOW] });

    // ---------- foreign rows unchanged so far ----------
    const mid = await cli('value={community:foreignCommunity(),core:coreRows(),counters:counters(),faults:faults(),rows:ownRows()};');
    push('foreign-preserved-midrun', same(mid.community, base.foreignCommunity) && same(mid.core, base.core), { communityChanged: mid.community.filter((r, i) => !same(r, base.foreignCommunity[i])).map(r => r.id), coreChanged: mid.core.filter((r, i) => !same(r, base.core[i])).map(r => r.id) });
    fixtureLoads = { counters: mid.counters, faults: mid.faults, reproductions: { individualA: mid.faults.a, pairAB: mid.faults.a && mid.faults.b }, rows: mid.rows };

    return { fixtureLoads };
  } catch (error) {
    cases.push({ name: 'execution-error', passed: false, error: String(error?.message || error) });
    const failureReason = 'acceptance-failed: ' + (error?.message ? String(error.message) : String(error)).slice(0, 300);
    try {
      await cli(`rt.pause(${J(failureReason)});value=true;`);
      ownLastLocal = { ...(ownLastLocal || {}), recoveryReason: failureReason };
    } catch { /* host may be gone */ }
  } finally {
    if (ownWritesStarted) {
      cleanup.attempted = true;
      try {
        await cli(`rt.pause('acceptance-cleanup');if(typeof rt.cancelDeferred==='function')rt.cancelDeferred();value=true;`);
        ownLastLocal = { ...(ownLastLocal || {}), recoveryReason: 'acceptance-cleanup' };
        const freshBefore = await cli(`${STATEVARS}\nvalue={proj:ownProj(S),local:localOf(),rows:ownRows(),generation:rt.getMutationGeneration(REF(${J(SLOW)}))};`);
        const evalResult = evaluateOwnedPostimage(ownPostimage, freshBefore.proj);
        if (!evalResult.ok) {
          cleanup.conflicts.push({ phase: 'pre-cleanup-projection', expected: ownPostimage, actual: freshBefore.proj, diffs: evalResult.differences });
          push('own-postimage-current', false, { expected: ownPostimage, actual: freshBefore.proj });
        } else {
          push('own-postimage-current', true, { expected: ownPostimage, actual: freshBefore.proj });
        }

        if (!evalResult.ok) throw new Error(`Cleanup CAS refused before purge: ${evalResult.differences.join(', ')}`);

        // Disable ONLY owned 3 that match expected file hashes
        const disableList = [];
        for (const id of OWN) {
          const mHash = await nodeHash(path.join(VAULT_PATH, `.obsidian/plugins/${id}/main.js`));
          const fHash = await nodeHash(path.join(VAULT_PATH, `.obsidian/plugins/${id}/manifest.json`));
          if (mHash === expectedFixtureHashes[`${id}/main.js`] && fHash === expectedFixtureHashes[`${id}/manifest.json`]) {
            disableList.push(id);
          } else {
            cleanup.conflicts.push({ phase: 'pre-disable-hash-mismatch', id, mainHash: mHash, manifestHash: fHash });
          }
        }
        const disable = await cli(`const out=[];for(const id of ${J(disableList)}){await app.plugins.disablePluginAndSave(id);out.push(row(id));}value={disabled:out,foreign:foreignCommunity().length,core:coreRows().length};`);
        push('cleanup-own-disabled', disable.disabled.every(r => r.loaded === false && r.native === false), { disabled: disable.disabled });
        push('cleanup-foreign-count-intact', disable.foreign === foreignBefore.community.length, { foreign: disable.foreign, expected: foreignBefore.community.length });

        // Purge ONLY owned 3 records, tag, profile, partial, deferred, source keys, backups, and undo
        const purge = await cli(`const out=await rt.enqueue('acceptance-cleanup',async(tx)=>{
S=await tx.refresh();
for(const id of OWNJ)delete S.records['community:'+id];
S.tags=S.tags.filter(t=>t.id!==${J(TAG)});
S.deviceProfiles=S.deviceProfiles.filter(x=>x.id!==${J(PROFILE)});
S.fixtureProfiles=S.fixtureProfiles.filter(x=>x.id!==${J(PARTIAL)});
S.deferred=S.deferred.filter(d=>d.id!==${J(SLOW)});
S.profileBackups=(S.profileBackups||[]).filter(b=>!(b&&b.profileId===${J(PROFILE)}));
for(const k of Object.keys(S.githubSources||{}))if(${J(OWN)}.some(id=>k.includes(id)))delete S.githubSources[k];
${baseline?.undo === null ? 'delete S.undo;' : `S.undo=${J(JSON.parse(baseline.undo))};`}
await tx.save();
return ownProj(S);
});
value={proj:out,local:localOf()};`);
        const purged = purge.proj;
        push('cleanup-records-removed', purged.records.every(r => r === null), { records: purged.records });
        push('cleanup-entities-removed', purged.tags.length === 0 && purged.deviceProfiles.length === 0 && purged.fixtureProfiles.length === 0 && purged.deferred.length === 0 && purged.ownProfileBackups === 0, { tags: purged.tags, profiles: purged.deviceProfiles, fixtures: purged.fixtureProfiles, deferred: purged.deferred, ownProfileBackups: purged.ownProfileBackups });
        push('cleanup-undo-restored', same(purged.undo, baseline?.undo === null ? null : JSON.parse(baseline.undo)), { undo: purged.undo });

        // Safe local restore comparing current against recorded own last local postimage
        const currentLocal = freshBefore.local;
        const localDecision = safeLocalRestore(baseline?.local, ownLastLocal, currentLocal);
        if (localDecision.conflicts.length > 0) {
          cleanup.conflicts.push({ phase: 'local-restore-conflicts', conflicts: localDecision.conflicts });
        }
        const localRestored = await cli(`if(JSON.stringify(localOf())!==${J(JSON.stringify(freshBefore.local))})throw Error('Local postimage changed; preserve external local state');
${localDecision.instructions.join('\n')}
if(typeof rt.persistLocal==='function')rt.persistLocal();
value=localOf();`);
        cleanup.localRestored = localDecision.conflicts.length === 0;
        push('cleanup-local-restored', localDecision.conflicts.length === 0, { restored: localRestored, baseline: baseline?.local, conflicts: localDecision.conflicts });

        // File removals: verify known exact files and prevent recursive rmdir on extra unknown files
        for (const id of OWN) {
          const files = ['main.js', 'manifest.json'];
          const receipt = { id, action: 'remove-fixture-namespace', startedAt: new Date().toISOString(), files: {}, removed: {} };
          for (const n of files) receipt.files[`${id}/${n}`] = await nodeHash(path.join(VAULT_PATH, `.obsidian/plugins/${id}/${n}`));
          receipts.push(receipt);
          await persist();

          let fileMismatch = false;
          for (const n of files) {
            const expected = expectedFixtureHashes[`${id}/${n}`];
            const actual = receipt.files[`${id}/${n}`];
            if (actual !== expected) {
              fileMismatch = true;
              cleanup.conflicts.push({ phase: 'remove', file: `${id}/${n}`, expected, actual });
            }
          }
          if (fileMismatch) continue;

          // Check if unknown extra files exist inside plugin dir
          const listDir = await cli(`const p='.obsidian/plugins/${id}';const entries=await app.vault.adapter.list(p).catch(()=>({files:[],folders:[]}));value={files:entries.files||[],folders:entries.folders||[]};`);
          const knownPaths = files.map(n => `.obsidian/plugins/${id}/${n}`);
          const extraFiles = listDir.files.filter(f => !knownPaths.some(k => f.endsWith(k)));
          if (extraFiles.length > 0 || listDir.folders.length > 0) {
            cleanup.conflicts.push({ phase: 'remove-dir-extra-files', id, extraFiles, folders: listDir.folders });
            continue; // Prevent rmdir if unknown extra files present
          }

          // Remove known files
          for (const n of files) {
            await cli(`if(await ${ADAPTER_EXISTS({ id }, n)})await ${ADAPTER_REMOVE({ id }, n)};value=true;`);
            receipt.removed[`${id}/${n}`] = await nodeHash(path.join(VAULT_PATH, `.obsidian/plugins/${id}/${n}`));
          }
          // Non-recursive rmdir (false)
          await cli(`const r=await app.vault.adapter.rmdir('.obsidian/plugins/${id}',false).catch(()=>null);value=await app.vault.adapter.exists('.obsidian/plugins/${id}');`);
          receipt.dirRemoved = true;
          await persist();
        }

        const absent = await cli(`await app.plugins.loadManifests();value={ns:await Promise.all(OWNJ.map(async id=>({id,exists:await app.vault.adapter.exists('.obsidian/plugins/'+id),manifest:!!app.plugins.manifests?.[id]}))),foreignCount:Object.keys(app.plugins.manifests||{}).filter(i=>!OWNJ.includes(i)).length};`);
        const dirGone = [];
        for (const id of OWN) { try { await stat(path.join(VAULT_PATH, `.obsidian/plugins/${id}`)); dirGone.push(id); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
        cleanup.ownNamespacesAbsent = absent.ns.every(x => !x.exists && !x.manifest) && dirGone.length === 0;
        push('cleanup-namespaces-absent', cleanup.ownNamespacesAbsent, { namespaces: absent.ns, dirsStillPresent: dirGone });

        const after = await cli('value={community:foreignCommunity(),core:coreRows(),local:localOf(),restricted:restricted()};');
        foreignAfter = { community: after.community, core: after.core };
        cleanup.completed = cleanup.conflicts.length === 0;
        cleanup.foreignPreserved = same(after.community, foreignBefore?.community) && same(after.core, foreignBefore?.core);
        push('foreign-preserved-final', cleanup.foreignPreserved, { communityChanged: (after.community || []).filter((r, i) => !same(r, foreignBefore?.community?.[i])).map(r => r.id), coreChanged: (after.core || []).filter((r, i) => !same(r, foreignBefore?.core?.[i])).map(r => r.id) });
        push('foreign-hash-stable', hash(J(after.community)) === foreignBaselineHash?.community && hash(J(after.core)) === foreignBaselineHash?.core, { communityHash: hash(J(after.community)), coreHash: hash(J(after.core)), baseline: foreignBaselineHash });
        push('host-not-restricted-after', after.restricted === false, { restricted: after.restricted });
      } catch (cleanupErr) {
        cleanup.error = String(cleanupErr?.message || cleanupErr);
      }
    }

    const passed = cases.length > 0 && cases.every(c => c.passed) && (ownWritesStarted ? (cleanup.completed === true && cleanup.foreignPreserved === true && cleanup.ownNamespacesAbsent === true) : true);
    await persist();
    await (await import('node:fs/promises')).writeFile(EVIDENCE, JSON.stringify({
      schemaVersion: 1, harness: 'sandbox-community', status: passed ? 'passed' : 'failed', vault: VAULT, appId: APP_ID,
      capturedAt: new Date().toISOString(), cases, foreignBefore, foreignAfter,
      foreignSummary: { beforeHash: foreignBaselineHash, afterHash: foreignAfter ? { community: hash(J(foreignAfter.community)), core: hash(J(foreignAfter.core)) } : null, communityCount: foreignAfter?.community?.length, coreCount: foreignAfter?.core?.length, preserved: cleanup.foreignPreserved },
      fixtureLoads, fixtureNamespaces: OWN, cleanup, receipts, baseline, ownPostimage, deferredRan,
      counts: { cases: cases.length, passed: cases.filter(c => c.passed).length, failed: cases.filter(c => !c.passed).length },
    }, null, 2) + '\n', { flag: 'w' });

    if (!passed) {
      if (cleanup.error || cleanup.conflicts?.length) throw new Error(`Harness cleanup failed: ${cleanup.error || JSON.stringify(cleanup.conflicts)}`);
      throw new Error(`Harness failed on case: ${cases.find(c => !c.passed)?.name || 'unknown'}`);
    }
    return { ok: passed, status: passed ? 'passed' : 'failed', evidence: EVIDENCE, cases: cases.length, passedCases: cases.filter(c => c.passed).length, communityCount: foreignAfter?.community?.length, coreCount: foreignAfter?.core?.length, foreignPreserved: cleanup.foreignPreserved, namespacesAbsent: cleanup.ownNamespacesAbsent };
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--prepare') {
    return cli('value={readyOnly:true,runExecuted:false,identity:{name:app.vault.getName(),basePath:app.vault.adapter.getBasePath(),appId:app.appId},foreignCount:foreignCommunity().length,coreCount:coreRows().length,ownNamespaces:OWNJ.filter(id=>!!app.plugins.manifests[id])};');
  }
  if (argv.length !== 1 || argv[0] !== '--run') throw new Error('Usage: sandbox-community.mjs --run (authorized live Sandbox acceptance only).');
  return run();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n')).catch(e => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
}
