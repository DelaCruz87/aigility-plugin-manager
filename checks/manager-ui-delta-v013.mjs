// Essential current UI acceptance only, after the published full acceptance.
// No plugin toggles, profile apply, settings edits, app activation or suite replay.
export function uiDelta(r) {
 const fs=require('fs'),crypto=require('crypto'),remote=require('@electron/remote'),J=JSON.stringify;
 const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),pm=app.plugins,P=pm.plugins['aigility-plugin-manager'],s=app.setting,doc=document,host=app,win=remote.getCurrentWindow(),root=fs.statSync(r.root);let bag=null,q=null;
 const gate=cleanup=>{const st=fs.statSync(app.vault.adapter.getBasePath());if(Date.now()>=(cleanup?r.deadline:r.actionDeadline)||app!==host||document!==doc||app.workspace.containerEl.ownerDocument!==doc||app.vault.getName()!==r.vault||app.appId!==r.appId||st.dev!==root.dev||st.ino!==root.ino||remote.getCurrentWindow().id!==r.window||win.webContents.id!==r.wc||pm.plugins['aigility-plugin-manager']!==P||P?._loaded!==true)throw Error('UI identity/deadline/instance');if(q&&(window.__managerUIDelta!==bag||bag.get(r.token)!==q||q.status!=='running'))throw Error('UI registry/job changed');};
 gate(false);if(s.modalEl?.isConnected||doc.querySelector('.aigility-options-modal'))throw Error('Preexisting Settings/options; preserve');
 bag=window.__managerUIDelta??=new Map();if(bag.has(r.token))throw Error('Duplicate token; poll same UI job');
 q={token:r.token,status:'running',phase:'preflight',pending:true,checks:[],startedAt:new Date().toISOString(),captures:[]};bag.set(r.token,q);
 const check=(name,pass)=>{q.checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
 const leaves=()=>{const a=[];app.workspace.iterateAllLeaves(l=>a.push({id:l.id,type:l.view?.getViewType?.(),state:l.view?.getState?.(),buffer:l.view?.editor?.getValue?sha(l.view.editor.getValue()):null}));return J(a);};
 const foreign=Object.entries(pm.plugins).filter(([id])=>id!=='aigility-plugin-manager'),core=Object.entries(app.internalPlugins.plugins).map(([id,w])=>[id,w.enabled,w.instance]);
 const paths=['community-plugins.json','core-plugins.json','plugins/aigility-plugin-manager/data.json','plugins/better-plugins-manager/data.json','plugins/better-plugins-manager-companion/data.json','workspace.json','workspaces.json'];
 const hashFile=p=>fs.existsSync(p)?sha(fs.readFileSync(p)):null,base=app.vault.adapter.getBasePath();
 const before={tab:s.lastTabId,leaf:app.workspace.activeLeaf,leaves:leaves(),focus:remote.BrowserWindow.getFocusedWindow()?.id??null,state:J(P.runtime.state),local:J(P.runtime.local),filter:J(P.managerUI.filterCriteria),sidebar:J(P.managerUI.sidebarFilterCriteria),hashes:Object.fromEntries(paths.map(p=>[p,hashFile(base+'/.obsidian/'+p)])),enabled:J([...pm.enabledPlugins].sort())};
 const wait=async(fn,cleanup=false)=>{while(!fn()){gate(cleanup);await new Promise(resolve=>setTimeout(resolve,40));gate(cleanup);}};
 const durable=(p,b)=>{const fd=fs.openSync(p,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 let ownedSettings=null,sd=null,ownedTab=null,options=null,optionDoc=null;
 const owned=cleanup=>{gate(cleanup);if(s.modalEl!==ownedSettings||s.doc!==sd||s.lastTabId!==ownedTab||ownedSettings?.ownerDocument!==sd)throw Error('Settings ownership CAS mismatch');};
 const visible=n=>{if(!n?.isConnected)return false;const x=n.getBoundingClientRect(),c=n.ownerDocument.defaultView.getComputedStyle(n);return x.width>0&&x.height>0&&c.display!=='none'&&c.visibility!=='hidden';};
 const capture=async(d,node,name)=>{owned(false);const ew=d===doc?win:d.defaultView?.electronWindow;if(!ew||ew.isDestroyed()||ew.webContents.isCrashed()||node.ownerDocument!==d||!node.isConnected)throw Error('Exact capture document/window missing');const wc=ew.webContents,wid=ew.id,wcid=wc.id,rect=node.getBoundingClientRect();if(rect.width<=0||rect.height<=0)throw Error('Capture rect invalid');const clip={x:Math.max(0,Math.floor(rect.x)),y:Math.max(0,Math.floor(rect.y)),width:Math.ceil(rect.width),height:Math.ceil(rect.height)};const image=await wc.capturePage(clip);owned(false);if(ew.id!==wid||ew.webContents!==wc||wc.id!==wcid||node.ownerDocument!==d)throw Error('Capture target replaced');const p=r.output+'/'+name+'.png';durable(p,image.toPNG());q.captures.push({path:p,window:wid,wc:wcid,documentURI:d.documentURI,clip,size:image.getSize(),sha:hashFile(p),pixelReview:'pending'});};
 q.task=(async()=>{try{
  fs.mkdirSync(r.output,{recursive:true});durable(r.output+'/intent.json',J({token:r.token,vault:r.vault,window:r.window,wc:r.wc,deadline:r.deadline,actionDeadline:r.actionDeadline,beforeTab:before.tab,settingsClosed:true,hashes:before.hashes},null,2));
  const fd=fs.openSync(r.output,'r');fs.fsyncSync(fd);fs.closeSync(fd);
  check('current loaded 0.1.3',P.manifest.version==='0.1.3');
  gate(false);q.phase='opening-settings';s.open();ownedSettings=s.modalEl;sd=s.doc;ownedTab=s.lastTabId;owned(false);
  s.openTabById('community-plugins');ownedTab='community-plugins';await wait(()=>sd.querySelector('.aigility-manager-root'));owned(false);
  check('native Community tab current',s.activeTab?.id==='community-plugins');
  check('one integrated list',sd.querySelectorAll('.aigility-manager-installed-container').length===1);
  check('community rows visible',sd.querySelectorAll('.aigility-plugin-row.kind-community').length>0&&visible(sd.querySelector('.aigility-plugin-row.kind-community')));
  check('core rows visible',sd.querySelectorAll('.aigility-plugin-row.kind-core').length>0&&visible(sd.querySelector('.aigility-plugin-row.kind-core')));
  const sidebar=sd.querySelector('.aigility-options-btn');check('native sidebar Options connected',visible(sidebar));
  check('recovery banner visible',visible(sd.querySelector('.aigility-recovery-banner')));
  q.phase='capturing-community';await capture(sd,ownedSettings,'community-current');
  owned(false);sidebar.click();await wait(()=>[doc,sd].some(d=>d.querySelector('.aigility-options-modal')));owned(false);
  optionDoc=[doc,sd].find(d=>d.querySelector('.aigility-options-modal'));options=optionDoc.querySelector('.aigility-options-modal').closest('.modal-container');
  check('Options native modal visible',visible(options));
  check('seven Options sections',options.querySelectorAll('.aigility-nav-tab').length===7);
  check('profiles remain seven',P.runtime.state.deviceProfiles.length===7);
  check('fixtures remain migrated',P.runtime.state.fixtureProfiles.length>=42);
  q.phase='capturing-options';await capture(optionDoc,options.querySelector('.modal'),'options-current');
 }catch(e){q.error=String(e);}finally{
  try{
   q.phase='cleanup';
   if(options?.isConnected){owned(true);if(optionDoc.querySelector('.aigility-options-modal')?.closest('.modal-container')!==options)throw Error('Options ownership replaced');const close=options.querySelector('.modal-close-button,.modal-close-btn')??options.querySelector('.modal-header-button svg.lucide-x')?.closest('.modal-header-button');if(!close)throw Error('Owned native Options close absent');close.click();await wait(()=>!options.isConnected,true);owned(true);}
   if(ownedSettings?.isConnected){owned(true);s.lastTabId=before.tab;ownedTab=before.tab;s.close();await wait(()=>!ownedSettings.isConnected,true);gate(true);}
   gate(true);check('owned Settings restored closed',!s.modalEl?.isConnected&&s.lastTabId===before.tab);
   check('state local filters unchanged',J(P.runtime.state)===before.state&&J(P.runtime.local)===before.local&&J(P.managerUI.filterCriteria)===before.filter&&J(P.managerUI.sidebarFilterCriteria)===before.sidebar);
   check('all configuration bytes unchanged',paths.every(p=>hashFile(base+'/.obsidian/'+p)===before.hashes[p]));
   check('enabled and foreign instances unchanged',J([...pm.enabledPlugins].sort())===before.enabled&&foreign.every(([id,p])=>pm.plugins[id]===p)&&Object.keys(pm.plugins).length===foreign.length+1);
   check('core instances unchanged',core.every(([id,e,p])=>app.internalPlugins.plugins[id].enabled===e&&app.internalPlugins.plugins[id].instance===p));
   check('leaves and focus unchanged',app.workspace.activeLeaf===before.leaf&&leaves()===before.leaves&&(remote.BrowserWindow.getFocusedWindow()?.id??null)===before.focus);
  }catch(e){q.error=(q.error??'')+'; '+String(e);}
  q.pending=false;q.status=q.error?'failed':'passed';q.phase='settled';q.completedAt=new Date().toISOString();q.receipt={token:q.token,status:q.status,pending:false,startedAt:q.startedAt,completedAt:q.completedAt,checks:q.checks,captures:q.captures,error:q.error??null};durable(r.output+'/result.json',J(q.receipt,null,2));
 }})();return {token:q.token,status:q.status,pending:q.pending};
}
