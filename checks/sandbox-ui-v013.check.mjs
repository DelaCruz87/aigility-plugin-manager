import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,VAULT_PATH,VAULT,APP_ID,MANAGER_ID,OBSIDIAN,J,hash,parseCliJson} from '../scripts/sandbox-community.mjs';
const execute=promisify(execFile);
export const TOTAL_MS=120000,CLEANUP_MS=35000;
export function uiGate(deadline,now=Date.now()){if(now>=deadline)throw Error('UI lease expired before next action');}
export function matchingRestore(before,post,current){return JSON.stringify(post)===JSON.stringify(current)?structuredClone(before):null;}
export async function nativeUI(app,globalThis,settingsImage,downloadImage,key,deadline,cleanupDeadline){
 const gate=()=>uiGate(deadline),cleanupGate=()=>uiGate(cleanupDeadline);
 const job=globalThis[key]={status:'pending',phase:'preflight',startedAt:new Date().toISOString(),checks:[],restoration:{}};
 const check=(label,pass,data)=>{job.checks.push({label,pass:!!pass,...(data?{data}:{})});if(!pass)throw Error(label);};
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const crypto=require('crypto'),digest=v=>crypto.createHash('sha256').update(v).digest('hex');
 const adapter=app.vault.adapter,P=app.plugins.plugins['aigility-plugin-manager'],ui=P.managerUI,settings=app.setting;
 const foreign=()=>Object.entries(app.plugins.manifests).filter(([id])=>id!=='aigility-plugin-manager').map(([id,m])=>({id,version:m.version,native:app.plugins.enabledPlugins.has(id),loaded:app.plugins.plugins[id]?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
 const cores=()=>Object.entries(app.internalPlugins.plugins).map(([id,w])=>({id,enabled:w.enabled,loaded:w.instance?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id));
 const prior={filter:structuredClone(ui.filterCriteria),sidebar:structuredClone(ui.sidebarFilterCriteria),tab:settings.lastTabId,leaf:app.workspace.activeLeaf,leaves:[],foreign:foreign(),core:cores(),local:JSON.stringify(P.runtime.local)};
 app.workspace.iterateAllLeaves(l=>prior.leaves.push(l.id));
 const dataPath=P.manifest.dir+'/data.json';prior.dataHash=digest(await adapter.read(dataPath));gate();
 let ownedFilter=structuredClone(prior.filter),ownedSidebar=structuredClone(prior.sidebar),ownModal=null,sd=null;
 const wait=async(predicate,label)=>{for(let i=0;i<80;i++){gate();if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI did not render: '+label);};
 const visible=n=>{if(!n?.isConnected)return false;const c=n.ownerDocument.defaultView.getComputedStyle(n);return c.display!=='none'&&c.visibility!=='hidden'&&n.getBoundingClientRect().height>0;};
 const event=(n,name)=>n.dispatchEvent(new n.ownerDocument.defaultView.Event(name,{bubbles:true}));
 const docs=()=>[settings.doc,document].filter(Boolean);
 const q=selector=>docs().map(d=>d.querySelector(selector)).find(Boolean);
 const setFilter=(selector,value,name='change')=>{gate();const n=sd.querySelector(selector);check('Control '+selector,!!n);n.value=value;event(n,name);ownedFilter=structuredClone(ui.filterCriteria);};
 const capture=async(doc,imagePath)=>{gate();const wins=require('@electron/remote').BrowserWindow.getAllWindows();const win=doc===document?require('@electron/remote').getCurrentWindow():wins.find(w=>w.getTitle().startsWith('Settings - '+app.vault.getName()+' - Obsidian'));check('Native capture window exists',!!win);const modal=doc.querySelector('.aigility-options-modal')?.closest('.modal');const rect=modal?.getBoundingClientRect();const clip=rect?{x:Math.max(0,Math.floor(rect.x)),y:Math.max(0,Math.floor(rect.y)),width:Math.ceil(rect.width),height:Math.ceil(rect.height)}:undefined;const image=await win.webContents.capturePage(clip);gate();require('fs').writeFileSync(imagePath,image.toPNG());return {path:imagePath,size:image.getSize(),kind:'native Electron capturePage, physical desktop locked'};};
 try{
  gate();check('Correct Sandbox identity',app.vault.getName()==='Sandbox'&&adapter.getBasePath()==='/Users/eme/Obsidian/Sandbox'&&app.appId==='d137282e82167d84');
  check('Native loaded0.1.3',P._loaded&&P.manifest.version==='0.1.3');
  check('Settings initially closed',!settings.modalEl?.isConnected);
  check('No previous manager modal',!q('.aigility-options-modal'));
  check('Recovery remains paused',!!P.runtime.local.recoveryReason&&!P.runtime.local.deviceProfileId&&!P.runtime.local.operationPending&&!P.runtime.state.debug?.active);
  gate();settings.open();await wait(()=>settings.doc?.querySelector('.vertical-tab-content'),'Settings document');
  sd=settings.doc;gate();settings.openTabById('community-plugins');await wait(()=>sd.querySelector('.aigility-manager-root'),'integrated Community list');
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
  gate();settings.openTabById('appearance');gate();settings.openTabById('community-plugins');check('Direct tab switch mounts once',sd.querySelectorAll('.aigility-manager-installed-container').length===1);
  job.phase='capture-community';job.communityCapture=await capture(sd,settingsImage);
  gate();sd.querySelector('.aigility-options-btn').click();await wait(()=>q('.aigility-options-modal'),'Options');ownModal=q('.aigility-options-modal').closest('.modal-container');
  const options=q('.aigility-options-modal'),nav=[...options.querySelectorAll('.aigility-nav-tab')];check('Seven option sections',nav.length===7,{labels:nav.map(n=>n.textContent)});
  const downloaded=nav.find(n=>n.textContent==='Descargados');check('Downloaded section exists',!!downloaded);gate();downloaded.click();
  const section=options.querySelector('.archive-manager-section');check('Archive section renders',!!section);check('Configured archive root',P.archive.root==='.obsidian/plugins/_archive');
  const safety=P.archive.safety();job.archiveSafety=safety;check('Actual Sync safety refuses physical move',safety.allowed===false&&/sync/i.test(safety.reason));
  check('Visible Sync warning',visible(section.querySelector('.archive-safety-warning')));check('No archive action can run',[...section.querySelectorAll('.archive-action-btn')].every(n=>n.disabled));
  check('Downloaded list is bounded',section.querySelectorAll('.archive-item-row').length<=50);
  const search=section.querySelector('.archive-search-input');gate();search.value='aigility-plugin-manager';event(search,'input');check('Downloaded ID search',section.querySelectorAll('.archive-item-row').length===1);
  gate();search.value='';event(search,'input');
  job.downloadCapture=await capture(section.ownerDocument,downloadImage);
 }catch(error){job.error=String(error);}
 finally{
  job.phase='cleanup';const restore=async(label,fn)=>{try{cleanupGate();await fn();job.restoration[label]=true;}catch(error){job.restoration[label]=false;job.restoration.errors??=[];job.restoration.errors.push({label,error:String(error)});}};
  await restore('ownModal',()=>{if(ownModal?.isConnected){const close=ownModal.querySelector('.modal-close-button');if(!close)throw Error('Own modal close unavailable');close.click();}});
  await restore('filters',()=>{const f=matchingRestore(prior.filter,ownedFilter,ui.filterCriteria),s=matchingRestore(prior.sidebar,ownedSidebar,ui.sidebarFilterCriteria);if(!f||!s)throw Error('Manual filter edit preserved, cleanup conflicts');ui.filterCriteria=f;ui.sidebarFilterCriteria=s;ui.applySidebarFilter(settings);ui.refreshList();});
  await restore('settings',()=>{if(settings.modalEl?.isConnected)settings.close();if(settings.lastTabId==='community-plugins')settings.lastTabId=prior.tab;});
  await restore('foreign',()=>check('Foreign plugins unchanged',equal(prior.foreign,foreign())&&equal(prior.core,cores())));
  await restore('data',async()=>check('Manager data unchanged',prior.dataHash===digest(await adapter.read(dataPath))));
  await restore('local',()=>check('Local recovery/profile unchanged',prior.local===JSON.stringify(P.runtime.local)));
  await restore('workspace',()=>{const leaves=[];app.workspace.iterateAllLeaves(l=>leaves.push(l.id));check('Workspace and leaf unchanged',app.workspace.activeLeaf===prior.leaf&&equal(leaves,prior.leaves));});
  job.status=job.error||job.restoration.errors?.length?'failed':'complete';job.finishedAt=new Date().toISOString();
 }
 return job;
}
export function uiBody(key,deadline,cleanupDeadline,communityImage,downloadImage){return `const uiGate=${uiGate.toString()};const matchingRestore=${matchingRestore.toString()};value=await (${nativeUI.toString()})(app,globalThis,${J(communityImage)},${J(downloadImage)},${J(key)},${deadline},${cleanupDeadline});`;}
export async function run(){
 assert.equal(process.env.AIGILITY_SANDBOX_UI_AUTHORIZED,'1');
 const ready=JSON.parse(await readFile(path.join(ROOT,'evidence/sandbox-ui-v013-ready.json'),'utf8'));assert.equal(ready.status,'ready-offline-ui-v013');assert.equal(hash(await readFile(fileURLToPath(import.meta.url))),ready.checkSha256);
 for(const file of ['main.js','manifest.json','styles.css'])assert.equal(hash(await readFile(path.join(VAULT_PATH,'.obsidian/plugins',MANAGER_ID,file))),ready.files[file]);
 const deadline=Date.now()+TOTAL_MS,key='aigility-manager-ui:'+Date.now(),images=path.join(ROOT,'evidence/native-ui-v013');await mkdir(images,{recursive:true});
 const host=async body=>{const code=`(async()=>{let value;try{if(app.vault.getName()!==${J(VAULT)}||app.vault.adapter.getBasePath()!==${J(VAULT_PATH)}||app.appId!==${J(APP_ID)})throw Error('Wrong Sandbox');${body};return JSON.stringify({ok:true,value});}catch(error){return JSON.stringify({ok:false,error:String(error)});}})()`;new Function('return '+code);const {stdout}=await execute(OBSIDIAN,[`vault=${VAULT}`,'eval',`code=${code}`],{timeout:Math.min(15000,Math.max(1,deadline-Date.now())),maxBuffer:1024*1024});const r=parseCliJson(stdout);assert(r.ok,r.error);return r.value;};
 const pending=await host("value=Object.keys(globalThis).filter(k=>k.startsWith('aigility-manager-ui:')&&globalThis[k]?.status==='pending');");assert.deepEqual(pending,[]);
 let receipt;try{receipt=await host(uiBody(key,deadline-CLEANUP_MS,deadline,path.join(images,'community.png'),path.join(images,'downloaded.png')));}catch(error){console.error('UI operation did not return; read same token only:',String(error));}
 while(!receipt&&Date.now()<deadline-1000){await new Promise(r=>setTimeout(r,250));const r=await host(`value=globalThis[${J(key)}]??null;`);if(r&&r.status!=='pending')receipt=r;}
 receipt??={status:'pending',key,reason:'No further native action permitted until same job settles'};
 await writeFile(path.join(ROOT,'evidence/sandbox-ui-v013.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,checks:receipt.checks?.length,error:receipt.error,restoration:receipt.restoration,captures:[receipt.communityCapture,receipt.downloadCapture]}));assert.equal(receipt.status,'complete',receipt.error??receipt.reason);return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(error=>{console.error(error);process.exitCode=1;});
