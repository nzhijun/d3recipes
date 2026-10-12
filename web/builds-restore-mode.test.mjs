import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {englishT} from './i18n-harness.mjs';
const source=await readFile(new URL('./builds.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function restoreMode()'),source.indexOf('async function refresh()'));
function run(stored,throws){
  const hc={value:'0'};
  const context=vm.createContext({_t:englishT,$:()=>hc,localStorage:{getItem:k=>{if(throws)throw new Error('blocked');assert.equal(k,'d3r-hc');return stored;}}});
  vm.runInContext(fn+';restoreMode();',context);
  return hc.value;
}
test('saved Hardcore is applied before the first prepared-list fetch',()=>assert.equal(run('1'),'1'));
test('saved Softcore, nothing saved, junk, or blocked storage keep the page value',()=>{
  assert.equal(run('0'),'0');assert.equal(run(null),'0');assert.equal(run('x'),'0');assert.equal(run('1',true),'0');
});
test('restoreMode runs before the first refresh()',()=>{
  assert.ok(source.lastIndexOf('restoreMode();')<source.lastIndexOf('\nrefresh();'));
});
