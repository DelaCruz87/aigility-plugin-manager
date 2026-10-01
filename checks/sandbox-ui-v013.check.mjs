import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,VAULT_PATH,VAULT,APP_ID,MANAGER_ID,OBSIDIAN,J,hash,parseCliJson} from '../scripts/sandbox-community.mjs';

const execute=promisify(execFile);
export const TOTAL_MS=120000,CLEANUP_MS=35000;

export function ackWindow({leaseId,ackUTC,startBy,now=Date.now()}){
 if(!leaseId||typeof leaseId!=='string'||!leaseId.trim())throw Error('Invalid leaseId');
 if(!ackUTC||typeof ackUTC!=='string')throw Error('Invalid ackUTC');
 const ackTime=Date.parse(ackUTC);
 if(Number.isNaN(ackTime))throw Error('Invalid ackUTC timestamp');
 if(typeof startBy!=='number'||!Number.isFinite(startBy))throw Error('Invalid startBy');
 if(ackTime>now)throw Error('ACK is in the future');
 if(startBy<ackTime||now>=startBy)throw Error('Lease startBy expired');
 const deadline=ackTime+TOTAL_MS;
 const actionDeadline=deadline-CLEANUP_MS;
 const remaining=actionDeadline-now;
 if(remaining<=0)throw Error('Action deadline expired');
 if(deadline-now<=CLEANUP_MS)throw Error('Remaining time below cleanup budget');
 return {leaseId,ackUTC,startBy,deadline,actionDeadline};
}

export function uiGate(deadline,now=Date.now()){
 if(now>=deadline)throw Error('UI lease expired before next action');
}

export function matchingRestore(before,post,current){
 return JSON.stringify(post)===JSON.stringify(current)?structuredClone(before):null;
}

export async function waitClosed(predicate,deadline,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 while(true){
  if(predicate())return true;
  if(now()>=deadline)throw Error('Timeout waiting for window/modal to close');
  await sleep(50);
 }
}

export function casSettingsDecision(beforeTab,ownedTab,currentTab,ownedDoc,currentDoc,ownedModalEl,currentModalEl){
 const tabMatch=JSON.stringify(ownedTab)===JSON.stringify(currentTab);
 const docMatch=ownedDoc===currentDoc;
 const modalMatch=ownedModalEl===currentModalEl;
 if(!tabMatch||!docMatch||!modalMatch){
  return {ok:false,conflict:true,shouldRestoreTab:false,shouldClose:false,reason:'CAS mismatch on Settings tab/doc/modalEl'};
 }
 return {ok:true,conflict:false,shouldRestoreTab:true,shouldClose:true,restoreTab:beforeTab};
}

export async function dispatchOnce(persist,dispatch,metadata){
 if(metadata.key&&globalThis[metadata.key])throw Error('Global key already registered before dispatch');
 await persist({status:'dispatch-prepared',...metadata});
 if(metadata.key){
  globalThis[metadata.key]={status:'dispatch-prepared',registeredAt:new Date().toISOString(),...metadata};
 }
 return await dispatch();
}

export function registerUIJob(globals,key){
 if(Object.hasOwn(globals,key))throw Error('UI job token already exists; do not replace');
 const job={id:key,status:'pending',phase:'preflight',startedAt:new Date().toISOString(),checks:[],restoration:{}};
 globals[key]=job;return job;
}
export function validateUIIdentity(app,globals,key,job){
 if(app.vault.getName()!=='Sandbox'||app.vault.adapter.getBasePath()!=='/Users/eme/Obsidian/Sandbox'||app.appId!=='d137282e82167d84')throw Error('Wrong Sandbox identity');
 if(globals[key]!==job||job.id!==key)throw Error('UI job token changed');
 if(Object.hasOwn(job,'pluginRef')&&app.plugins.plugins['aigility-plugin-manager']!==job.pluginRef)throw Error('Manager instance replaced during UI operation');
 if(app.plugins.plugins['aigility-plugin-manager']?._loaded!==true)throw Error('Manager unloaded during UI operation');
}
export function focusDecision(before,post,current){
 if(JSON.stringify(current)!==JSON.stringify(post))return {ok:false,conflict:true,restore:false};
 return {ok:true,conflict:false,restore:JSON.stringify(before)!==JSON.stringify(current)};
}

