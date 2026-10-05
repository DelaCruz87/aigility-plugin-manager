// Bounded continuation of the published v0.1.3 delivery. No product changes.
// Reuses the existing durable backup, returned-loader, identity and CAS pattern.
export function delivery(request) {
 const fs=require('fs'),crypto=require('crypto'),remote=require('@electron/remote');
 const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),J=JSON.stringify;
 const root=request.root,base=app.vault.adapter.getBasePath(),host=app,doc=document,win=remote.getCurrentWindow(),pm=app.plugins;
 const ID='aigility-plugin-manager',legacy=['better-plugins-manager','better-plugins-manager-companion'];
 let bag=null,q=null;
 const legacyOriginal=Object.fromEntries(legacy.map(id=>[id,pm.plugins[id]??null]));
 const fileHash=p=>fs.existsSync(p)?sha(fs.readFileSync(p)):null;
 const identity=()=>{const a=fs.statSync(root),b=fs.statSync(base);return a.dev===request.dev&&a.ino===request.ino&&b.dev===a.dev&&b.ino===a.ino;};
 const gate=deadline=>{if(Date.now()>=deadline||app!==host||document!==doc||app.workspace.containerEl.ownerDocument!==doc||app.vault.getName()!==request.vault||app.appId!==request.appId||win.id!==request.window||win.webContents.id!==request.wc||remote.getCurrentWindow().id!==win.id||!identity())throw Error('Deadline/realm/root/window guard');if(q&&(window.__ensoManagerDelivery!==bag||bag.get(request.token)!==q||q.status!=='running'||!['preflight','copying','manifest','loading','retiring-legacy','preserving-omnisearch','verified','failed-preserved'].includes(q.phase)))throw Error('Owned registry/job/status/phase changed');};
 gate(request.deadline);
 const enabled=()=>[...pm.enabledPlugins].sort();
 const foreign=()=>Object.entries(pm.manifests).filter(([id])=>![ID,...legacy,'omnisearch'].includes(id)).map(([id,m])=>({id,version:m.version,instance:pm.plugins[id]??null,native:pm.enabledPlugins.has(id),loaded:pm.plugins[id]?._loaded===true}));
 const cores=()=>Object.entries(app.internalPlugins.plugins).map(([id,w])=>({id,enabled:w.enabled,instance:w.instance}));
 const leaves=()=>{const a=[];app.workspace.iterateAllLeaves(l=>a.push({id:l.id,type:l.view?.getViewType?.(),state:l.view?.getState?.(),buffer:l.view?.editor?.getValue?sha(l.view.editor.getValue()):null}));return J(a);};
 const s=app.setting,beforeSettings={modal:s.modalEl,doc:s.doc,tab:s.activeTab,last:s.lastTabId,connected:s.modalEl?.isConnected===true};
 const focus=remote.BrowserWindow.getFocusedWindow()?.id??null,leaf=app.workspace.activeLeaf,leafImage=leaves();
 const foreignBefore=foreign(),coreBefore=cores(),enabledBefore=enabled();
 const fixedPaths=['core-plugins.json','plugins/better-plugins-manager/data.json','plugins/better-plugins-manager-companion/data.json','workspace.json','workspaces.json'];
 const fixed=Object.fromEntries(fixedPaths.map(p=>[p,fileHash(base+'/.obsidian/'+p)]));
 const target=base+'/.obsidian/plugins/'+ID,configPath=base+'/.obsidian/community-plugins.json',omniBefore=pm.plugins.omnisearch;
 const baseline=()=>{gate(request.deadline);if(app.setting!==s||s.modalEl!==beforeSettings.modal||s.doc!==beforeSettings.doc||s.activeTab!==beforeSettings.tab||s.lastTabId!==beforeSettings.last||(s.modalEl?.isConnected===true)!==beforeSettings.connected||app.workspace.activeLeaf!==leaf||leaves()!==leafImage||(remote.BrowserWindow.getFocusedWindow()?.id??null)!==focus)throw Error('User Settings/leaves/focus changed; preserve');
  if(q.managerInstance&&pm.plugins[ID]!==q.managerInstance)throw Error('Returned Manager replaced; preserve');
  for(const id of legacy)if((pm.plugins[id]??null)!==q.legacyExpected[id])throw Error('Original legacy instance replaced: '+id);
  for(const [p,h] of Object.entries(fixed))if(fileHash(base+'/.obsidian/'+p)!==h)throw Error('Foreign configuration changed: '+p);
  const f=foreign();if(f.length!==foreignBefore.length||f.some((v,i)=>Object.keys(v).some(k=>v[k]!==foreignBefore[i][k])))throw Error('Foreign plugin changed');
  const c=cores();if(c.length!==coreBefore.length||c.some((v,i)=>v.id!==coreBefore[i].id||v.enabled!==coreBefore[i].enabled||v.instance!==coreBefore[i].instance))throw Error('Core changed');
 };
 bag=window.__ensoManagerDelivery??=new Map();if(bag.has(request.token))throw Error('Duplicate token; poll same job');
 q={token:request.token,status:'running',phase:'preflight',startedAt:new Date().toISOString(),checks:[],pending:true,legacyExpected:{...legacyOriginal}};bag.set(request.token,q);
 const check=(name,pass)=>{q.checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
 const wait=async predicate=>{while(!predicate()){baseline();gate(request.actionDeadline);await new Promise(resolve=>setTimeout(resolve,50));baseline();gate(request.actionDeadline);}};
 const durable=(p,b)=>{const fd=fs.openSync(p,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const sync=p=>{const fd=fs.openSync(p,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const receipt=()=>{const r={token:q.token,status:q.status,phase:q.phase,pending:q.pending,startedAt:q.startedAt,completedAt:q.completedAt,checks:q.checks,error:q.error??null,result:q.result??null};if(q.backup){const p=q.backup+'/native-result.json';if(!fs.existsSync(p))durable(p,J(r,null,2));sync(q.backup);}return r;};
 let loaderHook=null,loaderOriginal=null,loaderDescriptor=null;
 q.task=(async()=>{try{
  baseline();gate(request.actionDeadline);
  if(request.action==='deploy'){
   check('new Manager absent',!pm.plugins[ID]&&!pm.manifests[ID]&&!fs.existsSync(target));
   check('late load only',app.workspace.layoutReady===true);
   check('legacy source managers present',legacy.every(id=>pm.plugins[id]?._loaded===true&&pm.enabledPlugins.has(id)));
   check('BPM unload has no delay or ribbon side effects',pm.plugins[legacy[0]].settings.DELAY===false&&pm.plugins[legacy[0]].settings.RIBBON_MANAGER_ENABLED===false);
   check('Omnisearch baseline',pm.plugins.omnisearch?._loaded===true&&!pm.enabledPlugins.has('omnisearch'));
   for(const [p,h] of Object.entries(request.preimages))check('frozen source '+p,fileHash(p)===h);
   const bpmRaw=fs.readFileSync(base+'/.obsidian/plugins/'+legacy[0]+'/data.json','utf8'),compRaw=fs.readFileSync(base+'/.obsidian/plugins/'+legacy[1]+'/data.json','utf8'),bpm=JSON.parse(bpmRaw),comp=JSON.parse(compRaw);
   const communityRaw=fs.readFileSync(configPath,'utf8'),coreRaw=fs.readFileSync(base+'/.obsidian/core-plugins.json','utf8');
   const localKey='aigility-plugin-manager:local:v1:'+encodeURIComponent(app.appId)+':'+encodeURIComponent(base),localBefore=localStorage.getItem(localKey);
   check('no stale binding/pending operation',localBefore===null||(!JSON.parse(localBefore).deviceProfileId&&!JSON.parse(localBefore).operationPending));
   check('only active deferred is Omni',comp.deferred.filter(x=>x.enabled).length===1&&comp.deferred.find(x=>x.id==='omnisearch')?.enabled===true);
   q.backup=request.backup;fs.mkdirSync(q.backup,{recursive:true});
   for(const [n,raw] of Object.entries({'legacy-bpm.json':bpmRaw,'legacy-companion.json':compRaw,'community-plugins.json':communityRaw,'core-plugins.json':coreRaw}))durable(q.backup+'/'+n,raw);
   for(const p of ['workspace.json','workspaces.json'])if(fs.existsSync(base+'/.obsidian/'+p))durable(q.backup+'/'+p,fs.readFileSync(base+'/.obsidian/'+p));
   durable(q.backup+'/before.json',J({token:q.token,at:q.startedAt,root,window:win.id,wc:win.webContents.id,localKey,localBefore,managerAbsent:true,artifactsAbsent:true,enabledBefore,fixed,preimages:request.preimages},null,2));sync(q.backup);sync(q.backup+'/..');
   baseline();gate(request.actionDeadline);q.phase='copying';fs.mkdirSync(target);sync(target+'/..');
   for(const [n,h] of Object.entries(request.artifacts)){baseline();gate(request.actionDeadline);check('source unchanged '+n,fileHash(request.source+'/'+n)===h);durable(target+'/'+n,fs.readFileSync(request.source+'/'+n));check('installed bytes '+n,fileHash(target+'/'+n)===h);}sync(target);
   q.phase='manifest';baseline();await pm.loadManifest(app.vault.configDir+'/plugins/'+ID);baseline();gate(request.actionDeadline);
   loaderOriginal=pm.loadPlugin;loaderDescriptor=Object.getOwnPropertyDescriptor(pm,'loadPlugin');let returned=null,ownCalls=0,omniReturned=null,omniCalls=0;
   durable(q.backup+'/loader-intent.json',J({token:q.token,hadOwnDescriptor:!!loaderDescriptor}));sync(q.backup);
   loaderHook=function(...args){if(![ID,'omnisearch'].includes(args[0]))return Reflect.apply(loaderOriginal,this,args);gate(request.actionDeadline);if(this!==pm)throw Error('Loader receiver changed');const id=args[0];if(id===ID&&++ownCalls!==1||id==='omnisearch'&&++omniCalls!==1)throw Error('Duplicate owned load');return Promise.resolve(Reflect.apply(loaderOriginal,this,args)).then(instance=>{gate(request.actionDeadline);if(!instance||pm.plugins[id]!==instance)throw Error('Returned actual instance changed');if(id===ID)returned=instance;else omniReturned=instance;return instance;});};
   Object.defineProperty(pm,'loadPlugin',{value:loaderHook,writable:true,configurable:true,enumerable:loaderDescriptor?.enumerable??false});
   q.phase='loading';await pm.enablePluginAndSave(ID);baseline();gate(request.actionDeadline);
   const P=returned;check('actual returned Manager loaded',P&&pm.plugins[ID]===P&&P._loaded===true&&ownCalls===1&&P.manifest.version==='0.1.3'&&P.managerBuild==='aigility-plugin-manager/0.1.3');q.managerInstance=P;
   const firstCommunity=[...JSON.parse(communityRaw),ID];await wait(()=>J(JSON.parse(fs.readFileSync(configPath,'utf8')))==J(firstCommunity));
   check('migration persisted',fs.existsSync(target+'/data.json')&&JSON.parse(fs.readFileSync(target+'/data.json','utf8')).schemaVersion===1);
   check('late recovery has no automatic profile',!!P.runtime.local.recoveryReason&&!P.runtime.local.deviceProfileId&&!P.runtime.local.appliedProfileId&&!P.runtime.local.operationPending);
   const migrationBackup=JSON.parse(fs.readFileSync(base+'/'+P.runtime.state.migration.backupPath,'utf8'));
   check('automatic raw backup exact',migrationBackup.legacyBpm===bpmRaw&&migrationBackup.legacyCompanion===compRaw&&migrationBackup.communityPlugins===communityRaw&&migrationBackup.corePlugins===coreRaw);
   const stateBaseline=J(P.runtime.state),stateHash=fileHash(target+'/data.json');
   q.phase='retiring-legacy';let communityExpected=JSON.parse(fs.readFileSync(configPath,'utf8'));
   for(const id of legacy){baseline();gate(request.actionDeadline);check('owned Manager still current',pm.plugins[ID]===P);check('community CAS',J(JSON.parse(fs.readFileSync(configPath,'utf8')))==J(communityExpected));check('original legacy instance present '+id,pm.plugins[id]===legacyOriginal[id]&&legacyOriginal[id]?._loaded===true);q.legacyExpected[id]=null;await pm.disablePluginAndSave(id);baseline();gate(request.actionDeadline);check('legacy retired '+id,!pm.plugins[id]&&!pm.enabledPlugins.has(id));communityExpected=communityExpected.filter(x=>x!==id);await wait(()=>J(JSON.parse(fs.readFileSync(configPath,'utf8')))==J(communityExpected));check('only legacy community removal '+id,J(JSON.parse(fs.readFileSync(configPath,'utf8')))==J(communityExpected));}
   check('state CAS after retirement',fileHash(target+'/data.json')===stateHash&&J(P.runtime.state)===stateBaseline);
   const expectedState=JSON.parse(stateBaseline);for(const id of legacy)expectedState.records['community:'+id].desired=false;
   await P.runtime.enqueue('delivery-retire-legacy-status',async tx=>{baseline();gate(request.actionDeadline);await tx.refresh();baseline();gate(request.actionDeadline);check('refreshed state CAS',J(P.runtime.state)===stateBaseline);for(const id of legacy)P.runtime.state.records['community:'+id].desired=false;await tx.save();baseline();gate(request.actionDeadline);});
   check('only retired desired fields changed',J(P.runtime.state)===J(expectedState));
   q.phase='preserving-omnisearch';if(!pm.plugins.omnisearch){baseline();gate(request.actionDeadline);check('Omni still excluded',!pm.enabledPlugins.has('omnisearch'));await pm.enablePlugin('omnisearch');baseline();gate(request.actionDeadline);check('actual returned Omni retained',omniReturned&&pm.plugins.omnisearch===omniReturned&&omniCalls===1&&omniReturned._loaded===true);}else check('existing Omni never replaced by delivery',omniCalls===0&&pm.plugins.omnisearch===omniBefore);
   check('Omni function and exclusion preserved',pm.plugins.omnisearch?._loaded===true&&!pm.enabledPlugins.has('omnisearch'));
   await P.runtime.writeEffectiveState();baseline();gate(request.actionDeadline);
   const st=JSON.parse(fs.readFileSync(target+'/data.json','utf8'));
   check('seven templates preserved',J(st.deviceProfiles.map(x=>x.id))===J(['macbook','zenbook','iphone','ipad','s24','lenovo tab','boox tab mini c']));
   check('all source fixtures preserved',st.fixtureProfiles.length===bpm.COMMAND_PROFILES.length&&bpm.COMMAND_PROFILES.every(x=>{const f=st.fixtureProfiles.find(y=>y.id===x.id);return f&&f.name===(x.name||x.id)&&J(f.members)===J(Object.fromEntries(Object.entries(x.pluginStates??{}).map(([id,on])=>['community:'+id,on===true])));}));
   check('legacy settings/repositories/tags/betas preserved',J(st.legacyBpm.Plugins)===J(bpm.Plugins)&&J(st.legacyBpm.TAGS)===J(bpm.TAGS)&&J(st.legacyBpm.GROUPS)===J(bpm.GROUPS)&&J(st.legacyBpm.REPO_MAP)===J(bpm.REPO_MAP)&&J(st.legacyBpm.BETA_SOURCES)===J(bpm.BETA_SOURCES)&&Object.entries(bpm).filter(([k,v])=>!(/token|secret|password|api[-_]?key|credential|authorization/i.test(k))&&typeof v!=='object').every(([k,v])=>st.legacyBpm[k]===v));
   check('Companion backups preserved',J(st.profileBackups[0]?.backups)===J(comp.profileBackups));
   check('deferred unchanged',comp.deferred.every(x=>{const d=st.deferred.find(y=>y.id===x.id);return d&&d.enabled===x.enabled&&d.delayMs===x.delayMs;}));
   check('enabled only Manager replaces legacy2',J(enabled())===J([...enabledBefore.filter(id=>!legacy.includes(id)),ID].sort()));
   check('effective core/community list',P.runtime.list().some(x=>x.ref.kind==='core')&&P.runtime.list().some(x=>x.ref.kind==='community'&&x.ref.id===ID));
   for(const [n,h] of Object.entries(request.artifacts))check('final artifacts '+n,fileHash(target+'/'+n)===h);
   q.result={version:P.manifest.version,root,window:win.id,wc:win.webContents.id,enabled:true,loaded:true,profiles:st.deviceProfiles.length,fixtures:st.fixtureProfiles.length,tags:st.tags.length,groups:st.groups.length,records:Object.keys(st.records).length,legacyRetired:legacy,legacyDirectoriesPreserved:legacy.every(id=>fs.existsSync(base+'/.obsidian/plugins/'+id+'/data.json')),omniLoaded:true,omniNative:false,local:P.runtime.local,backup:q.backup,migrationBackup:P.runtime.state.migration.backupPath,dataSha:fileHash(target+'/data.json'),foreignAndCorePreserved:true,settingsLeavesFocusPreserved:true};
  }else throw Error('Unknown bounded action');
  q.phase='verified';
 }catch(e){q.error=String(e);q.phase='failed-preserved';}finally{
  if(loaderHook){try{gate(request.deadline);const d=Object.getOwnPropertyDescriptor(pm,'loadPlugin');if(d?.value!==loaderHook)throw Error('Loader ownership changed; preserve');if(loaderDescriptor)Object.defineProperty(pm,'loadPlugin',loaderDescriptor);else Reflect.deleteProperty(pm,'loadPlugin');check('loader observer removed',pm.loadPlugin===loaderOriginal);}catch(e){q.error=(q.error??'')+'; '+String(e);}}
  q.pending=false;q.status=q.error?'failed':'passed';q.completedAt=new Date().toISOString();q.receipt=receipt();
 }})();return {token:q.token,status:q.status,pending:q.pending};
}
