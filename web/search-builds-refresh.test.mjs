import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./search-builds.js',import.meta.url),'utf8');
function harness(saved,loaded){
  const controls=new Map();
  const element=tag=>({tag,textContent:'',children:[],dataset:{},style:{},append(child){this.children.push(child);},setAttribute(name,value){this[name]=value;}});
  const $=id=>{if(!controls.has(id))controls.set(id,{textContent:'',children:[],replaceChildren(...children){this.children=children;},querySelectorAll:()=>[]});return controls.get(id);};
  const select={value:loaded.id,replaceChildren(){this.value='';},add(){}};
  const messages=[];
  const context=vm.createContext({searchEnded:()=>{},document:{createElement:element},localStorage:{getItem:()=>JSON.stringify(saved)},key:'builds',select,status:{textContent:''},Option:function(){},$,build:loaded,rows:[{item:1}],active:{row:{}},job:10,info:{items:[]},worker:{postMessage:m=>messages.push(m)},esc:s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),statName:String,itemName:String});
  vm.runInContext(source.slice(source.indexOf('function targetStats('),source.indexOf('function bestCandidate('))+source.slice(source.indexOf('function refresh()'),source.indexOf("document.getElementById('search-builds-create')"))+source.slice(source.indexOf('function cancel()'),source.indexOf("select.addEventListener('change'")),context);
  return {context,controls,messages};
}
const original={id:'a',class:0,slots:[{item:1,slot:'Head',wants:[]}]};
test('edited build cancels active job and rebuilds rows from saved record',()=>{
  const updated={...original,class:5,slots:[{item:2,slot:'Chest',wants:[{stem:'Dex'}]}]};
  const h=harness([updated],original);h.context.refresh();
  assert.equal(h.context.active,null);assert.equal(h.context.job,11);
  assert.equal(h.context.build.class,5);assert.equal(h.context.rows[0].item,2);assert.equal(h.context.rows[0].wants[0].stem,'Dex');
  assert.equal(h.messages[0].type,'cancel');
});
test('deleted selected build cancels search, clears rows, and disables Run',()=>{
  const h=harness([],original);h.context.refresh();
  assert.equal(h.context.active,null);assert.equal(h.context.build,undefined);assert.equal(h.context.rows.length,0);assert.equal(h.controls.get('run').disabled,true);
});
test('unchanged saved record preserves active search and rows',()=>{
  const h=harness([original],original);h.context.refresh();
  assert.notEqual(h.context.active,null);assert.equal(h.context.job,10);assert.equal(h.messages.length,0);
});
test('saved item names and stat labels are escaped in the card markup',()=>{
  const markup='<img src=x onerror=alert(1)>';
  const updated={...original,slots:[{item:2,slot:'Head',externalName:markup,wants:[{label:markup}]}]};
  const h=harness([updated],original);h.context.refresh();
  const html=h.controls.get('rows').innerHTML;
  assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('aria-label="Already have &lt;img'));
});