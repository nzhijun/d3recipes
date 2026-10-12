import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {initSync,Engine} from './pkg/d3cube.js';
import {parseBuildToml} from './build-toml.js';
import {baseQuery} from './search-settings.js';
import {STATS,statName,statNameEnglish,legacyStatNames} from './stats.js';
import {englishT} from './i18n-harness.mjs';
initSync({module:await readFile(new URL('./pkg/d3cube_bg.wasm',import.meta.url))});
const engine=new Engine(await readFile(new URL('./data.json',import.meta.url),'utf8'));
const editor=await readFile(new URL('./create-build.js',import.meta.url),'utf8');
const search=await readFile(new URL('./search-builds.js',import.meta.url),'utf8');
const pending=new Map();
const context=vm.createContext({_t:englishT,STATS,statName,statNameEnglish,legacyStatNames,info:JSON.parse(engine.describe()),slots:['Head','Shoulders','Chest','Hands','Wrists','Waist','Legs','Feet','Amulet','Ring 1','Ring 2','Main-hand','Off-hand','Dual-Wield'],normalize:s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,''),pending,workerFailure:null,uid:()=>crypto.randomUUID(),worker:{postMessage:m=>{const request=pending.get(m.key);pending.delete(m.key);try{request.resolve(JSON.parse(engine.stems(m.class,m.slot,m.item)));}catch(e){request.reject(e);}}}});
vm.runInContext(editor.slice(editor.indexOf('async function prepareImported('),editor.indexOf("$('clone').addEventListener")),context);
vm.runInContext(search.slice(search.indexOf('function targetStats('),search.indexOf('function nextRow(')),context);
test('all bundled builds import against real item and affix tables',async()=>{
  const builds=parseBuildToml(await readFile(new URL('../builds.toml',import.meta.url),'utf8'));
  assert.ok(builds.length>=12);
  for(const source of builds){const {build}=await context.prepareImported(source);assert.ok(build.slots.length,source.name);assert.ok(build.slots.every(row=>row.wants.every(w=>w.exportName)),source.name);}
  assert.equal(pending.size,0);
});
test('real WASM accepts alternatives',async()=>{
  const builds=parseBuildToml(await readFile(new URL('../builds.toml',import.meta.url),'utf8'));
  const source=builds.find(b=>b.name.toLowerCase().includes('ue'));
  const {build}=await context.prepareImported(source);
  for(const row of build.slots.filter(row=>row.alternatives.length)){
    const items=context.searchItems(row,context.info.items);
    const query=baseQuery({c:build.class,p:['0.75','1','5','25'],f:75,xn:'0',xs:'1',cn:'2',w:row.wants.map(w=>[w.stem,''])},items[0],40,false);
    Object.assign(query,{items:Array.from(items,item=>item.id),slots:Array.from(new Set(items.map(item=>item.slot))),quality:'normal',maxpos:30,node_cap:10000});
    const handle=engine.search(JSON.stringify(query));
    try{handle.run(10000);const results=JSON.parse(handle.results());assert.ok(results.status);for(const hit of [...results.full,...results.near])assert.ok(items.some(item=>item.name===hit.name),hit.name);}finally{handle.free();}
  }
});
