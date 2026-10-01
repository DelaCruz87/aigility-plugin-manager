#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const execFileAsync = promisify(execFile), ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OBSIDIAN = '/opt/homebrew/bin/obsidian', VAULT = 'Sandbox', VAULT_PATH = '/Users/eme/Obsidian/Sandbox', APP_ID = 'd137282e82167d84';
const ID = 'aigility-plugin-manager', SRC = ['main.js', 'manifest.json', 'styles.css'];
const LEGACY = ['better-plugins-manager', 'better-plugins-manager-companion'];
const PLUGIN_DIR = `${VAULT_PATH}/.obsidian/plugins/${ID}`, TARGET = `${VAULT_PATH}/.obsidian/plugins`;
const EVIDENCE = path.join(ROOT, 'evidence/sandbox-stage.json');
const hash = b => createHash('sha256').update(b).digest('hex');
const parseCliJson = output => { const text=output.trim();if(!text)throw Error('Obsidian CLI returned no eval response; Sandbox must be open and responsive.');const i=text.indexOf('=> '); try{return JSON.parse((i<0?text:text.slice(i+3)).trim());}catch{throw Error(`Obsidian eval returned malformed JSON: ${text.slice(0,1000)}`);} };
async function cli(code) {
  const {stdout}=await execFileAsync(OBSIDIAN,[`vault=${VAULT}`,'eval',`code=(async()=>{${code}})()`],{timeout:60000,maxBuffer:12*1024*1024});
  const out=parseCliJson(stdout); if(!out?.ok) throw Error(out?.error||'Sandbox eval failed.'); return out.value;
}
async function sourceHashes(){return Object.fromEntries(await Promise.all(SRC.map(async f=>[f,hash(await readFile(path.join(ROOT,f)))])));}
async function snapshot() {
  return cli(`try{
    const identity={name:app.vault.getName(),basePath:app.vault.adapter.getBasePath(),appId:app.appId};
    if(identity.name!==${JSON.stringify(VAULT)}||identity.basePath!==${JSON.stringify(VAULT_PATH)}||identity.appId!==${JSON.stringify(APP_ID)})throw Error('Sandbox identity mismatch');
    const manifests=app.plugins?.manifests||{}, loaded=id=>app.plugins?.plugins?.[id]?._loaded===true;
    const community=Object.entries(manifests).map(([id,m])=>({id,version:m.version??null,nativeEnabled:app.plugins.enabledPlugins?.has(id)===true,loaded:loaded(id)})).sort((a,b)=>a.id.localeCompare(b.id));
    const core=Object.entries(app.internalPlugins?.plugins||{}).map(([id,w])=>({id,enabled:w.enabled===true,loaded:w.instance?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
    const ownPresent=!!manifests[${JSON.stringify(ID)}];
    const value={identity,community,core,nativeIds:Object.keys(manifests).sort(),ownPresent,legacy:Object.fromEntries(${JSON.stringify(LEGACY)}.map(id=>[id,{manifest:!!manifests[id],nativeEnabled:app.plugins.enabledPlugins?.has(id)===true,loaded:loaded(id)}]))};
    return JSON.stringify({ok:true,value});
  }catch(error){return JSON.stringify({ok:false,error:String(error?.message||error)});}`);
}
const obj = s => {try{const v=JSON.parse(s);return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}};
const cmp = (a,b) => {const x=String(a).split(/[.-]/).slice(0,3).map(n=>parseInt(n,10)||0),y=String(b).split(/[.-]/).slice(0,3).map(n=>parseInt(n,10)||0);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
function assert(ok,msg){if(!ok)throw Error(msg);}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function hasRedactedSecrets(node){if(Array.isArray(node))return node.every(hasRedactedSecrets);if(!node||typeof node!=='object')return true;return Object.entries(node).every(([k,v])=>/token|secret|password|api[-_]?key|credential|authorization/i.test(k)?v==='[redacted]':hasRedactedSecrets(v));}

export async function run() {
  assert(process.env.AIGILITY_SANDBOX_RUN_AUTHORIZED==='1','Set AIGILITY_SANDBOX_RUN_AUTHORIZED=1 to perform the authorized one-time installation.');
  let priorEvidence=null;try{priorEvidence=JSON.parse(await readFile(EVIDENCE,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  assert(!priorEvidence||(priorEvidence.mode==='run'&&priorEvidence.status==='failed'&&priorEvidence.installAttempted===false&&priorEvidence.receipts?.length===0),'Refusing to overwrite existing stage evidence or resume after writes.');
  const manifest=JSON.parse(await readFile(path.join(ROOT,'manifest.json'),'utf8'));
  assert(manifest.id===ID&&manifest.version,'Source manifest identity/version invalid.');
  const source=await sourceHashes(), evidence=priorEvidence||{schemaVersion:1,mode:'run',status:'running',capturedAt:new Date().toISOString(),identity:null,sourceHashes:source,receipts:[]};
  evidence.status='running';evidence.error=undefined;evidence.capturedAt=new Date().toISOString();evidence.sourceHashes=source;
  let changed=false;
  const persist=async()=>writeFile(EVIDENCE,JSON.stringify(evidence,null,2)+'\n',{flag:'w'});
  async function ownedWrite(target,bytes){
    const expected=hash(bytes);let before=null;try{before=hash(await readFile(target));}catch{}
    assert(before===null,`Refusing to overwrite existing owned target: ${target}`);
    const receipt={target,beforeHash:null,afterExpectedHash:expected,afterHash:null};evidence.receipts.push(receipt);await persist();
    await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
    receipt.afterHash=hash(await readFile(target));assert(receipt.afterHash===expected,`Readback hash mismatch: ${target}`);await persist();
  }
  try {
    const before=await snapshot();evidence.identity=before.identity;
    const sandboxFiles=['.obsidian/plugins/better-plugins-manager/data.json','.obsidian/plugins/better-plugins-manager-companion/data.json','.obsidian/community-plugins.json','.obsidian/core-plugins.json'];
    const raw=await Promise.all(sandboxFiles.map(f=>readFile(path.join(VAULT_PATH,f),'utf8')));
    [before.bpmRaw,before.companionRaw,before.communityRaw,before.coreRaw]=raw;
    assert(!before.ownPresent,'Manager already exists in Sandbox registry.');
    assert(before.community.every(p=>p.id!==ID),'Manager already exists in community registry.');
    try{await stat(PLUGIN_DIR);throw Error('Manager plugin directory already exists in Sandbox.');}catch(e){if(e.code!=='ENOENT')throw e;}
    const mainBytes=await readFile(path.join(ROOT,'main.js')), manifestBytes=await readFile(path.join(ROOT,'manifest.json')), styleBytes=await readFile(path.join(ROOT,'styles.css'));
    assert(hash(mainBytes)===source['main.js']&&hash(manifestBytes)===source['manifest.json']&&hash(styleBytes)===source['styles.css'],'Build files changed after hash capture.');
    const observed=[];
    const hostInfo=await cli(`return JSON.stringify({ok:true,value:{apiVersion:app.apiVersion||null,community:Object.values(app.plugins.manifests||{}).map(m=>({id:m.id,name:m.name||m.id,version:m.version||'',minAppVersion:m.minAppVersion||'0',isDesktopOnly:m.isDesktopOnly===true})),core:Object.entries(app.internalPlugins?.plugins||{}).map(([id,w])=>({id,name:w.instance?.manifest?.name||id,version:w.instance?.manifest?.version||'',loaded:w.instance?._loaded===true,enabled:w.enabled===true}))}})`);
    // Compatibility stays provisional during migration; every operation revalidates the live host API and device constraints.
    for(const p of hostInfo.community){observed.push({ref:{kind:'community',id:p.id},name:p.name,version:p.version,installed:true,compatible:true,nativeAutostart:before.community.find(x=>x.id===p.id)?.nativeEnabled===true,loaded:before.community.find(x=>x.id===p.id)?.loaded===true});}
    for(const p of hostInfo.core){observed.push({ref:{kind:'core',id:p.id},name:p.name,version:p.version,installed:true,compatible:true,nativeAutostart:p.enabled,loaded:p.loaded});}
    const tmp=path.join('/private/tmp',`aigility-migration-${process.pid}.mjs`);
    await esbuild.build({entryPoints:[path.join(ROOT,'src/integrated/migration.ts')],bundle:true,platform:'node',format:'esm',outfile:tmp});
    const {migrateLegacy}=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
    await rm(tmp,{force:true});
    const bpm=obj(before.bpmRaw),companion=obj(before.companionRaw),state=migrateLegacy(bpm,companion,observed);
    state.protected=[...new Set([...state.protected,...before.community.map(p=>`community:${p.id}`),...before.core.map(p=>`core:${p.id}`),`community:${ID}`])];
    assert(state.schemaVersion===1&&state.deviceProfiles.length===7,'Migration did not produce the expected schema/device profiles.');
    assert(state.fixtureProfiles.length===(Array.isArray(bpm.COMMAND_PROFILES)?bpm.COMMAND_PROFILES.length:0),'Fixture count changed during migration.');
    assert(Array.isArray(state.tags)&&Array.isArray(state.groups)&&Array.isArray(state.deferred)&&Array.isArray(state.profileBackups),'Migrated state is incomplete.');
    assert(hasRedactedSecrets(state.legacyBpm),'Migrated state contains unredacted credential fields.');
    assert(state.records['community:omnisearch']?.desired===true,'Omnisearch effective desired state was not retained.');
    const when=new Date().toISOString().replace(/[:.]/g,'-'), backupDir=path.join(PLUGIN_DIR,'migration-backups',when);
    for(const [name,raw] of [['legacy-bpm.json',before.bpmRaw],['legacy-companion.json',before.companionRaw],['community-plugins.json',before.communityRaw],['core-plugins.json',before.coreRaw]])await ownedWrite(path.join(backupDir,name),Buffer.from(raw));
    const stateBytes=Buffer.from(JSON.stringify(state,null,2)+'\n');
    await ownedWrite(path.join(PLUGIN_DIR,'data.json'),stateBytes);
    for(const f of SRC)await ownedWrite(path.join(PLUGIN_DIR,f),await readFile(path.join(ROOT,f)));
    changed=true;
    const installed=await cli(`try{await app.plugins.loadManifests();const m=app.plugins.manifests[${JSON.stringify(ID)}];if(m?.version!==${JSON.stringify(manifest.version)})throw Error('Registry version mismatch');await app.plugins.enablePluginAndSave(${JSON.stringify(ID)});const p=app.plugins.plugins[${JSON.stringify(ID)}];await new Promise(r=>setTimeout(r,300));const rows=Object.entries(app.plugins.manifests||{}).filter(([id])=>id!==${JSON.stringify(ID)}).map(([id,m])=>({id,version:m.version??null,nativeEnabled:app.plugins.enabledPlugins?.has(id)===true,loaded:app.plugins.plugins?.[id]?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));const core=Object.entries(app.internalPlugins?.plugins||{}).map(([id,w])=>({id,enabled:w.enabled===true,loaded:w.instance?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));const ownData=await p.loadData();return JSON.stringify({ok:true,value:{version:m.version,loaded:p?._loaded===true,nativeEnabled:app.plugins.enabledPlugins?.has(${JSON.stringify(ID)})===true,community:rows,core,local:p.runtime?.local||null,ownData,legacy:Object.fromEntries(${JSON.stringify(LEGACY)}.map(id=>[id,{nativeEnabled:app.plugins.enabledPlugins?.has(id)===true,loaded:app.plugins.plugins?.[id]?._loaded===true}]))}})}catch(error){return JSON.stringify({ok:false,error:String(error?.message||error)})}`);
    assert(installed.version===manifest.version&&installed.loaded&&installed.nativeEnabled,'Manager did not reach loaded+enabled state.');
    assert(same(installed.community,before.community.map(p=>({...p,nativeEnabled:p.id===ID?true:p.nativeEnabled})).sort((a,b)=>a.id.localeCompare(b.id)).concat([]).filter(p=>p.id!==ID)),'Foreign community plugin rows changed.');
    assert(same(installed.core,before.core),'Core plugin rows changed.');
    assert(LEGACY.every(id=>installed.legacy[id]?.nativeEnabled===before.legacy[id]?.nativeEnabled&&installed.legacy[id]?.loaded===before.legacy[id]?.loaded),'Legacy manager state changed.');
    assert(installed.local?.recoveryReason,'Expected protected/deferred conflict recovery reason was not persisted.');
    assert(!installed.local?.deviceProfileId,'A local profile binding was created.');
    assert(installed.ownData?.schemaVersion===1&&installed.ownData.deviceProfiles?.length===7,'Seed state was not persisted as schema 1.');
    assert(installed.ownData.records?.['community:omnisearch']?.desired===true,'Persisted Omnisearch desired state changed.');
    assert(hasRedactedSecrets(installed.ownData.legacyBpm),'Persisted state contains credential data.');
    evidence.status='staged';evidence.installed=true;evidence.enabled=true;evidence.loaded=true;evidence.foreignPreserved=true;
    evidence.communityCount=before.community.length;evidence.coreCount=before.core.length;evidence.tagCount=installed.ownData.tags.length;
    evidence.groupCount=installed.ownData.groups.length;evidence.deviceProfileCount=installed.ownData.deviceProfiles.length;
    evidence.fixtureCount=installed.ownData.fixtureProfiles.length;evidence.deferredCount=installed.ownData.deferred.length;
    evidence.backupCount=installed.ownData.profileBackups.length;evidence.omnisearchDesired=true;evidence.omnisearchNativeEnabled=before.community.find(p=>p.id==='omnisearch')?.nativeEnabled===true;
    evidence.compatibilityPolicy='Runtime revalidates host API and desktop constraints before plugin operations.';
    evidence.recoveryReason=installed.local.recoveryReason;evidence.managerVersion=installed.version;evidence.backupHashes=Object.fromEntries(evidence.receipts.filter(r=>r.target.includes('migration-backups')).map(r=>[path.basename(r.target),r.afterHash]));
    await persist();return {ok:true,status:evidence.status,evidence:EVIDENCE,communityCount:evidence.communityCount,coreCount:evidence.coreCount,deviceProfileCount:evidence.deviceProfileCount,fixtureCount:evidence.fixtureCount,foreignPreserved:true};
  } catch(error) {evidence.status='failed';evidence.error=String(error.message||error);evidence.installAttempted=changed;await persist();throw error;}
}
export async function main(argv=process.argv.slice(2)) {
  if(argv.length!==1||argv[0]!=='--run')throw Error('Usage: sandbox-stage.mjs --run (authorized installation only).');
  return run();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().then(r=>process.stdout.write(JSON.stringify(r,null,2)+'\n')).catch(e=>{process.stderr.write(`${e.message}\n`);process.exitCode=1;});
