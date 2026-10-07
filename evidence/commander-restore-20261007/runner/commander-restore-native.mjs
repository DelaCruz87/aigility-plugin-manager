// Import-safe maintenance source. Only an explicit fresh ROOT grant may execute it.
export async function runInner(r) {
 const fs=require('fs'),crypto=require('crypto'),path=require('path'),remote=require('electron').remote;
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),sha=p=>fs.existsSync(p)?hash(fs.readFileSync(p)):null,J=JSON.stringify;
 const host=app,doc=document,pm=app.plugins,win=remote.getCurrentWindow(),ID='cmdr',target=r.root+'/.obsidian/plugins/'+ID;
 const stable=o=>J(Array.isArray(o)?o.map(x=>JSON.parse(stable(x))):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,JSON.parse(stable(o[k]))])):o);
 let phase='preflight',started=false,firstGuardFailure=null;
 const ownExpected={...r.preimages},pins=r.pins;
 const ribbonKeys=['cmdr:Open settings','cmdr:Web viewer: Search the web','cmdr:Web viewer: Open web viewer'];
 if(r.targetScope==='remaining-two'&&!['Sandbox 2','Sandbox 3'].includes(r.vault))throw Error('Remaining scope forbids original target');
 const normalizeOwnRibbon=value=>{const copy=JSON.parse(J(value)),hidden=copy['left-ribbon']?.hiddenItems;if(r.allowOwnRibbon&&hidden){for(const k of ribbonKeys)if(k in hidden){if(hidden[k]!==false)throw Error('Unexpected own ribbon value '+k);delete hidden[k];}}return J(copy);};
 const workspaceGuard=()=>{if(!r.workspacePath)return;const current=fs.readFileSync(r.workspacePath);if(!['load','readback'].includes(phase)){if(hash(current)!==r.workspaceSha)throw Error('Workspace preimage changed before own lifecycle');}else if(normalizeOwnRibbon(JSON.parse(current.toString()))!==normalizeOwnRibbon(r.workspaceBefore))throw Error('Foreign workspace file changed');};
 const identity=()=>{
  const st=fs.statSync(app.vault.adapter.getBasePath());
  if(app!==host||document!==doc||pm!==app.plugins||app.appId!==r.native.appId||app.vault.getName()!==r.native.vault||app.vault.adapter.getBasePath()!==r.root||fs.realpathSync(r.root)!==r.native.physicalRoot||st.dev!==r.native.dev||st.ino!==r.native.ino||win.id!==r.native.window||win.webContents.id!==r.native.wc||win.webContents.isCrashed()||document.URL!==r.native.document)throw Error('Native identity changed');
  if(Date.now()>=Date.parse(r.actionBy)||Date.now()>=Date.parse(r.rootHardBy))throw Error('Action deadline expired');
  for(const [p,s]of Object.entries(pins))if(sha(p)!==s)throw Error('Frozen pin drift '+p);
  if(!fs.readFileSync(r.leasePath,'utf8').includes(r.token))throw Error('Lease token changed');
 };
 const files=()=>{
  for(const [p,s]of Object.entries(r.protectedFiles))if(sha(p)!==s)throw Error('Protected config changed '+p);
  for(const [n,s]of Object.entries(ownExpected))if(sha(target+'/'+n)!==s)throw Error('Own artifact CAS drift '+n);
  for(const [n,a]of Object.entries(r.artifacts))if(sha(a.source)!==a.sha)throw Error('Candidate source drift '+n);
  workspaceGuard();
 };
 identity();files();
 if(Boolean(pm.plugins[ID]?._loaded)!==r.expectedLoaded||pm.enabledPlugins.has(ID)!==r.expectedNative||r.expectedLoaded)throw Error('NO_START Commander profile changed/already loaded');
 const candidate={};for(const[n,a]of Object.entries(r.artifacts)){const b=fs.readFileSync(a.source);if(hash(b)!==a.sha)throw Error('NO_START frozen buffer differs from approved SHA '+n);candidate[n]=b;}
 if(Object.keys(candidate).sort().join(',')!=='main.js,manifest.json,styles.css')throw Error('Only own3 artifacts allowed');
 const manifest=JSON.parse(candidate['manifest.json'].toString());
 const hostManifest=m=>{const copy={...m};if('dir' in copy){if(copy.dir!=='.obsidian/plugins/cmdr'&&copy.dir!==target)throw Error('Unexpected registered manifest directory');delete copy.dir;}return copy;};
 if(manifest.id!==ID||stable(manifest)!==stable(hostManifest(pm.manifests[ID])))throw Error('Registered manifest differs semantically');
 const dataPath=target+'/data.json',cfg=JSON.parse(fs.readFileSync(dataPath,'utf8'));
 if(cfg.spacingReset!==true||['seenEditorMenuItems','seenFileMenuItems'].some(k=>k in (cfg.hide??{}))||(cfg.macros??[]).some(m=>m.startup))throw Error('NO_START Commander migration/startup macro would alter protected state');
 const settings=app.setting,settingValues=[settings.isOpen,settings.lastTabId,settings.doc,settings.modalEl],leaf=app.workspace.activeLeaf,layout=J(app.workspace.getLayout()),layoutNormalized=normalizeOwnRibbon(app.workspace.getLayout()),focus=document.activeElement;
 const buffers=()=>{const b=[];app.workspace.iterateAllLeaves(l=>b.push([l.id,l.view?.getViewType?.(),l.view?.editor?.getValue?hash(l.view.editor.getValue()):null]));return J(b);},beforeBuffers=buffers();
 const foreign=Object.entries(pm.plugins).filter(([id])=>id!==ID),foreignKeys=foreign.map(([id])=>id).sort(),nativeOrder=J([...pm.enabledPlugins]);
 const cores=Object.entries(app.internalPlugins.plugins).map(([id,p])=>[id,p.enabled,p.instance]);
 const windows=remote.BrowserWindow.getAllWindows(),windowState=windows.map(w=>[w,w.webContents,w.webContents.isCrashed()]);
 const focused=remote.BrowserWindow.getFocusedWindow?.()??remote.getFocusedWindow?.()??null;
 const foreignUnchanged=()=>{
  identity();files();
  const failures=[];
  if(J([...pm.enabledPlugins])!==nativeOrder)failures.push('native-flags-order');
  if(J(Object.keys(pm.plugins).filter(id=>id!==ID).sort())!==J(foreignKeys)||foreign.some(([id,p])=>pm.plugins[id]!==p))failures.push('foreign-plugins');
  if(cores.some(([id,on,i])=>app.internalPlugins.plugins[id]?.enabled!==on||app.internalPlugins.plugins[id]?.instance!==i))failures.push('core');
  if(app.setting!==settings||settings.isOpen!==settingValues[0]||settings.lastTabId!==settingValues[1]||settings.doc!==settingValues[2]||settings.modalEl!==settingValues[3])failures.push('settings');
  if(app.workspace.activeLeaf!==leaf)failures.push('active-leaf');
  if(normalizeOwnRibbon(app.workspace.getLayout())!==layoutNormalized)failures.push('foreign-layout');
  if(buffers()!==beforeBuffers)failures.push('buffers');
  const ws=remote.BrowserWindow.getAllWindows();if(ws.length!==windows.length||windowState.some(([w,c,crashed])=>!ws.includes(w)||w.webContents!==c||c.isCrashed()!==crashed))failures.push('windows-crash-flags');
  if(document.activeElement!==focus||(remote.BrowserWindow.getFocusedWindow?.()??remote.getFocusedWindow?.()??null)!==focused)failures.push('focus');
  if(failures.length){firstGuardFailure??={phase,failed:failures,before:{activeLeaf:leaf?.id??null,layoutHash:hash(layout),buffersHash:hash(beforeBuffers)},after:{activeLeaf:app.workspace.activeLeaf?.id??null,layoutHash:hash(J(app.workspace.getLayout())),buffersHash:hash(buffers())},at:new Date().toISOString()};throw Error('Preservation guard failed '+failures.join(','));}
 };
 if(r.runtimeBefore){
  const current={native:JSON.parse(nativeOrder),foreign:foreign.map(([id,p])=>({id,loaded:Boolean(p._loaded),native:pm.enabledPlugins.has(id)})).sort((a,b)=>a.id.localeCompare(b.id)),core:cores.map(([id,on,i])=>({id,enabled:on,hasInstance:Boolean(i)})).sort((a,b)=>a.id.localeCompare(b.id)),settings:{open:settings.isOpen,last:settings.lastTabId,doc:settings.doc?.URL??null,modalDoc:settings.modalEl?.ownerDocument?.URL??null},activeLeaf:leaf?.id??null,layoutHash:hash(layout),buffersHash:hash(beforeBuffers)};
  if(J(current)!==J(r.runtimeBefore))throw Error('NO_START stale runtime baseline');
 }
 foreignUnchanged();
 const durable=(p,b)=>{const fd=fs.openSync(p,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const cleanupGate=()=>{if(Date.now()>=Date.parse(r.totalBy)||Date.now()>=Date.parse(r.rootHardBy))throw Error('Receipt cleanup deadline');};
 const sync=p=>{const fd=fs.openSync(p,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 try{
  phase='backup';fs.mkdirSync(r.backupPath);started=true;
  const protectedBytes=Object.fromEntries(Object.keys(r.protectedFiles).map(p=>[p,fs.existsSync(p)?fs.readFileSync(p):null]));
  let k=0;for(const[p,b]of Object.entries(protectedBytes))if(b!==null)durable(r.backupPath+'/protected-'+(++k)+'.bak',b);
  if(r.workspacePath)durable(r.backupPath+'/workspace.json.bak',fs.readFileSync(r.workspacePath));
  for(const n of Object.keys(candidate))if(fs.existsSync(target+'/'+n))durable(r.backupPath+'/'+n+'.bak',fs.readFileSync(target+'/'+n));
  durable(r.backupPath+'/baseline.json',J({job:r.job,token:r.token,preimages:r.preimages,protectedFiles:r.protectedFiles,nativeOrder:JSON.parse(nativeOrder)},null,2));sync(r.backupPath);sync(path.dirname(r.backupPath));foreignUnchanged();
  phase='copy';for(const[n,b]of Object.entries(candidate)){foreignUnchanged();const fd=fs.openSync(target+'/'+n,'w');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}ownExpected[n]=hash(b);if(sha(target+'/'+n)!==ownExpected[n])throw Error('Own copy readback failed '+n);}
  sync(target);foreignUnchanged();
  if(r.expectedNative){phase='load';foreignUnchanged();await pm.loadPlugin(ID);foreignUnchanged();if(!pm.plugins[ID]?._loaded||stable(hostManifest(pm.plugins[ID].manifest))!==stable(manifest))throw Error('Commander load readback failed');}
  phase='readback';foreignUnchanged();
  const receipt={job:r.job,token:r.token,status:'SETTLED',pending:false,phase,loaded:Boolean(pm.plugins[ID]?._loaded),native:pm.enabledPlugins.has(ID),configsPreserved:true,foreignPreserved:true,artifacts:ownExpected,workspacePostSha:r.workspacePath?sha(r.workspacePath):null,ownRibbonKeys:r.allowOwnRibbon?Object.fromEntries(ribbonKeys.map(k=>[k,app.workspace.getLayout()['left-ribbon']?.hiddenItems?.[k]??null])):null,firstGuardFailure:null,at:new Date().toISOString()};
  cleanupGate();durable(r.resultPath,J(receipt,null,2));sync(path.dirname(r.resultPath));return receipt;
 }catch(e){
  const receipt={job:r.job,token:r.token,status:'FAILED_PRESERVED',pending:true,phase,error:String(e),firstGuardFailure,started,at:new Date().toISOString()};
  if(started)try{cleanupGate();durable(r.resultPath,J(receipt,null,2));sync(path.dirname(r.resultPath));}catch(err){receipt.receiptError=String(err);}
  return receipt;
 }
}

// Starts a single asynchronous job; returns immediately, then polls the same token.
export function runOuter(r){
 const fs=require('fs'),crypto=require('crypto'),path=require('path'),remote=require('electron').remote;
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),sha=p=>fs.existsSync(p)?hash(fs.readFileSync(p)):null,J=JSON.stringify;
 const host=app,doc=document,win=remote.getCurrentWindow();
 const windows=remote.BrowserWindow.getAllWindows(),captured=windows.map(w=>[w,w.webContents,w.webContents.isCrashed()]),focus=remote.BrowserWindow.getFocusedWindow();
 const expected={...r.baselineFiles},startedWorkspaces=new Set();
 const ribbonKeys=['cmdr:Open settings','cmdr:Web viewer: Search the web','cmdr:Web viewer: Open web viewer'];
 const normalize=value=>{const c=JSON.parse(J(value)),h=c['left-ribbon']?.hiddenItems;if(h)for(const k of ribbonKeys)if(k in h){if(h[k]!==false)throw Error('Unexpected own ribbon value');delete h[k];}return J(c);};
 const gate=()=>{
  if(app!==host||document!==doc||app.appId!==r.native.appId||app.vault.getName()!==r.native.vault||fs.realpathSync(app.vault.adapter.getBasePath())!==r.native.physicalRoot||win.id!==r.native.window||win.webContents.id!==r.native.wc||win.webContents.isCrashed()||document.URL!==r.native.document)throw Error('Outer identity changed');
  const st=fs.statSync(app.vault.adapter.getBasePath());if(st.dev!==r.native.dev||st.ino!==r.native.ino)throw Error('Outer physical root changed');
  if(Date.now()>=Date.parse(r.actionBy)||Date.now()>=Date.parse(r.rootHardBy))throw Error('Outer deadline');
  for(const[p,s]of Object.entries(r.pins))if(sha(p)!==s)throw Error('Outer frozen pin changed '+p);
  if(sha(r.emissionPath)!==r.emissionSha)throw Error('Actual emission file changed');
  for(const[p,s]of Object.entries(r.protectedFiles))if(sha(p)!==s)throw Error('Outer protected config changed '+p);
  for(const t of r.targets)if(t.workspacePath){if(!startedWorkspaces.has(t.workspacePath)){if(sha(t.workspacePath)!==t.workspaceSha)throw Error('Outer workspace preimage changed');}else if(normalize(JSON.parse(fs.readFileSync(t.workspacePath,'utf8')))!==normalize(t.workspaceBefore))throw Error('Outer foreign workspace changed');}
  if(!fs.readFileSync(r.leasePath,'utf8').includes(r.token))throw Error('Outer lease token changed');
  const ws=remote.BrowserWindow.getAllWindows();if(ws.length!==windows.length||captured.some(([w,c,x])=>!ws.includes(w)||w.webContents!==c||c.isCrashed()!==x)||remote.BrowserWindow.getFocusedWindow()!==focus)throw Error('Outer window/focus changed');
 };
 const ownFiles=()=>{for(const[p,s]of Object.entries(expected))if(sha(p)!==s)throw Error('Global own artifact CAS changed '+p);};
 gate();ownFiles();
 if(sha(r.emissionPath)!==r.emissionSha||J(JSON.parse(fs.readFileSync(r.emissionPath,'utf8')))!==J(r.invocations))throw Error('Frozen actual emissions differ');
 if(r.windowsBefore&&J(windows.map(w=>({id:w.id,wc:w.webContents.id,crashed:w.webContents.isCrashed()})))!==J(r.windowsBefore))throw Error('NO_START stale global windows');
 if('focusBefore' in r&&(focus?.id??null)!==r.focusBefore)throw Error('NO_START stale foreground');
 if(r.targetScope==='remaining-two'){if(r.targets.length!==2||J(r.targets.map(t=>t.vault).sort())!==J(['Sandbox 2','Sandbox 3'])||new Set(r.targets.map(t=>t.root)).size!==2)throw Error('Remaining scope forbids original target');}
 else if(r.targets.length!==3||new Set(r.targets.map(t=>t.root)).size!==3)throw Error('Exactly three unique Sandbox targets');
 const invocations=r.targets.map(t=>{const matches=windows.filter(w=>w.id===t.native.window&&w.webContents.id===t.native.wc&&!w.webContents.isCrashed());if(matches.length!==1)throw Error('Target window not unique/healthy');const emission=r.invocations?.find(e=>e.root===t.root);if(!emission||hash(emission.source)!==emission.sha)throw Error('Exact precompiled invocation pin missing');return{target:t,window:matches[0],source:emission.source};});
 const jobs=window.__commanderRestoreJobs??=new Map();if(jobs.has(r.token))throw Error('Begin duplicate forbidden');
 const q={job:r.job,token:r.token,status:'RUNNING',pending:true,phase:'preflight',taskSettled:false,results:[]};jobs.set(r.token,q);
 const durable=(p,b)=>{const fd=fs.openSync(p,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const d=fs.openSync(path.dirname(p),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}};
 q.task=(async()=>{
  try{
   // All configs and present own3 are durable before the first target lifecycle.
   gate();ownFiles();fs.mkdirSync(r.backupPath);let n=0;
   for(const p of new Set([...Object.keys(r.protectedFiles),...Object.keys(expected),...r.targets.map(t=>t.workspacePath).filter(Boolean)])){gate();ownFiles();if(fs.existsSync(p))durable(r.backupPath+'/preimage-'+(++n)+'.bak',fs.readFileSync(p));}
   durable(r.backupPath+'/index.json',J({protectedFiles:r.protectedFiles,ownFiles:expected},null,2));
   const parent=fs.openSync(path.dirname(r.backupPath),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
   for(const item of invocations){
    gate();ownFiles();q.phase='restore-'+item.target.vault;
    if(item.target.workspacePath)startedWorkspaces.add(item.target.workspacePath);
    const out=await item.window.webContents.executeJavaScript(item.source);
    gate();
    // Known postimages are accepted only from this exact settled target result.
    if(out?.status!=='SETTLED')throw Error('Target FAILED_PRESERVED '+J(out));
    for(const[n,a]of Object.entries(item.target.artifacts))expected[item.target.root+'/.obsidian/plugins/cmdr/'+n]=a.sha;
    ownFiles();q.results.push(out);
   }
   q.phase='final-readback';gate();ownFiles();q.status='SETTLED';q.pending=false;
  }catch(e){q.status='FAILED_PRESERVED';q.pending=true;q.error=String(e);}
  finally{
   const receipt={job:r.job,token:r.token,status:q.status,pending:q.pending,phase:q.phase,results:q.results,error:q.error??null,at:new Date().toISOString()};
   try{if(Date.now()>=Date.parse(r.totalBy)||Date.now()>=Date.parse(r.rootHardBy))throw Error('Outer receipt cleanup deadline');durable(r.outerResultPath,J(receipt,null,2));q.receipt=receipt;}catch(e){q.receipt={...receipt,pending:true,receiptError:String(e)};q.pending=true;}
   q.taskSettled=true;
  }
 })();
 return J({job:r.job,token:r.token,status:q.status,pending:q.pending});
}

// Readonly snapshot compiled and dispatched only with ROOT preparation permission.
export function snapshotNative(t){
 const fs=require('fs'),crypto=require('crypto'),remote=require('electron').remote,hash=b=>crypto.createHash('sha256').update(b).digest('hex'),J=JSON.stringify;
 const w=remote.getCurrentWindow(),st=fs.statSync(app.vault.adapter.getBasePath());
 if(app.appId!==t.appId||app.vault.getName()!==t.name||fs.realpathSync(app.vault.adapter.getBasePath())!==t.root||w.id!==t.window||w.webContents.id!==t.wc||w.webContents.isCrashed()||document.URL!=='app://obsidian.md/index.html')throw Error('Readonly exact realm mismatch');
 const pm=app.plugins,settings=app.setting,values=[];app.workspace.iterateAllLeaves(l=>values.push([l.id,l.view?.getViewType?.(),l.view?.editor?.getValue?hash(l.view.editor.getValue()):null]));
 return {native:{vault:t.name,appId:t.appId,window:t.window,wc:t.wc,document:document.URL,physicalRoot:t.root,dev:st.dev,ino:st.ino},cmdr:{loaded:Boolean(pm.plugins.cmdr?._loaded),native:pm.enabledPlugins.has('cmdr'),manifest:pm.manifests.cmdr},runtimeBefore:{native:[...pm.enabledPlugins],foreign:Object.entries(pm.plugins).filter(([id])=>id!=='cmdr').map(([id,p])=>({id,loaded:Boolean(p._loaded),native:pm.enabledPlugins.has(id)})).sort((a,b)=>a.id.localeCompare(b.id)),core:Object.entries(app.internalPlugins.plugins).map(([id,p])=>({id,enabled:p.enabled,hasInstance:Boolean(p.instance)})).sort((a,b)=>a.id.localeCompare(b.id)),settings:{open:settings.isOpen,last:settings.lastTabId,doc:settings.doc?.URL??null,modalDoc:settings.modalEl?.ownerDocument?.URL??null},activeLeaf:app.workspace.activeLeaf?.id??null,layoutHash:hash(J(app.workspace.getLayout())),buffersHash:hash(J(values))}};
}
