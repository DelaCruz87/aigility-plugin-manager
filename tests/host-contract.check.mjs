import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';
const { createHostAdapter } = await importModule('src/integrated/adapter.ts');

function host() {
  let allowed = true;
  const loaded = {};
  const calls = [];
  const enabledPlugins = new Set();
  const app = {
    appId: 'host-contract-fixture',
    plugins: {
      manifests: { slow: {id:'slow',name:'Slow',version:'1'} },
      plugins: loaded, enabledPlugins,
      // Verified host1.14.3: isEnabled has NO plugin-id parameter.
      isEnabled: () => allowed,
      setEnable: value => {allowed=value;},
      getPlugin: id => loaded[id],
      enablePlugin: async id => {loaded[id]={_loaded:true};return true;},
      enablePluginAndSave: async id => {enabledPlugins.add(id);loaded[id]={_loaded:true};return true;},
      disablePluginAndSave: async id => {enabledPlugins.delete(id);delete loaded[id];},
      saveConfig: async () => calls.push('save-native'),
    },
    internalPlugins: {getPluginById: id => id==='workspaces'?{instance:{
      workspaces:{d:{},t:{},m:{}},
      loadWorkspace: async id=>calls.push('workspace:'+id),
      saveData:async()=>calls.push('save-workspaces'),
    }}:undefined},
    workspace: {},
  };
  const adapter=createHostAdapter(app,{app},reason=>calls.push('pause:'+reason));
  return {app,adapter,calls};
}
test('restricted mode reads actual global app.plugins.isEnabled()',()=>{
 const h=host();h.app.plugins.setEnable(false);
 assert.equal(h.adapter.isRestricted(),true);
});
test('deferred enable uses nonpersistent host load and leaves native IDs excluded',async()=>{
 const h=host();await h.adapter.loadDeferred({kind:'community',id:'slow'});
 assert.ok(h.app.plugins.plugins.slow,'plugin really loaded');
 assert.equal(h.app.plugins.enabledPlugins.has('slow'),false,'deferred MUST stay outside native autostart');
 assert.equal(h.calls.includes('save-native'),false,'no-save activation must not persist native IDs');
});
test('workspace application calls core Workspaces instance',async()=>{
 const h=host();await h.adapter.loadWorkspace('d');
 assert.ok(h.calls.includes('workspace:d'));
});
test('persisted native flag without actual load is a readback failure',async()=>{
 const h=host();h.app.plugins.enablePluginAndSave=async id=>{h.app.plugins.enabledPlugins.add(id);return true;};
 await assert.rejects(h.adapter.setEnabled({kind:'community',id:'slow'},true),/readback|load/i);
});
