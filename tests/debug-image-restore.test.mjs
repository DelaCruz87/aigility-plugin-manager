import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';
const {ManagerRuntime}=await importModule('src/integrated/runtime.ts');
const {DebugManager}=await importModule('src/integrated/debug.ts');
function fixture({id='alpha', desired=true, native=false, loaded=false, core=false, otherCommunity=false}={}) {
 const files=new Map(),storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const enabledPlugins=new Set(),plugins={},manifests={};
 if(!core){manifests[id]={id,name:id,version:'1.0.0',minAppVersion:'1.0.0'};if(loaded)plugins[id]={_loaded:true,manifest:manifests[id]};if(native)enabledPlugins.add(id);}
 if(otherCommunity){manifests.other={id:'other',name:'other',version:'1.0.0',minAppVersion:'1.0.0'};plugins.other={_loaded:true,manifest:manifests.other};enabledPlugins.add('other');}
 const api={plugins,manifests,enabledPlugins,isEnabled:()=>true,setEnable(){},getPlugin:key=>plugins[key],
  async enablePlugin(key){plugins[key]={_loaded:true,manifest:manifests[key]};return true;},async disablePlugin(key){delete plugins[key];},
  async enablePluginAndSave(key){await this.enablePlugin(key);enabledPlugins.add(key);return true;},async disablePluginAndSave(key){enabledPlugins.delete(key);await this.disablePlugin(key);},async saveConfig(){}};
 const app={appId:'debug-image-restore',plugins:api,internalPlugins:{plugins:{},getPluginById(){}},workspace:{layoutReady:false,onLayoutReady(){}},vault:{adapter:{getBasePath:()=>'/debug-image-restore',exists:async p=>files.has(p),read:async p=>files.get(p),write:async(p,v)=>files.set(p,v)},configDir:'.obsidian'}};
 const state={schemaVersion:1,records:{},tags:[],groups:[],deviceProfiles:[],fixtureProfiles:[],deferred:[],protected:['community:aigility-plugin-manager'],profileBackups:[],githubSources:{},settings:{staggerMs:0,automaticUpdates:false},legacyBpm:{}};
 const ref={kind:core?'core':'community',id};state.records[`${ref.kind}:${id}`]={ref,name:id,version:'1',tags:[],group:'',desired,metadata:{}};
 if(otherCommunity)state.records['community:other']={ref:{kind:'community',id:'other'},name:'other',version:'1',tags:[],group:'',desired:true,metadata:{}};
 let wrapper;if(core){wrapper={id,enabled:native,instance:{_loaded:loaded,manifest:{id,name:id,version:'1',minAppVersion:'1.0.0'}},async enable(user){assert.equal(user,false);this.enabled=true;this.instance._loaded=true;},async disable(user){assert.equal(user,false);this.enabled=false;this.instance._loaded=false;}};app.internalPlugins.plugins[id]=wrapper;app.internalPlugins.getPluginById=key=>app.internalPlugins.plugins[key];app.internalPlugins.saveConfig=async()=>{};}
 const plugin={app,manifest:{id:'aigility-plugin-manager',dir:'.obsidian/plugins/aigility-plugin-manager'},managerRuntimePreimage:null,logger:{info(){},warn(){},error(){}}};const runtime=new ManagerRuntime(app,plugin,state);plugin.runtime=runtime;const debug=new DebugManager(runtime,app,plugin);return{app,plugin,runtime,debug,api,state,wrapper,ref,files};
}
function observed(f){const key=`${f.ref.kind}:${f.ref.id}`;const item=f.runtime.list().find(x=>`${x.ref.kind}:${x.ref.id}`===key);return{desired:item.desired,native:item.nativeAutostart,loaded:item.loaded};}
test('finish after interrupted resume preserves explicit inert desired community snapshot',async()=>{
 const f=fixture({desired:true,native:false,loaded:false});try{await f.runtime.start(false);await f.debug.start([f.ref]);await f.debug.testSingle(f.ref);f.debug.dispose();f.debug=new DebugManager(f.runtime,f.app,f.plugin);await f.debug.resume();assert.equal(f.debug.session.currentStep,undefined);await f.debug.finish();assert.deepEqual(observed(f),{desired:true,native:false,loaded:false});assert.equal(f.state.records[`community:${f.ref.id}`].desired,true);}finally{f.debug.dispose();f.runtime.dispose();}
});
test('previous restores a loaded community snapshot even when desired is false',async()=>{
 const f=fixture({desired:false,native:false,loaded:true,otherCommunity:true});try{await f.runtime.start(false);await f.debug.start([{kind:'community',id:'other'}]);await f.debug.testSingle({kind:'community',id:'other'});assert.equal(observed(f).loaded,false,'the originally loaded candidate is disabled during isolation');await f.debug.previous();assert.deepEqual(observed(f),{desired:false,native:false,loaded:true});}finally{f.debug.dispose();f.runtime.dispose();}
});
test('finish restores a regular core snapshot including native and loaded state',async()=>{
 const f=fixture({id:'core-test',desired:false,native:true,loaded:true,core:true});const other={id:'other',enabled:true,instance:{_loaded:true,manifest:{id:'other',name:'other',minAppVersion:'1.0.0'}},async enable(){this.enabled=true;this.instance._loaded=true;},async disable(){this.enabled=false;this.instance._loaded=false;}};f.app.internalPlugins.plugins.other=other;f.state.records['core:other']={ref:{kind:'core',id:'other'},name:'other',version:'1',tags:[],group:'',desired:true,metadata:{}};try{await f.runtime.start(false);await f.debug.start([f.ref,{kind:'core',id:'other'}]);await f.debug.testSingle({kind:'core',id:'other'});assert.equal(f.wrapper.enabled,false);await f.debug.finish();assert.deepEqual(observed(f),{desired:false,native:true,loaded:true});}finally{f.debug.dispose();f.runtime.dispose();}
});
test('finish reports unsupported split core native and loaded snapshot',async()=>{
 const f=fixture({id:'split-core',desired:false,native:false,loaded:true,core:true});const other={id:'other',enabled:true,instance:{_loaded:true,manifest:{id:'other',name:'other',minAppVersion:'1.0.0'}},async enable(){this.enabled=true;this.instance._loaded=true;},async disable(){this.enabled=false;this.instance._loaded=false;}};f.app.internalPlugins.plugins.other=other;f.state.records['core:other']={ref:{kind:'core',id:'other'},name:'other',version:'1',tags:[],group:'',desired:true,metadata:{}};try{await f.runtime.start(false);await f.debug.start([f.ref,{kind:'core',id:'other'}]);await f.debug.testSingle({kind:'core',id:'other'});await assert.rejects(f.debug.finish(),/restauración incompleta.*nativeAutostart=false.*loaded=true/i);assert.equal(f.wrapper.enabled,true);}finally{f.debug.dispose();f.runtime.dispose();}
});
