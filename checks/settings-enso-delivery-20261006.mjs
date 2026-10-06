// One owned ENSO Manager 0.1.3 -> 0.1.5 delivery. Prepared source is injected only
// into the verified ENSO main renderer under a NEW root lease. No UI input,
// settings/profile application, foreign plugin writes or automatic rollback.
export function deliverEnsoSettingsFix(r) {
    const fs=require('fs'),crypto=require('crypto'),e=require('electron').remote,J=JSON.stringify;
    const h=b=>crypto.createHash('sha256').update(b).digest('hex'),file=p=>fs.existsSync(p)?h(fs.readFileSync(p)):null;
    const ID='aigility-plugin-manager',host=app,doc=document,pm=app.plugins,win=e.getCurrentWindow(),old=pm.plugins[ID],target=r.root+'/.obsidian/plugins/'+ID;
    let expected=old,transition=false,q;
    const gate=()=>{
        const st=fs.statSync(app.vault.adapter.getBasePath());
        if(app!==host||document!==doc||pm!==app.plugins||app.vault.getName()!=='ENSO'||app.appId!=='770c2d6b37fb662f'||app.vault.adapter.getBasePath()!=='/Users/eme/OBSIDIAN/ENSO'||!['/Users/eme/Obsidian/ENSO','/Users/eme/OBSIDIAN/ENSO'].includes(fs.realpathSync(app.vault.adapter.getBasePath()))||st.dev!==16777230||st.ino!==157927577||win.id!==1||win.webContents.id!==1||win.webContents.isCrashed()||document.URL!=='app://obsidian.md/index.html'||Date.now()>=Date.parse(r.actionBy))throw Error('Delivery identity/deadline');
        if(file(r.controlPath)!==r.controlSha||file(r.leasePath)!==r.leaseSha||!fs.readFileSync(r.leasePath,'utf8').includes(r.token)||file(r.helperPath)!==r.helperSha||file(r.baselinePath)!==r.baselineSha)throw Error('Delivery control/lease/helper/baseline drift');
        if(q&&(window.__managerEnsoSettingsDelivery!==bag||bag.get(r.token)!==q||q.status!=='running'))throw Error('Delivery registry changed');
        if(!transition&&(pm.plugins[ID]??null)!==expected)throw Error('Unexpected Manager instance');
    };
    gate();
    if(!old?._loaded||old.manifest.version!=='0.1.3'||!pm.enabledPlugins.has(ID)||!app.setting.isOpen||app.setting.activeTab?.id!=='community-plugins'||app.setting.lastTabId!=='community-plugins'||app.workspace.activeLeaf.id!=='930617187a50fb24'||document.activeElement?.tagName!=='BODY')throw Error('NO_START Manager/Settings/leaf/focus');
    if(!['disablePlugin','enablePlugin','loadManifest'].every(k=>typeof pm[k]==='function'))throw Error('NO_START host API contract');
    const bag=window.__managerEnsoSettingsDelivery??=new Map();if(bag.has(r.token))throw Error('Duplicate job; poll SAME token');
    const foreign=Object.entries(pm.plugins).filter(([id])=>id!==ID),cores=Object.entries(app.internalPlugins.plugins).map(([id,w])=>[id,w.enabled,w.instance]);
    const enabled=J([...pm.enabledPlugins].sort()),state=J(old.runtime.state),local=J(old.runtime.local),localKey=old.runtime.localKey,localRaw=localStorage.getItem(localKey),filters=J(old.managerUI.filterCriteria),sidebar=J(old.managerUI.sidebarFilterCriteria);
    if(h(state)!=='23c196cd4a240da8345888c3d7d0eb170fcb8ba759ffd7044bfef50b5ec40d07'||h(localRaw)!=='98e17bdfdb975d9ceb3b1f031f9fede7b5fa24f7ae64737046c5d8eace48f4b2'||old.runtime.local.recoveryReason!=='Manager loaded after layout readiness; startup automation was skipped.'||old.runtime.local.operationPending)throw Error('NO_START frozen State/Local/pause compatibility');
    const setting=app.setting,settingTab=setting.activeTab,settingDoc=setting.doc,settingModal=setting.modalEl,leaf=app.workspace.activeLeaf,layout=J(app.workspace.getLayout());
    const leafImage=()=>{const rows=[];app.workspace.iterateAllLeaves(l=>rows.push({id:l.id,type:l.view?.getViewType?.(),state:l.view?.getState?.(),buffer:l.view?.editor?.getValue?h(l.view.editor.getValue()):null}));return J(rows);};const buffers=leafImage();
    const windows=e.BrowserWindow.getAllWindows().map(w=>({ref:w,id:w.id,wc:w.webContents.id,title:w.getTitle(),url:w.webContents.getURL()}));
    const baseline=JSON.parse(fs.readFileSync(r.baselinePath));
    const fixed=()=>{
        gate();
        for(const[n,v]of Object.entries(baseline.files))if(file(baseline.root+'/'+n)!==v.sha256)throw Error('42-file drift '+n);
        if(J([...pm.enabledPlugins].sort())!==enabled||foreign.some(([id,p])=>pm.plugins[id]!==p)||Object.keys(pm.plugins).filter(id=>id!==ID).length!==foreign.length||cores.some(([id,on,p])=>app.internalPlugins.plugins[id].enabled!==on||app.internalPlugins.plugins[id].instance!==p))throw Error('Foreign/core instance or enabled drift');
        const now=e.BrowserWindow.getAllWindows();if(now.length!==windows.length||windows.some(w=>!now.includes(w.ref)||w.ref.id!==w.id||w.ref.webContents.id!==w.wc||w.ref.webContents.isCrashed()||w.ref.getTitle()!==w.title||w.ref.webContents.getURL()!==w.url)||e.BrowserWindow.getFocusedWindow()?.id!==3||app.setting!==setting||!setting.isOpen||setting.activeTab!==settingTab||setting.activeTab?.id!=='community-plugins'||setting.lastTabId!=='community-plugins'||setting.doc!==settingDoc||setting.modalEl!==settingModal||app.workspace.activeLeaf!==leaf||J(app.workspace.getLayout())!==layout||leafImage()!==buffers||document.activeElement?.tagName!=='BODY')throw Error('Window/Settings/leaf/focus drift');
    };
    const durable=(p,b)=>{const fd=fs.openSync(p,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
    const sync=p=>{const fd=fs.openSync(p,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
    q={token:r.token,status:'running',pending:true,phase:'preflight',startedAt:new Date().toISOString()};bag.set(r.token,q);
    q.task=(async()=>{try{
        fixed();
        for(const[n,hash]of Object.entries(r.preimages))if(file(target+'/'+n)!==hash)throw Error('Artifact preimage drift '+n);
        for(const[n,hash]of Object.entries(r.artifacts))if(file(r.source+'/'+n)!==hash)throw Error('Candidate drift '+n);
        if(file(target+'/data.json')!==h(state)||J(JSON.parse(fs.readFileSync(target+'/data.json')))!==state)throw Error('Runtime/disk State mismatch');
        if(old.runtime.state.deferred.filter(p=>p.enabled).some(p=>!old.runtime.state.protected.includes('community:'+p.id)&&!old.runtime.state.protected.includes(p.id)&&(pm.enabledPlugins.has(p.id)||pm.plugins[p.id]?._loaded)))throw Error('Foreign deferred transition would be required');
        fs.mkdirSync(r.backup,{recursive:false});for(const n of ['main.js','manifest.json','styles.css','data.json']){fixed();durable(r.backup+'/'+n,fs.readFileSync(target+'/'+n));}
        durable(r.backup+'/before.json',J({state,local,localKey,localRaw,enabled,filters,sidebar},null,2));
        fixed();sync(r.backup);sync(require('path').dirname(r.backup));
        fixed();await old.runtime.enqueue('settings-delivery-drain',async()=>{});fixed();
        q.phase='unloading';transition=true;fixed();await pm.disablePlugin(ID);expected=null;transition=false;fixed();
        if(pm.plugins[ID]||old.runtime.disposed!==true)throw Error('Old Manager did not unload');
        q.phase='copying';for(const[n,hash]of Object.entries(r.artifacts)){fixed();if(file(target+'/'+n)!==r.preimages[n]||file(r.source+'/'+n)!==hash)throw Error('Copy CAS drift '+n);const fd=fs.openSync(target+'/'+n,'w');try{fs.writeFileSync(fd,fs.readFileSync(r.source+'/'+n));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(file(target+'/'+n)!==hash)throw Error('Copied artifact mismatch '+n);}
        q.phase='manifest';fixed();await pm.loadManifest(app.vault.configDir+'/plugins/'+ID);fixed();
        q.phase='loading';transition=true;fixed();await pm.enablePlugin(ID);expected=pm.plugins[ID];transition=false;fixed();
        const p=expected;if(!p||p===old||!p._loaded||p.manifest.version!=='0.1.5'||p.managerBuild!=='aigility-plugin-manager/0.1.5')throw Error('Actual loaded candidate identity mismatch');
        if(J(p.runtime.state)!==state||J(p.runtime.local)!==local||p.runtime.localKey!==localKey||localStorage.getItem(localKey)!==localRaw||J(p.managerUI.filterCriteria)!==filters||J(p.managerUI.sidebarFilterCriteria)!==sidebar)throw Error('Runtime/Local/filter preservation mismatch');
        for(const[n,hash]of Object.entries(r.artifacts))if(file(target+'/'+n)!==hash)throw Error('Final installed artifact mismatch');
        q.result={version:p.manifest.version,build:p.managerBuild,loaded:true,native:true,stateSha:h(state),localSha:h(local),filesUnchanged:42,foreignInstancesPreserved:true,coreInstancesPreserved:true,filtersPreserved:true,openSettings2Preserved:true,layoutAndBuffersPreserved:true,focusSandbox3Preserved:true,backup:r.backup,artifacts:r.artifacts};
    }catch(error){q.error=String(error);}finally{
        q.completedAt=new Date().toISOString();const receipt={token:r.token,status:q.error?'FAILED_PRESERVED':'SETTLED',pending:false,startedAt:q.startedAt,completedAt:q.completedAt,phase:q.phase,result:q.result??null,error:q.error??null};
        try{durable(r.resultPath,J(receipt,null,2));q.receipt=receipt;}catch(error){q.receipt={...receipt,durable:false,error:(q.error??'')+'; receipt '+String(error)};}
        q.pending=false;q.status=q.receipt.status;
    }})();return {token:q.token,status:q.status,pending:q.pending};
}
