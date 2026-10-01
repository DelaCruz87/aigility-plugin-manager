import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ackWindow,
  dispatchOnce,
  waitClosed,
  casSettingsDecision,
  uiGate,
  matchingRestore,
  uiBody,
  TOTAL_MS,
  CLEANUP_MS
} from '../checks/sandbox-ui-v013.check.mjs';

test('native UI harness imports without running or opening Settings', () => {
  assert.equal(TOTAL_MS, 120000);
  assert.equal(CLEANUP_MS, 35000);
});

test('native UI deadline prevents next action at expiry', () => {
  uiGate(101, 100);
  assert.throws(() => uiGate(100, 100), /expired/);
});

test('filter cleanup preserves a later manual edit', () => {
  assert.deepEqual(matchingRestore({ search: '' }, { search: 'test' }, { search: 'test' }), { search: '' });
  assert.equal(matchingRestore({ search: '' }, { search: 'test' }, { search: 'manual' }), null);
});

test('serialized native UI body compiles with its own guard and cleanup helpers', () => {
  const Async = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new Async('app', 'globalThis', 'let value;' + uiBody('aigility-manager-ui:test', 100, 200, '/own/community.png', '/own/downloaded.png')));
});

test('ackWindow requires explicit inputs, computes deadlines, and validates conditions', () => {
  const baseTime = 1700000000000;
  const ackUTC = new Date(baseTime).toISOString();
  const startBy = baseTime + 10000;

  // Valid invocation
  const res = ackWindow({ leaseId: 'lease-123', ackUTC, startBy, now: baseTime + 5000 });
  assert.equal(res.leaseId, 'lease-123');
  assert.equal(res.deadline, baseTime + 120000);
  assert.equal(res.actionDeadline, baseTime + 120000 - 35000);

  // Missing or invalid leaseId
  assert.throws(() => ackWindow({ leaseId: '', ackUTC, startBy, now: baseTime }), /leaseId/);
  assert.throws(() => ackWindow({ leaseId: null, ackUTC, startBy, now: baseTime }), /leaseId/);

  // Invalid ackUTC
  assert.throws(() => ackWindow({ leaseId: 'l1', ackUTC: 'not-a-date', startBy, now: baseTime }), /ackUTC/);
  assert.throws(() => ackWindow({ leaseId: 'l1', ackUTC: null, startBy, now: baseTime }), /ackUTC/);

  // Expirations
  // now >= startBy
  assert.throws(() => ackWindow({ leaseId: 'l1', ackUTC, startBy, now: startBy }), /startBy expired/);
  assert.throws(() => ackWindow({ leaseId: 'l1', ackUTC, startBy, now: startBy + 1 }), /startBy expired/);

  // remaining <= 35000 (actionDeadline expired or below cleanup budget)
  const pastAction = baseTime + 120000 - 35000;
  assert.throws(() => ackWindow({ leaseId: 'l1', ackUTC, startBy: baseTime + 100000, now: pastAction }), /expired|cleanup/);
  assert.throws(() => ackWindow({ leaseId: 'l1', ackUTC, startBy: baseTime + 100000, now: pastAction + 5000 }), /expired|cleanup/);
});

test('dispatchOnce persists before dispatch and enforces single execution without automatic second call', async () => {
  const recorded = [];
  const persist = async (meta) => {
    recorded.push({ op: 'persist', meta: { ...meta } });
  };
  let dispatchCallCount = 0;
  const dispatch = async () => {
    dispatchCallCount++;
    recorded.push({ op: 'dispatch' });
    return { ok: true };
  };

  const metadata = { key: 'test-key-1', leaseId: 'lease-test' };
  const r = await dispatchOnce(persist, dispatch, metadata);
  assert.equal(dispatchCallCount, 1);
  assert.equal(r.ok, true);
  assert.equal(recorded[0].op, 'persist');
  assert.equal(recorded[0].meta.status, 'dispatch-prepared');
  assert.equal(recorded[1].op, 'dispatch');

  // Token reuse / collision check on globalThis
  await assert.rejects(async () => {
    await dispatchOnce(persist, dispatch, metadata);
  }, /Global key already registered/);
  assert.equal(dispatchCallCount, 1, 'Dispatch must not be called a second time');
  delete globalThis['test-key-1'];
});

