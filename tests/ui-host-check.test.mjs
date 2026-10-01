import test from 'node:test';
import assert from 'node:assert/strict';
import {uiGate,matchingRestore,uiBody,TOTAL_MS,CLEANUP_MS} from '../checks/sandbox-ui-v013.check.mjs';
test('native UI harness imports without running or opening Settings',()=>{assert.equal(TOTAL_MS,120000);assert.equal(CLEANUP_MS,35000);});
test('native UI deadline prevents next action at expiry',()=>{uiGate(101,100);assert.throws(()=>uiGate(100,100),/expired/);});
test('filter cleanup preserves a later manual edit',()=>{assert.deepEqual(matchingRestore({search:''},{search:'test'},{search:'test'}),{search:''});assert.equal(matchingRestore({search:''},{search:'test'},{search:'manual'}),null);});
test('serialized native UI body compiles with its own guard and cleanup helpers',()=>{const Async=Object.getPrototypeOf(async function(){}).constructor;assert.doesNotThrow(()=>new Async('app','globalThis','let value;'+uiBody('aigility-manager-ui:test',100,200,'/own/community.png','/own/downloaded.png')));});
