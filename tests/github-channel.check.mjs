import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from '../test.config.mjs';
const {GithubManager}=await importModule('src/integrated/github.ts');

test('a beta-enabled channel can advance from an older beta to a newer stable release without fetching history', async()=>{
 const requests=[];
 const asset=version=>({tag_name:version,prerelease:version.includes('-'),draft:false,assets:[{name:'manifest.json',browser_download_url:`https://github.com/acme/example/releases/download/${version}/manifest.json`}]});
 const runtime={state:{records:{},githubSources:{'community:example':{repo:'acme/example',trackPrereleases:true}}},local:{},list:()=>[{ref:{kind:'community',id:'example'},installed:true,compatible:true,version:'1.5.0-beta.1'}]};
 const plugin={githubRequest:async({url})=>{
  requests.push(url);
  if(url.includes('community-plugins.json'))return{status:200,json:[]};
  if(url.includes('/releases?'))return{status:200,json:[asset('2.0.0'),asset('1.5.0-beta.2'),asset('1.5.0-beta.1')]};
  const version=url.split('/').at(-2);
  return{status:200,text:JSON.stringify({id:'example',version,minAppVersion:'1.0.0'})};
 }};
 const manager=new GithubManager(runtime,{vault:{adapter:{}}},plugin);
 const result=await manager.checkAll();
 assert.equal(result[0].proposed,'2.0.0','allowing prereleases must still accept a later stable release');
 const releaseQueries=requests.filter(url=>url.includes('/releases?'));
 assert.equal(releaseQueries.length,1);
 assert.equal(new URL(releaseQueries[0]).searchParams.get('per_page'),'3','catalog checks retain the bounded light query');
});