test('dispatchOnce failure leaves receipt durable and does not retry on unknown failure', async () => {
  const recorded = [];
  const persist = async (meta) => {
    recorded.push({ op: 'persist', meta: { ...meta } });
  };
  let dispatchCallCount = 0;
  const failingDispatch = async () => {
    dispatchCallCount++;
    throw new Error('Simulated network/timeout error');
  };

  const metadata = { key: 'test-key-fail', leaseId: 'lease-fail' };
  await assert.rejects(async () => {
    await dispatchOnce(persist, failingDispatch, metadata);
  }, /Simulated network\/timeout error/);

  assert.equal(dispatchCallCount, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].op, 'persist');
  assert.equal(recorded[0].meta.status, 'dispatch-prepared');
  delete globalThis['test-key-fail'];
});

test('casSettingsDecision validates and enforces CAS decisions', () => {
  const priorTab = 'general';
  const ownedTab = 'community-plugins';
  const doc = {};
  const modalEl = {};

  // Clean match
  const pass = casSettingsDecision(priorTab, ownedTab, 'community-plugins', doc, doc, modalEl, modalEl);
  assert.equal(pass.ok, true);
  assert.equal(pass.conflict, false);
  assert.equal(pass.shouldRestoreTab, true);
  assert.equal(pass.shouldClose, true);
  assert.equal(pass.restoreTab, 'general');

  // Manual tab changed
  const conflictTab = casSettingsDecision(priorTab, ownedTab, 'appearance', doc, doc, modalEl, modalEl);
  assert.equal(conflictTab.ok, false);
  assert.equal(conflictTab.conflict, true);
  assert.equal(conflictTab.shouldRestoreTab, false);
  assert.equal(conflictTab.shouldClose, false);

  // Foreign doc or replaced modalEl
  const newDoc = {};
  const conflictDoc = casSettingsDecision(priorTab, ownedTab, 'community-plugins', doc, newDoc, modalEl, modalEl);
  assert.equal(conflictDoc.ok, false);
  assert.equal(conflictDoc.conflict, true);

  const newModal = {};
  const conflictModal = casSettingsDecision(priorTab, ownedTab, 'community-plugins', doc, doc, modalEl, newModal);
  assert.equal(conflictModal.ok, false);
  assert.equal(conflictModal.conflict, true);
});

test('waitClosed awaits condition asynchronously and respects deadline budget', async () => {
  let closed = false;
  let simulatedTime = 1000;
  const now = () => simulatedTime;
  const sleep = async (ms) => {
    simulatedTime += ms;
  };

  // Condition met within deadline
  let step = 0;
  const promise = waitClosed(() => {
    step++;
    return step >= 3;
  }, 1200, { now, sleep });
  const result = await promise;
  assert.equal(result, true);

  // Condition never met before deadline
  simulatedTime = 1000;
  await assert.rejects(
    () => waitClosed(() => false, 1100, { now, sleep }),
    /Timeout waiting for window\/modal to close/
  );
});

// Parent fault checks exercise the helpers actually serialized into the native procedure.
import {registerUIJob,validateUIIdentity,focusDecision} from '../checks/sandbox-ui-v013.check.mjs';
test('same UI token is never replaced, including a prepared predecessor',()=>{const g={old:{status:'dispatch-prepared'}},old=g.old;assert.throws(()=>registerUIJob(g,'old'),/exists/);assert.equal(g.old,old);const job=registerUIJob(g,'new');assert.equal(job.id,'new');assert.equal(g.new,job);});
test('real identity gate after a held await prevents next action when the vault changes',async()=>{let name='Sandbox',release;const held=new Promise(r=>release=r),g={},job=registerUIJob(g,'owned');const app={vault:{getName:()=>name,adapter:{getBasePath:()=>'/Users/eme/Obsidian/Sandbox'}},appId:'d137282e82167d84',plugins:{plugins:{'aigility-plugin-manager':{_loaded:true}}}};let mutations=0;const operation=(async()=>{validateUIIdentity(app,g,'owned',job);await held;validateUIIdentity(app,g,'owned',job);mutations++;})();name='ENSO';release();await assert.rejects(()=>operation,/identity/);assert.equal(mutations,0);});
test('real identity gate refuses an externally replaced pending token',()=>{const g={},job=registerUIJob(g,'owned'),app={vault:{getName:()=> 'Sandbox',adapter:{getBasePath:()=>'/Users/eme/Obsidian/Sandbox'}},appId:'d137282e82167d84',plugins:{plugins:{'aigility-plugin-manager':{_loaded:true}}}};g.owned={id:'owned',status:'pending'};assert.throws(()=>validateUIIdentity(app,g,'owned',job),/token changed/);});
test('focus cleanup refuses a later foreign focus instead of taking the current value as its own postimage',()=>{const before={electron:null,os:'com.openai.codex'},post={electron:7,os:'md.obsidian'};assert.deepEqual(focusDecision(before,post,{electron:8,os:'com.apple.Safari'}),{ok:false,conflict:true,restore:false});assert.equal(focusDecision(before,post,post).restore,true);assert.equal(focusDecision(before,before,before).restore,false);});
test('ACK-origin budget is not extended by a slow preflight or future ACK',()=>{const ackUTC='2026-10-01T20:00:00Z',base=Date.parse(ackUTC),startBy=base+300000;assert.throws(()=>ackWindow({leaseId:'own',ackUTC,startBy,now:base+85000}),/deadline|cleanup/);assert.throws(()=>ackWindow({leaseId:'own',ackUTC,startBy,now:base-1}),/future/);});
test('async close cannot report success until the actual modal disconnected',async()=>{let closed=false,release;const held=new Promise(r=>release=r);let done=false;const pending=waitClosed(()=>closed,Date.now()+10000,{sleep:()=>held}).then(()=>{done=true;});await Promise.resolve();assert.equal(done,false);closed=true;release();await pending;assert.equal(done,true);});
test('failed durable persistence prevents the native dispatch entirely',async()=>{let calls=0;await assert.rejects(()=>dispatchOnce(async()=>{throw Error('fsync failed');},async()=>calls++,{key:'durable-fault'}),/fsync/);assert.equal(calls,0);assert.equal(globalThis['durable-fault'],undefined);});

