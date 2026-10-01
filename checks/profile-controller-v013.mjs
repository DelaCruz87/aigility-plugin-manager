import {fixtureFiles,ownProjection,purgeOwned,protectionCleanup,buildCasesBody} from './profile-fixture-plan.mjs';
import {runOwnedProfileCases} from './profile-cases-v013.mjs';
import {cleanupOwnedFixtureFiles,cleanupOwnedManifest} from './profile-file-cleanup-v013.mjs';
import {createHash} from 'node:crypto';
import {writeReceiptCAS,frozenNativeIdentity} from './profile-ownership-v013.mjs';
const clone=v=>v===undefined?undefined:structuredClone(v);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const ownSet=new Set(['community:aigility-manager-fixture-a','community:aigility-manager-fixture-b']);
export const profileHelpers={fixtureFiles,ownProjection,purgeOwned,protectionCleanup,runOwnedProfileCases,cleanupOwnedFixtureFiles,cleanupOwnedManifest,digest:v=>createHash('sha256').update(v).digest('hex')};

export async function runProfileController(app,globals,key,{actionDeadline,cleanupDeadline},h){
 if(!Number.isFinite(actionDeadline)||!Number.isFinite(cleanupDeadline)||cleanupDeadline<=actionDeadline)throw Error('Finite ordered profile deadlines required');
 const ids=['aigility-manager-fixture-a','aigility-manager-fixture-b'],managerId='aigility-plugin-manager',tag='aigility-test-tag',profile='aigility-host-test',partial='aigility-host-partial';
 const copy=v=>v===undefined?undefined:structuredClone(v),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 if(!key.startsWith('aigility-manager-profile:')||Object.hasOwn(globals,key)||Object.entries(globals).some(([k,v])=>/^aigility-manager-(profile|ui):/.test(k)&&v?.status==='pending'))throw Error('Manager job exists or is pending');
 const job={id:key,status:'pending',phase:'preflight',startedAt:new Date().toISOString(),restoration:{},journal:[],postimages:[]};globals[key]=job;
 const manager=app.plugins?.plugins?.[managerId],rt=manager?.runtime,adapter=app.vault?.adapter,manifests={};
 Object.defineProperty(job,'pluginRef',{value:manager,enumerable:false});
 Object.defineProperty(job,'runtimeRef',{value:rt,enumerable:false});
 if(h.primaryWindowId!==undefined)job.primaryWindowId=h.primaryWindowId;
 let baseline,expectedProjection,localPost,undoPost,protections,created=false,casesStarted=false,operationPending=false,failure;
 const gate=cleanup=>{
  if(globals[key]!==job||app.plugins?.plugins?.[managerId]!==manager||manager?.runtime!==rt||!manager?._loaded||manager.manifest.version!=='0.1.3')throw Error('Manager/job identity changed');
  if(app.vault.getName()!=='Sandbox'||adapter.getBasePath()!=='/Users/eme/Obsidian/Sandbox'||app.appId!=='d137282e82167d84')throw Error('Sandbox identity changed');
  if(typeof document!=='undefined'&&app.workspace.containerEl.ownerDocument!==document)throw Error('Primary document changed');
  h.primaryWindowGate?.();
  if(Date.now()>=(cleanup?cleanupDeadline:actionDeadline))throw Error('Profile lease deadline reached');
 };
 const run=async(label,fn,cleanup=false)=>{
  gate(cleanup);job.phase=label;h.persistJob?.(job);gate(cleanup);operationPending=true;
  try{const value=await fn();operationPending=false;gate(cleanup);return value;}catch(error){operationPending=false;throw error;}
 };
 const local=()=>Object.fromEntries(['recoveryReason','operationPending','deviceProfileId','appliedProfileId'].map(k=>[k,rt.local[k]??null]));
 const foreign=()=>Object.entries(app.plugins.manifests).filter(([id])=>!ids.includes(id)).map(([id,m])=>({id,version:m.version??null,native:app.plugins.enabledPlugins.has(id),loaded:app.plugins.plugins[id]?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
 const cores=()=>Object.entries(app.internalPlugins.plugins).map(([id,w])=>({id,enabled:w.enabled===true,loaded:w.instance?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
 const settings=()=>({modal:app.setting?.modalEl,doc:app.setting?.doc,active:app.setting?.activeTab,tab:app.setting?.lastTabId,connected:app.setting?.modalEl?.isConnected===true});
 const row=id=>({native:app.plugins.enabledPlugins.has(id),loaded:app.plugins.plugins[id]?._loaded===true,generation:rt.getMutationGeneration({kind:'community',id})});
 let fixturePost={},settingsBefore;
 const remember=()=>{expectedProjection=h.ownProjection(rt.state);localPost=local();undoPost=copy(rt.profileUndo);fixturePost=Object.fromEntries(ids.map(id=>[id,row(id)]));};
 const captureCasePost=step=>{
  expectedProjection=copy(step.postimage.projection);localPost=Object.fromEntries(Object.keys(baseline.local).map(k=>[k,step.postimage.local[k]??null]));
  undoPost=copy(rt.profileUndo);fixturePost=Object.fromEntries(ids.map(id=>[id,{native:step.postimage.native[id],loaded:step.postimage.loaded[id],generation:step.postimage.generations[id]}]));
 };
 const applyDefinitionPost=()=>{if(job.manualFixturePost&&expectedProjection){const own=expectedProjection.fixtureProfiles.find(p=>p.id===job.manualFixturePost.id);if(own)own.members=copy(job.manualFixturePost.members);}};
 const absent=s=>{
  const p=h.ownProjection(s);if(Object.keys(p.records).length||p.tags.length||p.deviceProfiles.length||p.fixtureProfiles.length||p.deferred.length||p.profileBackups.length||ids.some(id=>Object.hasOwn(s.githubSources??{},'community:'+id)))throw Error('Owned metadata namespace already exists');
 };
 const owned=ids.map(id=>{const files=h.fixtureFiles(id);return {id,directory:'.obsidian/plugins/'+id,hashes:Object.fromEntries(Object.entries(files).map(([name,text])=>[name,h.digest(text)]))};});
 try{
  gate();if(app.plugins.isEnabled()!==true||!rt||!rt.local.recoveryReason||rt.local.operationPending||rt.local.deviceProfileId||rt.state.debug?.active)throw Error('Requires unrestricted, paused, unbound runtime with no pending operation/debug session');
  await run('read-state',()=>rt.enqueue('acceptance-read',tx=>tx.refresh()));absent(rt.state);
  baseline={state:copy(rt.state),local:local(),undo:copy(rt.profileUndo),foreign:foreign(),core:cores(),leaf:app.workspace.activeLeaf,leaves:[],counters:Object.fromEntries(ids.map(id=>[id,globals['aigility-host-count:'+id]]))};
  app.workspace.iterateAllLeaves(l=>baseline.leaves.push(l.id));settingsBefore=settings();
  Object.defineProperty(job,'workspaceRef',{value:baseline.leaf,enumerable:false});Object.defineProperty(job,'settingsRef',{value:settingsBefore,enumerable:false});
  job.baseline={projection:h.ownProjection(baseline.state),stateHash:h.digest(JSON.stringify(baseline.state)),local:copy(baseline.local),undo:copy(baseline.undo),foreign:copy(baseline.foreign),core:copy(baseline.core),leaves:[...baseline.leaves]};remember();h.persistJob?.(job);gate();
  for(const entry of owned)if(await run('namespace-preflight',()=>adapter.exists(entry.directory)))throw Error('Fixture namespace already exists: '+entry.id);
  await run('protect-foreign',()=>rt.enqueue('acceptance-protect',async tx=>{
   const s=await tx.refresh();gate();absent(s);
   const refs=[...Object.keys(app.plugins.manifests).filter(id=>!ids.includes(id)).map(id=>'community:'+id),...Object.keys(app.internalPlugins.plugins).map(id=>'core:'+id)];
   const before=[...s.protected],added=refs.filter(k=>!before.includes(k)&&!before.includes(k.split(':').slice(1).join(':')));
   protections={before,added};job.protections=copy(protections);h.persistJob?.(job);gate();s.protected.push(...added);gate();await tx.save();gate();
  }));
  for(const entry of owned){
   created=true;job.journal.push({phase:'create-directory',path:entry.directory,status:'planned'});
   await run('create-directory',()=>adapter.mkdir(entry.directory));job.journal.at(-1).status='settled';
   for(const [name,text]of Object.entries(h.fixtureFiles(entry.id))){
    const path=entry.directory+'/'+name;job.journal.push({phase:'write-fixture-file',path,hash:entry.hashes[name],status:'planned'});
    await run('write-fixture-file',()=>adapter.write(path,text));
    const actual=await run('read-fixture-file',()=>adapter.read(path));if(h.digest(actual)!==entry.hashes[name])throw Error('Fixture write readback mismatch: '+path);job.journal.at(-1).status='settled';
   }
   await run('load-owned-manifest',()=>app.plugins.loadManifest(entry.directory));manifests[entry.id]=app.plugins.manifests[entry.id];
   if(manifests[entry.id]?.id!==entry.id||row(entry.id).native||row(entry.id).loaded)throw Error('Fixture manifest registration mismatch');
  }
  await run('setup-metadata',()=>rt.enqueue('acceptance-own-metadata',async tx=>{
   const s=await tx.refresh();gate();absent(s);
   job.metadataIntent={ids,tag,profile,partial};h.persistJob?.(job);gate();
   for(const id of ids)s.records['community:'+id]={ref:{kind:'community',id},name:id,version:'1.0.0',tags:id===ids[0]?[tag]:[],group:'',desired:false,metadata:{}};
   s.tags.push({id:tag,name:'AIgility acceptance tag'});s.deviceProfiles.push({id:profile,name:'AIgility acceptance profile',tagIds:[tag],applyAtStart:false});s.fixtureProfiles.push({id:partial,name:'AIgility acceptance partial',members:{['community:'+ids[0]]:true}});
   gate();remember();await tx.save();gate();
  }));remember();
  casesStarted=true;job.result=await run('profile-cases',()=>h.runOwnedProfileCases(app,globals,job,{deadline:actionDeadline,manualFixtureProfileId:partial,beforeHostWrapper:()=>{gate();h.persistJob?.(job);gate();},beforeStep:step=>{gate();job.casePending=copy(step);h.persistJob?.(job);gate();},onStep:step=>{gate();captureCasePost(step);job.casePending=null;h.persistJob?.(job);gate();}}));applyDefinitionPost();
 }catch(error){failure=error;job.error=String(error);if(manager===app.plugins?.plugins?.[managerId]&&baseline&&rt){if(casesStarted){const last=job.postimages.at(-1);if(last)captureCasePost(last);applyDefinitionPost();}else localPost=local();}}
 finally{
  const attempt=async(label,fn)=>{try{gate(true);job.cleanupPhase=label;h.persistJob?.(job);gate(true);await fn();gate(true);job.restoration[label]=true;}catch(error){job.restoration[label]=false;job.cleanupErrors??=[];job.cleanupErrors.push({label,error:String(error)});}};
  job.phase='cleanup';h.persistJob?.(job);
  if(operationPending){job.cleanup={pending:true};return job;}
  if(baseline){
   await attempt('local-before-cleanup',()=>{
    if(!localPost)return;
    for(const field of ['operationPending','recoveryReason']){
     const current=rt.local[field]??null;if(current!==localPost[field])throw Error('Local postimage changed: '+field);
     if(baseline.local[field]!==localPost[field]){if(baseline.local[field]===null)delete rt.local[field];else rt.local[field]=baseline.local[field];}
    }rt.persistLocal();localPost=local();
   });
   if(created)await attempt('fixtures-off',async()=>{
    for(const id of ids){const current=row(id),post=fixturePost[id];if(!post||!equal(current,post))throw Error('Fixture state/generation changed: '+id);
     if(current.native||current.loaded)await run('cleanup-fixture-off',()=>rt.enqueue('acceptance-fixture-off',async()=>{gate(true);await rt.host.setEnabled({kind:'community',id},false);gate(true);}),true);
    }
   });
   await attempt('state',async()=>{
    if(expectedProjection)await run('cleanup-own-state',()=>rt.enqueue('acceptance-cleanup-state',async tx=>{
     const s=await tx.refresh();gate(true);const clean=h.purgeOwned(s,baseline.state,expectedProjection);
     Object.assign(s,clean);gate(true);await tx.save();gate(true);
    }),true);

    if(undoPost!==undefined&&equal(rt.profileUndo,undoPost))rt.profileUndo=copy(baseline.undo);
   });
   await attempt('protections',async()=>{
    if(protections)await run('cleanup-protections',()=>rt.enqueue('acceptance-cleanup-protections',async tx=>{const s=await tx.refresh();gate(true);s.protected=h.protectionCleanup(protections.before,protections.added,s.protected);gate(true);await tx.save();gate(true);}),true);
   });
   await attempt('local',()=>{
    if(localPost)for(const field of ['appliedProfileId','deviceProfileId','operationPending','recoveryReason']){
     if((rt.local[field]??null)!==localPost[field])throw Error('Later manual local edit preserved: '+field);
     if(baseline.local[field]===null)delete rt.local[field];else rt.local[field]=baseline.local[field];
    }rt.persistLocal();
   });
   if(created)await attempt('files',()=>{if(!job.restoration['fixtures-off']||!job.restoration.state)throw Error('Fixture state/metadata cleanup conflict; preserve files');return h.cleanupOwnedFixtureFiles(adapter,owned,{gate:()=>gate(true),digest:h.digest,onStep:step=>{job.journal.push(step);h.persistJob?.(job);}});});
   if(created&&job.restoration.files)await attempt('manifests',()=>{for(const id of ids)h.cleanupOwnedManifest(app,id,manifests[id],{gate:()=>gate(true)});});
   await attempt('readback',()=>{
    if(!equal(foreign(),baseline.foreign)||!equal(cores(),baseline.core))throw Error('Foreign community/core state changed; do not restore foreign states');
    if(!equal(rt.state,baseline.state)||!equal(local(),baseline.local))throw Error('Configuration changed; later edits preserved');
    const leaves=[];app.workspace.iterateAllLeaves(l=>leaves.push(l.id));if(app.workspace.activeLeaf!==baseline.leaf||!equal(leaves,baseline.leaves))throw Error('Workspace changed');
    const current=settings();if(Object.keys(current).some(k=>current[k]!==settingsBefore[k]))throw Error('Settings changed; no restoration of foreign UI');
   });
  }
  job.status=failure||job.cleanupErrors?.length?'failed':'complete';job.phase='settled';job.finishedAt=new Date().toISOString();job.cleanup={pending:false};h.persistJob?.(job);
 }
 return job;
}

export function profileControllerBody(key,actionDeadline,cleanupDeadline,receiptPath=null,nativeWindow=false,ownership=null){
 const definitions={fixtureFiles,ownProjection,purgeOwned,protectionCleanup,buildCasesBody,runOwnedProfileCases,cleanupOwnedFixtureFiles,cleanupOwnedManifest};
 const prelude="const IDS=['aigility-manager-fixture-a','aigility-manager-fixture-b'],MANAGER='aigility-plugin-manager',VAULT='Sandbox',BASE='/Users/eme/Obsidian/Sandbox',APP_ID='d137282e82167d84',TAG='aigility-test-tag',PROFILE='aigility-host-test',PARTIAL='aigility-host-partial',FIXTURE_IDS=IDS,ownSet=new Set(IDS.map(id=>'community:'+id)),clone=v=>v===undefined?undefined:structuredClone(v),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);";
 return `async()=>{${prelude}${Object.entries(definitions).map(([name,fn])=>'const '+name+'='+fn.toString()+';').join('')}const writeReceiptCAS=${writeReceiptCAS.toString()},frozenNativeIdentity=${frozenNativeIdentity.toString()};const ownership=${JSON.stringify(ownership)},h={${Object.keys(definitions).join(',')},digest:v=>require('crypto').createHash('sha256').update(v).digest('hex')};if(${JSON.stringify(nativeWindow)}){const remote=require('@electron/remote');h.primaryWindowId=ownership?.nativeIdentity?.windowId;h.primaryWindowGate=()=>frozenNativeIdentity(app,globalThis,document,remote,ownership?.nativeIdentity);h.primaryWindowGate();}const receiptPath=${JSON.stringify(receiptPath)};if(receiptPath){if(typeof ownership?.receiptRaw!=='string'||ownership?.receiptMetadata?.key!==${JSON.stringify(key)}||ownership.receiptMetadata.actionDeadline!==${actionDeadline}||ownership.receiptMetadata.deadline!==${cleanupDeadline})throw Error('Frozen receipt ownership required');let expectedRaw=ownership.receiptRaw;const fs=require('fs');h.persistJob=job=>{const base=JSON.parse(expectedRaw),next={...base,...job};expectedRaw=writeReceiptCAS(fs,receiptPath,expectedRaw,ownership.receiptMetadata,next);if(!Object.hasOwn(job,'receiptExpectedRaw'))Object.defineProperty(job,'receiptExpectedRaw',{value:expectedRaw,writable:true,enumerable:false});else job.receiptExpectedRaw=expectedRaw;};}return await (${runProfileController.toString()})(app,globalThis,${JSON.stringify(key)},{actionDeadline:${actionDeadline},cleanupDeadline:${cleanupDeadline}},h);}`;
}
