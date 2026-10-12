import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {englishT} from './i18n-harness.mjs';
const source=await readFile(new URL('./search-builds.js',import.meta.url),'utf8');
const context=vm.createContext({_t:englishT,});
vm.runInContext(source.slice(source.indexOf('function targetStats('),source.indexOf('function searchItems(')),context);
test('build results accept only primals and rank eligible matches by stats then cost',()=>{
  const candidate=(tier,count,cost)=>({tier,hit:{matched:Array(count).fill(0),cost}});
  assert.equal(context.bestCandidate([candidate('primal',2,100),candidate('ancient',2,10),candidate('normal',3,1)]).tier,'primal');
  assert.equal(context.bestCandidate([candidate('primal',2,100),candidate('crafted',3,1)]).tier,'primal');
  assert.equal(context.bestCandidate([candidate('primal',2,20),candidate('crafted',1,1)]).tier,'primal');
  assert.equal(context.bestCandidate([candidate('normal',2,1),candidate('ancient',2,1),candidate('crafted',2,1)]),undefined);
  assert.equal(context.bestCandidate([candidate('primal',2,100),candidate('primal',2,20)]).hit.cost,20);
});
test('every stat a build lists is a target, imported or made by hand',()=>{
  for(const imported of [true,false]){
    const row={wants:['A','B','C','D','E'].map(stem=>({stem,min:null,imported}))};
    assert.deepEqual(Array.from(context.targetStats(row),w=>w.stem),['A','B','C','D','E']);
  }
});
