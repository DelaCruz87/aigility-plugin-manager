import {readFile,writeFile,mkdir,open,readdir} from 'node:fs/promises';
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

export function settingsOwnershipPlan(connected,tab,approvedPreexistingTab){
 if(connected){const snapshotApproved=approvedPreexistingTab==='snapshot-current'&&typeof tab==='string'&&tab.length>0;if(!snapshotApproved&&(!approvedPreexistingTab||tab!==approvedPreexistingTab))throw Error('Preexisting Settings tab is outside approved scope');return {open:false,close:false,restoreTab:tab};}
 return {open:true,close:true,restoreTab:tab};
}
export function settingsBaselineGate(settings,baseline){
 layoutOwnershipGate(settings,{doc:baseline.doc,modal:baseline.modal,tab:baseline.tab,activeTab:baseline.activeTab});
 if((settings.modalEl?.isConnected===true)!==baseline.connected)throw Error('Settings connected state changed during preflight');
}
export function effectiveSettingsGate(settings,registered){
 if(settings.modalEl?.isConnected===true&&(!settings.activeTab||settings.activeTab.id!==settings.lastTabId||!registered.includes(settings.activeTab)))throw Error('Preexisting Settings effective active tab is absent, stale or unregistered');
}
export function selectSettingsWindow(settingsDoc,primaryDoc,mainWindow,windows,expectedId,expectedWindow=null,expectedWebContents=null){
 // Obsidian 1.14.3 app.js initializes each Window.electronWindow through that
 // window's own remote.getCurrentWindow(); titles are localized and mutable.
 const bound=settingsDoc?.defaultView?.electronWindow;
 if(settingsDoc!==primaryDoc&&(!bound||settingsDoc?.defaultView?.document!==settingsDoc))throw Error('Settings document has no native window binding');
 const matches=settingsDoc===primaryDoc?[mainWindow]:windows.filter(w=>w.id===bound.id&&w.webContents.id===bound.webContents.id);
 if(matches.length!==1)throw Error('Settings window missing or ambiguous');
 const selected=matches[0];
 if((expectedId!==null&&expectedId!==undefined&&selected.id!==expectedId)||(expectedWindow&&selected!==expectedWindow)||(expectedWebContents&&selected.webContents!==expectedWebContents))throw Error('Settings window replaced');
 return selected;
}
export async function restoreOwnedSettings(settings,owned,plan,gate,waitForClose){
 gate();const cas=casSettingsDecision(plan.restoreTab,owned.tab,settings.lastTabId,owned.doc,settings.doc,owned.modal,settings.modalEl);
 if(!cas.ok)throw Error(cas.reason);
 layoutOwnershipGate(settings,owned);
 if(plan.close){
  settings.lastTabId=plan.restoreTab;gate();settings.close();await waitForClose(()=>!owned.modal.isConnected);gate();
 }else{
  if(plan.priorActiveTab&&![...settings.settingTabs,...settings.pluginTabs].includes(plan.priorActiveTab))throw Error('Prior effective Settings tab was replaced; preserve current');
  gate();settings.openTabById(plan.restoreTab);gate();layoutOwnershipGate(settings,{doc:owned.doc,modal:owned.modal,tab:plan.restoreTab});
  if(settings.activeTab?.id!==plan.restoreTab||(plan.priorActiveTab&&settings.activeTab!==plan.priorActiveTab))throw Error('Native Settings restore did not restore effective active tab');
  if(!owned.modal.isConnected)throw Error('Preexisting Settings unexpectedly closed');
 }
}

export async function dispatchOnce(persist,dispatch,metadata){
 if(metadata.key&&globalThis[metadata.key])throw Error('Global key already registered before dispatch');
 await persist({status:'dispatch-prepared',...metadata});
 if(metadata.key){
  globalThis[metadata.key]={status:'dispatch-prepared',registeredAt:new Date().toISOString(),...metadata};
 }
 return await dispatch();
}

