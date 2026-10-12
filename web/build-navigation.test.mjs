import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {englishT} from './i18n-harness.mjs';
const search=await readFile(new URL('./search-builds.js',import.meta.url),'utf8');
const router=await readFile(new URL('./builds.js',import.meta.url),'utf8');
test('Create new build invokes router, displays editor and creates navigable history',()=>{
  let click,shown=0,scrolled=0;const events=new Map(),history=[];
  const context=vm.createContext({_t:englishT,route:'search-builds',show:()=>shown++,location:{pathname:'/',search:''},history:{pushState:(_,__,url)=>history.push(url)},window:{addEventListener:(name,fn)=>events.set(name,fn),dispatchEvent:event=>events.get(event.type)?.(event),scrollTo:()=>scrolled++},CustomEvent:function(type,options){this.type=type;this.detail=options.detail;},document:{getElementById:()=>({addEventListener:(_,fn)=>click=fn})}});
  vm.runInContext(router.slice(router.indexOf('function go('),router.indexOf('function fromHash(')),context);
  vm.runInContext(router.split('\n').find(line=>line.includes('addEventListener("d3-navigate"')),context);
  const start=search.indexOf("document.getElementById('search-builds-create')");
  vm.runInContext(search.slice(start,search.indexOf("window.addEventListener('d3-route'",start)),context);
  click();assert.equal(context.route,'create-build');assert.deepEqual(history,['#create-build']);assert.equal(shown,1);assert.equal(scrolled,1);
});
