// Root acceptance-check component. Inert import; no filesystem or native CLI access.
export async function cleanupOwnedFixtureFiles(adapter,owned,{gate,digest,onStep=async()=>{}}){
 const ids=new Set(['aigility-manager-fixture-a','aigility-manager-fixture-b']);
 const names=['manifest.json','main.js','data.json','custom.txt'];
 const seen=new Set();
 if(!Array.isArray(owned)||owned.length!==2)throw Error('Exactly two owned fixture namespaces required');
 for(const entry of owned){
  if(!ids.has(entry.id)||seen.has(entry.id)||entry.directory!=='.obsidian/plugins/'+entry.id)throw Error('Invalid owned fixture namespace');seen.add(entry.id);
  if(!entry.hashes||Object.keys(entry.hashes).sort().join()!=[...names].sort().join()||names.some(n=>!/^[a-f0-9]{64}$/.test(entry.hashes[n])))throw Error('Exact four expected fixture hashes required');
 }
 const call=async fn=>{gate();const value=await fn();gate();return value;};
 const contents=async(entry,remaining)=>{
  const listing=await call(()=>adapter.list(entry.directory));
  const expected=remaining.map(n=>entry.directory+'/'+n).sort();
  if(listing.folders.length||[...listing.files].sort().join()!=expected.join())throw Error('Unexpected fixture folder contents; preserve namespace: '+entry.id);
 };
 const match=async(entry,name)=>{
  const text=await call(()=>adapter.read(entry.directory+'/'+name));
  const current=await call(()=>digest(text));
  if(current!==entry.hashes[name])throw Error('Fixture postimage changed; preserve file: '+entry.id+'/'+name);
 };
 const removed=[];
 for(const entry of owned){
  await contents(entry,names);for(const name of names)await match(entry,name);
  const remaining=[...names];
  for(const name of names){
   const file=entry.directory+'/'+name;
   await call(()=>onStep({phase:'remove-fixture-file',path:file,status:'planned'}));
   await contents(entry,remaining);await match(entry,name);
   await call(()=>adapter.remove(file));remaining.splice(remaining.indexOf(name),1);
   if(await call(()=>adapter.exists(file)))throw Error('Removed file reappeared; preserve namespace: '+file);
   removed.push(file);await call(()=>onStep({phase:'remove-fixture-file',path:file,status:'settled'}));
  }
  await call(()=>onStep({phase:'remove-empty-fixture-directory',path:entry.directory,status:'planned'}));
  await contents(entry,[]);await call(()=>adapter.rmdir(entry.directory,false));
  if(await call(()=>adapter.exists(entry.directory)))throw Error('Fixture directory removal readback failed: '+entry.id);
  await call(()=>onStep({phase:'remove-empty-fixture-directory',path:entry.directory,status:'settled'}));
 }
 return {removed,directories:owned.map(e=>e.directory)};
}
export function cleanupOwnedManifest(app,id,manifestObject,{gate}){
 if(!['aigility-manager-fixture-a','aigility-manager-fixture-b'].includes(id))throw Error('Manifest outside owned namespace');
 gate();
 if(app.plugins.manifests[id]!==manifestObject||!manifestObject)throw Error('Owned manifest was replaced; preserve current slot');
 if(app.plugins.enabledPlugins.has(id)||app.plugins.plugins[id]?._loaded===true)throw Error('Owned fixture still native-enabled or loaded');
 delete app.plugins.manifests[id];gate();return {id,removed:true};
}
