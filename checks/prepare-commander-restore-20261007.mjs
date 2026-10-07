// ROOT-authorized readonly preparation. No runtime install, enable or unload.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import vm from 'node:vm';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {snapshotNative} from '../evidence/commander-restore-20261007/runner/commander-restore-native.mjs';
const repo=fileURLToPath(new URL('..',import.meta.url)),bundle=path.join(repo,'evidence/commander-restore-20261007/runner');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),sha=p=>fs.existsSync(p)?hash(fs.readFileSync(p)):null;
const sync=p=>{const d=fs.openSync(p,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}};
const save=(p,b)=>{const f=fs.openSync(p,'wx');try{fs.writeFileSync(f,b);fs.fsyncSync(f);}finally{fs.closeSync(f);}sync(path.dirname(p));};
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cmdr3-ready-'));sync(path.dirname(temp));
const remaining=process.argv.includes('--remaining');
 const allHints=[{name:'Sandbox',root:'/Users/eme/Obsidian/Sandbox',appId:'d137282e82167d84',window:2,wc:2},{name:'Sandbox 2',root:'/Users/eme/Obsidian/Sandbox 2',appId:'ea43ae4a186d86d2',window:12,wc:14},{name:'Sandbox 3',root:'/Users/eme/Obsidian/Sandbox 3',appId:'a47dd856a18af109',window:15,wc:17}];
 const hints=remaining?allHints.slice(1):allHints;
const code='(async()=>{const remote=require("electron").remote,J=JSON.stringify;const snap=()=>remote.BrowserWindow.getAllWindows().map(w=>({id:w.id,wc:w.webContents.id,crashed:w.webContents.isCrashed()}));const before=snap(),focus=remote.BrowserWindow.getFocusedWindow()?.id??null,results=[];for(const t of '+JSON.stringify(hints)+'){const ws=remote.BrowserWindow.getAllWindows().filter(w=>w.id===t.window&&w.webContents.id===t.wc&&!w.webContents.isCrashed());if(ws.length!==1)throw Error("Readonly target mismatch");const result=await ws[0].webContents.executeJavaScript("("+'+JSON.stringify(snapshotNative.toString())+'+")("+J(t)+")");if(J(snap())!==J(before)||(remote.BrowserWindow.getFocusedWindow()?.id??null)!==focus)throw Error("Readonly windows/focus changed");results.push(result);}return J({at:new Date().toISOString(),windows:before,focus,realms:results});})()';
new vm.Script('('+snapshotNative.toString()+')({})');new vm.Script(code);
const raw=execFileSync('obsidian',['vault=Sandbox','eval','code='+code],{encoding:'utf8',timeout:10000}).trim();if(!raw.startsWith('=> '))throw Error('Readonly return unknown');const native=JSON.parse(raw.slice(3));save(path.join(temp,'native.json'),JSON.stringify(native,null,2));
const source='/Users/eme/Obsidian/ENSO/.obsidian/plugins/cmdr',candidateDir=path.join(temp,'candidate');fs.mkdirSync(candidateDir);const artifacts={};
for(const n of ['main.js','manifest.json','styles.css']){const b=fs.readFileSync(path.join(source,n));save(path.join(candidateDir,n),b);artifacts[n]={source:path.join(candidateDir,n),sha:hash(b)};}
sync(candidateDir);sync(temp);
const semantic=o=>JSON.stringify(Array.isArray(o)?o.map(x=>JSON.parse(semantic(x))):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,JSON.parse(semantic(o[k]))])):o);
const manifest=JSON.parse(fs.readFileSync(path.join(candidateDir,'manifest.json'),'utf8'));
const protectedFiles={},baselineFiles={},targets=[];
for(let i=0;i<hints.length;i++){
 const t=hints[i],realm=native.realms[i],dir=path.join(t.root,'.obsidian/plugins/cmdr');
 if(realm.cmdr.loaded||!realm.cmdr.native)throw Error('Profile changed: reconcile before freeze '+t.name);
 const registered={...realm.cmdr.manifest};if(registered.dir!=='.obsidian/plugins/cmdr'&&registered.dir!==dir)throw Error('Unexpected host manifest dir');delete registered.dir;
 if(semantic(registered)!==semantic(manifest))throw Error('Registered manifest semantic mismatch '+t.name+' keys '+Object.keys(realm.cmdr.manifest));
 const preimages={};for(const n of Object.keys(artifacts)){preimages[n]=sha(path.join(dir,n));baselineFiles[path.join(dir,n)]=preimages[n];}
 const config=path.join(t.root,'.obsidian');for(const n of fs.readdirSync(config))if(n.endsWith('.json'))protectedFiles[path.join(config,n)]=sha(path.join(config,n));
 const plugins=path.join(config,'plugins');for(const id of fs.readdirSync(plugins)){const p=path.join(plugins,id);if(fs.statSync(p).isDirectory())for(const n of ['data.json','effective-state.json'])if(fs.existsSync(path.join(p,n)))protectedFiles[path.join(p,n)]=sha(path.join(p,n));}
 targets.push({job:remaining?'commander-restore-remaining-two-20261007':'commander-restore-three-sandbox-20261007',targetScope:remaining?'remaining-two':'all-three',allowOwnRibbon:remaining,root:t.root,vault:t.name,native:realm.native,artifacts,preimages,protectedFiles:null,runtimeBefore:realm.runtimeBefore,expectedLoaded:realm.cmdr.loaded,expectedNative:realm.cmdr.native,workspacePath:remaining?path.join(t.root,'.obsidian/workspace.json'):undefined,workspaceSha:remaining?sha(path.join(t.root,'.obsidian/workspace.json')):undefined,workspaceBefore:remaining?JSON.parse(fs.readFileSync(path.join(t.root,'.obsidian/workspace.json'),'utf8')):undefined});
}
if(remaining)for(const t of targets)delete protectedFiles[t.workspacePath];
 for(const t of targets)t.protectedFiles=protectedFiles;
