import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {initSync,Engine} from './pkg/d3cube.js';
// The page's language table (i18n.js): both languages stay in step, the first language comes from the saved choice and then
// the browser, and item names follow the language in use.
const source=await readFile(new URL('./i18n.js',import.meta.url),'utf8');
function load({saved=null,languages=['en-US'],storageThrows=false}={}){
  const window={};
  const context=vm.createContext({
    window,
    document:{addEventListener(){},querySelectorAll:()=>[],getElementById:()=>null},
    localStorage:{getItem(){if(storageThrows)throw new Error('blocked');return saved;},setItem(){if(storageThrows)throw new Error('blocked');}},
    navigator:{languages,language:languages[0]},
    CustomEvent:function(){}});
  const translations=vm.runInContext(source+';translations',context);
  return {window,translations};
}
test('every English string has a Chinese one, so the Chinese page never falls back to English for the page text',()=>{
  const {translations:{en,zh}}=load();
  assert.deepEqual(Object.keys(en).filter(k=>!(k in zh)),[]);
});
test('a Chinese-only key is a name (item, class, slot, stat), not page text the English page would show as a bare key',()=>{
  const {translations:{en,zh}}=load();
  const pageText=Object.keys(zh).filter(k=>!(k in en)&&/^[a-z][A-Za-z0-9]*$/.test(k));
  assert.deepEqual(pageText,[]);
});
test('the first language: a saved choice wins, then the browser language, then English',()=>{
  assert.equal(load({saved:'en',languages:['zh-CN']}).window.t('tagline'),load().translations.en.tagline);
  assert.equal(load({saved:'zh',languages:['en-US']}).window.t('tagline'),load().translations.zh.tagline);
  assert.equal(load({languages:['zh-TW','en']}).window.t('tagline'),load().translations.zh.tagline);
  assert.equal(load({languages:['de-DE']}).window.t('tagline'),load().translations.en.tagline);
  assert.equal(load({saved:'fr',languages:['de-DE']}).window.t('tagline'),load().translations.en.tagline);
});
test('blocked browser storage does not stop the page',()=>{
  assert.equal(load({storageThrows:true,languages:['en-US']}).window.t('tagline'),load().translations.en.tagline);
});
test('item names follow the page language',async()=>{
  const en=load({saved:'en'}),zh=load({saved:'zh'});
  const name=Object.keys(zh.translations.zh).find(k=>/^[A-Z][a-z]+( [A-Z][a-z']+)+$/.test(k)&&!(k in zh.translations.en));
  assert.ok(name,'a translated item name to try');
  const {itemName}=await import('./stats.js');
  globalThis.window=en.window;
  assert.equal(itemName(name),name);
  globalThis.window=zh.window;
  assert.equal(itemName(name),zh.translations.zh[name]);
  delete globalThis.window;
});
test('saved builds and exports carry the game\'s English stat names, whatever language the page shows',async()=>{
  const zh=load({saved:'zh'});
  const stem=Object.keys(zh.translations.zh).find(k=>k.startsWith('stat_')&&zh.translations.zh[k]!==k).slice(5);
  const {statName,statNameEnglish}=await import('./stats.js');
  globalThis.window=zh.window;
  assert.equal(statName(stem),zh.translations.zh['stat_'+stem]);
  const english=statNameEnglish(stem);
  assert.ok(english&&!/[一-鿿]/.test(english),'English name for '+stem);
  globalThis.window=load({saved:'en'}).window;
  assert.equal(statName(stem),english);
  delete globalThis.window;
});
test('every material a recipe can show has a Chinese name',async()=>{
  const {zh}=load({saved:'zh'}).translations;
  const {MATERIAL_ICONS,RECIPES}=await import('./stats.js');
  const used=new Set(Object.values(RECIPES).flatMap(r=>Object.keys(r)));
  for(const name of new Set([...used,...Object.keys(MATERIAL_ICONS)]))assert.ok(zh[name],'Chinese name for '+name);
});
test('page code has no English message that the table already translates',async()=>{
  const {translations:{en}}=load();
  const files=['app','builds','create-build','search-builds','search-settings','ui','recipe','stats'];
  const code=(await Promise.all(files.map(f=>readFile(new URL(`./${f}.js`,import.meta.url),'utf8')))).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:'"\w])\/\/[^\n]*/g,'$1')
    .replace(/const _fb=[^\n]*/,''); // the English fallback used only when the translation function is missing
  const found=[];
  for(const [key,text] of Object.entries(en)){
    for(const chunk of text.split(/\{\w+\}/).map(c=>c.trim()).filter(c=>c.length>=14&&c.includes(' ')))
      if(code.includes(chunk)){found.push(key+': '+chunk);break;}
  }
  assert.deepEqual(found,[],'use _t / window.t for these');
});
test('every stat the engine can offer on an item has a Chinese name',async()=>{
  const {zh}=load({saved:'zh'}).translations;
  const {HIDDEN}=await import('./stats.js');
  initSync({module:await readFile(new URL('./pkg/d3cube_bg.wasm',import.meta.url))});
  const engine=new Engine(await readFile(new URL('./data.json',import.meta.url),'utf8'));
  const stems=new Set();
  for(const it of JSON.parse(engine.describe()).items)for(const c of it.classes||[]){
    const r=JSON.parse(engine.stems(c,it.slot,it.id));
    for(const x of Array.isArray(r)?r:Object.keys(r))stems.add(typeof x==='string'?x:(x.stem||x[0]));
  }
  const alias=s=>{const m=/^Weapon ?Hit ?([A-Za-z]+?)[12]h$/.exec(s);return m?'Hit'+m[1]:s;};
  const missing=[...stems].filter(s=>!HIDDEN.test(s)&&!(('stat_'+s) in zh)&&!(('stat_'+alias(s)) in zh));
  assert.deepEqual(missing,[],'stats with no Chinese name');
});
test('every item the engine knows has a Chinese name',async()=>{
  const {zh}=load({saved:'zh'}).translations;
  initSync({module:await readFile(new URL('./pkg/d3cube_bg.wasm',import.meta.url))});
  const engine=new Engine(await readFile(new URL('./data.json',import.meta.url),'utf8'));
  const missing=[...new Set(JSON.parse(engine.describe()).items.map(i=>i.name))].filter(n=>!(n in zh));
  assert.deepEqual(missing,[],'items with no Chinese name');
});
test('English skill names read as the game spells them, and builds exported with the old names still import',async()=>{
  const {statNameEnglish,legacyStatNames}=await import('./stats.js');
  const want={Skill_Barbarian_HotA:'Hammer of the Ancients damage',Skill_Wizard_RayofFrost:'Ray of Frost damage',Skill_Monk_WaveofLight:'Wave of Light damage',
    Skill_WitchDoctor_WallofZombies:'Wall of Zombies damage',Skill_Wizard_WaveOfForce:'Wave of Force damage',Skill_Barbarian_CallOfTheAncients:'Call of the Ancients damage',
    Skill_Crusader_FistOfTheHeavens:'Fist of the Heavens damage',Skill_Monk_Wayof100Fists:'Way of the Hundred Fists damage',Skill_Crusader_HeavensFury3:"Heaven's Fury damage",
    Skill_Monk_SevenSidedStrike:'Seven-Sided Strike damage',Skill_WitchDoctor_FireBomb:'Firebomb damage',Skill_Wizard_SpectralBlade:'Spectral Blade damage'};
  for(const [stem,name] of Object.entries(want))assert.equal(statNameEnglish(stem),name,stem);
  assert.deepEqual(legacyStatNames('Skill_Barbarian_HotA'),['Hot A damage']);
  assert.deepEqual(legacyStatNames('Dex'),[]);
});
