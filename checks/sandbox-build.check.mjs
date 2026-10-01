import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {cli,hash,ROOT,VAULT_PATH,MANAGER_ID,J,OBSIDIAN,VAULT,APP_ID,parseCliJson} from '../scripts/sandbox-community.mjs';

const execute=promisify(execFile);
export const TOTAL_MS=120000, CLEANUP_MS=35000;
export function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
 return value;
}
export const canonicalHash=value=>hash(JSON.stringify(canonical(value)));
export function assertBudget(deadline,reserve=0,now=Date.now()){
 assert(deadline-now>reserve,'Global deployment budget exhausted; reserve cleanup and do not start another mutation');
 return deadline-now;
}
export function chooseProtectedCleanup(before,added,current){
 const owned=new Set(added.filter(id=>!before.includes(id)));
 return current.filter(id=>!owned.has(id));
}
export function localRestorePatch(before,post,current){
 const patch={},conflicts=[];
 for(const k of ['recoveryReason','deviceProfileId','appliedProfileId','operationPending']){
  const b=before?.[k]??null,p=post?.[k]??null,c=current?.[k]??null;
  if(b===p)continue;
  if(c===p)patch[k]=b;else conflicts.push(k);
 }
 return {patch,conflicts};
}

export function pendingDeploymentIds(globals){return Object.entries(globals).filter(([k,v])=>k.startsWith('aigility-manager-deploy:')&&v?.status==='pending').map(([k])=>k);}
export function jobBody(key,phase,body,deadline){return `const __deploymentJob=globalThis[${J(key)}]??{id:${J(key)},startedAt:new Date().toISOString()};globalThis[${J(key)}]=__deploymentJob;__deploymentJob.phase=${J(phase)};__deploymentJob.status='pending';try{if(Date.now()>=${deadline})throw Error('Deployment deadline exceeded');${body};__deploymentJob.result=value;__deploymentJob.status='complete';}catch(error){__deploymentJob.status='failed';__deploymentJob.error=String(error);throw error;}`;}

