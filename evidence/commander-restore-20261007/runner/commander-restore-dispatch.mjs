import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {runInner,runOuter} from './commander-restore-native.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),sha=p=>fs.existsSync(p)?hash(fs.readFileSync(p)):null;
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sync=p=>{const f=fs.openSync(p,'r');try{fs.fsyncSync(f);}finally{fs.closeSync(f);}};
const save=(p,v)=>{const f=fs.openSync(p,'wx');try{fs.writeFileSync(f,JSON.stringify(v,null,2));fs.fsyncSync(f);}finally{fs.closeSync(f);}sync(path.dirname(p));};
export function compilePackage(packageDir){
 const loaded=read(path.join(packageDir,'loaded.json'));
 const innerSource=runInner.toString(),outerSource=runOuter.toString();
 new vm.Script('('+innerSource+')({})');new vm.Script('('+outerSource+')({})');
 for(const t of loaded.targets)new vm.Script('('+innerSource+')('+JSON.stringify(t)+')');
 new vm.Script('('+outerSource+')('+JSON.stringify({...loaded,innerSource})+')');
 const proof={innerCompiled:true,outerCompiled:true,innerSha:hash(innerSource),outerSha:hash(outerSource),nativeIO:false,at:new Date().toISOString()};
 save(path.join(packageDir,'compile-proof.json'),proof);return proof;
}
export async function dispatch(packageDir){
 const loadedPath=path.join(packageDir,'loaded.json'),c=read(loadedPath),lease=read(c.leasePath),leaseSha=sha(c.leasePath);
 const ackBy=Date.parse(lease.ackBy);
 if(!Number.isFinite(ackBy)||typeof lease.token!=='string'||!lease.token.trim())throw Error('Invalid grant ACK date/token');
 if(lease.status!=='GRANTED'||lease.job!==c.job||lease.loadedSHA!==sha(loadedPath)||(lease.executor??lease.owner)!==c.owner||Date.now()>=ackBy)throw Error('No exact fresh ROOT grant');
 for(const[p,s]of [[c.helperPath,c.helperSha],[c.dispatchPath,c.dispatchSha],[c.baselinePath,c.baselineSha],[c.compileProofPath,c.compileProofSha]])if(sha(p)!==s)throw Error('Frozen package pin changed '+p);
 const proof=read(c.compileProofPath),innerSource=runInner.toString(),outerSource=runOuter.toString();
 if(!proof.innerCompiled||!proof.outerCompiled||proof.nativeIO!==false||proof.innerSha!==hash(innerSource)||proof.outerSha!==hash(outerSource))throw Error('Actual emitted proof mismatch');
 const ack=Date.now(),hard=Date.parse(lease.absoluteHardDeadline);if(!Number.isFinite(hard))throw Error('Hard deadline absent');
 const iso=ms=>new Date(Math.min(ms,hard)).toISOString(),controlPath=path.join(packageDir,'control.json');
 const control={job:c.job,token:lease.token,acknowledgedAt:new Date(ack).toISOString(),startBy:iso(ack+15000),actionBy:iso(ack+120000),totalBy:iso(ack+180000),rootHardBy:lease.absoluteHardDeadline,leaseSha};
 if(ack>=hard)throw Error('Expired hard deadline');
 const pins={[c.leasePath]:leaseSha,[loadedPath]:sha(loadedPath),[controlPath]:hash(JSON.stringify(control,null,2)),[c.helperPath]:c.helperSha,[c.dispatchPath]:c.dispatchSha,[c.baselinePath]:c.baselineSha,[c.compileProofPath]:c.compileProofSha};
 const r={...c,...control,pins,controlPath,innerSource,backupPath:path.join(packageDir,'global-backup'),outerResultPath:path.join(packageDir,'result.json'),targets:c.targets.map((t,i)=>({...t,...control,pins,controlPath,helperPath:c.helperPath,leasePath:c.leasePath,backupPath:path.join(packageDir,'target-'+i+'-backup'),resultPath:path.join(packageDir,'target-'+i+'-result.json')}))};
 // Fully enriched actual inner strings are compiled and frozen before ACK.
 r.invocations=r.targets.map(t=>{const source='('+innerSource+')('+JSON.stringify(t)+')';new vm.Script(source);return{root:t.root,source,sha:hash(source)};});
 r.emissionPath=path.join(packageDir,'actual-emissions.json');const emissionBytes=JSON.stringify(r.invocations);r.emissionSha=hash(emissionBytes);
 const outerInvocation='('+outerSource+')('+JSON.stringify(r)+')';new vm.Script(outerInvocation);
 save(r.emissionPath,r.invocations);
 // save uses pretty JSON; bind to the durable bytes rather than compact preview.
 r.emissionSha=sha(r.emissionPath);
 const actualOuterInvocation='('+outerSource+')('+JSON.stringify(r)+')';new vm.Script(actualOuterInvocation);
 save(path.join(packageDir,'actual-compilation.json'),{innerHashes:r.invocations.map(x=>x.sha),outerSha:hash(actualOuterInvocation),actualInnerCompiled:true,actualOuterCompiled:true,nativeIO:false});
 const actualProofSha=sha(path.join(packageDir,'actual-compilation.json'));
 save(controlPath,control);
 const guard=poll=>{
  if(Date.now()>=Date.parse(poll?control.totalBy:control.actionBy)||Date.now()>=hard)throw Error('Controller deadline');
  for(const[p,s]of Object.entries(pins))if(sha(p)!==s)throw Error('Controller pin drift '+p);
  if(sha(r.emissionPath)!==r.emissionSha||sha(path.join(packageDir,'actual-compilation.json'))!==actualProofSha)throw Error('Actual compiled emissions pin drift');
 };
 const cli=(code,poll=false)=>{new vm.Script(code);guard(poll);const raw=execFileSync('obsidian',['vault='+c.native.vault,'eval','code='+code],{encoding:'utf8',timeout:10000}).trim();guard(poll);if(!raw.startsWith('=> '))throw Error('Unknown CLI return; SAME job only');return JSON.parse(raw.slice(3));};
 let receipt=null,error=null;
 try{
  guard(false);if(Date.now()>=Date.parse(control.startBy))throw Error('NO_START expired');
  save(path.join(packageDir,'first-action.json'),{job:c.job,token:lease.token,at:new Date().toISOString(),action:'Single Commander outer Begin'});
  save(path.join(packageDir,'begin-return.json'),cli(actualOuterInvocation));
  const pollCode='(()=>{const w=require("electron").remote.getCurrentWindow();if(app.appId!=='+JSON.stringify(c.native.appId)+'||app.vault.getName()!=='+JSON.stringify(c.native.vault)+'||w.id!=='+c.native.window+'||w.webContents.id!=='+c.native.wc+')throw Error("Poll exact realm");const q=window.__commanderRestoreJobs?.get('+JSON.stringify(lease.token)+');return JSON.stringify(q?.receipt??{status:q?.status??"UNKNOWN",pending:q?.pending??true,taskSettled:q?.taskSettled??false});})()';new vm.Script(pollCode);
  for(;;){const out=cli(pollCode,true);if(out.status==='UNKNOWN')throw Error('UNKNOWN preserved; no retry');if(!out.pending||out.status==='FAILED_PRESERVED'){receipt=out;break;}guard(true);await new Promise(done=>setTimeout(done,150));guard(true);}
 }catch(e){error=String(e);save(path.join(packageDir,'dispatch-error.json'),{error,preserve:true,noRetry:true,at:new Date().toISOString()});}
 const report={job:c.job,token:lease.token,status:receipt?.status??'UNKNOWN_PRESERVED',pending:receipt?.pending??true,error,requiresRootClosure:true,at:new Date().toISOString()};save(path.join(packageDir,'dispatch-return.json'),report);return report;
}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href){
 const [mode,dir]=process.argv.slice(2);if(!dir||!['--compile','--begin'].includes(mode))throw Error('Explicit --compile|--begin outside-vault packageDir required');
 console.log(JSON.stringify(mode==='--compile'?compilePackage(dir):await dispatch(dir)));
}
