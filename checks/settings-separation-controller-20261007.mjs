// Reused root Oct7 shared factory pattern; fresh Manager parameters only. All methods share one module
// closure. Dependencies are injected so closure wiring is tested without host IO.
export function createController(c, d) {
  const {fs, crypto, vm, execFileSync} = d;
  const now = d.now ?? (() => Date.now());
  const hash = b => crypto.createHash('sha256').update(b).digest('hex');
  const syncDir = p => { const fd=fs.openSync(p,'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
  const save = (p,v) => { const fd=fs.openSync(p,'wx'); try { fs.writeFileSync(fd,JSON.stringify(v,null,2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } syncDir(c.temp); };
  const nativeSource = c.emittedSource;
  new vm.Script('('+nativeSource+')({})');
  let state = null;
  const guard = (polling = false) => {
    const r=state;
    if(!r) throw Error('Controller has no acknowledged job');
    if(now()>=Date.parse(polling ? r.totalBy : r.actionBy)||now()>=Date.parse(r.rootHardBy)) throw Error('Controller deadline');
    for(const [p,sha] of [[r.controlPath,r.controlSha],[r.leasePath,r.leaseSha],[r.helperPath,r.helperSha],[r.baselinePath,r.baselineSha],[c.controllerPath,c.controllerSha],[c.loadedPath,c.loadedSha]]) if(hash(fs.readFileSync(p))!==sha) throw Error('Controller pin drift '+p);
    if(!fs.readFileSync(r.leasePath,'utf8').includes(r.token)) throw Error('Controller lease token');
  };
  const cli = (code, polling = false) => {
    new vm.Script(code); guard(polling);
    const raw=execFileSync('obsidian',['vault='+c.vault,'eval','code='+code],{encoding:'utf8',timeout:10000}).trim();
    guard(polling);
    if(!raw.startsWith('=> ')) throw Error('Unknown return; preserve SAME job');
    return JSON.parse(raw.slice(3));
  };
  const begin = grant => {
    if(state||fs.existsSync(c.temp+'/control.json')) throw Error('Begin already acknowledged; no retry');
    const ack=now(),hard=Date.parse(grant.rootHardBy);
    if(!Number.isFinite(hard)||ack>=hard) throw Error('No current root hard deadline');
    const r={job:c.job,...grant,acknowledgedAt:new Date(ack).toISOString(),startBy:new Date(Math.min(ack+15000,hard)).toISOString(),actionBy:new Date(Math.min(ack+120000,hard)).toISOString(),totalBy:new Date(Math.min(ack+180000,hard)).toISOString(),native:c.native,fixtureSource:c.fixtureSource,fixtureArtifacts:c.fixtureArtifacts,root:c.root,source:c.source,leasePath:c.leasePath,controlPath:c.temp+'/control.json',helperPath:c.helperPath,helperSha:c.helperSha,baselinePath:c.baselinePath,baselineSha:c.baselineSha,preimages:c.preimages,artifacts:c.artifacts,backup:c.temp+'/private-backup',resultPath:c.temp+'/result.json',screenshotPath:c.temp+'/settings.png',controllerPath:c.controllerPath,controllerSha:c.controllerSha,loadedPath:c.loadedPath,loadedSha:c.loadedSha};
    save(r.controlPath,{...r,plan:'Own Manager016 plus temporary fixture; actual toggles/self-disable; own settings/dialog geometry only, separate CUA pixel verification required; native Settings preserved; CAS cleanup State/Local/community/fixture; retain fresh generated effective report; restore only Manager position in native order without foreign activation; no profile actions; outside-vault receipts.'});
    r.controlSha=hash(fs.readFileSync(r.controlPath));
    save(c.temp+'/parameters.json',r);
    state=r; guard();
    const code='('+nativeSource+')('+JSON.stringify(r)+')';
    new vm.Script(code);
    if(now()>=Date.parse(r.startBy)) throw Error('NO_START expired');
    save(c.temp+'/first-action.json',{token:r.token,job:r.job,firstActionAt:new Date(now()).toISOString(),action:'Own Manager016 delivery, functional controls and owned dialog dispatch'});
    return {returned:cli(code),parameters:r};
  };
  const poll = () => {
    const r=state;
    if(!r) throw Error('No job to poll');
    const out=cli('(()=>{if(app.appId!=='+JSON.stringify(c.native.appId)+'||require("electron").remote.getCurrentWindow().id!=='+c.native.window+'||require("electron").remote.getCurrentWindow().webContents.id!=='+c.native.wc+')throw Error("Poll exact identity");const q=window.__managerSettings016Jobs?.get('+JSON.stringify(r.token)+');return JSON.stringify(q?.receipt??{status:q?.status??"UNKNOWN",pending:q?.pending??true,phase:q?.phase});})()', true);
    syncDir(c.temp);
    return out;
  };
  return Object.freeze({begin,poll,parameters:()=>state});
}
