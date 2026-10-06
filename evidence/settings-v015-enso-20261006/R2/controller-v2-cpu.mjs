import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createController} from './controller-v2.mjs';
import {deliverEnsoSettingsFix} from '/Users/eme/Obsidian/ENSO/Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/checks/settings-enso-delivery-20261006.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const code=fs.readFileSync(new URL('./controller-v2.mjs',import.meta.url));
const helper=fs.readFileSync('/Users/eme/Obsidian/ENSO/Tasks/+Ecosistema/+Applications/+PKM/+Obsidian/+Obsidian Plugins/+AIgility Plugin Manager/plugin/checks/settings-enso-delivery-20261006.mjs');
const fixtures=[];
function setup(token='cpu-token') {
  let time=Date.parse('2026-10-06T16:01:00Z'),fd=10,calls=0;
  const bytes=new Map(),fds=new Map(),events=[];
  const fakeFs={existsSync:p=>bytes.has(p),readFileSync:(p,enc)=>{assert(bytes.has(p),'missing '+p);return enc?bytes.get(p).toString():bytes.get(p);},openSync:(p,mode)=>{if(mode==='wx')assert(!bytes.has(p),'overwrite '+p);fds.set(++fd,p);events.push({op:'open',p,mode});return fd;},writeFileSync:(f,b)=>{const p=fds.get(f);bytes.set(p,Buffer.from(b));events.push({op:'write',p});},fsyncSync:f=>events.push({op:'fsync',p:fds.get(f)}),closeSync:f=>fds.delete(f)};
  const c={temp:'/fake',leasePath:'/lease',controllerPath:'/controller',controllerSha:hash(code),helperPath:'/helper',helperSha:hash(helper),loadedPath:'/loaded',loadedSha:hash('proof'),baselinePath:'/baseline',baselineSha:hash('baseline'),emittedSource:deliverEnsoSettingsFix.toString(),source:'/candidate',preimages:{},artifacts:{}};
  for(const[p,b]of [['/lease',token],['/controller',code],['/helper',helper],['/loaded','proof'],['/baseline','baseline']])bytes.set(p,Buffer.from(b));
  const transport=(command,args)=>{calls++;assert.equal(command,'obsidian');assert.deepEqual(args.slice(0,2),['vault=ENSO','eval']);new vm.Script(args[2].slice(5));events.push({op:'fake-dispatch',token,args:args.slice(0,2)});return '=> '+JSON.stringify(calls===1?{token,status:'running',pending:true}:{token,status:'SETTLED',pending:false});};
  const controller=createController(c,{fs:fakeFs,crypto,vm,execFileSync:transport,now:()=>time});
  const grant={token,leaseSha:hash(token),rootHardBy:new Date(time+300000).toISOString()};
  return {controller,c,grant,bytes,events,calls:()=>calls,advance:n=>time+=n};
}
const a=setup();const begun=a.controller.begin(a.grant);
assert.equal(a.controller.parameters(),begun.parameters);assert.equal(begun.returned.token,'cpu-token');
assert.equal(begun.parameters.actionBy,'2026-10-06T16:03:00.000Z');
assert.equal(begun.parameters.totalBy,'2026-10-06T16:04:00.000Z');
const dispatch=a.events.findIndex(e=>e.op==='fake-dispatch');
for(const p of ['/fake/control.json','/fake/parameters.json','/fake/first-action.json']) {
  const wi=a.events.findIndex(e=>e.op==='write'&&e.p===p);
  assert(wi>=0&&wi<dispatch);
  assert(a.events.slice(wi+1,dispatch).some(e=>e.op==='fsync'&&e.p===p));
  assert(a.events.slice(wi+1,dispatch).some(e=>e.op==='fsync'&&e.p==='/fake'));
}
assert.equal(a.controller.poll().status,'SETTLED');assert.equal(a.calls(),2);
assert.throws(()=>a.controller.begin(a.grant),/already acknowledged/);assert.equal(a.calls(),2);
a.bytes.set('/lease',Buffer.from('foreign-token'));assert.throws(()=>a.controller.poll(),/pin drift/);assert.equal(a.calls(),2);
fixtures.push('begin/guard shared state and SAME-token poll; ACK/params/first-action file+parent fsync precede transport; repeated Begin and foreign lease rejected');
for(const p of ['/controller','/loaded','/baseline','/helper']){const b=setup('pin-'+p);b.bytes.set(p,Buffer.from('changed'));assert.throws(()=>b.controller.begin(b.grant),/pin drift/);assert.equal(b.calls(),0);assert(!b.bytes.has('/fake/first-action.json'));}
fixtures.push('controller/proof/baseline/helper drift fails before first-action/transport');
const b=setup('clock');b.controller.begin(b.grant);b.advance(120000);assert.throws(()=>b.controller.poll(),/deadline/);assert.equal(b.calls(),1);
const c=setup('hard');c.grant.rootHardBy='2026-10-06T16:02:00.000Z';const cr=c.controller.begin(c.grant).parameters;assert.equal(cr.actionBy,c.grant.rootHardBy);assert.equal(cr.totalBy,c.grant.rootHardBy);
const d=setup('expired');d.advance(300000);assert.throws(()=>d.controller.begin(d.grant),/hard deadline/);assert.equal(d.calls(),0);
fixtures.push('fake clock action deadline, root hard cap clamp and expired root rejection');
const proof={at:new Date().toISOString(),kind:'CPU-only factory wiring verification',controllerSha:hash(code),helperSha:hash(helper),actualEmittedFunctionCompiled:true,nativeCalls:0,productTests:0,hostIO:0,passed:fixtures,events:a.events};
const path=new URL('./controller-v2-cpu-proof.json',import.meta.url);const pf=fs.openSync(path,'wx');try{fs.writeFileSync(pf,JSON.stringify(proof,null,2));fs.fsyncSync(pf);}finally{fs.closeSync(pf);}const parent=fs.openSync(new URL('.',import.meta.url),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
console.log(JSON.stringify({PASS:true,controllerSha:proof.controllerSha,proofSha:hash(fs.readFileSync(path)),nativeCalls:0,cases:fixtures}));
