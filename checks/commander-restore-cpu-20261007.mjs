// Orchestrator-owned causal checker. Executes emitted worker code only in a fake realm.
// Never starts Obsidian, writes a live vault or calls a model.
import fsReal from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
const dir=process.argv[2]; if(!dir) throw Error('Worker directory required');
const modulePath=path.resolve(dir,'commander-restore-native.mjs');
const mod=await import(pathToFileURL(modulePath));
assert.equal(typeof mod.runInner,'function'); assert.equal(typeof mod.runOuter,'function');
const inner=mod.runInner.toString(),outer=mod.runOuter.toString();
new vm.Script('('+inner+')({})'); new vm.Script('('+outer+')({})');
const dispatch=fsReal.readFileSync(path.resolve(dir,'commander-restore-dispatch.mjs'),'utf8');
new vm.SourceTextModule(dispatch);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function scenario(kind){
 const root='/sandbox',target=root+'/.obsidian/plugins/cmdr',source='/source/cmdr',backup='/private/backup';
 let now=1000,loads=0,writes=0,fd=10,sourceReads=0; const data=new Map(),dirs=new Set([root,target,source,'/private']),fds=new Map();
 const put=(p,b)=>data.set(p,Buffer.from(b));const sha=p=>data.has(p)?hash(data.get(p)):null;
 const manifest=JSON.stringify({id:'cmdr',name:'Commander',version:'1.2.3'});
 const candidate={'main.js':Buffer.from('/* full valid Commander runtime */'),'manifest.json':Buffer.from(manifest),'styles.css':Buffer.from('.cmdr{display:flex}')};
 const preimages={},artifacts={};
 for(const [n,b]of Object.entries(candidate)){put(source+'/'+n,b);artifacts[n]={source:source+'/'+n,sha:hash(b)};if(n!=='main.js')put(target+'/'+n,n==='manifest.json'?JSON.stringify(JSON.parse(manifest),null,2):'old style');preimages[n]=sha(target+'/'+n);}
 put(target+'/data.json',JSON.stringify({keep:'original',spacingReset:true,hide:{leftRibbon:[],editorMenuItems:[],fileMenuItems:[]},macros:[]}));put(root+'/.obsidian/community-plugins.json','["cmdr","foreign"]');
 put('/private/lease.json','{"token":"cpu-token","status":"GRANTED"}');put('/private/control.json','{"token":"cpu-token"}');put('/private/helper.mjs','frozen');
 const protectedFiles=Object.fromEntries([target+'/data.json',root+'/.obsidian/community-plugins.json'].map(p=>[p,sha(p)]));
 const pins=Object.fromEntries(['/private/lease.json','/private/control.json','/private/helper.mjs'].map(p=>[p,sha(p)]));
 const fakefs={existsSync:p=>data.has(String(p))||dirs.has(String(p)),readFileSync:(p,e)=>{assert(data.has(String(p)),'Missing read '+p);let b=Buffer.from(data.get(String(p)));if(p===source+'/main.js'&&kind==='buffer-race'&&++sourceReads===2)b=Buffer.from('RACED');return typeof e==='string'?b.toString(e):b;},realpathSync:p=>String(p),statSync:p=>({dev:1,ino:7,isDirectory:()=>dirs.has(String(p))}),mkdirSync:p=>{assert(!dirs.has(String(p)));dirs.add(String(p));},openSync:(p,mode)=>{p=String(p);if(mode==='wx'&&data.has(p))throw Error('EEXIST');if(mode.includes('w')){put(p,'');writes++;}fds.set(++fd,{p,mode});return fd;},writeSync:(f,b)=>{put(fds.get(f).p,b);return Buffer.byteLength(b);},writeFileSync:(p,b)=>{const n=typeof p==='number'?fds.get(p).p:String(p);put(n,b);writes++;},fsyncSync:f=>{assert(fds.has(f));},closeSync:f=>fds.delete(f),unlinkSync:()=>{throw Error('Removal forbidden');},renameSync:()=>{throw Error('Rollback forbidden');}};
 let crashed=false;const wc={id:2,isCrashed:()=>false};const w={id:2,webContents:wc,isDestroyed:()=>false};const other={id:10,webContents:{id:12,isCrashed:()=>crashed},isDestroyed:()=>false};
 const windows=[w,other];const remote={getCurrentWindow:()=>w,getFocusedWindow:()=>other,BrowserWindow:{getAllWindows:()=>windows,getFocusedWindow:()=>other}};
 const leaf={id:'leaf',view:{getViewType:()=> 'markdown',editor:{getValue:()=> 'unsaved'}}};
 const document={URL:'app://obsidian.md/index.html',activeElement:{},defaultView:{},body:{}};const settings={isOpen:true,lastTabId:'community-plugins',doc:document,modalEl:{ownerDocument:document}};
 const foreign={_loaded:true};const pm={plugins:{foreign},manifests:{cmdr:JSON.parse(manifest),foreign:{id:'foreign'}},enabledPlugins:new Set(['cmdr','foreign']),loadPlugin:async id=>{assert.equal(id,'cmdr');loads++;assert.equal(sha(target+'/main.js'),artifacts['main.js'].sha,'Load before complete copy');for(const [p,s]of Object.entries(protectedFiles))assert.equal(sha(p),s,'Config changed before load');pm.plugins.cmdr={_loaded:true,manifest:JSON.parse(manifest)};if(kind==='data-race')put(target+'/data.json','human edit');if(kind==='source-race')put(source+'/main.js','concurrent source');if(kind==='deadline')now=50000;if(kind==='foreign-crash')crashed=true;},unloadPlugin:()=>{throw Error('Unneeded unload');},enablePluginAndSave:()=>{throw Error('Native flag write forbidden');},disablePluginAndSave:()=>{throw Error('Native flag write forbidden');},saveConfig:()=>{throw Error('Native persistence write forbidden');}};
 const app={appId:'cpu-app',vault:{getName:()=> 'Sandbox',adapter:{getBasePath:()=>root}},plugins:pm,setting:settings,internalPlugins:{plugins:{core:{enabled:true,instance:{}}}},workspace:{activeLeaf:leaf,getLayout:()=>({leaves:['leaf']}),iterateAllLeaves:fn=>fn(leaf)}};
 const r={job:'cpu-commander',token:'cpu-token',root,vault:'Sandbox',native:{vault:'Sandbox',appId:'cpu-app',window:2,wc:2,document:document.URL,physicalRoot:root,dev:1,ino:7},artifacts,preimages,protectedFiles,pins,backupPath:backup,resultPath:'/private/result.json',leasePath:'/private/lease.json',controlPath:'/private/control.json',helperPath:'/private/helper.mjs',actionBy:new Date(10000).toISOString(),totalBy:new Date(20000).toISOString(),rootHardBy:new Date(30000).toISOString(),expectedLoaded:false,expectedNative:true};
 if(kind==='wrong-identity')r.native.appId='wrong';if(kind==='config-preimage')put(target+'/data.json','human preflight edit');if(kind==='already-crashed')crashed=true;
 const fakeDate=class extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
 const ctx=vm.createContext({app,document,window:{},localStorage:{getItem:()=>null},require:n=>({fs:fakefs,crypto,path,electron:{remote}}[n]??(()=>{throw Error('Unknown module '+n);})()),Buffer,Date:fakeDate,setTimeout,clearTimeout,console});
 let result;try{result=await new vm.Script('('+inner+')(__params)').runInContext(Object.assign(ctx,{__params:r}));if(typeof result==='string')result=JSON.parse(result);}catch(e){result={status:'THREW',error:String(e)};}
 if(['normal','already-crashed'].includes(kind)){assert.equal(result.status,'SETTLED',JSON.stringify(result));assert.equal(loads,1);for(const [n,a]of Object.entries(artifacts))assert.equal(sha(target+'/'+n),a.sha);for(const [p,s]of Object.entries(protectedFiles))assert.equal(sha(p),s);assert.equal(pm.plugins.foreign,foreign);assert.equal(app.setting,settings);assert.equal(app.workspace.activeLeaf,leaf);assert.deepEqual([...pm.enabledPlugins],['cmdr','foreign']);}
 else{assert.notEqual(result.status,'SETTLED','Unsafe scenario passed '+kind);if(['wrong-identity','config-preimage','buffer-race'].includes(kind)){assert.equal(loads,0);assert.equal(writes,0,'NO_START wrote anything');}if(kind==='data-race')assert.equal(data.get(target+'/data.json').toString(),'human edit','Rolled back human data');}
 console.log('PASS '+kind+' status='+result.status);
}
for(const k of ['normal','wrong-identity','config-preimage','already-crashed','data-race','source-race','deadline','foreign-crash','buffer-race'])await scenario(k);
// Actual dispatcher must reject malformed grants before ACK/control or any CLI.
const dispatcher=await import(pathToFileURL(path.resolve(dir,'commander-restore-dispatch.mjs')));
for(const value of [undefined,'invalid']){
 const temp=fsReal.mkdtempSync(path.join(os.tmpdir(),'cmdr-ack-cpu-')),leasePath=path.join(temp,'lease.json'),loadedPath=path.join(temp,'loaded.json');
 fsReal.writeFileSync(loadedPath,JSON.stringify({job:'cpu',owner:'owner',leasePath}));
 fsReal.writeFileSync(leasePath,JSON.stringify({job:'cpu',executor:'owner',status:'GRANTED',token:'token',loadedSHA:hash(fsReal.readFileSync(loadedPath)),ackBy:value}));
 await assert.rejects(()=>dispatcher.dispatch(temp),/Invalid grant ACK date\/token/);
 assert(!fsReal.existsSync(path.join(temp,'control.json')));assert(!fsReal.existsSync(path.join(temp,'first-action.json')));
 console.log('PASS invalid ACK rejected before durable control/CLI');
}
// Execute actual outer preflight with the renderer vm module deliberately absent.
const emission=JSON.stringify([]),outerFiles=new Map([['/emission.json',Buffer.from(emission)],['/lease.json',Buffer.from('token')]]);
const w={id:2,webContents:{id:2,isCrashed:()=>false}},remote={getCurrentWindow:()=>w,BrowserWindow:{getAllWindows:()=>[w],getFocusedWindow:()=>null}};
const outerFs={existsSync:p=>outerFiles.has(p),readFileSync:(p,e)=>e?outerFiles.get(p).toString():outerFiles.get(p),realpathSync:p=>p,statSync:()=>({dev:1,ino:7})};
const r={native:{appId:'cpu',vault:'Sandbox',physicalRoot:'/sandbox',window:2,wc:2,document:'app://obsidian.md/index.html',dev:1,ino:7},actionBy:new Date(Date.now()+10000).toISOString(),rootHardBy:new Date(Date.now()+20000).toISOString(),pins:{},protectedFiles:{},baselineFiles:{},leasePath:'/lease.json',token:'token',emissionPath:'/emission.json',emissionSha:hash(emission),invocations:[],targets:[]};
const outerCtx=vm.createContext({app:{appId:'cpu',vault:{getName:()=> 'Sandbox',adapter:{getBasePath:()=>'/sandbox'}}},document:{URL:r.native.document},window:{},Date,__r:r,require:n=>{if(n==='vm')throw Error('Renderer vm is unavailable');return{fs:outerFs,crypto,path,electron:{remote}}[n];}});
assert.throws(()=>new vm.Script('('+outer+')(__r)').runInContext(outerCtx),/Exactly three unique Sandbox targets/);
console.log('PASS actual renderer outer needs no vm module');
const proof={innerCompiled:true,outerCompiled:true,dispatchCompiled:true,innerSha:hash(inner),outerSha:hash(outer),nativeIO:false,scenarios:9};
fsReal.writeFileSync(path.resolve(dir,'compile-proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log('PASS emitted inner/outer/dispatch compiled; nativeIO=false');
