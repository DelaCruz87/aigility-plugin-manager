// Acceptance executor only. Import does not call Obsidian or mutate a vault.
import {readFile,writeFile,mkdir,readdir,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {ROOT,VAULT,VAULT_PATH,APP_ID,MANAGER_ID,OBSIDIAN,hash,parseCliJson} from '../scripts/sandbox-community.mjs';
import {persistNewReceipt} from './sandbox-ui-v013.check.mjs';
import {profileControllerBody} from './profile-controller-v013.mjs';
const execute=promisify(execFile);
export const TOTAL_MS=180000,CLEANUP_MS=60000;
export function profileLease({leaseId,ackUTC,startBy,now=Date.now()}){
 assert.match(leaseId??'',/^[A-Za-z0-9_-]{1,80}$/,'Safe explicit lease ID required');
 const ack=Date.parse(ackUTC);assert.ok(Number.isFinite(ack)&&ack<=now,'Valid past ACK required');
 assert.ok(Number.isFinite(startBy)&&startBy>=ack&&now<startBy,'Start-by expired or invalid');
 const deadline=ack+TOTAL_MS,actionDeadline=deadline-CLEANUP_MS;
 assert.ok(now<actionDeadline,'Action deadline expired');return {leaseId,ackUTC,startBy,deadline,actionDeadline};
}
export function isSettled(r){return !!r&&['complete','failed'].includes(r.status)&&r.phase==='settled'&&r.cleanup?.pending===false;}
export async function pendingProfileReceipts(files){
 for(const file of files){let r;try{r=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(!isSettled(r))throw Error('Unsettled profile receipt must be resolved before a new dispatch: '+file);
 }
}
export async function settleProfileDispatch({dispatch,poll,readDurable,deadline,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 let dispatchError,pollErrors=[];
 try{const r=await dispatch();if(isSettled(r))return {receipt:r,dispatchError,pollErrors};}catch(e){dispatchError=String(e);}
 // A command timeout does not cancel its native job. Never dispatch again here.
 while(now()<deadline-1000){
  try{const r=await readDurable();if(isSettled(r))return {receipt:r,dispatchError,pollErrors};}catch(e){pollErrors.push('durable: '+String(e));}
  try{const r=await poll();if(isSettled(r))return {receipt:r,dispatchError,pollErrors};}catch(e){pollErrors.push('host: '+String(e));}
  await sleep(250);
 }
 return {receipt:null,dispatchError,pollErrors:pollErrors.slice(-5)};
}
export function validateProfileReceipt(r){
 assert.ok(isSettled(r),'Native profile operation has not settled');assert.equal(r.status,'complete',r.error??JSON.stringify(r.cleanupErrors));
 assert.equal(r.result?.cases?.length,11);assert.deepEqual(r.result.counterDeltas,{a:3,b:3});assert.equal(r.postimages.length,11);
 for(const name of ['local-before-cleanup','fixtures-off','state','protections','local','files','manifests','readback'])assert.equal(r.restoration[name],true,name);
 assert.equal(r.wrapperConflict,false);assert.equal(r.manualFixtureRestoreConflict,undefined);assert.equal(r.manualTogglesViaFixture,3);
 assert.equal(r.casePending,null);assert.ok(r.baseline?.stateHash);return r;
}
export async function nativeProfileReadback(app,globals,key,doc,getWindowId,digest){
 const j=globals[key],managerId='aigility-plugin-manager',ids=['aigility-manager-fixture-a','aigility-manager-fixture-b'];
 const guard=()=>{
  if(app.vault.getName()!=='Sandbox'||app.vault.adapter.getBasePath()!=='/Users/eme/Obsidian/Sandbox'||app.appId!=='d137282e82167d84'||app.workspace.containerEl.ownerDocument!==doc)throw Error('Independent primary Sandbox identity mismatch');
  if(!j||globals[key]!==j||j.status!=='complete'||j.cleanup?.pending!==false||app.plugins.plugins[managerId]!==j.pluginRef||j.pluginRef.runtime!==j.runtimeRef||!j.pluginRef._loaded||j.pluginRef.manifest.version!=='0.1.3'||getWindowId()!==j.primaryWindowId)throw Error('Completed own job/manager/window identity mismatch');
 };
 guard();const namespaces=[];
 for(const id of ids){guard();const exists=await app.vault.adapter.exists('.obsidian/plugins/'+id);guard();namespaces.push({id,exists,manifest:!!app.plugins.manifests[id],native:app.plugins.enabledPlugins.has(id),loaded:app.plugins.plugins[id]?._loaded===true});}
 const rt=j.runtimeRef,equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),local=Object.fromEntries(['recoveryReason','operationPending','deviceProfileId','appliedProfileId'].map(k=>[k,rt.local[k]??null]));
 const foreign=Object.entries(app.plugins.manifests).filter(([id])=>!ids.includes(id)).map(([id,m])=>({id,version:m.version??null,native:app.plugins.enabledPlugins.has(id),loaded:app.plugins.plugins[id]?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
 const core=Object.entries(app.internalPlugins.plugins).map(([id,w])=>({id,enabled:w.enabled===true,loaded:w.instance?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
 if(digest(JSON.stringify(rt.state))!==j.baseline.stateHash||!equal(local,j.baseline.local)||!equal(foreign,j.baseline.foreign)||!equal(core,j.baseline.core))throw Error('Independent configuration/native/core readback mismatch; preserve current state');
 const leaves=[];app.workspace.iterateAllLeaves(l=>leaves.push(l.id));const s=app.setting,nowSettings={modal:s?.modalEl,doc:s?.doc,active:s?.activeTab,tab:s?.lastTabId,connected:s?.modalEl?.isConnected===true};
 if(app.workspace.activeLeaf!==j.workspaceRef||!equal(leaves,j.baseline.leaves)||Object.keys(nowSettings).some(k=>nowSettings[k]!==j.settingsRef[k]))throw Error('Independent workspace/Settings readback mismatch; preserve current UI');
 guard();return {at:new Date().toISOString(),version:j.pluginRef.manifest.version,stateHash:j.baseline.stateHash,recoveryReason:local.recoveryReason,binding:local.deviceProfileId,foreignCount:foreign.length,coreCount:core.length,namespaces};
}
export async function run(){
 assert.equal(process.env.AIGILITY_SANDBOX_PROFILES_AUTHORIZED,'1','Explicit new native profile lease required');
 const lease=profileLease({leaseId:process.env.AIGILITY_PROFILE_LEASE_ID,ackUTC:process.env.AIGILITY_PROFILE_ACK_UTC,startBy:Number(process.env.AIGILITY_PROFILE_START_BY)});
 const ready=JSON.parse(await readFile(path.join(ROOT,'evidence/sandbox-profiles-v013-ready.json'),'utf8'));
 assert.equal(ready.status,'ready-offline-profiles-v013');
 for(const [file,sha]of Object.entries(ready.checkFiles))assert.equal(hash(await readFile(path.join(ROOT,file))),sha,'Frozen acceptance file changed: '+file);
 for(const [file,sha]of Object.entries(ready.files))assert.equal(hash(await readFile(path.join(VAULT_PATH,'.obsidian/plugins',MANAGER_ID,file))),sha,'Installed build changed: '+file);
 const key='aigility-manager-profile:'+lease.leaseId,dir=path.join(ROOT,'evidence/native-profiles-v013');await mkdir(dir,{recursive:true});
 await pendingProfileReceipts((await readdir(dir)).filter(n=>n.endsWith('.receipt.json')).map(n=>path.join(dir,n)));
 const receiptPath=path.join(dir,lease.leaseId+'.receipt.json');
 const metadata={key,...lease,status:'dispatch-prepared',phase:'parent-preflight',cleanup:{pending:true},totalMs:TOTAL_MS,cleanupMs:CLEANUP_MS};
 await persistNewReceipt(receiptPath,metadata); // Exclusive wx + file and directory fsync BEFORE the first CLI.
 const host=async(body,deadline)=>{
  assert.ok(Date.now()<deadline,'Native lease expired');
  const code=`(async()=>{try{if(app.vault.getName()!==${JSON.stringify(VAULT)}||app.vault.adapter.getBasePath()!==${JSON.stringify(VAULT_PATH)}||app.appId!==${JSON.stringify(APP_ID)}||app.workspace.containerEl.ownerDocument!==document)throw Error('Wrong native primary Sandbox identity');const value=await(async()=>{${body}})();return JSON.stringify({ok:true,value});}catch(error){return JSON.stringify({ok:false,error:String(error)});}})()`;
  new Function('return '+code);
  const {stdout}=await execute(OBSIDIAN,[`vault=${VAULT}`,'eval',`code=${code}`],{timeout:Math.min(15000,Math.max(1,deadline-Date.now())),maxBuffer:2*1024*1024});
  const response=parseCliJson(stdout);assert.ok(response.ok,response.error);return response.value;
 };
 const outcome=await settleProfileDispatch({deadline:lease.deadline,
  dispatch:()=>host(`return await (${profileControllerBody(key,lease.actionDeadline,lease.deadline,receiptPath,true)})();`,lease.actionDeadline),
  readDurable:()=>readFile(receiptPath,'utf8').then(JSON.parse),
  poll:()=>host(`return globalThis[${JSON.stringify(key)}]??null;`,lease.deadline),
 });
 if(!outcome.receipt){console.log(JSON.stringify({status:'pending',receiptPath,...outcome}));throw Error('Same profile job remains unresolved. No new dispatch or rollback permitted.');}
 let r=JSON.parse(await readFile(receiptPath,'utf8'));assert.equal(r.key,key);
 Object.assign(r,outcome.receipt,{key,...lease,dispatchError:outcome.dispatchError,pollErrors:outcome.pollErrors});
 if(r.status==='complete'){
  try{
   r.independentReadback=await host(`return await (${nativeProfileReadback.toString()})(app,globalThis,${JSON.stringify(key)},document,()=>require('@electron/remote').getCurrentWindow().id,v=>require('crypto').createHash('sha256').update(v).digest('hex'));`,lease.deadline);
   assert.equal(r.independentReadback.binding,null);assert.ok(r.independentReadback.recoveryReason);
   for(const ns of r.independentReadback.namespaces)for(const flag of ['exists','manifest','native','loaded'])assert.equal(ns[flag],false,ns.id+'/'+flag);
  }catch(error){r.parentVerificationError=String(error);r.status='verification-pending';r.cleanup={pending:true};}
 }
 const handle=await open(receiptPath,'w');try{await handle.writeFile(JSON.stringify(r,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 if(isSettled(r))await writeFile(path.join(ROOT,'evidence/sandbox-profiles-v013.json'),JSON.stringify(r,null,2)+'\n');
 console.log(JSON.stringify({status:r.status,cases:r.result?.cases?.length,counters:r.result?.counterDeltas,restoration:r.restoration,error:r.error??r.parentVerificationError,receiptPath}));
 validateProfileReceipt(r);return r;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(e=>{console.error(String(e));process.exitCode=1;});
