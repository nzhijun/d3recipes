import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {englishT} from './i18n-harness.mjs';
const source=await readFile(new URL('./search-builds.js',import.meta.url),'utf8');
function harness(active){
  const messages=[];let advanced=0;
  const context=vm.createContext({_t:englishT,active,job:1,document:{getElementById:()=>({textContent:''})},worker:{postMessage:m=>messages.push(m)},nextRow:()=>advanced++});
  vm.runInContext(source.slice(source.indexOf('function setOwned('),source.indexOf("select.addEventListener('change'")),context);
  return {context,messages,advanced:()=>advanced};
}
test('newly needed rows are queued once and stale results cleared',()=>{
  const row={index:1,owned:true,best:{},results:{primal:{}}},current={index:0};
  const h=harness({row:current,queue:[]});h.context.setOwned(row,false);h.context.setOwned(row,false);
  assert.equal(h.context.active.queue.length,1);assert.equal(h.context.active.queue[0],row);assert.equal(row.best,null);assert.equal(Object.keys(row.results).length,0);
  h.context.setOwned(row,true);assert.equal(h.context.active.queue.length,0);assert.equal(h.messages.length,0);
});
test('marking current row owned cancels its job and advances queue',()=>{
  const row={index:0};const h=harness({row,queue:[]});h.context.setOwned(row,true);
  assert.equal(h.messages[0].type,'cancel');assert.equal(h.context.job,2);assert.equal(h.advanced(),1);
});
test('changing ownership without an active search clears results without starting work',()=>{
  const row={index:0,best:{}};const h=harness(null);h.context.setOwned(row,false);
  assert.equal(row.best,null);assert.equal(h.advanced(),0);assert.equal(h.messages.length,0);
});
