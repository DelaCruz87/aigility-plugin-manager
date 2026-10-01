import test from 'node:test';
import assert from 'node:assert/strict';
import {repairPatches,applyPatches,repairBody,reverseRepairBody} from '../checks/redaction-recovery.check.mjs';
test('repair targets damaged identity fields and preserves all other data',()=>{
 const before={records:{'community:enso-secret-placeholders':'[redacted]',other:{desired:false}},fixtureProfiles:[{members:{'community:token-tools':'[redacted]',ordinary:false}}],legacyBpm:{GITHUB_TOKEN:'[redacted]'}};
 const source={records:{'community:enso-secret-placeholders':{ref:{kind:'community',id:'enso-secret-placeholders'},desired:true}},fixtureProfiles:[{members:{'community:token-tools':true,ordinary:true}}],legacyBpm:{GITHUB_TOKEN:'DO NOT COPY'}};
 const patches=repairPatches(before,source);assert.equal(patches.length,2);
 const after=applyPatches(before,patches);assert.equal(after.fixtureProfiles[0].members.ordinary,false);assert.equal(after.legacyBpm.GITHUB_TOKEN,'[redacted]');assert.equal(after.records.other.desired,false);
 assert.equal(before.records['community:enso-secret-placeholders'],'[redacted]');
});
test('repair rejects unknown source values and non-boolean membership',()=>{
 assert.throws(()=>repairPatches({fixtureProfiles:[{members:{'community:token-tools':'[redacted]'}}]},{fixtureProfiles:[]}),/Missing original/);
 assert.throws(()=>repairPatches({fixtureProfiles:[{members:{'community:token-tools':'[redacted]'}}]},{fixtureProfiles:[{members:{'community:token-tools':'true'}}]}),/boolean/);
});
test('repair preserves valid manual edits and refuses a changed repair preimage',()=>{
 const state={fixtureProfiles:[{members:{'community:token-tools':false}}]};assert.deepEqual(repairPatches(state,{fixtureProfiles:[{members:{'community:token-tools':true}}]}),[]);
 assert.throws(()=>applyPatches(state,[{path:['fixtureProfiles',0,'members','community:token-tools'],before:'[redacted]',after:true}]),/preimage/);
});
test('repair refuses reordered fixture IDs even if the membership path exists',()=>{
 assert.throws(()=>repairPatches({fixtureProfiles:[{id:'edited-order',members:{'community:token-tools':'[redacted]'}}]},{fixtureProfiles:[{id:'original-order',members:{'community:token-tools':true}}]}),/identity/);
});
test('native repair uses fresh queued state and leaves unrelated changes untouched',async()=>{
 const s={fixtureProfiles:[{id:'p',members:{'community:token-tools':'[redacted]',foreign:false}}],settings:{foreign:true}};
 const patches=repairPatches(s,{fixtureProfiles:[{id:'p',members:{'community:token-tools':true}}]});let saves=0;
 const rt={async enqueue(label,fn){return fn({async refresh(){return s;},async save(){saves++;}});}};
 const F=Object.getPrototypeOf(async function(){}).constructor,job={};
 const run=new F('rt','__deploymentJob','let value;'+repairBody(patches,Date.now()+10000)+'return value;');
 assert.deepEqual(await run(rt,job),{patchCount:1});assert.equal(saves,1);assert.equal(job.repairApplied,true);assert.equal(s.settings.foreign,true);assert.equal(s.fixtureProfiles[0].members.foreign,false);
 await assert.rejects(()=>run(rt,{}),/preimage/);assert.equal(saves,1);
});
test('rollback reverses only matching own fields and keeps concurrent edits',async()=>{
 const patches=[{path:['members','community:token-tools'],before:'[redacted]',after:true},{path:['members','community:secret-tools'],before:'[redacted]',after:false}];
 let raw=JSON.stringify({members:{'community:token-tools':true,'community:secret-tools':true,foreign:false}});
 const app={vault:{adapter:{async read(){return raw;},async write(p,v){raw=v;}}}};
 const F=Object.getPrototypeOf(async function(){}).constructor;
 const run=new F('app','let value;'+reverseRepairBody(patches,Date.now()+10000)+'return value;');
 assert.deepEqual(await run(app),{reverted:1,conflicts:1});const after=JSON.parse(raw);assert.equal(after.members['community:token-tools'],'[redacted]');assert.equal(after.members['community:secret-tools'],true);assert.equal(after.members.foreign,false);
});