export async function run(){
 assert.equal(process.env.AIGILITY_SANDBOX_RUN_AUTHORIZED,'1');
 const deadline=Date.now()+TOTAL_MS, jobKey='aigility-manager-deploy:'+Date.now();
 const files=['main.js','manifest.json','styles.css'];
 const dir=path.join(VAULT_PATH,'.obsidian/plugins',MANAGER_ID);
 const out=path.join(ROOT,'evidence/sandbox-build.json');
 const receipt={status:'running',at:new Date().toISOString(),deadline:new Date(deadline).toISOString(),source:{},before:{},after:{},written:[],cleanup:{}};
 const old={},next={};
 let baseline,protections,ownLocalPost,jobStarted=false,reloadStarted=false,reloadVerified=false,failure;
 const persist=()=>writeFile(out,JSON.stringify(receipt,null,2)+'\n');
 const execBounded=(cmd,args,opts)=>execute(cmd,args,{...opts,timeout:Math.min(15000,assertBudget(deadline))});
 async function read(body){assertBudget(deadline);return cli(body,{execFn:execBounded});}
 async function hostEval(body){
  assertBudget(deadline);
  const code=`(async()=>{try{if(app.vault.getName()!==${J(VAULT)}||app.vault.adapter.getBasePath()!==${J(VAULT_PATH)}||app.appId!==${J(APP_ID)})throw Error('Wrong vault for manager deployment');let value;${body};return JSON.stringify({ok:true,value});}catch(error){return JSON.stringify({ok:false,error:String(error?.message||error)});}})()`;
  new Function('return '+code);
  const {stdout}=await execBounded(OBSIDIAN,[`vault=${VAULT}`,'eval',`code=${code}`],{maxBuffer:1024*1024});
  const result=parseCliJson(stdout);assert(result.ok,result.error);return result.value;
 }
 const jobRead=()=>hostEval(`value=globalThis[${J(jobKey)}]??null;`);
 async function waitSettled(){
  if(!jobStarted)return true;
  while(deadline-Date.now()>2500){
   const job=await jobRead();receipt.operation=job;
   if(job&&job.status!=='pending')return true;
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  receipt.cleanup.pending=true;return false;
 }
 async function mutateLoaded(phase,body){
  jobStarted=true;
  try{return await read(jobBody(jobKey,phase,body,deadline));}
  catch(error){receipt.phaseError={phase,at:new Date().toISOString(),error:String(error)};console.error('Native operation failed; inspect same token, no retry:',phase,receipt.phaseError.at,String(error));await persist();throw error;}
 }
 async function capture(){
  const r=await read(`await rt.refresh();value={foreign:foreignCommunity().filter(x=>x.id!==${J(MANAGER_ID)}),core:coreRows(),local:localOf(),protected:[...rt.state.protected],profiles:rt.state.deviceProfiles.length,fixtures:rt.state.fixtureProfiles.length,profileContent:rt.state.deviceProfiles,fixtureContent:rt.state.fixtureProfiles,debug:rt.state.debug?.active===true,settings:app.setting?.containerEl?.isShown?.()===true,loaded:P._loaded,native:app.plugins.enabledPlugins.has(${J(MANAGER_ID)}),version:P.manifest.version,build:P.managerBuild,archiveRoot:P.archive?.root??null,archiveReady:typeof P.archive?.archive==='function'};`);
  r.profileHash=canonicalHash(r.profileContent);r.fixtureHash=canonicalHash(r.fixtureContent);
  delete r.profileContent;delete r.fixtureContent;return r;
 }
 function checkForeign(r){
  assert.deepEqual(r.foreign,baseline.foreign,'Foreign community state changed');
  assert.deepEqual(r.core,baseline.core,'Core state changed');
  assert.equal(r.profileHash,baseline.profileHash,'Full device profile content changed');
  assert.equal(r.fixtureHash,baseline.fixtureHash,'Full test profile content changed');
 }
 try{
  const pending=await hostEval(`value=(${pendingDeploymentIds.toString()})(globalThis);`);assert.deepEqual(pending,[],'A prior deployment is pending; inspect the same operation before new work');
  baseline=await capture();receipt.hostBefore=baseline;
  assert.equal(baseline.debug,false);assert.equal(baseline.settings,false);
  assert.equal(baseline.local.operationPending,null);assert.equal(baseline.local.deviceProfileId,null);
  assert.equal(baseline.loaded,true);assert.equal(baseline.native,true);
  const ready=await read(`value=JSON.parse(await app.vault.adapter.read(P.manifest.dir+'/data.json')).schemaVersion===1;`);
  assert.equal(ready,true,'Filesystem read must finish before update');
  for(const file of files){old[file]=await readFile(path.join(dir,file));next[file]=await readFile(path.join(ROOT,file));receipt.before[file]=hash(old[file]);receipt.source[file]=hash(next[file]);}
  const manifest=JSON.parse(next['manifest.json']);assert.equal(manifest.id,MANAGER_ID);assert.equal(manifest.version,'0.1.1');
  const backup=path.join(ROOT,'evidence/local-backups','sandbox-build-'+Date.now());
  await mkdir(backup,{recursive:true});
  for(const file of files){await writeFile(path.join(backup,file),old[file]);assert.equal(hash(await readFile(path.join(backup,file))),receipt.before[file]);}
  receipt.backup=path.relative(ROOT,backup);await persist();
  assertBudget(deadline,CLEANUP_MS);receipt.firstMutationAt=new Date().toISOString();
  protections=await mutateLoaded('protections',`let before,added,after;await rt.enqueue('sandbox-test-protect',async tx=>{const s=await tx.refresh();before=[...s.protected];const refs=[...Object.keys(app.plugins.manifests).filter(id=>id!==${J(MANAGER_ID)}&&!OWNJ.includes(id)).map(id=>'community:'+id),...Object.keys(app.internalPlugins.plugins).map(id=>'core:'+id)];added=refs.filter(k=>!before.includes(k)&&!before.includes(k.slice(k.indexOf(':')+1)));__deploymentJob.protections={before,added,after:[...before,...added],local:localOf()};if(Date.now()>=${deadline-CLEANUP_MS})throw Error('Reserve cleanup before protection save');s.protected.push(...added);await tx.save();after=[...s.protected];});rt.pause(${J(jobKey)});value={before,added,after,local:localOf()};__deploymentJob.protections=value;`);
  ownLocalPost=protections.local;receipt.temporaryProtections=protections;
  for(const file of files){
   assertBudget(deadline,CLEANUP_MS);
   assert.equal(hash(await readFile(path.join(dir,file))),receipt.before[file],'Installed artifact changed: '+file);
   assert.equal(hash(await readFile(path.join(ROOT,file))),receipt.source[file],'Source artifact changed: '+file);
   if(receipt.before[file]!==receipt.source[file]){receipt.written.push(file);await writeFile(path.join(dir,file),next[file]);}
  }
  assertBudget(deadline,CLEANUP_MS);
  jobStarted=true;reloadStarted=true;
  await hostEval(`const job={id:${J(jobKey)},startedAt:new Date().toISOString(),status:'pending'};globalThis[${J(jobKey)}]=job;try{await app.plugins.disablePlugin(${J(MANAGER_ID)});await app.plugins.loadManifests();await app.plugins.enablePlugin(${J(MANAGER_ID)});job.status='complete';job.loaded=app.plugins.plugins[${J(MANAGER_ID)}]?._loaded===true;}catch(error){job.status='failed';job.error=String(error);throw error;}value=job;`);
  const after=await capture();receipt.hostAfter=after;ownLocalPost=after.local;
  checkForeign(after);
  assert.equal(after.version,'0.1.1');assert.equal(after.build,MANAGER_ID+'/0.1.1');
  assert.equal(after.archiveRoot,'.obsidian/plugins/_archive');assert.equal(after.archiveReady,true);
  assert.equal(after.loaded,true);assert.equal(after.native,true);assert(after.local.recoveryReason,'Late load must remain paused');
  for(const file of files){receipt.after[file]=hash(await readFile(path.join(dir,file)));assert.equal(receipt.after[file],receipt.source[file]);}
  reloadVerified=true;
 }catch(error){failure=error;receipt.error=String(error.message||error);}
 finally{
  try{
   const settled=await waitSettled();
   const settledJob=jobStarted?await jobRead():null;
   protections??=settledJob?.protections;ownLocalPost??=protections?.local;
   if(!settled)throw Error('Same reload operation is pending: preserve files and state, do not retry');
   if(failure&&receipt.written.length){
    const unchanged=await Promise.all(receipt.written.map(async file=>hash(await readFile(path.join(dir,file)))===receipt.source[file]));
    if(!unchanged.every(Boolean))throw Error('Rollback refused: written artifacts changed externally');
    for(const file of receipt.written){assertBudget(deadline);await writeFile(path.join(dir,file),old[file]);}
    receipt.rollback='old matching artifacts restored';
    if(reloadStarted){
     assertBudget(deadline,15000);
     await hostEval(`await app.plugins.disablePlugin(${J(MANAGER_ID)});await app.plugins.loadManifests();await app.plugins.enablePlugin(${J(MANAGER_ID)});value=true;`);
     receipt.rollback='old artifacts and module restored';
    }
   }
   if(protections){
    const current=await capture();
    const expected=chooseProtectedCleanup(protections.before,protections.added,current.protected);
    const decision=localRestorePatch(baseline.local,ownLocalPost??protections.local,current.local);
    // Failed reload recovery reasons are retained unless they equal our own explicit marker.
    if(failure&&current.local.recoveryReason!==jobKey)delete decision.patch.recoveryReason;
    const ownFields=Object.keys(decision.patch);
    const result=await mutateLoaded('cleanup',`let before,after;await rt.enqueue('sandbox-build-cleanup',async tx=>{const s=await tx.refresh();before=[...s.protected];if(JSON.stringify(before)!==${J(JSON.stringify(current.protected))})throw Error('Protected list changed before cleanup; preserve current values');if(Date.now()>=${deadline})throw Error('Deployment deadline exceeded before cleanup save');s.protected=${J(expected)};await tx.save();after=[...s.protected];});const expectedLocal=${J(current.local)};if(JSON.stringify(localOf())!==JSON.stringify(expectedLocal))throw Error('Local state changed before cleanup; preserve current values');for(const [k,v] of Object.entries(${J(decision.patch)})){if(v===null)delete rt.local[k];else rt.local[k]=v;}rt.persistLocal();value={before,after,local:localOf()};`);
    assert.deepEqual(result.after,expected,'Selective protection cleanup readback');
    receipt.cleanup.protectedHashBefore=canonicalHash(protections.before);
    receipt.cleanup.protectedHashAfter=canonicalHash(result.after);
    receipt.cleanup.protectedHashExpected=canonicalHash(expected);
    receipt.cleanup.preservedForeignAdditions=result.after.filter(id=>!protections.before.includes(id));
    receipt.cleanup.localFieldsRestored=ownFields;receipt.cleanup.localConflicts=decision.conflicts;
    receipt.cleanup.localAfter=result.local;
    const final=await capture();receipt.hostFinal=final;checkForeign(final);
    receipt.cleanup.completed=true;
   }else receipt.cleanup.completed=true;
  }catch(error){receipt.cleanup.error=String(error.message||error);failure??=error;try{if(jobStarted){const settled=await waitSettled();receipt.cleanup.pending=!settled;if(settled)receipt.cleanup.lateOperation=await jobRead();}}catch(readError){receipt.cleanup.operationReadError=String(readError);}}
  receipt.status=failure?'failed':'passed';receipt.reloadVerified=reloadVerified;receipt.finishedAt=new Date().toISOString();await persist();
 }
 if(failure)throw failure;
 console.log(JSON.stringify({status:receipt.status,version:receipt.hostFinal.version,foreign:receipt.hostFinal.foreign.length,core:receipt.hostFinal.core.length,profiles:receipt.hostFinal.profiles,fixtures:receipt.hostFinal.fixtures,cleanup:receipt.cleanup,sourceHashes:receipt.source}));
 return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(error=>{console.error(error);process.exitCode=1;});
