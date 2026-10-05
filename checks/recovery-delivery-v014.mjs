// Owned Manager update only. Source fixes are accepted separately by peer review.
export async function workspaceProjection(fs,path,deadline){
 const until=Math.min(Date.now()+1000,deadline);let prior=null;
 while(Date.now()<until){const raw=fs.readFileSync(path,'utf8');try{const value=JSON.parse(raw);delete value.lastOpenFiles;const next=JSON.stringify(value);if(next===prior)return next;prior=next;}catch(e){if(!(e instanceof SyntaxError))throw e;prior=null;}await new Promise(resolve=>require('timers').setTimeout(resolve,20));}
 throw Error('Workspace JSON projection unavailable within bounded read');
}
export function recoveryDelivery(r){
 const fs=require('fs'),crypto=require('crypto'),remote=require('@electron/remote'),J=JSON.stringify,sha=x=>crypto.createHash('sha256').update(x).digest('hex');
 const ID='aigility-plugin-manager',host=app,doc=document,pm=app.plugins,win=remote.getCurrentWindow(),base=app.vault.adapter.getBasePath(),old=pm.plugins[ID],target=base+'/.obsidian/plugins/'+ID;
 const hash=p=>fs.existsSync(p)?sha(fs.readFileSync(p)):null;
 const gate=(cleanup=false)=>{const a=fs.statSync(base),b=fs.statSync(r.root);if(Date.now()>=(cleanup?r.deadline:r.actionDeadline)||app!==host||document!==doc||app.plugins!==pm||app.workspace.containerEl.ownerDocument!==doc||app.vault.getName()!==r.vault||app.appId!==r.appId||win.id!==r.window||win.webContents.id!==r.wc||remote.getCurrentWindow().id!==r.window||win.webContents.isCrashed()||a.dev!==b.dev||a.ino!==b.ino||a.dev!==r.dev||a.ino!==r.ino)throw Error('Delivery identity/deadline');};
 gate();if(!old?._loaded||old.manifest.version!=='0.1.3'||old.runtime.local.operationPending||!pm.enabledPlugins.has(ID))throw Error('Expected settled native Manager 0.1.3');
 const bag=window.__managerRecoveryDelivery??=new Map();if(bag.has(r.token))throw Error('Duplicate token; poll same job');
 const registryGate=(cleanup=false)=>{gate(cleanup);if(window.__managerRecoveryDelivery!==bag||bag.get(r.token)!==q||q.status!=='running'||hash(r.controlPath)!==r.controlSha)throw Error('Delivery job/control changed');};
 const jobGate=()=>{registryGate();if((pm.plugins[ID]??null)!==q.expectedManager)throw Error('Delivery Manager changed');};
 const s=app.setting,modal=s.modalEl,settingsDoc=s.doc,tab=s.activeTab,last=s.lastTabId,connected=modal?.isConnected===true,leaf=app.workspace.activeLeaf,focus=remote.BrowserWindow.getFocusedWindow()?.id??null;
 if(connected||doc.querySelector('.aigility-options-modal'))throw Error('Preexisting Settings/options; preserve');
 const leafImage=()=>{const a=[];app.workspace.iterateAllLeaves(l=>a.push({id:l.id,type:l.view?.getViewType?.(),state:l.view?.getState?.(),buffer:l.view?.editor?.getValue?sha(l.view.editor.getValue()):null}));return J(a);};
 const leaves=leafImage(),layout=J(app.workspace.getLayout()),state=J(old.runtime.state),dataSha=hash(target+'/data.json'),localKey=old.runtime.localKey,localBefore=localStorage.getItem(localKey),enabled=J([...pm.enabledPlugins].sort());
 const foreign=Object.entries(pm.plugins).filter(([id])=>id!==ID),cores=Object.entries(app.internalPlugins.plugins).map(([id,w])=>[id,w.enabled,w.instance]),fixedNames=['community-plugins.json','core-plugins.json','plugins/better-plugins-manager/data.json','plugins/better-plugins-manager-companion/data.json','workspaces.json'];
 const fixed=Object.fromEntries(fixedNames.map(p=>[p,hash(base+'/.obsidian/'+p)]));let workspace=null,loaderOriginal=null,loaderDescriptor=null,hook=null,hookDescriptor=null,returned=null;
 const q={token:r.token,status:'running',phase:'preflight',pending:true,startedAt:new Date().toISOString(),checks:[],expectedManager:old};bag.set(r.token,q);
 const check=(name,value)=>{q.checks.push({name,pass:!!value});if(!value)throw Error(name);};
 const baseline=async()=>{jobGate();const current=await workspaceProjection(fs,base+'/.obsidian/workspace.json',r.actionDeadline);jobGate();if(current!==workspace||J(app.workspace.getLayout())!==layout||app.setting!==s||s.modalEl!==modal||s.doc!==settingsDoc||s.activeTab!==tab||s.lastTabId!==last||(s.modalEl?.isConnected===true)!==connected||app.workspace.activeLeaf!==leaf||leafImage()!==leaves||(remote.BrowserWindow.getFocusedWindow()?.id??null)!==focus)throw Error('Workspace/Settings/leaves/focus changed; preserve');for(const[p,h]of Object.entries(fixed))if(hash(base+'/.obsidian/'+p)!==h)throw Error('Foreign configuration changed '+p);if(J([...pm.enabledPlugins].sort())!==enabled||foreign.some(([id,p])=>pm.plugins[id]!==p)||Object.keys(pm.plugins).filter(id=>id!==ID).length!==foreign.length||cores.some(([id,e,p])=>app.internalPlugins.plugins[id].enabled!==e||app.internalPlugins.plugins[id].instance!==p))throw Error('Foreign/core native or loaded instance changed');if(hash(target+'/data.json')!==dataSha)throw Error('Manager State changed');};
 const durable=(p,b)=>{const fd=fs.openSync(p,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const sync=p=>{const fd=fs.openSync(p,'r');fs.fsyncSync(fd);fs.closeSync(fd);};
 q.task=(async()=>{try{
  workspace=await workspaceProjection(fs,base+'/.obsidian/workspace.json',r.actionDeadline);await baseline();
  for(const[p,h]of Object.entries(r.preimages))check('fresh file preimage '+p,hash(p)===h);
  check('State request CAS',dataSha===r.stateSha);
  check('State matches disk',J(JSON.parse(fs.readFileSync(target+'/data.json','utf8')))===state);
  check('foreign deferred already off or protected',old.runtime.state.deferred.filter(p=>p.enabled).every(p=>old.runtime.state.protected.includes('community:'+p.id)||old.runtime.state.protected.includes(p.id)||(!pm.enabledPlugins.has(p.id)&&!pm.plugins[p.id]?._loaded)));
  fs.mkdirSync(r.backup,{recursive:true});for(const n of ['main.js','manifest.json','styles.css','data.json'])durable(r.backup+'/'+n,fs.readFileSync(target+'/'+n));durable(r.backup+'/before.json',J({token:r.token,at:q.startedAt,vault:r.vault,window:r.window,wc:r.wc,dataSha,state,localKey,localBefore,enabled,fixed,workspaceSha:sha(workspace)},null,2));sync(r.backup);sync(r.backup+'/..');
  await old.runtime.enqueue('recovery-delivery-drain',async()=>{});await baseline();
  q.phase='unloading';await pm.disablePlugin(ID);gate();q.expectedManager=null;check('old Manager unloaded only',!pm.plugins[ID]&&old.runtime.disposed===true);await baseline();
  q.phase='copying';for(const[n,h]of Object.entries(r.artifacts)){await baseline();check('source frozen '+n,hash(r.source+'/'+n)===h);const installed=target+'/'+n;check('owned artifact CAS '+n,hash(installed)===r.preimages[installed]);fs.writeFileSync(installed,fs.readFileSync(r.source+'/'+n));sync(installed);check('installed new bytes '+n,hash(installed)===h);}sync(target);
  q.phase='manifest';await pm.loadManifest(app.vault.configDir+'/plugins/'+ID);await baseline();
  loaderOriginal=pm.loadPlugin;loaderDescriptor=Object.getOwnPropertyDescriptor(pm,'loadPlugin');let calls=0;
  const hookCAS=()=>{const d=Object.getOwnPropertyDescriptor(pm,'loadPlugin');if(!d||d.value!==hookDescriptor.value||d.writable!==hookDescriptor.writable||d.enumerable!==hookDescriptor.enumerable||d.configurable!==hookDescriptor.configurable)throw Error('Loader descriptor changed; preserve');};
  hook=function(...args){if(args[0]!==ID)return Reflect.apply(loaderOriginal,this,args);jobGate();hookCAS();if(this!==pm||++calls!==1)throw Error('Loader receiver/duplicate');return Promise.resolve(Reflect.apply(loaderOriginal,this,args)).then(P=>{registryGate();hookCAS();if(!P||pm.plugins[ID]!==P)throw Error('Returned actual Manager mismatch');returned=P;q.expectedManager=P;return P;});};
  durable(r.backup+'/loader-intent.json',J({token:r.token,hadOwnDescriptor:!!loaderDescriptor}));sync(r.backup);
  hookDescriptor={value:hook,writable:true,configurable:true,enumerable:loaderDescriptor?.enumerable??false};Object.defineProperty(pm,'loadPlugin',hookDescriptor);
  q.phase='loading';await pm.enablePlugin(ID);await baseline();const P=returned;
  check('new actual Manager loaded',P&&P!==old&&P._loaded===true&&P.manifest.version==='0.1.4'&&P.managerBuild==='aigility-plugin-manager/0.1.4'&&calls===1);
  check('complete State preserved',J(P.runtime.state)===state&&hash(target+'/data.json')===dataSha);
  check('local binding and recovery preserved',P.runtime.localKey===localKey&&localStorage.getItem(localKey)===localBefore&&!P.runtime.local.operationPending);
  check('seven profiles and42 fixtures',P.runtime.state.deviceProfiles.length===7&&P.runtime.state.fixtureProfiles.length===42);
  q.managerInstance=P;q.phase='verified';q.result={version:'0.1.4',loaded:true,native:true,dataSha,artifacts:r.artifacts,profiles:7,fixtures:42,backup:r.backup,foreignAndCorePreserved:true,settingsLeavesFocusPreserved:true,automationPaused:!!P.runtime.local.recoveryReason,boundProfileId:P.runtime.local.deviceProfileId??null,appliedProfileId:P.runtime.local.appliedProfileId??null};
 }catch(e){q.error=String(e);q.phase='failed';}finally{
  if(hook){try{registryGate(true);const d=Object.getOwnPropertyDescriptor(pm,'loadPlugin');if(!d||d.value!==hookDescriptor.value||d.writable!==hookDescriptor.writable||d.enumerable!==hookDescriptor.enumerable||d.configurable!==hookDescriptor.configurable)throw Error('Loader descriptor changed; preserve');if(loaderDescriptor)Object.defineProperty(pm,'loadPlugin',loaderDescriptor);else delete pm.loadPlugin;}catch(e){q.error=(q.error??'')+'; loader cleanup preserved: '+String(e);}}
  q.completedAt=new Date().toISOString();const receipt={token:r.token,status:q.error?'failed':'passed',pending:false,startedAt:q.startedAt,completedAt:q.completedAt,checks:q.checks,error:q.error??null,result:q.result??null};
  try{if(!fs.existsSync(r.backup))throw Error('Durable receipt directory unavailable');durable(r.backup+'/native-result.json',J(receipt,null,2));sync(r.backup);q.receipt=receipt;}catch(e){q.error=(q.error??'')+'; durable receipt failed: '+String(e);q.receipt={...receipt,status:'failed',error:q.error,durable:false};}
  q.pending=false;q.status=q.receipt.status;
 }})();return {token:r.token,status:q.status,pending:true};
}