export async function nativeUI(app,globalThis,settingsImage,downloadImage,key,deadline,cleanupDeadline){
 const job=registerUIJob(globalThis,key);Object.defineProperty(job,'pluginRef',{value:app.plugins.plugins['aigility-plugin-manager'],enumerable:false});
 const checkIdentity=()=>validateUIIdentity(app,globalThis,key,job);
 const gate=()=>{uiGate(deadline);checkIdentity();};
 const cleanupGate=()=>{uiGate(cleanupDeadline);checkIdentity();};
 try {
 const check=(label,pass,data)=>{job.checks.push({label,pass:!!pass,...(data?{data}:{})});if(!pass)throw Error(label);};
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const crypto=require('crypto'),digest=v=>crypto.createHash('sha256').update(v).digest('hex');
 const cp=require('child_process');

 const getElectronFocus=()=>{
  const wins=require('@electron/remote').BrowserWindow.getAllWindows();
  const f=wins.find(w=>w.isFocused());
  return f?f.id:null;
 };

 const getOSFrontmost=()=>{
  try{
   const script='ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.js';
   const out=cp.execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',script],{timeout:1000,encoding:'utf8'});
   return out.trim();
  }catch(e){
   throw Error('Snapshot OS frontmost application failed before UI: '+String(e));
  }
 };

 const restoreOSFrontmost=(initialBundle,expectedBundle)=>{
  cleanupGate();
  if(getOSFrontmost()!==expectedBundle)throw Error('Manual OS focus changed; preserved');
  if(initialBundle===expectedBundle)return;
  if(expectedBundle!=='md.obsidian')throw Error('Unexpected OS focus postimage; preserved');
  const script=`ObjC.import("AppKit");const current=$.NSWorkspace.sharedWorkspace.frontmostApplication;if(current.bundleIdentifier.js!==${JSON.stringify(expectedBundle)})throw Error('Focus changed');const apps=$.NSRunningApplication.runningApplicationsWithBundleIdentifier(${JSON.stringify(initialBundle)});if(apps.count!==1)throw Error('Prior app is missing or ambiguous');apps.objectAtIndex(0).activateWithOptions(0);`;
  cp.execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',script],{timeout:1000});cleanupGate();
  if(getOSFrontmost()!==initialBundle)throw Error('Prior OS focus did not restore');
 };

 const initialElectronFocus=getElectronFocus();
 const initialOSBundle=getOSFrontmost();
 let ownFocus={electron:initialElectronFocus,os:initialOSBundle};job.focusBefore={...ownFocus};
 gate();

 const adapter=app.vault.adapter,P=app.plugins.plugins['aigility-plugin-manager'],ui=P.managerUI,settings=app.setting;
 const foreign=()=>Object.entries(app.plugins.manifests).filter(([id])=>id!=='aigility-plugin-manager').map(([id,m])=>({id,version:m.version,native:app.plugins.enabledPlugins.has(id),loaded:app.plugins.plugins[id]?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
 const cores=()=>Object.entries(app.internalPlugins.plugins).map(([id,w])=>({id,enabled:w.enabled,loaded:w.instance?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
 const prior={filter:structuredClone(ui.filterCriteria),sidebar:structuredClone(ui.sidebarFilterCriteria),tab:settings.lastTabId,leaf:app.workspace.activeLeaf,leaves:[],foreign:foreign(),core:cores(),local:JSON.stringify(P.runtime.local)};
 app.workspace.iterateAllLeaves(l=>prior.leaves.push(l.id));
 const dataPath=P.manifest.dir+'/data.json';
 prior.dataHash=digest(await adapter.read(dataPath));gate();

 let ownedFilter=structuredClone(prior.filter),ownedSidebar=structuredClone(prior.sidebar),ownModal=null,sd=null;
 let ownedSettingsTab=null,pinnedSettingsDoc=null,pinnedSettingsModalEl=null,pinnedSettingsWinId=null;

 const wait=async(predicate,label)=>{
  for(let i=0;i<80;i++){
   gate();
   if(predicate())return;
   await new Promise(r=>setTimeout(r,50));
  }
  throw Error('UI did not render: '+label);
 };
 const waitClosedLocal=async(predicate,deadlineMs)=>await waitClosed(predicate,deadlineMs);

 const visible=n=>{if(!n?.isConnected)return false;const c=n.ownerDocument.defaultView.getComputedStyle(n);return c.display!=='none'&&c.visibility!=='hidden'&&n.getBoundingClientRect().height>0;};
 const event=(n,name)=>n.dispatchEvent(new n.ownerDocument.defaultView.Event(name,{bubbles:true}));
 const docs=()=>[settings.doc,document].filter(Boolean);
 const q=selector=>docs().map(d=>d.querySelector(selector)).find(Boolean);
 const setFilter=(selector,value,name='change')=>{gate();assertDocument();const n=sd.querySelector(selector);check('Control '+selector,!!n);n.value=value;event(n,name);ownedFilter=structuredClone(ui.filterCriteria);};

 const mainWin=require('@electron/remote').getCurrentWindow();
 const pinnedMainWinId=mainWin.id;
 const settingsWindow=()=>{const wins=require('@electron/remote').BrowserWindow.getAllWindows().filter(w=>w.getTitle()==='Settings - Sandbox - Obsidian');if(wins.length!==1)throw Error('Settings window missing or ambiguous');if(pinnedSettingsWinId!==null&&wins[0].id!==pinnedSettingsWinId)throw Error('Settings window replaced');return wins[0];};
 const rememberOwnFocus=()=>{const current={electron:getElectronFocus(),os:getOSFrontmost()};if(current.electron!==null&&![initialElectronFocus,pinnedMainWinId,pinnedSettingsWinId].includes(current.electron))throw Error('Manual Electron focus changed; preserved');if(current.os!==initialOSBundle&&current.os!=='md.obsidian')throw Error('Manual OS focus changed; preserved');ownFocus=current;job.focusPost={...current};};
 const assertDocument=()=>{if(pinnedSettingsDoc&&settings.doc!==pinnedSettingsDoc)throw Error('Settings document replaced');if(pinnedSettingsWinId!==null)settingsWindow();};


 const capture=async(doc,imagePath)=>{
  gate();
  let targetWin;
  if(doc===document){
   targetWin=require('@electron/remote').getCurrentWindow();
   check('Main window id match',targetWin.id===pinnedMainWinId);
  }else{
   assertDocument();targetWin=settingsWindow();
  }
  check('Native capture window exists',!!targetWin);
  const modal=doc.querySelector('.aigility-options-modal')?.closest('.modal');
  const rect=modal?.getBoundingClientRect();
  if(doc===document&&(!rect||rect.width<=0||rect.height<=0))throw Error('Own manager modal crop unavailable; refuse whole mainwindow capture');
  const clip=rect?{x:Math.max(0,Math.floor(rect.x)),y:Math.max(0,Math.floor(rect.y)),width:Math.ceil(rect.width),height:Math.ceil(rect.height)}:undefined;
  const image=await targetWin.webContents.capturePage(clip);gate();
  require('fs').writeFileSync(imagePath,image.toPNG());
  return {path:imagePath,size:image.getSize(),kind:'native Electron capturePage; physical desktop not observed by this procedure'};
 };

 try{
  gate();check('Correct Sandbox identity',app.vault.getName()==='Sandbox'&&adapter.getBasePath()==='/Users/eme/Obsidian/Sandbox'&&app.appId==='d137282e82167d84');
  check('Native loaded0.1.3',P._loaded&&P.manifest.version==='0.1.3');
  check('Settings initially closed',!settings.modalEl?.isConnected);
  check('No previous manager modal',!q('.aigility-options-modal'));
  check('Recovery remains paused',!!P.runtime.local.recoveryReason&&!P.runtime.local.deviceProfileId&&!P.runtime.local.operationPending&&!P.runtime.state.debug?.active);
  gate();settings.open();ownedSettingsTab=settings.lastTabId;pinnedSettingsModalEl=settings.modalEl;pinnedSettingsDoc=settings.doc;await wait(()=>settings.doc?.querySelector('.vertical-tab-content'),'Settings document');
  sd=settings.doc;pinnedSettingsWinId=settingsWindow().id;rememberOwnFocus();pinnedSettingsDoc=settings.doc;pinnedSettingsModalEl=settings.modalEl;
  gate();settings.openTabById('community-plugins');ownedSettingsTab='community-plugins';await wait(()=>sd.querySelector('.aigility-manager-root'),'integrated Community list');
  ownedSettingsTab='community-plugins';
  check('One integrated list',sd.querySelectorAll('.aigility-manager-installed-container').length===1);
  check('Sidebar options is visible',visible(sd.querySelector('.aigility-options-btn')));
  check('Persistent recovery banner',visible(sd.querySelector('.aigility-recovery-banner')));
  const installed=P.runtime.list().filter(p=>p.installed&&!p.archived);
  setFilter('.aigility-kind-select','all');setFilter('.aigility-tag-select','all');setFilter('.aigility-group-select','all');setFilter('.aigility-search-input','','input');
  check('All installed rows match',sd.querySelectorAll('.aigility-plugin-row').length===installed.length,{expected:installed.length});
  setFilter('.aigility-search-input','aigility-plugin-manager','input');check('ID search finds own manager',sd.querySelectorAll('.aigility-plugin-row').length===1);
  setFilter('.aigility-search-input','','input');setFilter('.aigility-kind-select','core');check('Core selector matches',sd.querySelectorAll('.aigility-plugin-row').length===installed.filter(p=>p.ref.kind==='core').length);
  setFilter('.aigility-kind-select','community');check('Community selector matches',sd.querySelectorAll('.aigility-plugin-row').length===installed.filter(p=>p.ref.kind==='community').length);
  setFilter('.aigility-kind-select','all');
  const tag=installed.find(p=>p.tags?.length)?.tags[0];if(tag){setFilter('.aigility-tag-select',tag);check('Tag filter matches membership',sd.querySelectorAll('.aigility-plugin-row').length===installed.filter(p=>p.tags?.includes(tag)).length);setFilter('.aigility-tag-select','all');}
  const group=installed.find(p=>p.group)?.group;if(group){setFilter('.aigility-group-select',group);check('Group filter matches',sd.querySelectorAll('.aigility-plugin-row').length===installed.filter(p=>p.group===group).length);setFilter('.aigility-group-select','all');}
  const general=settings.settingTabs.map(t=>({id:t.id,display:t.navEl?.style.display??null}));
  gate();const sidebar=sd.querySelector('.aigility-sidebar-search');check('Sidebar name filter exists',!!sidebar);sidebar.value='aigility-no-such-plugin-013';event(sidebar,'input');ownedSidebar=structuredClone(ui.sidebarFilterCriteria);
  check('Sidebar hides only plugin entries',settings.pluginTabs.every(t=>!t.navEl||t.navEl.style.display==='none'));
  check('General categories stay accessible',equal(general,settings.settingTabs.map(t=>({id:t.id,display:t.navEl?.style.display??null}))));
  gate();sidebar.value=prior.sidebar.search??'';event(sidebar,'input');ownedSidebar=structuredClone(ui.sidebarFilterCriteria);
  gate();settings.openTabById('appearance');ownedSettingsTab='appearance';
  gate();settings.openTabById('community-plugins');ownedSettingsTab='community-plugins';
  check('Direct tab switch mounts once',sd.querySelectorAll('.aigility-manager-installed-container').length===1);
  rememberOwnFocus();assertDocument();job.phase='capture-community';job.communityCapture=await capture(sd,settingsImage);gate();
  sd.querySelector('.aigility-options-btn').click();await wait(()=>q('.aigility-options-modal'),'Options');ownModal=q('.aigility-options-modal').closest('.modal-container');
  rememberOwnFocus();assertDocument();const options=q('.aigility-options-modal'),nav=[...options.querySelectorAll('.aigility-nav-tab')];check('Seven option sections',nav.length===7,{labels:nav.map(n=>n.textContent)});
  const downloaded=nav.find(n=>n.textContent==='Descargados');check('Downloaded section exists',!!downloaded);gate();downloaded.click();
  const section=options.querySelector('.archive-manager-section');check('Archive section renders',!!section);check('Configured archive root',P.archive.root==='.obsidian/plugins/_archive');
  const safety=P.archive.safety();job.archiveSafety=safety;check('Actual Sync safety refuses physical move',safety.allowed===false&&/sync/i.test(safety.reason));
  check('Visible Sync warning',visible(section.querySelector('.archive-safety-warning')));check('No archive action can run',[...section.querySelectorAll('.archive-action-btn')].every(n=>n.disabled));
  check('Downloaded list is bounded',section.querySelectorAll('.archive-item-row').length<=50);
  const search=section.querySelector('.archive-search-input');gate();search.value='aigility-plugin-manager';event(search,'input');check('Downloaded ID search',section.querySelectorAll('.archive-item-row').length===1);
  gate();search.value='';event(search,'input');
  job.downloadCapture=await capture(section.ownerDocument,downloadImage);gate();
 }catch(error){job.error=String(error);}
 finally{
  job.phase='cleanup';
  const restore=async(label,fn)=>{
   try{
    cleanupGate();
    await fn();
    cleanupGate();job.restoration[label]=true;
   }catch(error){
    job.restoration[label]=false;
    job.restoration.errors??=[];
    job.restoration.errors.push({label,error:String(error)});
   }
  };

  await restore('ownModal',async()=>{
   if(ownModal?.isConnected){
    if(!focusDecision(job.focusBefore,ownFocus,{electron:getElectronFocus(),os:getOSFrontmost()}).ok)throw Error('Manual focus changed; preserve own modal for explicit cleanup');
    const currentOpt=q('.aigility-options-modal');
    if(currentOpt&&currentOpt.closest('.modal-container')===ownModal){
     if(ownModal.isConnected){
      const close=ownModal.querySelector('.modal-close-button');
      if(!close)throw Error('Own modal close button not found');
      close.click();
      await waitClosed(()=>!ownModal.isConnected,cleanupDeadline);cleanupGate();rememberOwnFocus();
     }
    }else throw Error('Own modal identity changed; preserved');
   }
  });

  await restore('filters',()=>{
   const f=matchingRestore(prior.filter,ownedFilter,ui.filterCriteria);
   const s=matchingRestore(prior.sidebar,ownedSidebar,ui.sidebarFilterCriteria);
   if(!f||!s)throw Error('Manual filter edit preserved, cleanup conflicts');
   ui.filterCriteria=f;ui.sidebarFilterCriteria=s;ui.applySidebarFilter(settings);ui.refreshList();
  });

  await restore('settings',async()=>{
   if(!focusDecision(job.focusBefore,ownFocus,{electron:getElectronFocus(),os:getOSFrontmost()}).ok)throw Error('Manual focus changed; preserve Settings');
   const cas=casSettingsDecision(prior.tab,ownedSettingsTab,settings.lastTabId,pinnedSettingsDoc,settings.doc,pinnedSettingsModalEl,settings.modalEl);
   if(!cas.ok){
    throw Error(cas.reason);
   }
   if(cas.shouldRestoreTab&&settings.lastTabId==='community-plugins'){
    settings.lastTabId=prior.tab;
   }
   if(cas.shouldClose&&settings.modalEl?.isConnected){
    settings.close();
    await waitClosedLocal(()=>!pinnedSettingsModalEl.isConnected,cleanupDeadline);cleanupGate();rememberOwnFocus();
   }
  });

  await restore('focus',()=>{
   const current={electron:getElectronFocus(),os:getOSFrontmost()};
   const decision=focusDecision(job.focusBefore,ownFocus,current);if(!decision.ok)throw Error('Manual focus edit preserved');
   if(decision.restore&&initialElectronFocus!==null&&current.electron!==initialElectronFocus){
    cleanupGate();const target=require('@electron/remote').BrowserWindow.getAllWindows().find(w=>w.id===initialElectronFocus);if(!target||target.isDestroyed())throw Error('Prior window unavailable');target.focus();cleanupGate();ownFocus={electron:getElectronFocus(),os:getOSFrontmost()};
   }
   restoreOSFrontmost(initialOSBundle,ownFocus.os);job.focusAfter={electron:getElectronFocus(),os:getOSFrontmost()};
   if(job.focusAfter.os!==job.focusBefore.os||job.focusBefore.electron!==null&&job.focusAfter.electron!==job.focusBefore.electron)throw Error('Focus readback differs');
  });

  await restore('foreign',()=>check('Foreign plugins unchanged',equal(prior.foreign,foreign())&&equal(prior.core,cores())));
  await restore('data',async()=>check('Manager data unchanged',prior.dataHash===digest(await adapter.read(dataPath))));
  await restore('local',()=>check('Local recovery/profile unchanged',prior.local===JSON.stringify(P.runtime.local)));
  await restore('workspace',()=>{const leaves=[];app.workspace.iterateAllLeaves(l=>leaves.push(l.id));check('Workspace and leaf unchanged',app.workspace.activeLeaf===prior.leaf&&equal(leaves,prior.leaves));});

  job.status=job.error||job.restoration.errors?.length?'failed':'complete';
  job.finishedAt=new Date().toISOString();
 }
 return job;
 }catch(error){job.status='failed';job.error=String(error);job.phase='preflight-failed';job.finishedAt=new Date().toISOString();return job;}
}

export function uiBody(key,deadline,cleanupDeadline,communityImage,downloadImage){
 return `const registerUIJob=${registerUIJob.toString()};const validateUIIdentity=${validateUIIdentity.toString()};const focusDecision=${focusDecision.toString()};const uiGate=${uiGate.toString()};
const matchingRestore=${matchingRestore.toString()};
const waitClosed=${waitClosed.toString()};
const casSettingsDecision=${casSettingsDecision.toString()};
value=await (${nativeUI.toString()})(app,globalThis,${J(communityImage)},${J(downloadImage)},${J(key)},${deadline},${cleanupDeadline});`;
}

export async function run(){
 assert.equal(process.env.AIGILITY_SANDBOX_UI_AUTHORIZED,'1');
 const leaseId=process.env.AIGILITY_UI_LEASE_ID;
 const ackUTC=process.env.AIGILITY_UI_ACK_UTC;
 const startBy=process.env.AIGILITY_UI_START_BY?Number(process.env.AIGILITY_UI_START_BY):NaN;
 const windowConfig=ackWindow({leaseId,ackUTC,startBy});
 const {deadline,actionDeadline}=windowConfig;

 const ready=JSON.parse(await readFile(path.join(ROOT,'evidence/sandbox-ui-v013-ready.json'),'utf8'));
 assert.equal(ready.status,'ready-offline-ui-v013');
 assert.equal(hash(await readFile(fileURLToPath(import.meta.url))),ready.checkSha256);
 for(const file of ['main.js','manifest.json','styles.css']){
  assert.equal(hash(await readFile(path.join(VAULT_PATH,'.obsidian/plugins',MANAGER_ID,file))),ready.files[file]);
 }

 const key='aigility-manager-ui:'+leaseId;
 const receiptPath=path.join(ROOT,'evidence/sandbox-ui-v013.json');
 const images=path.join(ROOT,'evidence/native-ui-v013');
 await mkdir(images,{recursive:true});

 const persistReceipt=async data=>{
  const file=await open(receiptPath,'w');try{await file.writeFile(JSON.stringify(data,null,2)+'\n');await file.sync();}finally{await file.close();}
 };

 const host=async(body,{mutation=false}={})=>{
  uiGate(mutation?actionDeadline:deadline);
  const code=`(async()=>{let value;try{if(app.vault.getName()!==${J(VAULT)}||app.vault.adapter.getBasePath()!==${J(VAULT_PATH)}||app.appId!==${J(APP_ID)})throw Error('Wrong Sandbox');${body};return JSON.stringify({ok:true,value});}catch(error){return JSON.stringify({ok:false,error:String(error)});}})()`;
  new Function('return '+code);
  const remainingMs=Math.max(1,(mutation?actionDeadline:deadline)-Date.now());
  const {stdout}=await execute(OBSIDIAN,[`vault=${VAULT}`,'eval',`code=${code}`],{timeout:Math.min(15000,remainingMs),maxBuffer:1024*1024});
  const r=parseCliJson(stdout);
  assert(r.ok,r.error);
  return r.value;
 };

 const metadata={
  key,
  leaseId,
  ackUTC,
  deadlines:{totalMs:TOTAL_MS,cleanupMs:CLEANUP_MS,deadline,actionDeadline}
 };

 let receipt;
 try{
  receipt=await dispatchOnce(
   persistReceipt,
   async()=>{
    const pending=await host("value=Object.keys(globalThis).filter(k=>k.startsWith('aigility-manager-ui:')&&globalThis[k]?.status==='pending');");const sameKey=await host(`value=Object.hasOwn(globalThis,${J(key)});`);assert.equal(sameKey,false,'Same UI token already exists, never dispatch again');
    assert.deepEqual(pending,[]);
    return await host(uiBody(key,actionDeadline,deadline,path.join(images,'community.png'),path.join(images,'downloaded.png')),{mutation:true});
   },
   metadata
  );
 }catch(error){
  console.error('UI operation did not return; read same token only:',String(error));
 }

 while(!receipt&&Date.now()<deadline-1000){
  await new Promise(r=>setTimeout(r,250));
  const r=await host(`value=globalThis[${J(key)}]??null;`);
  if(r&&r.status!=='pending'&&r.status!=='dispatch-prepared'){
   receipt=r;
  }
 }

 if(!receipt){
  receipt={status:'pending',key,leaseId,ackUTC,deadlines:metadata.deadlines,reason:'No further native action permitted until same job settles'};
 }

 await persistReceipt(receipt);
 console.log(JSON.stringify({status:receipt.status,checks:receipt.checks?.length,error:receipt.error,restoration:receipt.restoration,captures:[receipt.communityCapture,receipt.downloadCapture]}));
 assert.equal(receipt.status,'complete',receipt.error??receipt.reason);
 return receipt;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 run().catch(error=>{console.error(error);process.exitCode=1;});
}
