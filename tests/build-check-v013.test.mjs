import test from 'node:test';
import assert from 'node:assert/strict';
import {TOTAL_MS,CLEANUP_MS,reloadBody,pendingDeploymentIds} from '../checks/sandbox-build-v013.check.mjs';
test('v013 deployment import is inert before authorization',()=>{assert.equal(TOTAL_MS,120000);assert.equal(CLEANUP_MS,35000);});
test('v013 forward reload stops after disable when its lease expires',async()=>{
 const Async=Object.getPrototypeOf(async function(){}).constructor;let now=100;const calls=[],globals={};
 const app={plugins:{async disablePlugin(){calls.push('disable');now=201;},async loadManifest(){calls.push('manifest');},async enablePlugin(){calls.push('enable');},plugins:{}}};
 const run=new Async('app','globalThis','Date','let value;'+reloadBody('aigility-manager-deploy:v013','forward',200));
 await assert.rejects(()=>run(app,globals,class extends Date{static now(){return now;}}),/deadline/);assert.deepEqual(calls,['disable']);assert.equal(globals['aigility-manager-deploy:v013'].status,'failed');
});
test('v013 rollback remains observable under its own token and touches only manager manifest',async()=>{
 const Async=Object.getPrototypeOf(async function(){}).constructor,globals={'aigility-manager-deploy:forward-v013':{status:'complete'}},calls=[];
 let release;const held=new Promise(r=>release=r);
 const app={plugins:{async disablePlugin(id){calls.push(id);await held;},async loadManifest(folder){assert.equal(folder,'.obsidian/plugins/aigility-plugin-manager');calls.push(folder);},async enablePlugin(id){calls.push(id);},plugins:{'aigility-plugin-manager':{_loaded:true}}}};
 const run=new Async('app','globalThis','let value;'+reloadBody('aigility-manager-deploy:rollback-v013','rollback',Date.now()+10000));
 const pending=run(app,globals);assert.deepEqual(pendingDeploymentIds(globals),['aigility-manager-deploy:rollback-v013']);release();await pending;assert.equal(calls.length,3);assert.equal(globals['aigility-manager-deploy:rollback-v013'].status,'complete');
});
