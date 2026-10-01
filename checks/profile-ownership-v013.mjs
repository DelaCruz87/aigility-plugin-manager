// Acceptance-only ownership guards. Serialized functions have no module closure.
export function writeReceiptCAS(fs,file,expectedRaw,expectedMetadata,next,nextMetadata=expectedMetadata){
 if(typeof expectedRaw!=='string'||[expectedMetadata,nextMetadata].some(m=>!/^aigility-manager-profile:[A-Za-z0-9_-]+$/.test(m?.key??'')||!/^[a-f0-9]{32}$/.test(m?.nativeToken??'')||!Number.isFinite(m.deadline)||!Number.isFinite(m.actionDeadline)||m.deadline<=m.actionDeadline))throw Error('Complete frozen receipt ownership required');
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const fields=['key','leaseId','ackUTC','startBy','deadline','actionDeadline','nativeToken','nativeIdentity'];
 const descriptor=fs.openSync(file,'r+');
 try{
  const initial=fs.fstatSync(descriptor),named=fs.statSync(file);
  if(initial.ino!==named.ino||initial.dev!==named.dev)throw Error('Receipt file identity changed');
  const raw=fs.readFileSync(descriptor,'utf8');
  if(raw!==expectedRaw||fs.readFileSync(file,'utf8')!==expectedRaw)throw Error('Receipt expected bytes changed; preserve replacement');
  const previous=JSON.parse(raw);
  for(const field of fields)if(!same(previous[field],expectedMetadata[field])||!same(next[field],nextMetadata[field]))throw Error('Receipt immutable ownership changed: '+field);
  const last=fs.statSync(file),latest=fs.fstatSync(descriptor);
  if(last.ino!==initial.ino||last.dev!==initial.dev||latest.ino!==initial.ino||fs.readFileSync(file,'utf8')!==expectedRaw)throw Error('Receipt replaced immediately before write');
  const output=JSON.stringify(next,null,2)+'\n';
  // Writing the pinned descriptor cannot overwrite a foreign replacement path.
  fs.writeSync(descriptor,output,0,'utf8');fs.ftruncateSync(descriptor,Buffer.byteLength(output));fs.fsyncSync(descriptor);
  const after=fs.statSync(file);
  if(after.ino!==initial.ino||after.dev!==initial.dev||fs.readFileSync(file,'utf8')!==output)throw Error('Receipt changed during write; preserve foreign replacement');
  return output;
 }finally{fs.closeSync(descriptor);}
}
export function frozenNativeIdentity(app,globals,doc,remote,expected){
 if(!expected||!Number.isInteger(expected.windowId)||!Number.isInteger(expected.webContentsId)||typeof expected.documentURL!=='string'||typeof expected.webContentsURL!=='string'||!/^[a-f0-9]{32}$/.test(expected.baselineToken??'')||!/^aigility-manager-profile-baseline:[A-Za-z0-9_-]+$/.test(expected.baselineKey??''))throw Error('Frozen native target identity required');
 const baseline=globals[expected.baselineKey],win=remote.getCurrentWindow();
 if(!baseline||baseline.token!==expected.baselineToken||baseline.documentRef!==doc||baseline.windowRef!==win||baseline.webContentsRef!==win.webContents)throw Error('Frozen native target references changed');
 if(win.id!==expected.windowId||win.webContents.id!==expected.webContentsId||win.webContents.getURL()!==expected.webContentsURL||doc.documentURI!==expected.documentURL||app.workspace.containerEl.ownerDocument!==doc)throw Error('Frozen native window/webContents/document changed');
 if(app.vault.getName()!=='Sandbox'||app.vault.adapter.getBasePath()!=='/Users/eme/Obsidian/Sandbox'||app.appId!=='d137282e82167d84')throw Error('Frozen target is not primary Sandbox');
 return true;
}
