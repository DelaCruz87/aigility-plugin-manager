import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {cli,hash,ROOT,VAULT_PATH,MANAGER_ID,J,OBSIDIAN,VAULT,APP_ID,parseCliJson} from '../scripts/sandbox-community.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const deploymentKey='aigility-manager-deploy:0.1.1';
async function hostEval(body){
 const code=`(async()=>{try{if(app.vault.getName()!==${J(VAULT)}||app.vault.adapter.getBasePath()!==${J(VAULT_PATH)}||app.appId!==${J(APP_ID)})throw Error('Wrong vault for manager deployment');let value;${body};return JSON.stringify({ok:true,value});}catch(error){return JSON.stringify({ok:false,error:String(error?.message||error)});}})()`;
 const {stdout}=await execute(OBSIDIAN,[`vault=${VAULT}`,'eval',`code=${code}`],{timeout:15000,maxBuffer:1024*1024});
 const result=parseCliJson(stdout);assert(result.ok,result.error);return result.value;
}

// Executed only as a reviewed Ringer check. It updates the existing manager,
// never foreign namespaces, native configuration files, settings or leaves.
assert.equal(process.env.AIGILITY_SANDBOX_RUN_AUTHORIZED,'1');
const files=['main.js','manifest.json','styles.css'];
const dir=path.join(VAULT_PATH,'.obsidian/plugins',MANAGER_ID);
const receipt={status:'running',at:new Date().toISOString(),source:{},before:{},after:{}};
const out=path.join(ROOT,'evidence/sandbox-build.json');
const persist=()=>writeFile(out,JSON.stringify(receipt,null,2)+'\n');
const inspect=`value={foreign:foreignCommunity().filter(x=>x.id!==${J(MANAGER_ID)}),core:coreRows(),local:localOf(),profiles:rt.state.deviceProfiles.length,fixtures:rt.state.fixtureProfiles.length,debug:rt.state.debug?.active===true,settings:app.setting?.containerEl?.isShown?.()===true,loaded:P._loaded,native:app.plugins.enabledPlugins.has(${J(MANAGER_ID)}),version:P.manifest.version,build:P.managerBuild,archiveRoot:P.archive?.root??null,archiveReady:typeof P.archive?.archive==='function'};`;
const old={},next={};
let expectedVersion;
const jobRead=()=>hostEval(`value=globalThis[${J(deploymentKey)}]??null;`);
let changed=false;
try {
 const before=await cli(inspect);
 assert.equal(before.debug,false,'Active diagnostic session');
 assert.equal(before.settings,false,'Settings are in use');
 assert.equal(before.local.operationPending,null,'Pending recovery operation');
 assert.equal(before.local.deviceProfileId,null,'A device profile is bound; preserve its startup');
 assert.equal(before.loaded,true);assert.equal(before.native,true);
 // A synchronous renderer response does not prove its filesystem queue works.
 const fsReady=await cli(`const raw=await app.vault.adapter.read(P.manifest.dir+'/data.json');value=JSON.parse(raw).schemaVersion===1;`);
 assert.equal(fsReady,true,'Filesystem read must finish before any backup or update');
 receipt.hostBefore=before;
 const prior=await jobRead();assert(!prior||prior.status!=='pending','Prior manager-only reload is still pending; inspect same operation, do not retry');
 for(const file of files){old[file]=await readFile(path.join(dir,file));next[file]=await readFile(path.join(ROOT,file));receipt.before[file]=hash(old[file]);receipt.source[file]=hash(next[file]);}
 assert.equal(JSON.parse(next['manifest.json']).id,MANAGER_ID);
 expectedVersion=JSON.parse(next['manifest.json']).version;assert.equal(expectedVersion,'0.1.1');
 const backup=path.join(ROOT,'evidence/local-backups','sandbox-build-'+Date.now());
 await mkdir(backup,{recursive:true});
 for(const file of files)await writeFile(path.join(backup,file),old[file]);
 receipt.backup=path.relative(ROOT,backup);await persist();
 const protections=await cli(`let before,added,after;await rt.enqueue('sandbox-test-protect',async tx=>{const s=await tx.refresh();before=[...s.protected];const refs=[...Object.keys(app.plugins.manifests).filter(id=>id!==${J(MANAGER_ID)}&&!OWNJ.includes(id)).map(id=>'community:'+id),...Object.keys(app.internalPlugins.plugins).map(id=>'core:'+id)];added=refs.filter(k=>!before.includes(k)&&!before.includes(k.slice(k.indexOf(':')+1)));s.protected.push(...added);await tx.save();after=[...s.protected];});rt.pause('sandbox-build-update');value={before,added,after};`);
 receipt.temporaryProtections=protections;
 for(const key of protections.before)assert(protections.after.includes(key));
 for(const file of files){assert.equal(hash(await readFile(path.join(dir,file))),receipt.before[file],'Installed file changed: '+file);assert.equal(hash(await readFile(path.join(ROOT,file))),receipt.source[file],'Source build changed: '+file);}
 for(const file of files){await writeFile(path.join(dir,file),next[file]);changed=true;}
 for(const file of files)assert.equal(hash(await readFile(path.join(dir,file))),receipt.source[file]);
 // One eval retains the app reference across this manager-only reload.
 await hostEval(`const job={id:${J(deploymentKey)},startedAt:new Date().toISOString(),status:'pending'};globalThis[${J(deploymentKey)}]=job;try{await app.plugins.disablePlugin(${J(MANAGER_ID)});await app.plugins.loadManifests();await app.plugins.enablePlugin(${J(MANAGER_ID)});job.status='complete';job.loaded=app.plugins.plugins[${J(MANAGER_ID)}]?._loaded===true;}catch(error){job.status='failed';job.error=String(error);throw error;}value=job;`);
 const after=await cli(inspect);receipt.hostAfter=after;
 assert.deepEqual(after.foreign,before.foreign,'Foreign community state changed');
 assert.deepEqual(after.core,before.core,'Core state changed');
 assert.equal(after.profiles,before.profiles);assert.equal(after.fixtures,before.fixtures);
 assert.equal(after.loaded,true);assert.equal(after.native,true);assert(after.local.recoveryReason,'Late load must remain paused');
 assert.equal(after.version,expectedVersion);assert.equal(after.build,MANAGER_ID+'/'+expectedVersion);assert.equal(after.archiveRoot,'.obsidian/plugins/_archive');
 assert.equal(after.archiveReady,true,'The loaded module must expose the current archive implementation');
 for(const file of files){receipt.after[file]=hash(await readFile(path.join(dir,file)));assert.equal(receipt.after[file],receipt.source[file]);}
 receipt.status='passed';await persist();console.log(JSON.stringify({status:receipt.status,foreign:after.foreign.length,core:after.core.length,profiles:after.profiles,fixtures:after.fixtures,sourceHashes:receipt.source,recovery:after.local.recoveryReason}));
}catch(error){
 receipt.status='failed';receipt.error=String(error.message||error);
 if(changed){
  let job;try{job=await jobRead();receipt.operation=job;}catch(checkError){receipt.operationReadError=String(checkError);}
  if(job?.status==='pending'||!job){receipt.rollback='not attempted: reload unsettled or state unknown; preserve files and inspect same operation';}
  else {
   const unchanged=await Promise.all(files.map(async file=>hash(await readFile(path.join(dir,file)))===receipt.source[file]));
   if(unchanged.every(Boolean)){
    for(const file of files)await writeFile(path.join(dir,file),old[file]);
    receipt.rollback='old artifacts restored';
    try{await hostEval(`await app.plugins.disablePlugin(${J(MANAGER_ID)});await app.plugins.loadManifests();await app.plugins.enablePlugin(${J(MANAGER_ID)});value={loaded:app.plugins.plugins[${J(MANAGER_ID)}]?._loaded===true,version:app.plugins.plugins[${J(MANAGER_ID)}]?.manifest.version};`);receipt.rollback='old artifacts and module restored';}catch(rollbackError){receipt.rollbackError=String(rollbackError);}
   } else receipt.rollback='not attempted: artifacts changed externally';
  }
 }
 await persist();throw error;
}
