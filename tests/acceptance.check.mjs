import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/integrated/migration.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { migrateLegacy } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('approved migration contract: full catalog, explicit fixtures, equipment tags and effective deferred state', () => {
  const plugins = Array.from({length: 723}, (_, i) => ({id: 'fixture-' + i, name: 'Fixture ' + i, enabled: i < 25, tags: ['original'], group: 'g', customField: 'keep'}));
  plugins.push({id: 'omnisearch', name: 'Omnisearch', enabled: false, tags: ['search']});
  const fixtures = Array.from({length: 42}, (_, i) => ({id: 'test-' + i, name: 'Test ' + i, pluginStates: {'fixture-0': true, 'fixture-1': false}}));
  const bpm = {Plugins: plugins, TAGS: [{id:'original',name:'Original'}], GROUPS:[{id:'g',name:'Group',color:'red'}], COMMAND_PROFILES: fixtures, unknownMetadata: 'keep'};
  const companion = {profiles:{desktop:{'fixture-0':true,omnisearch:false},tablet:{},mobile:{omnisearch:true}}, deferred:[{id:'omnisearch',delayMs:30000,enabled:true},{id:'fixture-2',delayMs:20000,enabled:false}],workspaceIds:{desktop:'d',tablet:'t',mobile:'m'},profileBackups:{desktop:{name:'saved',pluginStates:{'fixture-0':false}}}};
  const observed = plugins.map(p => ({ref:{kind:'community',id:p.id},name:p.name,version:'1.0.0',installed:true,compatible:true,nativeAutostart:p.enabled,loaded:p.id==='omnisearch'||p.enabled}));
  observed.push({ref:{kind:'core',id:'backlink'},name:'Backlinks',version:'1.14.3',installed:true,compatible:true,nativeAutostart:true,loaded:true});
  observed.push({ref:{kind:'core',id:'sync'},name:'Sync',version:'1.14.3',installed:true,compatible:true,nativeAutostart:false,loaded:false});
  const state = migrateLegacy(bpm,companion,observed,'2026-10-01T10:00:00Z');
  const equipment=['macbook','zenbook','iphone','ipad','s24','lenovo tab','boox tab mini c'];
  assert.equal(state.schemaVersion,1);
  assert.deepEqual(state.deviceProfiles.map(p=>p.name).sort(),equipment.slice().sort());
  assert.ok(state.deviceProfiles.every(p=>p.applyAtStart===true));
  assert.equal(state.fixtureProfiles.length,42);
  assert.equal(state.fixtureProfiles[0].members['community:fixture-1'],false);
  assert.equal(state.fixtureProfiles[0].id,'test-0');
  assert.equal(state.records['community:fixture-0'].group,'g');
  assert.ok(state.records['community:fixture-0'].tags.includes('original'));
  assert.ok(state.records['community:fixture-0'].tags.includes('macbook'));
  assert.ok(state.records['community:fixture-0'].tags.includes('zenbook'));
  assert.ok(state.records['community:omnisearch'].tags.includes('macbook'),'active deferred Omnisearch must survive Desktop false');
  assert.ok(equipment.every(t=>state.records['core:backlink'].tags.includes(t)),'core snapshot initializes all templates');
  assert.equal(state.records['core:sync'].tags.some(t=>equipment.includes(t)),false);
  assert.equal(state.deferred.find(p=>p.id==='fixture-2').enabled,false);
  assert.equal(state.deferred.find(p=>p.id==='omnisearch').delayMs,30000);
  assert.ok(state.protected.some(p=>p==='aigility-plugin-manager'||p==='community:aigility-plugin-manager'));
  assert.ok(!state.protected.some(p=>p.includes('better-plugins-manager')));
  assert.equal(state.settings.automaticUpdates,false);
  assert.equal(bpm.Plugins[0].tags.length,1,'migration must not mutate input');
  assert.equal(companion.profiles.desktop.omnisearch,false,'legacy snapshot preserved unchanged');
});
