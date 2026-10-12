// Test helper: the page's translation function with English text, for tests that run page code outside a browser.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./i18n.js',import.meta.url),'utf8');
const window={};
vm.runInContext(source,vm.createContext({
  window,
  document:{addEventListener(){},querySelectorAll:()=>[],getElementById:()=>null},
  localStorage:{getItem:()=>'en',setItem(){}},
  navigator:{languages:['en']},
  CustomEvent:function(){}}));
export const englishT=(key,params)=>window.t(key,params);
