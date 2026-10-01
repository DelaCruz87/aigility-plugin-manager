import { buildCasesBody, ownProjection } from './profile-fixture-plan.mjs';

const IDS = ['aigility-manager-fixture-a', 'aigility-manager-fixture-b'];
const MANAGER = 'aigility-plugin-manager';
const VAULT = 'Sandbox', BASE = '/Users/eme/Obsidian/Sandbox', APP_ID = 'd137282e82167d84';
const clone = value => value === undefined ? undefined : structuredClone(value);

export async function runOwnedProfileCases(app, globals, job, { deadline, now = Date.now, onStep = () => {}, manualFixtureProfileId=null }) {
  const manager = app?.plugins?.plugins?.[MANAGER];
  const rt = manager?.runtime;
  const nativePlugins=app?.plugins;
  const host=rt?.host;
  if (!manager || manager._loaded !== true || manager.manifest?.version !== '0.1.3' || !rt) throw Error('loaded manager v0.1.3 runtime required');
  const identity = () => {
    if (app.vault?.getName?.() !== VAULT || app.vault?.adapter?.getBasePath?.() !== BASE || app.appId !== APP_ID) throw Error('Sandbox identity mismatch');
    if (app.plugins?.plugins?.[MANAGER] !== manager || manager.runtime !== rt || manager._loaded!==true || manager.manifest.version!=='0.1.3') throw Error('current manager instance changed');
    if(typeof document!=='undefined'&&app.workspace?.containerEl?.ownerDocument!==document)throw Error('primary document changed');
    if (!job?.id || globals?.[job.id] !== job) throw Error('job identity changed');
    if (now() >= deadline) throw Error('deadline exceeded');
  };
  identity();
  if(!Number.isFinite(deadline))throw Error('Finite deadline required');
  if(manualFixtureProfileId&&(manualFixtureProfileId!=='aigility-host-partial'||!rt.state.fixtureProfiles.some(p=>p.id===manualFixtureProfileId)))throw Error('Manual fixture profile is outside owned scope or missing');
  const originalHost = host.setEnabled;
  if (typeof originalHost !== 'function') throw Error('host setEnabled unavailable');
  let wrapperConflict = false;
  const ownWrapper = async function(ref, ...args) {
    identity();
    if (ref?.kind !== 'community' || !IDS.includes(ref.id)) throw Error('foreign toggle refused');
    const result = await originalHost.call(this, ref, ...args);
    identity();
    return result;
  };
  host.setEnabled = ownWrapper;
  const record = async (name, original, args) => {
    identity();
    let value, failure;
    try { value = await original.apply(rt, args); } catch (error) { failure = error; }
    const postimage = {
      desired: Object.fromEntries(IDS.map(id => [id, rt.list().find(x => x.ref?.kind === 'community' && x.ref.id === id)?.desired ?? null])),
      native: Object.fromEntries(IDS.map(id => [id, nativePlugins.enabledPlugins.has(id)])),
      loaded: Object.fromEntries(IDS.map(id => [id, nativePlugins.plugins[id]?._loaded === true])),
      projection: ownProjection(rt.state), local: clone(rt.local),
    };
    job.postimages ??= [];
    const step = { name, settled: true, postimage, ...(failure ? { error: failure?.message || String(failure) } : {}) };
    job.postimages.push(step);
    identity();
    await onStep(step);
    identity();
    if (failure) throw failure;
    return value;
  };
  let originalMembers,ownedMembers;
  const updateOwnedMembers=async members=>{
    identity();await rt.enqueue('acceptance-own-manual-fixture',async tx=>{
      const fresh=await tx.refresh();identity();const profile=fresh.fixtureProfiles.find(p=>p.id===manualFixtureProfileId);
      if(!profile||JSON.stringify(profile.members)!==JSON.stringify(ownedMembers))throw Error('Owned manual fixture definition changed; preserved');
      ownedMembers=clone(members);profile.members=clone(members);job.manualFixturePost={id:manualFixtureProfileId,members:clone(members)};
      identity();await tx.save();identity();
    });identity();
  };
  if(manualFixtureProfileId){
    if(manualFixtureProfileId!=='aigility-host-partial')throw Error('Manual fixture profile is outside owned scope');
    const profile=rt.state.fixtureProfiles.find(p=>p.id===manualFixtureProfileId);
    if(!profile)throw Error('Owned manual fixture profile is missing');
    originalMembers=clone(profile.members);ownedMembers=clone(profile.members);
  }
  const facade = {};
  for (const name of ['setEnabled', 'previewProfile', 'applyProfile', 'undoProfile', 'setTags', 'applyFixture']) {
    if (typeof rt[name] === 'function') facade[name] = (...args) => record(name, rt[name], args);
  }
  if(manualFixtureProfileId){
    facade.setEnabled=(ref,enabled)=>record('setEnabled-via-owned-fixture',async()=>{
      if(ref?.kind!=='community'||!IDS.includes(ref.id))throw Error('foreign toggle refused');
      await updateOwnedMembers({['community:'+ref.id]:enabled});identity();
      await rt.applyFixture(manualFixtureProfileId);identity();job.manualTogglesViaFixture=(job.manualTogglesViaFixture??0)+1;
    },[]);
    facade.applyFixture=id=>record('applyFixture',async()=>{
      if(id!==manualFixtureProfileId)throw Error('Fixture profile outside owned scope');
      await updateOwnedMembers(originalMembers);identity();await rt.applyFixture(id);identity();
    },[]);
  }
  facade.list=()=>{identity();return rt.list.call(rt);};
  for (const name of ['state', 'local']) Object.defineProperty(facade, name, { enumerable: true, get: () => { identity(); return rt[name]; } });
  try {
    const cases = new Function('app', 'rt', 'globalThis', `return (${buildCasesBody({ deadline })});`)(app, facade, globals);
    return await cases();
  } finally {
    if(manualFixtureProfileId&&JSON.stringify(ownedMembers)!==JSON.stringify(originalMembers)){
      try{identity();await updateOwnedMembers(originalMembers);}catch(error){job.manualFixtureRestoreConflict=String(error);}
    }
    if (host.setEnabled === ownWrapper) host.setEnabled = originalHost;
    else wrapperConflict = true;
    job.wrapperConflict = wrapperConflict;
  }
}

export function profileCasesBody(jobId, deadline, manualFixtureProfileId=null) {
  const ownProjectionSource = ownProjection.toString();
  const component = runOwnedProfileCases.toString();
  const build = buildCasesBody.toString();
  return `async function(){const MANAGER=${JSON.stringify(MANAGER)},IDS=${JSON.stringify(IDS)},VAULT=${JSON.stringify(VAULT)},BASE=${JSON.stringify(BASE)},APP_ID=${JSON.stringify(APP_ID)},FIXTURE_IDS=${JSON.stringify(IDS)},TAG='aigility-test-tag',PROFILE='aigility-host-test',PARTIAL='aigility-host-partial',ownSet=new Set(IDS.map(id=>'community:'+id)),clone=value=>value===undefined?undefined:structuredClone(value);const ownProjection=${ownProjectionSource};const buildCasesBody=${build};const runOwnedProfileCases=${component};return runOwnedProfileCases(app,globalThis,globalThis[${JSON.stringify(jobId)}],{deadline:${Number(deadline)},manualFixtureProfileId:${JSON.stringify(manualFixtureProfileId)}});}`;
}
