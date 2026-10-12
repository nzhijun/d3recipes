import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {englishT} from './i18n-harness.mjs';
const source=await readFile(new URL('./search-builds.js',import.meta.url),'utf8');
const context=vm.createContext({_t:englishT,});
vm.runInContext(source.slice(source.indexOf('function searchItems('),source.indexOf('function nextRow(')),context);
test('search includes the primary item and all available alternatives without duplicates',()=>{
  const items=[{id:1,name:'Primary',slot:'Ring'},{id:2,name:'Alternative One',slot:'Ring'},{id:3,name:'The Alternative Two',slot:'Amulet'},{id:4,name:'Other',slot:'Ring'}];
  const found=context.searchItems({item:1,alternatives:['alternative one','Alternative-Two','Primary','Missing']},items);
  assert.deepEqual(Array.from(found,item=>item.id),[1,2,3]);
});
test('single-item slots retain their existing search target',()=>{
  const found=context.searchItems({item:2},[{id:1,name:'A'},{id:2,name:'B'}]);
  assert.deepEqual(Array.from(found,item=>item.id),[2]);
});
