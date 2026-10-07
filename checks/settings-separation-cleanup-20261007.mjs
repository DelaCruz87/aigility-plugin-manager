// Cleanup for the owned fixture left by the settled functional-current failure.
// Importing this body performs no IO. A separate exact ROOT grant is required.
export function cleanupFixture(r) {
  const fs = require('fs'), crypto = require('crypto'), remote = require('electron').remote;
  const J = JSON.stringify, hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const sha = file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null;
  const ID = 'aigility-plugin-manager', F = 'aigility-manager-toggle-fixture', pm = app.plugins, manager = pm.plugins[ID];
  const root = app.vault.adapter.getBasePath(), win = remote.getCurrentWindow(), doc = document;
  const fixtureInstance = pm.plugins[F], fixtureManifest = pm.manifests[F];
  const dir = root + '/.obsidian/plugins/' + F, community = root + '/.obsidian/community-plugins.json';
  const stateFile = root + '/.obsidian/plugins/' + ID + '/data.json', effective = root + '/.obsidian/plugins/' + ID + '/effective-state.json';
  const stateBefore = J(manager.runtime.state), localBefore = localStorage.getItem(manager.runtime.localKey);
  const originalBytes = fs.readFileSync(r.originalCommunityPath), originalIds = JSON.parse(originalBytes);
  const beforeIds = [...pm.enabledPlugins], communityBefore = sha(community), effectiveBefore = sha(effective);
  const foreign = Object.entries(pm.plugins).filter(([id]) => id !== F);
  const foreignIds = beforeIds.filter(id => id !== F), core = Object.entries(app.internalPlugins.plugins).map(([id,p]) => [id,p.enabled,p.instance]);
  const layoutBefore = J(app.workspace.getLayout()), leafBefore = app.workspace.activeLeaf, settings = app.setting;
  const settingsBefore = [settings.isOpen, settings.lastTabId, settings.doc, settings.modalEl], windows = remote.BrowserWindow.getAllWindows();
  const buffers = () => { const a=[]; app.workspace.iterateAllLeaves(l => a.push([l.id,l.view?.getViewType?.(),l.view?.editor?.getValue ? hash(l.view.editor.getValue()) : null])); return J(a); };
  const buffersBefore = buffers();
  const baseline = JSON.parse(fs.readFileSync(r.baselinePath));
  const requestSave = pm.requestSaveConfig, requestRun = requestSave.run;
  const gate = () => {
    const currentRoot = app.vault.adapter.getBasePath(), st = fs.statSync(currentRoot);
    if (app.appId !== r.native.appId || app.vault.getName() !== r.native.vault || currentRoot !== root || root !== r.root || fs.realpathSync(currentRoot) !== r.native.physicalRoot || st.dev !== r.native.dev || st.ino !== r.native.ino || document !== doc || document.URL !== r.native.document || win.id !== r.native.window || win.webContents.id !== r.native.wc || win.webContents.isCrashed() || app.plugins !== pm || pm.plugins[ID] !== manager) throw Error('Cleanup identity changed');
    if (Date.now() >= Date.parse(r.totalBy) || Date.now() >= Date.parse(r.rootHardBy)) throw Error('Cleanup deadline');
    for (const [file, expected] of [[r.controlPath,r.controlSha],[r.leasePath,r.leaseSha],[r.helperPath,r.helperSha],[r.originalCommunityPath,r.originalCommunitySha],[r.baselinePath,r.baselineSha],[r.priorProofPath,r.priorProofSha]]) if (sha(file) !== expected) throw Error('Cleanup pin changed');
    for (const [relative,entry] of Object.entries(baseline.files)) if (relative !== '.obsidian/community-plugins.json' && !relative.startsWith('.obsidian/plugins/'+ID+'/') && sha(root+'/'+relative)!==entry.sha256) throw Error('Cleanup baseline file changed: '+relative);
    if (!fs.readFileSync(r.leasePath,'utf8').includes(r.token)) throw Error('Cleanup lease token changed');
    if (pm.requestSaveConfig !== requestSave || requestSave.run !== requestRun || hash(requestSave.toString()) !== r.requestSaveSha || hash(requestRun.toString()) !== r.requestRunSha) throw Error('Cleanup persistence hook changed');
    if (J(manager.runtime.state) !== stateBefore || sha(stateFile) !== r.stateSha || hash(localStorage.getItem(manager.runtime.localKey) ?? '') !== r.localSha || localStorage.getItem(manager.runtime.localKey) !== localBefore) throw Error('Cleanup State/Local changed');
    if (J([...pm.enabledPlugins].filter(id=>id!==F)) !== J(foreignIds) || Object.keys(pm.plugins).filter(id=>id!==F).length !== foreign.length || foreign.some(([id,p])=>pm.plugins[id]!==p) || Object.keys(app.internalPlugins.plugins).length !== core.length || core.some(([id,on,p])=>app.internalPlugins.plugins[id].enabled!==on || app.internalPlugins.plugins[id].instance!==p)) throw Error('Cleanup foreign runtime changed');
    if (app.setting !== settings || settings.isOpen !== settingsBefore[0] || settings.lastTabId !== settingsBefore[1] || settings.doc !== settingsBefore[2] || settings.modalEl !== settingsBefore[3] || app.workspace.activeLeaf !== leafBefore || J(app.workspace.getLayout()) !== layoutBefore || buffers() !== buffersBefore || remote.BrowserWindow.getAllWindows().length !== windows.length || windows.some(w=>!remote.BrowserWindow.getAllWindows().includes(w))) throw Error('Cleanup surface changed');
  };
  gate();
  if (!manager?._loaded || !pm.plugins[F]?._loaded || !pm.enabledPlugins.has(F) || sha(community) !== r.communitySha || hash(originalBytes) !== r.originalCommunitySha || J(originalIds) !== J(foreignIds) || J(JSON.parse(fs.readFileSync(community))) !== J(beforeIds) || stateBefore.includes(F) || window.__managerToggleFixtureLoads !== 1) throw Error('Cleanup fixture preimage differs');
  const assertFixtureBeforeDisable = () => {
    if (pm.plugins[F] !== fixtureInstance || !fixtureInstance?._loaded || pm.manifests[F] !== fixtureManifest || !fixtureManifest || !pm.enabledPlugins.has(F) || window.__managerToggleFixtureLoads !== 1) throw Error('Cleanup fixture identity changed before disable');
    for (const [name, expected] of Object.entries(r.fixtureArtifacts)) if (sha(dir+'/'+name)!==expected) throw Error('Cleanup fixture file changed');
  };
  assertFixtureBeforeDisable();
  const assertFixtureAfterDisable = () => {
    const current = pm.plugins[F];
    if ((current && current !== fixtureInstance) || current?._loaded || pm.enabledPlugins.has(F) || pm.manifests[F] !== fixtureManifest || window.__managerToggleFixtureLoads !== 1) throw Error('Cleanup fixture identity changed after disable');
  };
  const prior = window.__managerSettings016Jobs?.get(r.priorToken);
  if (!prior?.task || prior.receipt?.status !== 'FAILED_PRESERVED' || prior.receipt.phase !== 'fixture-native-enable' || JSON.parse(fs.readFileSync(r.priorProofPath)).taskSettled !== true || typeof pm.requestSaveConfig.run !== 'function') throw Error('Cleanup prior receipt/flush capability mismatch');
  const jobs = window.__manager016FixtureCleanupJobs ??= new Map(); if (jobs.has(r.token)) throw Error('Duplicate cleanup');
  const durable = (file,bytes) => { const fd=fs.openSync(file,'wx'); try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);} finally {fs.closeSync(fd);} };
  const syncDir = path => { const fd=fs.openSync(path,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);} };
  const q = {token:r.token,status:'running',pending:true,phase:'prior-task'};jobs.set(r.token,q);
  q.task=(async()=>{
    try {
      await prior.task; gate();assertFixtureBeforeDisable();
      if (sha(community)!==communityBefore || sha(effective)!==effectiveBefore) throw Error('Cleanup output preimage changed before disable');
      fs.mkdirSync(r.backup);durable(r.backup+'/community-current.json',fs.readFileSync(community));durable(r.backup+'/community-original.json',originalBytes);
      syncDir(r.backup);syncDir(require('path').dirname(r.backup));
      assertFixtureBeforeDisable();
      q.phase='disable-own-fixture'; await pm.disablePluginAndSave(F);gate();assertFixtureAfterDisable();
      await pm.requestSaveConfig.run();gate();assertFixtureAfterDisable();
      await pm.saveConfig();gate();assertFixtureAfterDisable();
      if (pm.plugins[F]?._loaded || pm.enabledPlugins.has(F) || J(JSON.parse(fs.readFileSync(community)))!==J(originalIds)) throw Error('Cleanup native OFF readback differs');
      const ownCommunityPost=sha(community);
      if (sha(effective)!==effectiveBefore) throw Error('Cleanup effective preimage changed');
      q.phase='remove-own-files';
      assertFixtureAfterDisable();
      for(const[name,expected]of Object.entries(r.fixtureArtifacts)){gate();if(sha(dir+'/'+name)!==expected)throw Error('Cleanup file CAS changed');fs.unlinkSync(dir+'/'+name);}
      fs.rmdirSync(dir);syncDir(require('path').dirname(dir));delete pm.manifests[F];
      if(window.__managerToggleFixtureLoads!==1)throw Error('Cleanup counter changed');delete window.__managerToggleFixtureLoads;
      gate();if(sha(community)!==ownCommunityPost)throw Error('Cleanup raw config CAS changed');fs.writeFileSync(community,originalBytes);
      const fd=fs.openSync(community,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      q.phase='refresh-own-effective';await manager.runtime.writeEffectiveState();gate();
      if(fs.readFileSync(effective,'utf8').includes(F)||sha(community)!==r.originalCommunitySha||pm.manifests[F]||fs.existsSync(dir))throw Error('Cleanup final readback differs');
      q.result={fixtureRemoved:true,stateLocalPreserved:true,foreignPreserved:true,surfacesPreserved:true,communityRestored:true,effectiveSha:sha(effective)};
    }catch(error){q.error=String(error);}
    finally{q.receipt={token:r.token,status:q.error?'FAILED_PRESERVED':'SETTLED',pending:!!q.error,phase:q.phase,result:q.result??null,error:q.error??null,completedAt:new Date().toISOString()};try{durable(r.resultPath,J(q.receipt,null,2));syncDir(require('path').dirname(r.resultPath));}catch(error){q.receipt={...q.receipt,pending:true,receiptError:String(error)};}q.status=q.receipt.status;q.pending=q.receipt.pending;}
  })();
  return J({token:q.token,status:q.status,pending:q.pending});
}
