import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash,chooseProtectedCleanup,localRestorePatch,assertBudget,TOTAL_MS,CLEANUP_MS,pendingDeploymentIds,jobBody,reloadBody} from '../checks/sandbox-build.check.mjs';
test('import is inert and does not require native authorization',()=>{assert.equal(TOTAL_MS,120000);assert.equal(CLEANUP_MS,35000);});
test('selective protection cleanup preserves baseline and foreign additions',()=>{assert.deepEqual(chooseProtectedCleanup(['community:original'],['community:test'],['community:original','community:test','core:new-foreign']),['community:original','core:new-foreign']);});
test('cleanup never removes a baseline protection even if mistakenly listed as added',()=>{assert.deepEqual(chooseProtectedCleanup(['core:search'],['core:search'],['core:search']),['core:search']);});
test('local cleanup restores only its matching postimage',()=>{const before={recoveryReason:'original',deviceProfileId:null},post={recoveryReason:'test',deviceProfileId:null};assert.deepEqual(localRestorePatch(before,post,{recoveryReason:'test',deviceProfileId:'user-new'}),{patch:{recoveryReason:'original'},conflicts:[]});assert.deepEqual(localRestorePatch(before,post,{recoveryReason:'user-error'}),{patch:{},conflicts:['recoveryReason']});});
test('budget prevents new mutations inside cleanup reserve',()=>{assert.equal(assertBudget(120000,35000,80000),40000);assert.throws(()=>assertBudget(120000,35000,85000));assert.throws(()=>assertBudget(120000,0,120000));});
test('same profile count does not imply preserved definitions',()=>{const a=[{id:'macbook',tags:['macbook']}],b=[{id:'macbook',tags:['zenbook']}];assert.notEqual(canonicalHash(a),canonicalHash(b));});
test('canonical profile content tolerates object key order but detects membership order',()=>{assert.equal(canonicalHash([{id:'p',applyAtStart:true}]),canonicalHash([{applyAtStart:true,id:'p'}]));assert.notEqual(canonicalHash(['a','b']),canonicalHash(['b','a']));});

test('pending async deployment is detected before another operation starts',()=>{assert.deepEqual(pendingDeploymentIds({'aigility-manager-deploy:old':{status:'pending'},'aigility-manager-deploy:done':{status:'complete'},foreign:{status:'pending'}}),['aigility-manager-deploy:old']);});
test('reload deadline checked after disable prevents subsequent native mutations',async()=>{
 const FakeAsync=Object.getPrototypeOf(async function(){}).constructor,globals={},calls=[];
 let now=100;
 const app={plugins:{
   async disablePlugin(){calls.push('disable');now=201;},
   async loadManifest(folder){assert.equal(folder,'.obsidian/plugins/aigility-plugin-manager');calls.push('manifests');},
   async enablePlugin(){calls.push('enable');},plugins:{},
 }};
 const run=new FakeAsync('app','globalThis','Date','let value;'+reloadBody('aigility-manager-deploy:forward','forward-reload',200)+'return value;');
 await assert.rejects(()=>run(app,globals,class extends Date{static now(){return now;}}),/deadline/);
 assert.deepEqual(calls,['disable']);
 assert.equal(globals['aigility-manager-deploy:forward'].status,'failed');
});
test('reload deadline checked after manifest load prevents enabling after expiry',async()=>{
 const FakeAsync=Object.getPrototypeOf(async function(){}).constructor,globals={},calls=[];
 let now=100;
 const app={plugins:{
   async disablePlugin(){calls.push('disable');},
   async loadManifest(folder){assert.equal(folder,'.obsidian/plugins/aigility-plugin-manager');calls.push('manifests');now=201;},
   async enablePlugin(){calls.push('enable');},plugins:{},
 }};
 const run=new FakeAsync('app','globalThis','Date','let value;'+reloadBody('aigility-manager-deploy:forward','forward-reload',200)+'return value;');
 await assert.rejects(()=>run(app,globals,class extends Date{static now(){return now;}}),/deadline/);
 assert.deepEqual(calls,['disable','manifests']);
});
test('rollback uses its own pending token while forward is already settled',async()=>{
 const FakeAsync=Object.getPrototypeOf(async function(){}).constructor;
 const globals={'aigility-manager-deploy:forward':{status:'complete'}};
 let release;const held=new Promise(r=>release=r);
 const app={plugins:{async disablePlugin(){await held;},async loadManifest(folder){},async enablePlugin(){},plugins:{'aigility-plugin-manager':{_loaded:true}}}};
 const run=new FakeAsync('app','globalThis','let value;'+reloadBody('aigility-manager-deploy:rollback','rollback-reload',Date.now()+10000)+'return value;');
 const pending=run(app,globals);
 assert.deepEqual(pendingDeploymentIds(globals),['aigility-manager-deploy:rollback']);
 assert.equal(globals['aigility-manager-deploy:forward'].status,'complete');
 release();await pending;
 assert.equal(globals['aigility-manager-deploy:rollback'].status,'complete');
});
test('actual native job wrapper persists success and failure phases without another execution',async()=>{const FakeAsync=Object.getPrototypeOf(async function(){}).constructor;const globals={};const body=jobBody('aigility-manager-deploy:test','protect','value={ok:true}',Date.now()+10000);const exec=new FakeAsync('globalThis','let value;'+body+'return value;');assert.deepEqual(await exec(globals),{ok:true});assert.equal(globals['aigility-manager-deploy:test'].status,'complete');const bad=new FakeAsync('globalThis','let value;'+jobBody('aigility-manager-deploy:bad','protect',"throw Error('disk failure')",Date.now()+10000));await assert.rejects(()=>bad(globals),/disk failure/);assert.equal(globals['aigility-manager-deploy:bad'].status,'failed');});
