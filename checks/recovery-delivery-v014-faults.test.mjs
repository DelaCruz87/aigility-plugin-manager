// Fault injection executes the actual emitted native adapter in an isolated host.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
const project=path.resolve('.'),source=fs.readFileSync('checks/recovery-delivery-v014.mjs','utf8').replaceAll('export async function ','async function ').replaceAll('export function ','function ');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function run(fault){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'manager-delivery-fault-')),base=path.join(root,'vault'),src=path.join(root,'source'),backup=path.join(root,'backup'),id='aigility-plugin-manager',target=path.join(base,'.obsidian/plugins',id);fs.mkdirSync(target,{recursive:true});fs.mkdirSync(src);
 const put=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v);};
 for(const n of ['community-plugins.json','core-plugins.json','plugins/better-plugins-manager/data.json','plugins/better-plugins-manager-companion/data.json','workspace.json','workspaces.json'])put(path.join(base,'.obsidian',n),'{}');
 const state={schemaVersion:1,deferred:[],protected:['community:'+id],deviceProfiles:Array.from({length:7},(_,i)=>({id:String(i)})),fixtureProfiles:Array.from({length:42},(_,i)=>({id:String(i)}))};put(target+'/data.json',JSON.stringify(state));
 const local={recoveryReason:'Existing recovery'},doc={querySelector:()=>null},window={},storage=new Map([['owned-local',JSON.stringify(local)]]),rt=()=>({state:structuredClone(state),local:{...local},localKey:'owned-local',enqueue:async(l,fn)=>fn(),disposed:false});
 const old={_loaded:true,manifest:{version:'0.1.3'},runtime:rt()},fresh={_loaded:true,manifest:{version:'0.1.4'},runtime:rt(),managerBuild:'aigility-plugin-manager/0.1.4'};
 let now=Date.now(),calls={disable:0,enable:0};const pm={plugins:{[id]:old},enabledPlugins:new Set([id]),async disablePlugin(){calls.disable++;delete this.plugins[id];old.runtime.disposed=true;},async loadManifest(){},async loadPlugin(){await Promise.resolve();this.plugins[id]=fresh;if(fault==='clone')window.__managerRecoveryDelivery=new Map(window.__managerRecoveryDelivery);if(fault==='expiry')now=request.deadline+1;return fresh;},async enablePlugin(){calls.enable++;return this.loadPlugin(id);}};
 const original=pm.loadPlugin,win={id:9,webContents:{id:9,isCrashed:()=>false}},app={plugins:pm,appId:'d137282e82167d84',vault:{getName:()=> 'Sandbox',adapter:{getBasePath:()=>base}},setting:{lastTabId:''},workspace:{containerEl:{ownerDocument:doc},getLayout:()=>({}),iterateAllLeaves(){},activeLeaf:null},internalPlugins:{plugins:{}}};
 for(const n of ['main.js','manifest.json','styles.css']){put(target+'/'+n,'old-'+n);put(src+'/'+n,'new-'+n);}
 const control=path.join(root,'control.json');put(control,'{"intent":"frozen"}');const st=fs.statSync(base),preimages=Object.fromEntries(['community-plugins.json','core-plugins.json','plugins/better-plugins-manager/data.json','plugins/better-plugins-manager-companion/data.json','plugins/'+id+'/main.js','plugins/'+id+'/manifest.json','plugins/'+id+'/styles.css'].map(n=>{const p=path.join(base,'.obsidian',n);return[p,sha(fs.readFileSync(p))];}));
 const request={token:'test-'+fault,vault:'Sandbox',window:9,wc:9,appId:app.appId,root:base,dev:st.dev,ino:st.ino,actionDeadline:now+120000,deadline:now+180000,source:src,backup,preimages,stateSha:sha(fs.readFileSync(target+'/data.json')),artifacts:Object.fromEntries(['main.js','manifest.json','styles.css'].map(n=>[n,sha(fs.readFileSync(src+'/'+n))])),controlPath:control,controlSha:sha(fs.readFileSync(control))};
 const testFs=Object.create(fs);testFs.openSync=(p,...args)=>{if(fault==='receipt'&&String(p).endsWith('/native-result.json'))throw Error('Injected receipt I/O failure');return fs.openSync(p,...args);};
 class Clock extends Date{static now(){return now;}}
 const context=vm.createContext({app,window,document:doc,localStorage:{getItem:k=>storage.get(k)},Date:Clock,require:n=>n==='fs'?testFs:n==='crypto'?crypto:n==='@electron/remote'?{getCurrentWindow:()=>win,BrowserWindow:{getFocusedWindow:()=>null}}:n==='timers'?awaitedTimers:undefined});
 try{vm.runInContext(source,context);context.request=request;vm.runInContext('recoveryDelivery(request)',context);const job=window.__managerRecoveryDelivery.get(request.token);await job.task;return{job,pm,original,calls,receiptExists:fs.existsSync(backup+'/native-result.json')};}finally{fs.rmSync(root,{recursive:true,force:true});}
}
const awaitedTimers=await import('node:timers');
test('settled delivery publishes PASS only after durable receipt and exact hook restore',async()=>{const x=await run('none');assert.equal(x.job.status,'passed');assert.equal(x.receiptExists,true);assert.equal(x.pm.loadPlugin,x.original);assert.deepEqual(x.calls,{disable:1,enable:1});});
test('cloned registry after loader await cannot adopt returned Manager or restore hook',async()=>{const x=await run('clone');assert.equal(x.job.status,'failed');assert.equal(x.job.result,undefined);assert.equal(x.job.expectedManager,null);assert.notEqual(x.pm.loadPlugin,x.original);assert.match(x.job.error,/job\/control changed/);});
test('expired total lease preserves hook and reports cleanup failure',async()=>{const x=await run('expiry');assert.equal(x.job.status,'failed');assert.notEqual(x.pm.loadPlugin,x.original);assert.match(x.job.error,/cleanup preserved.*deadline/);});
test('receipt I/O failure never exposes a PASS through polling',async()=>{const x=await run('receipt');assert.equal(x.receiptExists,false);assert.equal(x.job.status,'failed');assert.equal(x.job.receipt.status,'failed');assert.equal(x.job.receipt.durable,false);assert.match(x.job.error,/durable receipt failed/);});
test('Python begin refuses artifact drift before control creation or native dispatch',()=>{const temp=fs.mkdtempSync(path.join(os.tmpdir(),'manager-delivery-drift-'));try{fs.mkdirSync(temp+'/checks');for(const n of ['recovery-delivery-v014.py','recovery-delivery-v014.mjs'])fs.copyFileSync(project+'/checks/'+n,temp+'/checks/'+n);for(const n of ['main.js','manifest.json','styles.css'])fs.copyFileSync(project+'/'+n,temp+'/'+n);fs.appendFileSync(temp+'/main.js','\nDRIFT');const control=temp+'/control.json',ack=new Date().toISOString(),start=new Date(Date.now()+15000).toISOString();const p=spawnSync('python3',[temp+'/checks/recovery-delivery-v014.py','begin',control,ack,start,'never-dispatch'],{encoding:'utf8'});assert.notEqual(p.status,0);assert.match(p.stderr,/frozen artifact drift/);assert.equal(fs.existsSync(control),false);}finally{fs.rmSync(temp,{recursive:true,force:true});}});
