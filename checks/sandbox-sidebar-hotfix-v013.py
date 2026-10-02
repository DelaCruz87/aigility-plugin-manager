# Private bounded AIgility Plugin Manager delivery adapter.
# Reuses Tasks release-simple-deploy.py, source SHA 5838a57ae5273380d231a984345bc95b6f00cc0cc0bb16bcbae781b1e3e0b608.
# Delta: Sandbox-only identity, 120/90/30 absolute lease, one manager ID/version,
# frozen old/new hashes, manager whole State/local/7config/foreign/core checks,
# existing exact returned-loader observer with durable intent; no auto rollback.
# Source is not edited and no app call occurs in expression mode.
"""Start-once ENSO deployment. Requires a fresh exclusive supervisor START.

No OS activation, mobile filesystem, settings, or foreign-plugin writes.
Unknown responses are polled by the same token; never repeat begin.
"""
from pathlib import Path
import datetime
import hashlib
import json
import subprocess
import sys
import time
import uuid
"""Absolute supervisor lease. Validation never creates state or calls the host."""
import datetime
import time


def parse_utc(value):
    instant = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if instant.utcoffset() != datetime.timedelta(0):
        raise ValueError('Lease timestamps must explicitly use UTC')
    return int(instant.timestamp() * 1000)


def lease(args, total_ms, action_ms, now_ms=None):
    if len(args) != 3:
        raise ValueError('begin requires ACK_UTC START_BY_UTC LEASE_ID')
    ack, start_by = map(parse_utc, args[:2])
    lease_id = args[2]
    if not lease_id or len(lease_id) > 120 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in lease_id):
        raise ValueError('Invalid lease identity')
    state = {'ackUtc': args[0], 'startByUtc': args[1], 'leaseId': lease_id,
             'ackMs': ack, 'startByMs': start_by,
             'expires': ack + total_ms, 'actionExpires': ack + action_ms}
    validate(state, now_ms)
    return state


def validate(state, now_ms=None):
    now = int(time.time() * 1000) if now_ms is None else now_ms
    if now < state['ackMs'] or now >= min(state['startByMs'], state['actionExpires']):
        raise ValueError('NO_START: future ACK, expired start-by or action budget')


