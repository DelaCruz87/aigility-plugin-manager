import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';
const {ManagerRuntime}=await importModule('src/integrated/runtime.ts');
const {DebugManager}=await importModule('src/integrated/debug.ts');
function fixture() {
 const files=new Map(), storage=new Map(); globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const enabledPlugins=new Set(['alpha','beta','outsider']),plugins={},manifests={};
 for(const id of ['alpha','beta','outsider']) { manifests[id]={id,name:id,version:'1.0.0',minAppVersion:'1.0.0'}; plugins[id]={_loaded:true,manifest:manifests[id]};}
 const api={plugins,manifests,enabledPlugins,isEnabled:()=>true,setEnable(){},getPlugin:id=>plugins[id],
 async enablePlugin(id){plugins[id]={_loaded:true,manifest:manifests[id]};return true;},
 async disablePlugin(id){delete plugins[id];},
 async enablePluginAndSave(id){await this.enablePlugin(id);enabledPlugins.add(id);return true;},
 async disablePluginAndSave(id){enabledPlugins.delete(id);await this.disablePlugin(id);},
 async saveConfig(){}};
 const app={appId:'cross-module-review',plugins:api,internalPlugins:{plugins:{},getPluginById(){}},workspace:{layoutReady:false,onLayoutReady(){}},
 vault:{adapter:{getBasePath:()=>'/cross-module-review',exists:async p=>files.has(p),read:async p=>files.get(p),write:async(p,s)=>files.set(p,s)},configDir:'.obsidian'}};
 const state={schemaVersion:1,records:{},tags:[],groups:[],deviceProfiles:[],fixtureProfiles:[],deferred:[],protected:['community:aigility-plugin-manager'],profileBackups:[],githubSources:{},settings:{staggerMs:0,automaticUpdates:false},legacyBpm:{}};
 for(const id of Object.keys(manifests))state.records['community:'+id]={ref:{kind:'community',id},name:id,version:'1',tags:[],group:'',desired:true,metadata:{}};
 const plugin={app,manifest:{id:'aigility-plugin-manager',dir:'.obsidian/plugins/aigility-plugin-manager'},managerRuntimePreimage:null,logger:{info(){},warn(){},error(){}}};
 const runtime=new ManagerRuntime(app,plugin,state);plugin.runtime=runtime;
 const debug=new DebugManager(runtime,app,plugin);
 return {app,plugin,runtime,debug,api,state,files};
}
test('real runtime and DebugManager isolate one candidate while automation is paused', {timeout:3000}, async()=>{
 const f=fixture();
 try {
 await f.runtime.start(false);
 await f.debug.start([{kind:'community',id:'alpha'},{kind:'community',id:'beta'}]);
 assert.ok(f.runtime.local.recoveryReason,'diagnosis pauses automation');
 await f.debug.testSingle({kind:'community',id:'alpha'});
 assert.equal(Boolean(f.api.plugins.alpha),true);
 assert.equal(Boolean(f.api.plugins.beta),false);
 assert.equal(Boolean(f.api.plugins.outsider),false,'unselected active outsider cannot contaminate isolation');
 await f.debug.finish();
 assert.equal(Boolean(f.api.plugins.beta),true);
 assert.equal(Boolean(f.api.plugins.outsider),true);
 }finally{f.debug.dispose();f.runtime.dispose();}
});
test('real runtime and DebugManager load a deferred candidate without native autostart', {timeout:3000},async()=>{
 const f=fixture(); f.state.deferred=[{id:'beta',enabled:true,delayMs:30000}];f.api.enabledPlugins.delete('beta');delete f.api.plugins.beta;f.state.records['community:beta'].desired=false;
 try {
 await f.runtime.start(false);
 await f.debug.start([{kind:'community',id:'beta'}]);
 await f.debug.testSingle({kind:'community',id:'beta'});
 assert.equal(Boolean(f.api.plugins.beta),true);
 assert.equal(f.api.enabledPlugins.has('beta'),false);
 await f.debug.finish();
 assert.equal(Boolean(f.api.plugins.beta),false,'an originally off candidate returns off');
 assert.equal(f.api.enabledPlugins.has('beta'),false);
 }finally{f.debug.dispose();f.runtime.dispose();}
});
test('real core wrapper diagnostics account for native persistence and restore the original off state', {timeout:3000}, async()=>{
 const f=fixture();
 const wrapper={enabled:false,instance:{_loaded:false,manifest:{id:'audio-recorder',name:'Audio recorder'}},
  async enable(user){assert.equal(user,false);this.enabled=true;this.instance._loaded=true;},
  async disable(user){assert.equal(user,false);this.enabled=false;this.instance._loaded=false;}};
 f.app.internalPlugins.plugins['audio-recorder']=wrapper;
 f.app.internalPlugins.getPluginById=id=>f.app.internalPlugins.plugins[id];
 f.app.internalPlugins.saveConfig=async()=>{};
 f.state.records['core:audio-recorder']={ref:{kind:'core',id:'audio-recorder'},name:'Audio recorder',version:'',tags:[],group:'',desired:false,metadata:{}};
 try {
  await f.runtime.start(false);
  await f.debug.start([{kind:'core',id:'audio-recorder'}]);
  await f.debug.testSingle({kind:'core',id:'audio-recorder'});
  assert.equal(wrapper.instance._loaded,true,'the real wrapper must load the selected core candidate');
  assert.equal(wrapper.enabled,true,'core wrapper enable inherently changes native state');
  await f.debug.finish();
  assert.equal(wrapper.instance._loaded,false,'an originally off core candidate returns off');
  assert.equal(wrapper.enabled,false,'the session restores the core native state it changed');
 }finally{f.debug.dispose();f.runtime.dispose();}
});
test('a diagnostic origin alone cannot bypass an unrelated interrupted-operation recovery latch', {timeout:3000}, async()=>{
 const f=fixture();
 try {
  await f.runtime.start(false);
  f.runtime.local.operationPending='profile-apply:interrupted';
  f.runtime.pause('Interrupted operation: profile-apply:interrupted');
  await assert.rejects(f.runtime.enqueue('attempt-diagnostic-bypass',tx=>tx.setEnabled({kind:'community',id:'alpha'},false,{loadNow:true,origin:'debugging'})),/paused|pending|recovery/i);
  assert.equal(Boolean(f.api.plugins.alpha),true,'recovery must preserve the host until explicit acknowledgement');
  assert.equal(f.runtime.local.operationPending,'profile-apply:interrupted');
 }finally{f.debug.dispose();f.runtime.dispose();}
});
test('an invalid deferred policy for the protected manager cannot remove its native startup entry', {timeout:3000}, async()=>{
 const f=fixture(),id='aigility-plugin-manager',ref={kind:'community',id};
 f.api.manifests[id]={id,name:'AIgility Plugin Manager',version:'0.1.0',minAppVersion:'1.0.0'};
 f.api.enabledPlugins.add(id);f.api.plugins[id]={_loaded:true,manifest:f.api.manifests[id]};
 f.state.records['community:'+id]={ref,name:id,version:'0.1.0',tags:[],group:'',desired:true,metadata:{}};
 f.state.deferred.push({id,enabled:true,delayMs:50});
 try {
  await f.runtime.start(false);
  assert.equal(f.api.enabledPlugins.has(id),true,'self protection includes retaining native startup');
  assert.equal(Boolean(f.api.plugins[id]),true);
  assert.ok(f.runtime.local.recoveryReason,'the invalid policy is surfaced in recovery');
  await assert.rejects(f.runtime.enqueue('invalid-self-defer',tx=>tx.reconcileDeferred(ref)),/protect|manager|conflict/i);
  assert.equal(f.api.enabledPlugins.has(id),true);
 }finally{f.debug.dispose();f.runtime.dispose();}
});
test('a partial fixture cannot disable the protected manager through an explicit false member', {timeout:3000}, async()=>{
 const f=fixture(),id='aigility-plugin-manager',ref={kind:'community',id};
 f.api.manifests[id]={id,name:'AIgility Plugin Manager',version:'0.1.0',minAppVersion:'1.0.0'};
 f.api.enabledPlugins.add(id);f.api.plugins[id]={_loaded:true,manifest:f.api.manifests[id]};
 f.state.records['community:'+id]={ref,name:id,version:'0.1.0',tags:[],group:'',desired:true,metadata:{}};
 f.state.fixtureProfiles.push({id:'invalid-self-fixture',name:'Self false',members:{['community:'+id]:false,'community:beta':false}});
 try {
  await f.runtime.start(false);
  await f.runtime.applyFixture('invalid-self-fixture');
  assert.equal(Boolean(f.api.plugins[id]),true,'partial profiles preserve self protection too');
  assert.equal(f.api.enabledPlugins.has(id),true);
  assert.equal(f.runtime.state.records['community:'+id].desired,true);
  assert.equal(Boolean(f.api.plugins.beta),false,'the ordinary declared member still applies');
 }finally{f.debug.dispose();f.runtime.dispose();}
});
