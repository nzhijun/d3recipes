import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {englishT} from './i18n-harness.mjs';
const source=await readFile(new URL('./worker.js',import.meta.url),'utf8');
function harness(engine){
  const messages=[],tasks=[];
  const context=vm.createContext({_t:englishT,URL,self:{location:{href:'http://localhost/worker.js'}},postMessage:m=>messages.push(m),setTimeout:fn=>tasks.push(fn),performance:{now:()=>0},mockEngine:engine});
  vm.runInContext(source.replace(/boot\(\)\.catch[^\n]*$/m,'')+'\nengine=mockEngine;',context);
  return {messages,tasks,send:data=>context.onmessage({data})};
}
test('affix failures preserve request key and worker continues handling requests',()=>{
  const h=harness({stems:(_,__,id)=>{if(id===1)throw Error('bad item');return '{}';},stat_max:()=>'{}'});
  h.send({type:'stems',key:'failed',item:1});h.send({type:'stems',key:'next',item:2});
  assert.equal(h.messages[0].type,'error');assert.equal(h.messages[0].key,'failed');
  assert.equal(h.messages[1].type,'stems');assert.equal(h.messages[1].key,'next');
});
for(const stage of ['run','results'])test('search '+stage+' failure preserves job ID and frees handle',()=>{
  let freed=0;
  const h=harness({search:()=>({run:()=>{if(stage==='run')throw Error('run failed');return true;},results:()=>{throw Error('results failed');},free:()=>freed++})});
  h.send({type:'search',id:42,query:{},budgetMs:1000});h.tasks.shift()();
  assert.equal(h.messages[0].type,'error');assert.equal(h.messages[0].id,42);assert.equal(freed,1);
});
const editorSource=await readFile(new URL('./create-build.js',import.meta.url),'utf8');
test('affix error rejects only its import request; fatal errors clear all pending requests',()=>{
  const rejected=[],pending=new Map([['a',{reject:e=>rejected.push(['a',e.message])}],['b',{reject:e=>rejected.push(['b',e.message])}]]);
  const context=vm.createContext({_t:englishT,pending,workerFailure:null,generation:0,notice:()=>{}});
  vm.runInContext(editorSource.slice(editorSource.indexOf('function failRequests('),editorSource.indexOf("worker.addEventListener('error'")),context);
  context.failRequests('bad item','a');assert.equal(pending.has('a'),false);assert.equal(pending.has('b'),true);
  assert.deepEqual(rejected,[['a','bad item']]);
  context.failRequests('crash');assert.equal(pending.size,0);assert.equal(rejected[1][0],'b');assert.match(context.workerFailure,/Reload/);
});
const searchSource=await readFile(new URL('./search-builds.js',import.meta.url),'utf8');
test('stale search errors are ignored and current errors advance the row',()=>{
  let advanced=0;const cell={textContent:''};
  const context=vm.createContext({_t:englishT,worker:{},active:{row:{index:0}},job:2,document:{getElementById:()=>cell},nextRow:()=>advanced++,engineFailed:()=>{},status:{}});
  const start=searchSource.indexOf('worker.onmessage=');
  vm.runInContext(searchSource.slice(start,searchSource.indexOf("window.addEventListener('d3-route'",start)),context);
  context.worker.onmessage({data:{type:'error',id:1,message:'old'}});assert.equal(advanced,0);assert.equal(cell.textContent,'');
  context.worker.onmessage({data:{type:'error',id:2,message:'current'}});assert.equal(advanced,1);assert.match(cell.textContent,/current/);
});
