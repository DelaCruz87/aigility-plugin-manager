import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {ROOT,VAULT_PATH,MANAGER_ID,hash,cli} from '../scripts/sandbox-community.mjs';
const SOURCE=path.join(VAULT_PATH,'.obsidian/plugins',MANAGER_ID);
const ORIGINAL=path.join(SOURCE,'migration-backups/2026-10-01T12-59-31-333Z');
const TARGET='enso-secret-placeholders';
export function getAt(s,p){for(const k of p){if(s==null)return undefined;s=s[k];}return s;}
export function repairPatches(current,original){
 const patches=[];
 function walk(node,p=[]){
  if(Array.isArray(node)){node.forEach((v,i)=>walk(v,[...p,i]));return;}
  if(!node||typeof node!=='object')return;
  for(const [k,v] of Object.entries(node)){
   const next=[...p,k];
   if(v==='[redacted]'&&(k.startsWith('community:')||k.startsWith('core:')||p.at(-1)==='pluginStates')){
    const value=getAt(original,next);
    assert(value!==undefined&&value!=='[redacted]','Missing original identity value: '+JSON.stringify(next));
    if(p[0]==='records')assert(value?.ref?.kind==='community'&&value.ref.id===TARGET,'Unexpected record repair');
    else assert.equal(typeof value,'boolean','Original membership must be a boolean');
    if(p[0]==='fixtureProfiles')assert.equal(current.fixtureProfiles[p[1]]?.id,original.fixtureProfiles[p[1]]?.id,'Fixture identity changed');
    if(p[0]==='legacyBpm'&&p[1]==='COMMAND_PROFILES')assert.equal(current.legacyBpm.COMMAND_PROFILES[p[2]]?.id,original.legacyBpm.COMMAND_PROFILES[p[2]]?.id,'Legacy fixture identity changed');
    patches.push({path:next,before:v,after:value});
   }else walk(v,next);
  }
 }
 walk(current);return patches;
}
export function repairBody(patches,deadline){
 return `let repaired;await rt.enqueue('sandbox-redaction-repair',async tx=>{const s=await tx.refresh();const patches=${JSON.stringify(patches)};const get=(p)=>p.reduce((v,k)=>v?.[k],s);for(const p of patches){if(JSON.stringify(get(p.path))!==JSON.stringify(p.before))throw Error('Repair preimage changed: '+JSON.stringify(p.path));}if(Date.now()>=${deadline})throw Error('Repair deadline exceeded');for(const p of patches){get(p.path.slice(0,-1))[p.path.at(-1)]=p.after;}await tx.save();repaired=patches.length;__deploymentJob.repairApplied=true;});value={patchCount:repaired};`;
}
export function reverseRepairBody(patches,deadline){
 return `const path='.obsidian/plugins/aigility-plugin-manager/data.json';const adapter=app.vault.adapter;const before=await adapter.read(path);const s=JSON.parse(before);const patches=${JSON.stringify(patches)};const get=(p)=>p.reduce((v,k)=>v?.[k],s);let reverted=0;for(const p of patches){if(JSON.stringify(get(p.path))===JSON.stringify(p.after)){get(p.path.slice(0,-1))[p.path.at(-1)]=p.before;reverted++;}}const fresh=await adapter.read(path);if(fresh!==before)throw Error('Repair rollback disk preimage changed');if(Date.now()>=${deadline})throw Error('Repair rollback deadline exceeded');await adapter.write(path,JSON.stringify(s));if(await adapter.read(path)!==JSON.stringify(s))throw Error('Repair rollback readback failed');value={reverted,conflicts:patches.length-reverted};`;
}
export function applyPatches(current,patches){
 const next=structuredClone(current);
 for(const patch of patches){
  assert.deepEqual(getAt(next,patch.path),patch.before,'Repair preimage changed');
  const parent=getAt(next,patch.path.slice(0,-1));
  assert(parent&&typeof parent==='object','Repair parent absent');
  parent[patch.path.at(-1)]=structuredClone(patch.after);
 }
 return next;
}
export async function prepare(){
 const raws={};
 for(const name of ['legacy-bpm.json','legacy-companion.json','community-plugins.json','core-plugins.json'])raws[name]=await readFile(path.join(ORIGINAL,name),'utf8');
 const currentRaw=await readFile(path.join(SOURCE,'data.json'),'utf8');
 const current=JSON.parse(currentRaw),bpm=JSON.parse(raws['legacy-bpm.json']),companion=JSON.parse(raws['legacy-companion.json']);
 const manifestRaw=await readFile(path.join(VAULT_PATH,'.obsidian/plugins',TARGET,'manifest.json'),'utf8'),manifest=JSON.parse(manifestRaw);
 assert.equal(manifest.id,TARGET);
 const native=JSON.parse(raws['community-plugins.json']);assert(native.includes(TARGET),'Historical native activation must be explicit for target');
 const out=path.join(ROOT,'evidence/local-backups/redaction-proposal-'+Date.now());await mkdir(out,{recursive:true});
 const migrationModule=path.join(out,'migration.mjs');
 await build({absWorkingDir:ROOT,entryPoints:['src/integrated/migration.ts'],bundle:true,format:'esm',platform:'node',outfile:migrationModule});
 const {migrateLegacy}=await import(pathToFileURL(migrationModule).href);
 const original=migrateLegacy(bpm,companion,[{ref:{kind:'community',id:TARGET},name:manifest.name,version:manifest.version,installed:true,compatible:true,nativeAutostart:true,loaded:false}],current.migration.migratedAt);
 const patches=repairPatches(current,original);
 assert.equal(patches.filter(x=>x.path[0]==='records').length,1);
 const after=applyPatches(current,patches);
 const projected=structuredClone(after);for(const p of patches)getAt(projected,p.path.slice(0,-1))[p.path.at(-1)]=p.before;
 assert.deepEqual(projected,current,'Non-repair data must remain unchanged');
 const packet={schemaVersion:1,preparedAt:new Date().toISOString(),expectedStateHash:hash(currentRaw),sourceHashes:Object.fromEntries(Object.entries(raws).map(([k,v])=>[k,hash(v)])),manifestHash:hash(manifestRaw),target:TARGET,patches};
 await writeFile(path.join(out,'proposal.json'),JSON.stringify(packet,null,2)+'\n');
 const receipt={status:'prepared-offline-no-host-write',at:packet.preparedAt,proposal:path.relative(ROOT,path.join(out,'proposal.json')),expectedStateHash:packet.expectedStateHash,sourceHashes:packet.sourceHashes,manifestHash:packet.manifestHash,patchCount:patches.length,patches:patches.map(p=>({path:p.path,beforeType:typeof p.before,afterType:typeof p.after})),foreignDataPreserved:true,nativeChanged:false};
 await writeFile(path.join(ROOT,'evidence/redaction-recovery.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({status:receipt.status,patchCount:receipt.patchCount,proposal:receipt.proposal}));return receipt;
}
export async function observe(){
 const result=await cli(`const r=rt.state.records['community:enso-secret-placeholders'];value={at:new Date().toISOString(),loaded:P._loaded,build:P.managerBuild,recordType:typeof r,recordRef:r&&typeof r==='object'?r.ref:null,fixturesWithInvalidMembers:rt.state.fixtureProfiles.filter(f=>Object.values(f.members).some(v=>typeof v!=='boolean')).map(f=>f.id),local:localOf(),target:{native:app.plugins.enabledPlugins.has('enso-secret-placeholders'),loaded:app.plugins.plugins['enso-secret-placeholders']?._loaded===true},debug:rt.state.debug?.active===true};`);
 await writeFile(path.join(ROOT,'evidence/redaction-runtime-observation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){(process.argv.includes('--observe')?observe():prepare()).catch(e=>{console.error(e.message);process.exitCode=1;});}
