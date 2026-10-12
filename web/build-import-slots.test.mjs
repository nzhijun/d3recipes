import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {englishT} from './i18n-harness.mjs';
const source=await readFile(new URL('./create-build.js',import.meta.url),'utf8');
const context=vm.createContext({_t:englishT,slots:['Chest'],info:{classes:['DemonHunter'],items:[{id:1,name:'Test Cloak',classes:[0],slot:'Cloak'}]},normalize:s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,''),uid:()=>'request',pending:new Map(),workerFailure:null,worker:{postMessage:()=>{}},STATS:{},statName:s=>s});
const start=source.indexOf('async function prepareImported(');
vm.runInContext(source.slice(start,source.indexOf("$('clone').addEventListener",start)),context);
test('Cloak maps to Chest and Potion is skipped before validation',async()=>{
  // Resolve the asynchronous stem request just as the worker does.
  const promise=context.prepareImported({name:'Test',class:'DemonHunter',slot:[{name:'Potion',items:['Unknown potion'],stat_priority:['Unknown stat']},{name:'Cloak',items:['Test Cloak'],stat_priority:[]}]});
  context.pending.get('request').resolve({});
  const {build,skipped}=await promise;
  assert.equal(build.slots.length,1);assert.equal(build.slots[0].slot,'Chest');assert.equal(build.slots[0].item,1);assert.equal(skipped[0],'Potion slot');
});
test('any-item Potion rows are also skipped',async()=>{
  const {build,skipped}=await context.prepareImported({name:'Test',class:'DemonHunter',slot:[{name:'Potion',any_item:true}]});
  assert.equal(build.slots.length,0);assert.equal(skipped.length,1);
});