const baselinePath=path.join(temp,'baseline.json');save(baselinePath,JSON.stringify({at:new Date().toISOString(),protectedFiles,baselineFiles},null,2));
for(const n of ['commander-restore-native.mjs','commander-restore-dispatch.mjs'])save(path.join(temp,n),fs.readFileSync(path.join(bundle,n)));
const c={job:remaining?'commander-restore-remaining-two-20261007':'commander-restore-three-sandbox-20261007',targetScope:remaining?'remaining-two':'all-three',owner:'01a10c7c-6e4a-7ad0-8e52-5e0c9bb51484',leasePath:'/var/folders/gd/hvzhhtjs0794fpy1_27c0hg40000gn/T/enso-mac-lease-01a0f837-20261006.json',native:native.realms[0].native,targets,protectedFiles,baselineFiles,windowsBefore:native.windows,focusBefore:native.focus,helperPath:path.join(temp,'commander-restore-native.mjs'),helperSha:sha(path.join(temp,'commander-restore-native.mjs')),dispatchPath:path.join(temp,'commander-restore-dispatch.mjs'),dispatchSha:sha(path.join(temp,'commander-restore-dispatch.mjs')),baselinePath,baselineSha:sha(baselinePath),compileProofPath:path.join(temp,'compile-proof.json')};
const loadedPath=path.join(temp,'loaded.json');save(loadedPath,JSON.stringify(c,null,2));
const rawProof=execFileSync('node',[c.dispatchPath,'--compile',temp],{encoding:'utf8',timeout:10000});const proof=JSON.parse(rawProof);c.compileProofSha=sha(c.compileProofPath);fs.writeFileSync(loadedPath,JSON.stringify(c,null,2));const f=fs.openSync(loadedPath,'r');fs.fsyncSync(f);fs.closeSync(f);sync(temp);
for(const[p,s]of Object.entries({...protectedFiles,...baselineFiles}))if(sha(p)!==s)throw Error('Prepared filesystem drift '+p);
console.log(JSON.stringify({status:'PREPARED_READONLY',temp,loadedSHA:sha(loadedPath),helperSha:c.helperSha,dispatchSha:c.dispatchSha,baselineSha:c.baselineSha,compileProofSha:c.compileProofSha,protectedCount:Object.keys(protectedFiles).length,artifacts,proof},null,2));
