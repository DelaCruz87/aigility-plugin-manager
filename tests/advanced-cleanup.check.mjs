import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';
const {installLongStackTraces}=await importModule('src/integrated/advanced/long-stack-traces.ts');

test('long-stack teardown restores native EventTarget methods while keeping live listeners removable', async()=>{
 const originalAdd=EventTarget.prototype.addEventListener,originalRemove=EventTarget.prototype.removeEventListener;
 const target=new EventTarget();let calls=0;
 const listener=()=>{calls++;};
 const restore=await installLongStackTraces({},false);
 try {
  target.addEventListener('fixture',listener);
  target.dispatchEvent(new Event('fixture'));
  assert.equal(calls,1);
  restore();
  assert.equal(EventTarget.prototype.addEventListener,originalAdd);
  assert.equal(EventTarget.prototype.removeEventListener,originalRemove,'unloading must not leave a persistent removal shim for live registrations');
  target.removeEventListener('fixture',listener);
  target.dispatchEvent(new Event('fixture'));
  assert.equal(calls,1,'original listener identity remains removable after teardown');
 }finally{restore();target.removeEventListener('fixture',listener);}
});
