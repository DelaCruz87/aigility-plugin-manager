import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {profileLease,isSettled,pendingProfileReceipts,settleProfileDispatch,validateProfileReceipt,run} from '../checks/sandbox-profiles-v013.check.mjs';
const complete={status:'complete',phase:'settled',cleanup:{pending:false}};
test('profile lease is 180 seconds from ACK with 60 reserved and refuses invalid/late windows',()=>{
 const now=Date.now(),ackUTC=new Date(now-1000).toISOString(),leaseId='PM-PROFILES-test',startBy=now+5000;
 const r=profileLease({leaseId,ackUTC,startBy,now});assert.equal(r.deadline-Date.parse(ackUTC),180000);assert.equal(r.deadline-r.actionDeadline,60000);
 for(const delta of [{leaseId:'../escape'},{ackUTC:'invalid'},{ackUTC:new Date(now+100).toISOString()},{startBy:now},{now:now+121000,startBy:now+122000}])assert.throws(()=>profileLease({leaseId,ackUTC,startBy,now,...delta}));
});
test('unsettled or cleanup-pending cannot be reported as completed',()=>{for(const r of [null,{status:'complete'},{...complete,cleanup:{pending:true}},{...complete,phase:'cleanup'},{...complete,status:'verification-pending'}])assert.equal(isSettled(r),false);assert.equal(isSettled(complete),true);});
test('command timeout dispatches only once and reads the same pending operation until durable settled',async()=>{
 let dispatches=0,polls=0,reads=0,time=0;
 const r=await settleProfileDispatch({dispatch:async()=>{dispatches++;throw Error('CLI timed out');},poll:async()=>{polls++;return {status:'pending'};},readDurable:async()=>++reads===2?complete:{status:'pending'},deadline:10000,now:()=>time,sleep:async ms=>{time+=ms;}});
 assert.equal(dispatches,1);assert.equal(polls,1);assert.equal(r.receipt,complete);assert.match(r.dispatchError,/timed out/);
});
test('unresolved job stays pending without retries or rollback, including poll failure',async()=>{let calls=0,time=0;const r=await settleProfileDispatch({dispatch:async()=>{calls++;throw Error('unknown');},poll:async()=>{throw Error('unresponsive');},readDurable:async()=>({status:'pending'}),deadline:2000,now:()=>time,sleep:async ms=>{time+=ms;}});assert.equal(calls,1);assert.equal(r.receipt,null);assert.ok(r.pollErrors.length);});
test('predecessor durable pending receipts are preserved and block the next run',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'aigility-pending-')),file=path.join(dir,'old.receipt.json');try{await writeFile(file,JSON.stringify({status:'dispatch-prepared'}));await assert.rejects(pendingProfileReceipts([file]),/Unsettled/);await writeFile(file,JSON.stringify(complete));await pendingProfileReceipts([file]);}finally{await rm(dir,{recursive:true,force:true});}});
test('success requires actual 11 steps, counters, all cleanup fields and no wrapper conflict',()=>{const r={...complete,result:{cases:Array(11).fill('test'),counterDeltas:{a:3,b:3}},postimages:Array(11),restoration:Object.fromEntries(['local-before-cleanup','fixtures-off','state','protections','local','files','manifests','readback'].map(k=>[k,true])),wrapperConflict:false,manualTogglesViaFixture:3,casePending:null,baseline:{stateHash:'test'}};validateProfileReceipt(r);for(const delta of [{wrapperConflict:true},{casePending:{name:'pending'}},{result:{cases:[],counterDeltas:{a:3,b:3}}},{restoration:{...r.restoration,files:false}}])assert.throws(()=>validateProfileReceipt({...r,...delta}));});
test('imported runner without lease authorization refuses before native CLI or any files',async()=>{const previous=process.env.AIGILITY_SANDBOX_PROFILES_AUTHORIZED;delete process.env.AIGILITY_SANDBOX_PROFILES_AUTHORIZED;try{await assert.rejects(run(),/Explicit new native profile lease/);}finally{if(previous!==undefined)process.env.AIGILITY_SANDBOX_PROFILES_AUTHORIZED=previous;}});