def persist_new(control, state):
    import json, os
    validate(state)
    # Never replace a previous deployment or unknown host token.
    with control.open('x') as out:
        out.write(json.dumps(state, indent=2) + '\n'); out.flush(); os.fsync(out.fileno())
    fd=os.open(control.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


p = Path(sys.argv[1]).resolve()
action = sys.argv[2]
vault=sys.argv[3]
assert vault == 'Sandbox', 'This private delivery hotfix is Sandbox only'
offline = action=='expression'
control = p/'evidence/manager-sidebar-hotfix-Sandbox-control.json'
canonical_base='/Users/eme/Obsidian/'+vault
observed_base='/Users/eme/OBSIDIAN/ENSO' if vault=='ENSO' else canonical_base
canonical_stat=Path(canonical_base).stat()
observed_stat=Path(observed_base).stat()
assert (canonical_stat.st_dev,canonical_stat.st_ino)==(observed_stat.st_dev,observed_stat.st_ino)
# Frozen from the separate filesystem identity proof 2026-10-01 20:57:28 UTC.
vault_identity={'dev':canonical_stat.st_dev,'ino':canonical_stat.st_ino}
assert (canonical_stat.st_dev,canonical_stat.st_ino)==(vault_identity['dev'],vault_identity['ino'])
vault_contract={'canonicalBase':canonical_base,'observedBase':observed_base,'vaultIdentity':vault_identity}
files = ['main.js', 'manifest.json', 'styles.css']
inputs=json.loads((p/'evidence/sidebar-hotfix-v013-inputs.json').read_text());previous=inputs['previous'];assert vault_identity==inputs['vaultIdentity']
if action == 'begin':
    grant = lease(sys.argv[4:],120000,90000)
    assert json.loads((p/'manifest.json').read_text())['version']=='0.1.3'
    state = {**grant, **vault_contract, 'token': 'manager-sidebar-hotfix-'+uuid.uuid4().hex, 'source': str(p), 'vault':vault, 'previous': previous,
             'next': {f: hashlib.sha256((p/f).read_bytes()).hexdigest() for f in files}}
    assert state["next"]==inputs["next"], "Frozen hotfix source drift"
    persist_new(control, state)
elif action == 'expression':
    # Offline syntax review with deterministic dummy token; no host call.
    state = {**vault_contract,'token':'offline','expires':120001,'actionExpires':90001,'ackMs':1,'startByMs':60001,'leaseId':'offline','source':str(p),'vault':vault,
             'previous':previous,'next':{f:hashlib.sha256((p/f).read_bytes()).hexdigest() for f in files}}
else:
    state = json.loads(control.read_text())

if offline:
    action=sys.argv[4] if len(sys.argv)>4 else 'begin'
    assert action in ['begin','poll','close']

owned = 'const q=window.__managerSidebarHotfix?.get('+json.dumps(state['token'])+');if(!q)throw Error("Missing owned token");'
if action in ('begin','expression'):
    body = 'const request='+json.dumps(state)+';'+r'''
if(Date.now()<request.ackMs||Date.now()>=Math.min(request.startByMs,request.actionExpires))throw Error('NO_START: absolute ACK/start-by budget expired');
const primaryHost=app,primaryDocument=document,expectedWindow=request.vault==='Sandbox'?1:2,manager=app.plugins;
if(electron.remote.getCurrentWindow().id!==expectedWindow||app.workspace.containerEl.ownerDocument!==primaryDocument)throw Error('Wrong expected primary window/document');
const originalLoader=manager.loadPlugin,loaderDescriptor=Object.getOwnPropertyDescriptor(manager,'loadPlugin');
if(typeof originalLoader!=='function')throw Error('Own loader observer unavailable');
const settingBefore=app.setting??null,settingsModal=settingBefore?.modalEl??null,settingsDocument=settingsModal?.ownerDocument??null,settingsTab=settingBefore?.activeTab??null;
const settingsWindowBefore=settingsDocument?.defaultView?.electronWindow??null,settingsContentsBefore=settingsWindowBefore?.webContents??null;if(settingsModal?.isConnected&&(settingBefore.win?.document!==settingsDocument||settingsDocument!==settingBefore.doc||settingsWindowBefore?.id!==6||settingsContentsBefore?.id!==6||settingsWindowBefore.isDestroyed()||settingsContentsBefore.getURL()!=='about:blank'))throw Error('Settings6 document/native identity mismatch');
const settingsUiBefore={open:!!settingsModal?.isConnected,tabId:settingsTab?.id??null,tabPluginId:settingsTab?.plugin?.manifest?.id??null,ownerIsMainDocument:settingsDocument===document};
if(settingsUiBefore.tabId==='aigility-plugin-manager'||settingsUiBefore.tabId==='community-plugins'||settingsUiBefore.tabPluginId==='aigility-plugin-manager')throw Error('Own manager Settings active; preserve before deployment');
const bag=window.__managerSidebarHotfix??=new Map();if([...bag.values()].some(j=>j.status==='running'))throw Error('Previous own deployment still running');
if(bag.has(request.token))return {token:request.token,status:bag.get(request.token).status};
const fs=require('fs'),crypto=require('crypto'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const canonical=value=>{const sort=x=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));};
const win=electron.remote.getCurrentWindow(),old=app.plugins.plugins['aigility-plugin-manager'];
if(old?.manifest?.version!=='0.1.3'||old._loaded!==true||!old.runtime||old.runtime.local.operationPending||old.runtime.state.debug?.active||old.runtime.profileUndo)throw Error('Previous instance/conflict mismatch');
if(typeof app.plugins.loadManifest!=='function')throw Error('Own manifest loader unavailable');
if(document.querySelector('.aigility-pending'))throw Error('Tables save pending; do not deploy');
const target=app.vault.adapter.getBasePath()+'/.obsidian/plugins/aigility-plugin-manager/';
const configPaths=['community-plugins.json','core-plugins.json','plugins/aigility-plugin-manager/data.json','plugins/better-plugins-manager/data.json','plugins/better-plugins-manager-companion/data.json','workspace.json','workspaces.json'];
const foreignState=()=>JSON.stringify(Object.entries(manager.manifests).filter(([id])=>id!=='aigility-plugin-manager').map(([id,m])=>({id,version:m.version,native:manager.enabledPlugins.has(id),loaded:manager.plugins[id]?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id)));
const coreState=()=>JSON.stringify(Object.entries(app.internalPlugins.plugins).map(([id,w])=>({id,enabled:w.enabled===true,loaded:w.instance?._loaded===true})).sort((a,b)=>a.id.localeCompare(b.id)));
const foreignBefore=foreignState(),coreBefore=coreState(),oldRuntime=old.runtime;
const enabledState=()=>JSON.stringify([...app.plugins.enabledPlugins].sort());
const leafState=()=>{const out=[];app.workspace.iterateAllLeaves(l=>out.push({id:l.id,type:l.view?.getViewType?.()??null,state:l.view?.getState?.()??null,buffer:l.view?.editor?.getValue?sha(l.view.editor.getValue()):null}));return JSON.stringify(out);};
const enabledBefore=enabledState(),leavesBefore=leafState();
const config=Object.fromEntries(configPaths.map(x=>[x,fs.existsSync(app.vault.adapter.getBasePath()+'/.obsidian/'+x)?sha(fs.readFileSync(app.vault.adapter.getBasePath()+'/.obsidian/'+x)):null]));
const originals={};
for(const f of Object.keys(request.previous)){
 const bytes=fs.readFileSync(target+f);if(sha(bytes)!==request.previous[f])throw Error('Previous disk artifact drift: '+f);
 if(sha(fs.readFileSync(request.source+'/'+f))!==request.next[f])throw Error('New source artifact drift: '+f);
 originals[f]=bytes;
}
if(JSON.parse(fs.readFileSync(request.source+'/manifest.json','utf8')).version!=='0.1.3')throw Error('New metadata mismatch');
const q={...request,windowId:win.id,old,originals,config,expectedInstance:old,expectedLoader:originalLoader,loaderCalls:0,loadedInstance:null,enabledExpected:enabledBefore,artifactExpected:{...request.previous},settingsUiBefore,settings:canonical(old.runtime.state),local:canonical(old.runtime.local),oldRuntime,foreignBefore,coreBefore,profiles:old.runtime.state.deviceProfiles.length,fixtures:old.runtime.state.fixtureProfiles.length,enabledBefore,leavesBefore,enabled:app.plugins.enabledPlugins.has('aigility-plugin-manager'),previousLeaf:app.workspace.activeLeaf?.id,foreground:electron.remote.BrowserWindow.getFocusedWindow()?.id??null,status:'running',phase:'prepared',copied:[],skipped:[],drifts:[],error:null};
bag.set(q.token,q);
q.rootIdentity=()=>{if(app.vault.adapter.getBasePath()!==q.observedBase)return false;for(const path of [q.observedBase,q.canonicalBase]){const st=fs.statSync(path);if(st.dev!==q.vaultIdentity.dev||st.ino!==q.vaultIdentity.ino)return false;}return true;};
q.guard=(cleanup,expected=q.expectedInstance,ownedTransition=false)=>{if(Date.now()>=(cleanup?q.expires:q.actionExpires)||window.__managerSidebarHotfix!==bag||bag.get(q.token)!==q||app!==primaryHost||document!==primaryDocument||app.workspace.containerEl.ownerDocument!==primaryDocument||app.plugins!==manager||manager.loadPlugin!==q.expectedLoader||electron.remote.getCurrentWindow().id!==q.windowId||app.vault.getName()!==q.vault||!q.rootIdentity())throw Error('Owned deadline/window guard');
 if((app.setting??null)!==settingBefore||(app.setting?.modalEl??null)!==settingsModal||(app.setting?.activeTab??null)!==settingsTab||!!settingsModal?.isConnected!==settingsUiBefore.open||(settingsModal?.ownerDocument??null)!==settingsDocument||(app.setting?.activeTab?.id??null)!==settingsUiBefore.tabId||(app.setting?.activeTab?.plugin?.manifest?.id??null)!==settingsUiBefore.tabPluginId)throw Error('Settings UI drift; preserve');
 if(settingsModal?.isConnected&&(settingsDocument?.defaultView?.electronWindow!==settingsWindowBefore||settingsWindowBefore.webContents!==settingsContentsBefore||settingsContentsBefore.getURL()!=='about:blank'))throw Error('Settings native binding replaced');
 if(manager.isEnabled()!==true||app.appId!=='d137282e82167d84'||foreignState()!==q.foreignBefore||coreState()!==q.coreBefore)throw Error('Host/foreign/core drift; preserve');
 if(expected===q.old&&expected.runtime!==q.oldRuntime)throw Error('Old runtime replaced');
 if(expected&&expected!==q.old&&expected.runtime!==q.loadedRuntime)throw Error('Returned runtime replaced');
 if((app.plugins.plugins['aigility-plugin-manager']??null)!==expected)throw Error('Foreign plugin instance; preserve');
 if(JSON.stringify(q.configCurrent())!==JSON.stringify(q.config))throw Error('Config drift; preserve');
 const foreignSet=x=>JSON.stringify(JSON.parse(x).filter(id=>id!=='aigility-plugin-manager'));
 if(ownedTransition?foreignSet(enabledState())!==foreignSet(q.enabledBefore):enabledState()!==q.enabledExpected)throw Error('Enabled state drift; preserve');
 if(leafState()!==q.leavesBefore||app.workspace.activeLeaf?.id!==q.previousLeaf)throw Error('Leaf/source state drift; preserve');
};
q.assertHash=(path,expected,stage)=>{const actual=sha(fs.readFileSync(path));if(actual!==expected){q.drifts.push({path,stage,expected,actual});throw Error('Artifact drift; preserve foreign bytes: '+stage+' '+path);}return actual;};
q.configCurrent=()=>Object.fromEntries(configPaths.map(x=>[x,fs.existsSync(app.vault.adapter.getBasePath()+'/.obsidian/'+x)?sha(fs.readFileSync(app.vault.adapter.getBasePath()+'/.obsidian/'+x)):null]));
q.assertArtifacts=(expected,stage)=>{for(const f of Object.keys(expected))q.assertHash(target+f,expected[f],stage);};
q.writeDurable=(file,bytes,cleanup=false)=>{q.guard(cleanup);const fd=fs.openSync(file,'wx');try{q.guard(cleanup);fs.writeFileSync(fd,bytes);q.guard(cleanup);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
q.syncDir=(dir,cleanup=false)=>{q.guard(cleanup);const fd=fs.openSync(dir,'r');try{q.guard(cleanup);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
q.task=(async()=>{try{
 q.guard(false);q.phase='backup';q.backup=request.source+'/evidence/release-backups/'+q.token+'/before/';
 q.guard(false);fs.mkdirSync(q.backup,{recursive:true});
 for(const f of Object.keys(q.previous)){q.guard(false);q.writeDurable(q.backup+f,q.originals[f]);q.assertHash(q.backup+f,q.previous[f],'durable-backup');}
 q.guard(false);q.writeDurable(q.backup+'receipt.json',JSON.stringify({token:q.token,vault:q.vault,windowId:q.windowId,previous:q.previous,createdAt:new Date().toISOString()},null,2));
 for(const dir of [q.backup,q.backup+'..',q.backup+'../..',q.backup+'../../..'])q.syncDir(dir);q.durableBackup=true;
 q.guard(false);if(app.plugins.plugins['aigility-plugin-manager']!==q.old)throw Error('Instance changed before disable');
 q.phase='disabling';await app.plugins.disablePlugin('aigility-plugin-manager');
 q.guard(false,null,true);q.expectedInstance=null;q.enabledExpected=enabledState();
 q.phase='copying';for(const f of Object.keys(q.next)){
  q.guard(false);const bytes=fs.readFileSync(request.source+'/'+f);if(sha(bytes)!==q.next[f])throw Error('New artifact changed during job');
  if(sha(fs.readFileSync(target+f))===q.next[f]){q.skipped.push(f);q.artifactExpected[f]=q.next[f];continue;}
  q.assertHash(target+f,q.previous[f],'before-temp');
  const temp=target+f+'.'+q.token+'.tmp';q.guard(false);q.writeDurable(temp,bytes);
  q.assertHash(temp,q.next[f],'temp-before-rename');q.guard(false);q.assertHash(target+f,q.previous[f],'installed-before-rename');
  fs.renameSync(temp,target+f);q.artifactExpected[f]=q.next[f];q.copied.push(f);q.syncDir(target);q.assertHash(target+f,q.next[f],'installed-after-rename');
 }
 q.guard(false);q.assertArtifacts(q.next,'before-manifest');q.phase='manifest';await app.plugins.loadManifest(app.vault.configDir+'/plugins/aigility-plugin-manager');
 q.guard(false);q.assertArtifacts(q.next,'before-enable');q.phase='enabling';
 q.loaderHook=function(...args){if(args[0]!=='aigility-plugin-manager')return Reflect.apply(originalLoader,this,args);q.guard(false,null,true);if(this!==manager||++q.loaderCalls!==1)throw Error('Owned loader receiver/count');return Promise.resolve(Reflect.apply(originalLoader,this,args)).then(instance=>{q.loadedInstance=instance;q.loadedRuntime=instance?.runtime;if(!instance||manager.plugins['aigility-plugin-manager']!==instance||instance.manifest?.version!=='0.1.3'||instance.manifest?.name!=='AIgility Plugin Manager')throw Error('Owned loader result replaced');q.guard(false,instance,true);return instance;});};
 q.guard(false);q.writeDurable(q.backup+'loader-intent.json',JSON.stringify({token:q.token,leaseId:q.leaseId,status:'prepared',hadOwnDescriptor:!!loaderDescriptor,descriptor:loaderDescriptor?{writable:loaderDescriptor.writable,enumerable:loaderDescriptor.enumerable,configurable:loaderDescriptor.configurable}:null}));q.syncDir(q.backup);Object.defineProperty(manager,'loadPlugin',{value:q.loaderHook,writable:true,configurable:true,enumerable:loaderDescriptor?.enumerable??false});q.expectedLoader=q.loaderHook;
 await app.plugins.enablePlugin('aigility-plugin-manager');
 const fresh=q.loadedInstance;if(!fresh||manager.plugins['aigility-plugin-manager']!==fresh||q.loaderCalls!==1)throw Error('Owned enable did not retain returned instance');q.newInstance=fresh;
 if(fresh?.manifest?.version!=='0.1.3'||app.plugins.manifests['aigility-plugin-manager']?.version!=='0.1.3')throw Error('Loaded marker/conflict check failed');
 q.guard(false,fresh,true);q.expectedInstance=fresh;q.enabledExpected=enabledState();q.assertArtifacts(q.next,'after-enable');
 if(canonical(fresh.runtime.state)!==q.settings||canonical(fresh.runtime.local)!==q.local||fresh.runtime.state.deviceProfiles.length!==q.profiles||fresh.runtime.state.fixtureProfiles.length!==q.fixtures||JSON.stringify(q.configCurrent())!==JSON.stringify(q.config))throw Error('Settings/config drift; preserve for owner review');
 if(enabledState()!==q.enabledBefore||leafState()!==q.leavesBefore||app.workspace.activeLeaf?.id!==q.previousLeaf)throw Error('Enabled/leaf/source state changed; preserve for review');
 for(const f of Object.keys(q.next))if(sha(fs.readFileSync(target+f))!==q.next[f])throw Error('Installed artifact mismatch');
 q.result={profiles:q.profiles,fixtures:q.fixtures,wholeRuntimeStateUnchanged:true,localUnchanged:true,foreignAndCoreUnchanged:true,build:fresh.manifest.version,installed:q.next,settingsUnchanged:true,settingsUiUnchanged:true,settingsUiBefore,configUnchanged:true,configHashes:q.config,enabledUnchanged:true,leavesAndSourceUnchanged:true,activeLeaf:app.workspace.activeLeaf?.id,foreground:electron.remote.BrowserWindow.getFocusedWindow()?.id??null};
 q.phase='verified';
 }catch(e){q.error=String(e);}finally{
 if(q.loaderHook){try{if(Date.now()>=q.expires||window.__managerSidebarHotfix!==bag||bag.get(q.token)!==q||app!==primaryHost||document!==primaryDocument||app.workspace.containerEl.ownerDocument!==primaryDocument||app.plugins!==manager||electron.remote.getCurrentWindow().id!==expectedWindow)throw Error('Loader cleanup ownership/deadline');const current=Object.getOwnPropertyDescriptor(manager,'loadPlugin');if(current?.value!==q.loaderHook||current.configurable!==true||current.writable!==true||current.enumerable!==(loaderDescriptor?.enumerable??false))throw Error('Loader observer changed; preserve foreign descriptor');if(loaderDescriptor)Object.defineProperty(manager,'loadPlugin',loaderDescriptor);else Reflect.deleteProperty(manager,'loadPlugin');q.expectedLoader=originalLoader;}catch(e){q.error=(q.error?q.error+'; ':'')+String(e);}}
 q.status='settled';}})();
return {token:q.token,status:q.status,phase:q.phase,windowId:q.windowId,expires:q.expires};
'''
elif action == 'poll':
    body = owned+'return {token:q.token,status:q.status,phase:q.phase,error:q.error,result:q.result??null,copied:q.copied,skipped:q.skipped,drifts:q.drifts,backup:q.backup??null,rollbackStatus:q.rollbackStatus??null,rollbackError:q.rollbackError??null,settingsUiBefore:q.settingsUiBefore,durableBackup:q.durableBackup??false,rollbackRestored:q.rollbackRestored??[],closed:q.closed??false,expires:q.expires,windowId:q.windowId};'
elif action == 'rollback':
    raise SystemExit('Rollback requires separate supervised recovery; no automatic rollback in this delivery unit')

    body = owned+r'''
if(q.status!=='settled'||!q.error)throw Error('Rollback requires settled failed deployment');
if(q.rollbackStarted)return {status:q.rollbackStatus,error:q.rollbackError??null};
q.guard(true);q.assertArtifacts(q.artifactExpected,'rollback-preflight');q.rollbackStarted=true;q.rollbackStatus='running';q.rollbackRestored=[];
q.rollbackTask=(async()=>{try{
 const fs=require('fs'),crypto=require('crypto'),sha=s=>crypto.createHash('sha256').update(s).digest('hex'),target=app.vault.adapter.getBasePath()+'/.obsidian/plugins/aigility-plugin-manager/';
 q.guard(true);q.assertArtifacts(q.artifactExpected,'rollback-whole-before-disable');
 const current=app.plugins.plugins['aigility-plugin-manager'];
 if(current){q.guard(true);await app.plugins.disablePlugin('aigility-plugin-manager');q.guard(true,null,true);q.expectedInstance=null;q.enabledExpected=JSON.stringify([...app.plugins.enabledPlugins].sort());q.assertArtifacts(q.artifactExpected,'rollback-after-disable');}
 for(const f of [...q.copied,...q.skipped]){q.guard(true);q.assertArtifacts(q.artifactExpected,'rollback-before-slot');
  const temp=target+f+'.'+q.token+'.rollback.tmp';q.writeDurable(temp,q.originals[f],true);q.assertHash(temp,q.previous[f],'rollback-temp');
  q.guard(true);q.assertArtifacts(q.artifactExpected,'rollback-before-rename');fs.renameSync(temp,target+f);q.artifactExpected[f]=q.previous[f];q.rollbackRestored.push(f);q.syncDir(target,true);q.assertArtifacts(q.artifactExpected,'rollback-after-slot');
 }
 q.guard(true);q.assertArtifacts(q.previous,'rollback-before-manifest');await app.plugins.loadManifest(app.vault.configDir+'/plugins/aigility-plugin-manager');
 q.guard(true);q.assertArtifacts(q.previous,'rollback-after-manifest');
 if(q.enabled){await app.plugins.enablePlugin('aigility-plugin-manager');const restored=app.plugins.plugins['aigility-plugin-manager'];if(restored?.manifest?.version!==(request.vault==='Sandbox'?'0.1.3':'0.1.3'))throw Error('Previous loaded marker not restored');q.guard(true,restored,true);q.expectedInstance=restored;q.enabledExpected=JSON.stringify([...app.plugins.enabledPlugins].sort());}
 q.guard(true);q.assertArtifacts(q.previous,'rollback-final');if(q.enabledExpected!==q.enabledBefore)throw Error('Original enablement not restored');
 q.rollbackStatus='settled';
 }catch(e){q.rollbackStatus='settled';q.rollbackError=String(e);}})();return {status:q.rollbackStatus};
'''
elif action == 'close':
    body = owned+r'''
if(q.status!=='settled'||(q.error&&(q.rollbackStatus!=='settled'||q.rollbackError)))throw Error('Unresolved deployment; retain owned recovery state');
q.guard(true);const fs=require('fs'),crypto=require('crypto'),target=app.vault.adapter.getBasePath()+'/.obsidian/plugins/aigility-plugin-manager/';
for(const f of Object.keys(q.next)){for(const [suffix,expected] of [['.tmp',q.next[f]],['.rollback.tmp',q.previous[f]]]){const temp=target+f+'.'+q.token+suffix;if(fs.existsSync(temp)){if(crypto.createHash('sha256').update(fs.readFileSync(temp)).digest('hex')!==expected)throw Error('Own temp changed; retain');q.guard(true);fs.unlinkSync(temp);q.syncDir(target,true);}}}
q.guard(true);q.originals=null;q.closed=true;return {closed:true,phase:q.phase,rollbackStatus:q.rollbackStatus??null,activeLeaf:app.workspace.activeLeaf?.id,previousLeaf:q.previousLeaf,foreground:electron.remote.BrowserWindow.getFocusedWindow()?.id??null,foregroundBefore:q.foreground};
'''
else:
    raise SystemExit('Unknown action')
inner='(async()=>{const rootContract='+json.dumps(vault_contract)+';if(app.vault.getName()!==__VAULT__||app.vault.adapter.getBasePath()!==rootContract.observedBase)throw Error("Wrong target");for(const path of [rootContract.observedBase,rootContract.canonicalBase]){const st=require("fs").statSync(path);if(st.dev!==rootContract.vaultIdentity.dev||st.ino!==rootContract.vaultIdentity.ino)throw Error("Wrong directory identity");}'+body+'})()'
route='(async()=>{const wins=electron.remote.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w.id===1&&w.webContents.id===1&&w.webContents.getURL()==="app://obsidian.md/index.html");const main=[];for(const w of wins){const ok=await w.webContents.executeJavaScript('+json.dumps(('typeof app!=="undefined"&&app.vault.getName()===__VAULT__&&app.workspace.containerEl.ownerDocument===document').replace('__VAULT__',json.dumps(vault)))+');if(ok)main.push(w);}if(main.length!==1)throw Error("Target main window not unique");return await main[0].webContents.executeJavaScript('+json.dumps(inner.replace('__VAULT__',json.dumps(vault)))+');})()'
route=route.replace('__TITLE__',json.dumps(' - '+vault+' - '))
if offline:
    print(route)
    raise SystemExit()
route=route.replace('__TITLE__',json.dumps(' - '+vault+' - '))
if action=='begin':validate(state)
result=subprocess.run(['/opt/homebrew/bin/obsidian','vault=Sandbox','dev:cdp','method=Runtime.evaluate','params='+json.dumps({'expression':route,'awaitPromise':True,'returnByValue':True})],capture_output=True,text=True,timeout=15)
if result.returncode:raise RuntimeError(result.stderr or result.stdout[:500])
response=json.loads(result.stdout.strip().removeprefix('=> ').strip())
if response.get('exceptionDetails'):
    error_record={'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'action':action,'response':response}
    (p/'evidence'/('manager-sidebar-hotfix-'+action+'-error.json')).write_text(json.dumps(error_record,indent=2)+'\n')
    raise RuntimeError(json.dumps(response['exceptionDetails'])[:1500])
record={'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'action':action,'value':response['result'].get('value')}
suffix=action
assert Path(suffix).name==suffix
(p/'evidence'/('manager-sidebar-hotfix-'+vault+'-'+action+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(record,ensure_ascii=False))