test('the serialized identity gate also rejects a newly loaded replacement manager instance',()=>{const g={},job=registerUIJob(g,'same-instance'),plugin={_loaded:true},app={vault:{getName:()=> 'Sandbox',adapter:{getBasePath:()=>'/Users/eme/Obsidian/Sandbox'}},appId:'d137282e82167d84',plugins:{plugins:{'aigility-plugin-manager':plugin}}};Object.defineProperty(job,'pluginRef',{value:plugin,enumerable:false});validateUIIdentity(app,g,'same-instance',job);app.plugins.plugins['aigility-plugin-manager']={_loaded:true};assert.throws(()=>validateUIIdentity(app,g,'same-instance',job),/instance replaced/);assert.equal(JSON.parse(JSON.stringify(job)).pluginRef,undefined);});

import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {primaryDocumentGate,layoutOwnershipGate,rejectPendingReceipts,persistNewReceipt} from '../checks/sandbox-ui-v013.check.mjs';
test('a pending predecessor receipt survives without dispatch or overwrite',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'aigility-ui-pending-')),file=path.join(dir,'prior.receipt.json'),raw=JSON.stringify({key:'prior',status:'pending'});try{await writeFile(file,raw);await assert.rejects(()=>rejectPendingReceipts([file]),/pending/);assert.equal(await readFile(file,'utf8'),raw);}finally{await rm(dir,{recursive:true,force:true});}});
test('exclusive fsynced receipt creation never truncates an existing lease',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'aigility-ui-receipt-')),file=path.join(dir,'own.receipt.json');try{await persistNewReceipt(file,{key:'own',status:'dispatch-prepared'});await assert.rejects(()=>persistNewReceipt(file,{key:'other'}),{code:'EEXIST'});assert.equal(JSON.parse(await readFile(file,'utf8')).key,'own');}finally{await rm(dir,{recursive:true,force:true});}});
test('primary document gate rejects the auxiliary Settings context and a different window',()=>{const main={},aux={},app={workspace:{containerEl:{ownerDocument:main}}};primaryDocumentGate(app,main,7,7);assert.throws(()=>primaryDocumentGate(app,aux,8,7),/Auxiliary/);assert.throws(()=>primaryDocumentGate(app,main,8,7),/window identity/);});
test('real ownership gate after capture refuses replacement doc and foreign tab before filter cleanup',async()=>{const doc={},modal={},settings={doc,modalEl:modal,lastTabId:'community-plugins'},owned={doc,modal,tab:'community-plugins'};let cleaned=0;layoutOwnershipGate(settings,owned);await Promise.resolve();settings.doc={};assert.throws(()=>{layoutOwnershipGate(settings,owned);cleaned++;},/ownership changed/);settings.doc=doc;settings.lastTabId='appearance';assert.throws(()=>{layoutOwnershipGate(settings,owned);cleaned++;},/ownership changed/);assert.equal(cleaned,0);});