export function primaryDocumentGate(app,currentDocument,currentWindowId,expectedWindowId){
 if(app.workspace.containerEl.ownerDocument!==currentDocument)throw Error('Auxiliary document cannot run manager UI acceptance');
 if(currentWindowId!==expectedWindowId)throw Error('Primary window identity changed');
}
export function layoutOwnershipGate(settings,owned){
 if(settings.doc!==owned.doc||settings.modalEl!==owned.modal||settings.lastTabId!==owned.tab||(Object.hasOwn(owned,'activeTab')&&settings.activeTab!==owned.activeTab))throw Error('Settings document/modal/tab ownership changed');
}
export async function rejectPendingReceipts(paths){
 for(const file of paths){let raw;try{raw=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const r=JSON.parse(raw);if(['pending','running','dispatch-prepared','dispatching'].includes(r.status)||r.cleanup?.pending)throw Error('Prior UI receipt is pending: '+file);
 }
}
export async function persistNewReceipt(file,data){
 const handle=await open(file,'wx');try{await handle.writeFile(JSON.stringify(data,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 const directory=await open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
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

export async function nativeUI(app,globalThis,settingsImage,downloadImage,key,deadline,cleanupDeadline,approvedPreexistingTab){
 const primaryWindowId=require('@electron/remote').getCurrentWindow().id;primaryDocumentGate(app,document,primaryWindowId,primaryWindowId);
 const job=registerUIJob(globalThis,key);Object.defineProperty(job,'pluginRef',{value:app.plugins.plugins['aigility-plugin-manager'],enumerable:false});
 const checkIdentity=()=>{primaryDocumentGate(app,document,require('@electron/remote').getCurrentWindow().id,primaryWindowId);validateUIIdentity(app,globalThis,key,job);};
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
 prior.settingsConnected=settings.modalEl?.isConnected===true;prior.settingsDoc=settings.doc;prior.settingsModal=settings.modalEl;prior.settingsActiveTab=settings.activeTab;
 const dataPath=P.manifest.dir+'/data.json';
 prior.dataHash=digest(await adapter.read(dataPath));gate();

 let ownedFilter=structuredClone(prior.filter),ownedSidebar=structuredClone(prior.sidebar),ownModal=null,sd=null;
 let ownedSettingsTab=null,pinnedSettingsDoc=null,pinnedSettingsModalEl=null,pinnedSettingsWinId=null,pinnedSettingsWinRef=null,pinnedSettingsWebContentsRef=null,pinnedSettingsActiveTab=null,uiStarted=false,settingsPlan=null;

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
 const settingsWindow=()=>{if(settings.win?.document!==settings.doc||settings.modalEl?.ownerDocument!==settings.doc)throw Error('Settings owner document changed');const bound=settings.doc?.defaultView?.electronWindow;if(settings.doc!==document&&(!bound||bound.id!==6||bound.webContents.id!==6||bound.isDestroyed()||bound.webContents.getURL()!=='about:blank'))throw Error('Settings lease window identity changed');return selectSettingsWindow(settings.doc,document,mainWin,require('@electron/remote').BrowserWindow.getAllWindows(),pinnedSettingsWinId,pinnedSettingsWinRef,pinnedSettingsWebContentsRef);};
 const rememberOwnFocus=()=>{const current={electron:getElectronFocus(),os:getOSFrontmost()};if(current.electron!==null&&![initialElectronFocus,pinnedMainWinId,pinnedSettingsWinId].includes(current.electron))throw Error('Manual Electron focus changed; preserved');if(current.os!==initialOSBundle&&current.os!=='md.obsidian')throw Error('Manual OS focus changed; preserved');ownFocus=current;job.focusPost={...current};};
 const assertDocument=()=>{if(pinnedSettingsDoc)layoutOwnershipGate(settings,{doc:pinnedSettingsDoc,modal:pinnedSettingsModalEl,tab:ownedSettingsTab,activeTab:pinnedSettingsActiveTab});if(pinnedSettingsWinId!==null)settingsWindow();};


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
  const optionsModal=doc.querySelector('.aigility-options-modal')?.closest('.modal');
  const settingsModal=doc===pinnedSettingsDoc&&settings.modalEl===pinnedSettingsModalEl&&settings.lastTabId===ownedSettingsTab&&settings.modalEl?.querySelector('.aigility-manager-root')?settings.modalEl:null;
  const modal=optionsModal??settingsModal;
  const rect=modal?.getBoundingClientRect();
  if(doc===document&&(!rect||rect.width<=0||rect.height<=0))throw Error('Own manager modal crop unavailable; refuse whole mainwindow capture');
  const clip=rect?{x:Math.max(0,Math.floor(rect.x)),y:Math.max(0,Math.floor(rect.y)),width:Math.ceil(rect.width),height:Math.ceil(rect.height)}:undefined;
  const image=await targetWin.webContents.capturePage(clip);gate();assertDocument();
  require('fs').writeFileSync(imagePath,image.toPNG());
  return {path:imagePath,size:image.getSize(),kind:'native Electron capturePage; physical desktop not observed by this procedure'};
 };

 try{
  gate();check('Correct Sandbox identity',app.vault.getName()==='Sandbox'&&adapter.getBasePath()==='/Users/eme/Obsidian/Sandbox'&&app.appId==='d137282e82167d84');
  check('Native loaded0.1.3',P._loaded&&P.manifest.version==='0.1.3');
  settingsBaselineGate(settings,{doc:prior.settingsDoc,modal:prior.settingsModal,tab:prior.tab,connected:prior.settingsConnected,activeTab:prior.settingsActiveTab});
  effectiveSettingsGate(settings,[...settings.settingTabs,...settings.pluginTabs]);
  settingsPlan=settingsOwnershipPlan(prior.settingsConnected,prior.tab,approvedPreexistingTab);if(prior.settingsConnected)settingsPlan.priorActiveTab=prior.settingsActiveTab;check('Settings ownership preflight',true,{preexisting:prior.settingsConnected,priorTab:prior.tab,openedByUs:settingsPlan.open});
  check('No previous manager modal',!q('.aigility-options-modal'));
  check('Recovery remains paused',!!P.runtime.local.recoveryReason&&!P.runtime.local.deviceProfileId&&!P.runtime.local.operationPending&&!P.runtime.state.debug?.active);
  gate();settingsBaselineGate(settings,{doc:prior.settingsDoc,modal:prior.settingsModal,tab:prior.tab,connected:prior.settingsConnected,activeTab:prior.settingsActiveTab});uiStarted=true;if(settingsPlan.open)settings.open();ownedSettingsTab=settings.lastTabId;pinnedSettingsModalEl=settings.modalEl;pinnedSettingsDoc=settings.doc;pinnedSettingsActiveTab=settings.activeTab;await wait(()=>settings.doc?.querySelector('.vertical-tab-content'),'Settings document');
  sd=settings.doc;pinnedSettingsWinRef=settingsWindow();pinnedSettingsWinId=pinnedSettingsWinRef.id;pinnedSettingsWebContentsRef=pinnedSettingsWinRef.webContents;rememberOwnFocus();pinnedSettingsDoc=settings.doc;pinnedSettingsModalEl=settings.modalEl;pinnedSettingsActiveTab=settings.activeTab;
  gate();settings.openTabById('community-plugins');ownedSettingsTab='community-plugins';pinnedSettingsActiveTab=settings.activeTab;await wait(()=>sd.querySelector('.aigility-manager-root'),'integrated Community list');
  ownedSettingsTab='community-plugins';
  check('One integrated list',sd.querySelectorAll('.aigility-manager-installed-container').length===1);
  const sidebarNode=sd.querySelector('.aigility-options-btn');
  const primitiveNode=n=>{if(!n)return null;if(n.nodeType!==1)return {kind:typeof n};const r=n.getBoundingClientRect(),c=n.ownerDocument.defaultView.getComputedStyle(n);return {tag:n.tagName,classes:n.className,connected:n.isConnected,settingsDocument:n.ownerDocument===sd,ownerDocumentURL:n.ownerDocument.documentURI,rootContains:sd.contains(n),display:c.display,visibility:c.visibility,height:r.height,width:r.width};};
  const parentChain=[];for(let n=sidebarNode,i=0;n&&i<8;n=n.parentElement,i++)parentChain.push(primitiveNode(n));
  job.sidebarEvidence={node:primitiveNode(sidebarNode),parentChain,controls:primitiveNode(ui.sidebarControlsEl),fields:Object.fromEntries(['communityPluginTabContainer','tabHeadersEl','navEl','containerEl','modalEl'].map(k=>[k,primitiveNode(settings[k])])),headerGroups:[...sd.querySelectorAll('.vertical-tab-header-group')].map(primitiveNode)};
  if(!visible(sidebarNode)){rememberOwnFocus();assertDocument();job.phase='capture-sidebar-failure';job.communityCapture=await capture(sd,settingsImage);gate();}
  check('Sidebar options is visible',visible(sidebarNode));
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
  gate();settings.openTabById('appearance');ownedSettingsTab='appearance';pinnedSettingsActiveTab=settings.activeTab;
  gate();settings.openTabById('community-plugins');ownedSettingsTab='community-plugins';pinnedSettingsActiveTab=settings.activeTab;
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
   if(!uiStarted){job.cleanupNotRequired??=[];job.cleanupNotRequired.push('filters');return;}
   assertDocument();
   const f=matchingRestore(prior.filter,ownedFilter,ui.filterCriteria);
   const s=matchingRestore(prior.sidebar,ownedSidebar,ui.sidebarFilterCriteria);
   if(!f||!s)throw Error('Manual filter edit preserved, cleanup conflicts');
   ui.filterCriteria=f;ui.sidebarFilterCriteria=s;ui.applySidebarFilter(settings);ui.refreshList();
  });

  await restore('settings',async()=>{
   if(!uiStarted){job.cleanupNotRequired??=[];job.cleanupNotRequired.push('settings');return;}
   if(!focusDecision(job.focusBefore,ownFocus,{electron:getElectronFocus(),os:getOSFrontmost()}).ok)throw Error('Manual focus changed; preserve Settings');
   await restoreOwnedSettings(settings,{tab:ownedSettingsTab,doc:pinnedSettingsDoc,modal:pinnedSettingsModalEl,activeTab:pinnedSettingsActiveTab},settingsPlan,cleanupGate,predicate=>waitClosedLocal(predicate,cleanupDeadline));
   ownedSettingsTab=settingsPlan.restoreTab;rememberOwnFocus();job.settingsAfter={connected:settings.modalEl?.isConnected===true,tab:settings.lastTabId,preexisting:prior.settingsConnected};
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

export function uiBody(key,deadline,cleanupDeadline,communityImage,downloadImage,approvedPreexistingTab){
 return `const effectiveSettingsGate=${effectiveSettingsGate.toString()};const settingsBaselineGate=${settingsBaselineGate.toString()};const selectSettingsWindow=${selectSettingsWindow.toString()};const settingsOwnershipPlan=${settingsOwnershipPlan.toString()};const restoreOwnedSettings=${restoreOwnedSettings.toString()};const primaryDocumentGate=${primaryDocumentGate.toString()};const layoutOwnershipGate=${layoutOwnershipGate.toString()};const registerUIJob=${registerUIJob.toString()};const validateUIIdentity=${validateUIIdentity.toString()};const focusDecision=${focusDecision.toString()};const uiGate=${uiGate.toString()};
const matchingRestore=${matchingRestore.toString()};
const waitClosed=${waitClosed.toString()};
const casSettingsDecision=${casSettingsDecision.toString()};
value=await (${nativeUI.toString()})(app,globalThis,${J(communityImage)},${J(downloadImage)},${J(key)},${deadline},${cleanupDeadline},${J(approvedPreexistingTab??null)});`;
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
 const approvedPreexistingTab=process.env.AIGILITY_UI_PREEXISTING_TAB??null;assert.equal(approvedPreexistingTab,ready.preexistingSettingsTab??null,'Approved preexisting Settings scope differs from READY');
 assert.equal(hash(await readFile(fileURLToPath(import.meta.url))),ready.checkSha256);
 for(const file of ['main.js','manifest.json','styles.css']){
  assert.equal(hash(await readFile(path.join(VAULT_PATH,'.obsidian/plugins',MANAGER_ID,file))),ready.files[file]);
 }

 assert.match(leaseId,/^[A-Za-z0-9_-]{1,80}$/,'Lease filename must be safe');
 const key='aigility-manager-ui:'+leaseId;
 const pointerPath=path.join(ROOT,'evidence/sandbox-ui-v013.json');
 const receiptDir=path.join(ROOT,'evidence/native-ui-v013');await mkdir(receiptDir,{recursive:true});
 await rejectPendingReceipts([pointerPath,...(await readdir(receiptDir)).filter(n=>n.endsWith('.receipt.json')).map(n=>path.join(receiptDir,n))]);
 const receiptPath=path.join(receiptDir,leaseId+'.receipt.json');
 const images=path.join(receiptDir,leaseId);await mkdir(images,{recursive:true});let receiptCreated=false;

 const persistReceipt=async data=>{
  if(!receiptCreated){await persistNewReceipt(receiptPath,data);receiptCreated=true;return;}
  const previous=JSON.parse(await readFile(receiptPath,'utf8'));assert.equal(previous.key,key,'Own receipt identity changed');
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
    return await host(uiBody(key,actionDeadline,deadline,path.join(images,'community.png'),path.join(images,'downloaded.png'),approvedPreexistingTab),{mutation:true});
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

 receipt.key??=key;receipt.leaseId??=leaseId;receipt.ackUTC??=ackUTC;receipt.deadlines??=metadata.deadlines;await persistReceipt(receipt);
 await rejectPendingReceipts([pointerPath]);await writeFile(pointerPath,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({status:receipt.status,checks:receipt.checks?.length,error:receipt.error,restoration:receipt.restoration,captures:[receipt.communityCapture,receipt.downloadCapture]}));
 assert.equal(receipt.status,'complete',receipt.error??receipt.reason);
 return receipt;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 run().catch(error=>{console.error(error);process.exitCode=1;});
}
