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
