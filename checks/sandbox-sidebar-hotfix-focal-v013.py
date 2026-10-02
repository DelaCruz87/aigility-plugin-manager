# Private reuse of Tasks release-simple-deploy-check.py; only three requested cases, manager runtime and observed Settings6 shape.
"""Frozen focal release check. Executes emitted deploy JS in isolated Map fixtures."""
import json,subprocess,sys,tempfile
from pathlib import Path
runner=Path(sys.argv[1]).resolve();project=Path(sys.argv[2]).resolve()
assert runner.is_file(),'Release runner missing'
source=runner.read_text();compile(source,str(runner),'exec')
expressions={}
for action in ['begin','poll','close']:
 proc=subprocess.run([sys.executable,str(runner),str(project),'expression','Sandbox',action],capture_output=True,text=True,timeout=10)
 assert proc.returncode==0,f'emit {action} failed: {proc.stderr} {proc.stdout}'
 expressions[action]=proc.stdout.strip();assert expressions[action],f'Empty {action}'
 node=subprocess.run(['node','-e','new (require("vm").Script)(process.argv[1]);',expressions[action]],capture_output=True,text=True)
 assert node.returncode==0,f'{action} JS syntax: {node.stderr}'
 print('PASS emitted syntax',action)
assert 'loadManifests(' not in source,'Global manifest loader forbidden'
assert 'begin requires ACK_UTC START_BY_UTC LEASE_ID' in source,'Fresh external grant required'
node=r"""
const vm=require('vm'),fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const [expression,project]=process.argv.slice(1),base='/Users/eme/Obsidian/Sandbox',id='aigility-plugin-manager',target=base+'/.obsidian/plugins/'+id+'/',names=['main.js','manifest.json','styles.css'];
for(const scenario of ['success','expired-before-start','foreign-instance-after-enable']){
 const memory=new Map(names.flatMap(n=>[[path.normalize(target+n),fs.readFileSync(target+n)],[path.normalize(project+'/'+n),fs.readFileSync(project+'/'+n)]]));
 for(const f of ['community-plugins.json','core-plugins.json','workspace.json','workspaces.json','plugins/better-plugins-manager/data.json','plugins/better-plugins-manager-companion/data.json','plugins/aigility-plugin-manager/data.json']){const fp=base+'/.obsidian/'+f;if(fs.existsSync(fp))memory.set(fp,fs.readFileSync(fp));}
 let renamesAtForeignEnable=0;const writes=[],renames=[],fds=new Map();let next=1,clock=scenario==='expired-before-start'?60001:1000,context,originalQ;
 const normalize=x=>typeof x==='number'?fds.get(x):path.normalize(x);
 const fakeFs={statSync(p){return fs.statSync(p)},existsSync(p){return memory.has(normalize(p))},mkdirSync(p){writes.push(['mkdir',p]);},readFileSync(p,enc){const b=memory.get(normalize(p));assert.ok(b,'Missing mock '+p);return enc?b.toString():Buffer.from(b)},openSync(p,flags){p=normalize(p);if(flags==='wx')assert.ok(!memory.has(p),'Exclusive clobber');fds.set(next,p);return next++},closeSync(fd){fds.delete(fd)},fsyncSync(fd){assert.ok(fds.has(fd))},writeFileSync(p,b){p=normalize(p);memory.set(p,Buffer.from(b));writes.push(['write',p]);if(scenario==='disk-drift-before-rename'&&p.startsWith(target)&&p.endsWith('.tmp'))memory.set(target+'main.js',Buffer.from('FOREIGN'));},renameSync(a,b){a=normalize(a);b=normalize(b);renames.push(b);memory.set(b,memory.get(a));memory.delete(a)},unlinkSync(p){memory.delete(normalize(p));writes.push(['unlink',p])}};
 const document={querySelector(){return null},querySelectorAll(){return []}},settings={};
 const runtimeState=JSON.parse(memory.get(target+'data.json')),runtimeLocal={recoveryReason:'held'};
 const old={_loaded:true,runtime:{state:runtimeState,local:runtimeLocal,profileUndo:null},manifest:JSON.parse(memory.get(target+'manifest.json')),settings,settingsTab:{},whenReady:async()=>{},engine:{index:{all:()=>[]}}};
 const activeLeaf={id:'original',view:{getViewType:()=> 'markdown',getState:()=>({}),file:null},getViewState:()=>({})};
 const plugins={isEnabled:()=>true,plugins:{[id]:old},manifests:{[id]:old.manifest},enabledPlugins:new Set([id]),async disablePlugin(){delete this.plugins[id];this.enabledPlugins.delete(id);originalQ=context.window.__managerSidebarHotfix?.get('offline');if(scenario==='expired-after-disable')clock=120002;if(scenario==='token-replaced')context.window.__managerSidebarHotfix.set('offline',{});if(scenario==='foreign-instance-after-disable')this.plugins[id]={manifest:{version:'foreign'}};if(scenario==='settings-tab-drift')app.setting.activeTab={id:'foreign-new'};},async loadManifest(){this.manifests[id]=JSON.parse(fakeFs.readFileSync(target+'manifest.json','utf8'));},async loadPlugin(){const fresh={_loaded:true,runtime:{state:Object.fromEntries(Object.entries(runtimeState).reverse()),local:{...runtimeLocal},profileUndo:null},manifest:this.manifests[id],settings:{...settings},settingsTab:{},whenReady:async()=>{},engine:{index:{all:()=>[]}}};this.plugins[id]=fresh;return fresh;},async enablePlugin(){await this.loadPlugin(id);this.enabledPlugins.add(id);if(scenario==='foreign-instance-after-enable'){this.plugins[id]={manifest:{version:'foreign'}};renamesAtForeignEnable=renames.length;}}};
 const loaderBefore=plugins.loadPlugin;const popupWindow={id:6,isDestroyed:()=>false,webContents:{id:6,getURL:()=> 'about:blank'}},popupDocument={defaultView:{electronWindow:popupWindow}};const app={appId:'d137282e82167d84',internalPlugins:{plugins:{}},plugins,setting:{win:{document:popupDocument},doc:popupDocument,modalEl:{isConnected:true,ownerDocument:popupDocument},activeTab:{id:'aigility-ui',plugin:{manifest:{id:'aigility-ui'}}}},vault:{configDir:'.obsidian',getName:()=> 'Sandbox',adapter:{getBasePath:()=>base}},workspace:{containerEl:{ownerDocument:scenario==='wrong-primary-document'?{}:document},activeLeaf,iterateAllLeaves(fn){fn(activeLeaf)},getLeavesOfType(){return []}}};
 const win={id:scenario==='wrong-window'?2:1,isDestroyed:()=>false,getTitle:()=> 'Fixture - Sandbox - Obsidian',webContents:{id:1,getURL:()=> 'app://obsidian.md/index.html',executeJavaScript:async code=>vm.runInContext(code,context)}};
 const MockDate=class extends Date {static now(){return clock}};
 context=vm.createContext({Date:MockDate,app,document,window:{},Buffer,setTimeout,clearTimeout,electron:{remote:{getCurrentWindow:()=>win,BrowserWindow:{getAllWindows:()=>[win],getFocusedWindow:()=>null}}},require(name){if(name==='fs')return fakeFs;if(name==='crypto')return crypto;if(name==='path')return path;throw Error('Unexpected mock require '+name)}});
 let receipt,error;
 try{receipt=await vm.runInContext(expression,context);}catch(e){error=String(e)}
 const q=originalQ??context.window.__managerSidebarHotfix?.get('offline');if(q?.task)await q.task;
 if(scenario==='success'){assert.ok(q,'Owned job missing');assert.equal(q.status,'settled');assert.ok(!q.error,q.error);assert.ok(renames.length>0,'No actual installed replacement');for(const n of names)assert.deepEqual(memory.get(target+n),fs.readFileSync(project+'/'+n));}
 else{assert.ok(error||q?.error,'Fault was accepted: '+scenario);if(scenario==='foreign-instance-after-enable'){assert.equal(renames.length,renamesAtForeignEnable,'Writes continued after returned instance replaced');assert.equal(plugins.plugins[id].manifest.version,'foreign');assert.equal(plugins.loadPlugin,loaderBefore,'Owned observer not restored');for(const n of names)assert.deepEqual(memory.get(target+n),fs.readFileSync(project+'/'+n));}else assert.equal(renames.length,0,'Installed write after fault '+scenario);if(scenario==='expired-before-start')assert.equal(writes.length,0);if(scenario==='settings-tab-drift')assert.equal(app.setting.activeTab.id,'foreign-new');if(scenario==='disk-drift-before-rename')assert.equal(memory.get(target+'main.js').toString(),'FOREIGN');}
 console.log('PASS actual emitted deploy',scenario);
}
"""
with tempfile.TemporaryDirectory(prefix='tasks-release-focal-') as td:
 f=Path(td)/'check.cjs';f.write_text('(async()=>{'+node+'})().catch(e=>{console.error(e);process.exit(1)});')
 import os
 env=dict(os.environ,RELEASE_RUNNER=str(runner))
 proc=subprocess.run(['node','-e',f.read_text(),expressions['begin'],str(project)],capture_output=True,text=True,timeout=15,env=env)
 print(proc.stdout);assert proc.returncode==0,proc.stderr
print('PASS3 existing emitted deployment lifecycle cases: own returned loader/state canonical reorder, expired ACK zero writes, foreign instance preserved/observer restored; no native calls')
