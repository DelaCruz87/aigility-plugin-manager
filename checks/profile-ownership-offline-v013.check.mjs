// Ringer acceptance check executor. No Obsidian CLI or native vault access.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tests=['tests/profile-controller-v013.test.mjs','tests/profile-cases-v013.test.mjs','tests/profile-ownership-v013.test.mjs'];
let output,exitCode=0;try{const r=await promisify(execFile)(process.execPath,['--test','--test-name-pattern=ownership focal',...tests],{cwd:root,timeout:20000,maxBuffer:1024*1024});output=r.stdout+r.stderr;}catch(e){exitCode=Number.isInteger(e.code)?e.code:1;output=(e.stdout??'')+(e.stderr??'')+String(e);}
const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(k=>[k,Number(output.match(new RegExp('(?:ℹ |# )'+k+' (\\d+)'))?.[1]??NaN)]));
const passed=exitCode===0&&counts.tests===17&&counts.pass===17&&counts.fail===0&&counts.cancelled===0&&counts.skipped===0;
await writeFile(path.join(root,'evidence/profile-ownership-offline-v013.txt'),output);
await writeFile(path.join(root,'evidence/profile-ownership-offline-v013.json'),JSON.stringify({status:passed?'passed':'failed',at:new Date().toISOString(),tests,counts,exitCode,nativeExecuted:false,productSourceChanged:false,previous40Repeated:false},null,2)+'\n');
console.log(JSON.stringify({passed,exitCode,counts,nativeExecuted:false}));if(!passed)process.exitCode=1;
