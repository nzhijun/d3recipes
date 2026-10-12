import { KEY, readBuilds as saved, updateBuilds, importPlan, conflictSnapshot, applyImport } from './build-storage.js?v=440ee39fb2';
import { combo, esc } from './ui.js?v=440ee39fb2';
import { parseBuildToml } from './build-toml.js?v=440ee39fb2';
// randomUUID exists only on HTTPS and localhost pages; a self-hosted plain-HTTP page needs the fallback
const uid=()=>globalThis.crypto?.randomUUID?.()??'b-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
import { CLASS_NAMES, STATS, statName, statNameEnglish, legacyStatNames, HIDDEN, SLOT_NAMES, itemName } from './stats.js?v=440ee39fb2';
const $=id=>document.getElementById('build-'+id);
const _t=(key,params)=>typeof window!=='undefined'&&typeof window.t==='function'?window.t(key,params):key;
const slots=['Head','Shoulders','Chest','Hands','Wrists','Waist','Legs','Feet','Amulet','Ring 1','Ring 2','Main-hand','Off-hand','Dual-Wield'];
const pools={Head:['Helm','SpiritStone_Monk','VoodooMask','WizardHat'],Shoulders:['Shoulders'],Chest:['Chest','Cloak'],Hands:['Gloves'],Wrists:['Bracers'],Waist:['Belt','MightyBelt'],Legs:['Legs'],Feet:['Boots'],Amulet:['Amulet'],'Ring 1':['Ring'],'Ring 2':['Ring']};
let workerFailure=null;
let info,draft={id:null,name:'',class:0,slots:[]},generation=0;
const pending=new Map();
const pickers=new Map();
function disposePicker(i){pickers.get(i)?.dispose();pickers.delete(i);}
const V=new URL(import.meta.url).searchParams.get('v');
const worker=new Worker('./worker.js'+(V?'?v='+V:''),{type:'module'});
const notice=text=>{ $('status').textContent=text; if($('importStatus')) $('importStatus').textContent=text; };
function listSaved(){try{$('saved').replaceChildren(new Option(_t('chooseSavedBuild'),''),...saved().map(b=>new Option(b.name,b.id)));}catch(e){notice(e.message);}}
function candidates(slot){return info.items.filter(it=>it.classes.includes(draft.class)&&(pools[slot]?pools[slot].includes(it.slot):slot==='Main-hand'?/Sword|Axe|Mace|Dagger|Spear|Bow|Crossbow|HandXbow|Wand|Fist|Daibo|Flail|Scythe|Staff|Polearm|MightyWeapon/.test(it.slot):/Shield|Orb|Mojo|Quiver|Phylactery|Sword$|Axe$|Mace$|Dagger$|Spear$|Wand$|FistWeapon|HandXbow|Scythe1H|Flail1H|MightyWeapon1H/.test(it.slot))).sort((a,b)=>a.name.localeCompare(b.name));}
function definition(build=draft){const names={Head:'Helm',Hands:'Gloves',Wrists:'Bracers',Waist:'Belt',Legs:'Pants',Feet:'Boots','Main-hand':'Main-Hand','Off-hand':'Off-Hand'};return {name:build.name.trim(),class:info.classes[build.class],slot:build.slots.map(r=>({name:names[r.slot]||r.slot,...(r.any_item?{any_item:true,sets:r.sets??true}:{items:[r.externalName||info.items.find(it=>it.id===r.item).name,...(r.alternatives||[])]}),stat_priority:r.wants.map(w=>w.exportName||statNameEnglish(w.stem)),...(r.notes?{notes:r.notes}:{})}))};}
function toml(build=draft){const b=definition(build),q=JSON.stringify;return '[[build]]\nname = '+q(b.name)+'\nclass = '+q(b.class)+'\n'+b.slot.map(r=>'\n[[build.slot]]\nname = '+q(r.name)+'\n'+(r.any_item?'any_item = true\nsets = '+r.sets+'\n':'items = ['+r.items.map(q).join(', ')+']\n')+'stat_priority = ['+r.stat_priority.map(q).join(', ')+']\n'+(r.notes?'notes = ['+r.notes.map(q).join(', ')+']\n':'')).join('');}
let itemCombos=[];
function itemChip(i){
  const row=draft.slots.find(r=>r.slot===slots[i]),chip=$('chip-'+i),input=$('item-'+i);
  const name=row?(info.items.find(it=>it.id===row.item)?.name||row.externalName||_t('anyItemPlaceholder')):'';const displayName=itemName(name);
  chip.innerHTML=row?`<div class="chip"><span>${esc(displayName)}</span><button type="button" title="${esc(_t('chooseDifferentItem'))}" aria-label="${esc(_t('chooseDifferentItemFor',{s:itemName(slots[i])}))}">&times;</button></div>`:'';
  input.hidden=!!row;if(row)$('pick-'+i).hidden=true;
  chip.querySelector('button')?.addEventListener('click',()=>{draft.slots=draft.slots.filter(r=>r.slot!==slots[i]);itemChip(i);loadAffixes(i);input.focus();});
}
function render(){for(const i of pickers.keys())disposePicker(i);for(const c of itemCombos)c.dispose();itemCombos=[];generation++;$('clone').hidden=!draft.id;$('name').value=draft.name;$('class').value=String(draft.class);$('exportPreview').hidden=true;$('slots').replaceChildren(...slots.map((slot,i)=>{
  const section=document.createElement('section');section.className='card';
  section.innerHTML=`<h3>${esc(itemName(slot))}</h3><label for="build-item-${i}">Item</label><div id="build-chip-${i}" class="chips"></div>`+
    `<input id="build-item-${i}" type="text" placeholder="${esc(_t('searchItemsPh'))}" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="build-pick-${i}">`+
    `<div id="build-pick-${i}" class="pick" role="listbox" hidden></div><div id="build-affixes-${i}"></div>`;
  return section;
}));
  slots.forEach((slot,i)=>{
    const source=()=>{const q=$('item-'+i).value.trim().toLowerCase();return candidates(slot).filter(it=>{if(!q)return true;const en=it.name.toLowerCase();const zh=itemName(it.name).toLowerCase();return en.includes(q)||zh.includes(q);}).slice(0,60).map(it=>({value:it,html:esc(itemName(it.name))+' <span class="hint">'+esc(SLOT_NAMES[it.slot]||it.slot)+'</span>'}));};
    itemCombos.push(combo($('item-'+i),$('pick-'+i),source,_t('noMatchingItem'),it=>{draft.slots=draft.slots.filter(r=>r.slot!==slot);draft.slots.push({slot,item:it.id,wants:[]});itemChip(i);loadAffixes(i);}));
    itemChip(i);
  });
  slots.forEach((_,i)=>loadAffixes(i));}
function loadAffixes(i){disposePicker(i);const row=draft.slots.find(r=>r.slot===slots[i]),box=$('affixes-'+i);box.replaceChildren();if(!row)return;const item=info.items.find(it=>it.id===row.item);if(!item){affixPicker({i,item:row.item},[]);return;}if(workerFailure){box.textContent=workerFailure;return;}const key=uid();pending.set(key,{i,generation,item:row.item});box.textContent=_t('loadingAffixes');worker.postMessage({type:'stems',key,class:draft.class,slot:item.slot,item:row.item});}
function affixPicker(request,stems){const row=draft.slots.find(r=>r.slot===slots[request.i]);if(!row||row.item!==request.item)return;row.wants=row.wants.filter(w=>w.imported||stems.includes(w.stem));const box=$('affixes-'+request.i),inputId='build-statFind-'+request.i,pickId='build-statPick-'+request.i;
const label=document.createElement('label');label.htmlFor=inputId;label.textContent=_t('statsYouWant');
const chipList=document.createElement('div');chipList.className='chips';
const statInput=document.createElement('input');statInput.id=inputId;statInput.type='text';statInput.placeholder='Search stats: crit, cooldown, dexterity...';statInput.autocomplete='off';statInput.setAttribute('role','combobox');statInput.setAttribute('aria-expanded','false');statInput.setAttribute('aria-controls',pickId);
const suggestions=document.createElement('div');suggestions.id=pickId;suggestions.className='pick';suggestions.setAttribute('role','listbox');suggestions.hidden=true;
const help=document.createElement('p');help.className='small';help.textContent=_t('affixHelp');
disposePicker(request.i);box.replaceChildren(label,chipList,statInput,suggestions,help);
const chips=()=>{const list=box.querySelector('.chips');list.replaceChildren(...row.wants.map((want,i)=>{
  const chip=document.createElement('div');chip.className='chip';
  const label=document.createElement('span');label.textContent=(i+1)+'. '+(want.label||statName(want.stem))+(stems.includes(want.stem)?'':_t('unavailableOnItem'));
  const up=document.createElement('button');up.type='button';up.dataset.up=String(i);up.title=_t('moveUpPriority');up.setAttribute('aria-label',_t('moveStatUp',{s:statName(want.stem)}));up.disabled=i===0;up.textContent='↑';
  const remove=document.createElement('button');remove.type='button';remove.dataset.remove=String(i);remove.title='Remove';remove.setAttribute('aria-label','Remove '+statName(want.stem));remove.textContent='×';
  chip.append(label,up,remove);return chip;
}));list.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',()=>{const i=+b.dataset.up;[row.wants[i-1],row.wants[i]]=[row.wants[i],row.wants[i-1]];chips();}));list.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{row.wants.splice(+b.dataset.remove,1);chips();}));};chips();const input=box.querySelector('input');pickers.set(request.i,combo(input,box.querySelector('.pick'),()=>{const text=input.value.trim().toLowerCase();return stems.filter(stem=>!row.wants.some(w=>w.stem===stem)&&(statName(stem).toLowerCase().includes(text)||stem.toLowerCase().includes(text))).slice(0,40).map(stem=>({value:stem,html:esc(statName(stem))}));},_t('noMatchingStats'),stem=>{row.wants.push({stem,min:null});chips();}));}
function renderClassOptions(){if(!info)return;const prev=$('class').value;$('class').replaceChildren(...info.classes.map((c,i)=>{const tl=_t(c);const nm=tl!==c?tl:(CLASS_NAMES[c]||c);return new Option(nm,String(i));}).sort((x,y)=>x.text.localeCompare(y.text)));if(prev&&[...$('class').options].some(o=>o.value===prev))$('class').value=prev;}
window.addEventListener('d3-lang-change',()=>{if(!info)return;const selected=$('saved').value;renderClassOptions();listSaved();$('saved').value=selected;render();});
worker.onmessage=({data:m})=>{if(m.type==='ready'){info=m.info;renderClassOptions();$('editor').hidden=false;$('loading').hidden=true;render();listSaved();}else if(m.type==='stems'){const r=pending.get(m.key);pending.delete(m.key);if(r?.resolve){r.resolve(m.stems);return;}if(r&&r.generation===generation)affixPicker(r,Object.keys(m.stems).filter(s=>!HIDDEN.test(s)).sort((a,b)=>statName(a).localeCompare(statName(b))));}else if(m.type==='error')failRequests(m.message,m.key);};
$('name').addEventListener('input',()=>draft.name=$('name').value);
$('class').addEventListener('change',()=>{draft.class=+$('class').value;draft.slots=draft.slots.filter(r=>!r.item||candidates(r.slot).some(it=>it.id===r.item));render();notice(_t('classChanged'));});
$('save').addEventListener('click',async()=>{if(!draft.name.trim())return notice(_t('enterBuildName'));if(!draft.slots.length)return notice(_t('selectAtLeastOneItem'));if(pending.size)return notice(_t('waitAffixesSave'));try{draft.name=draft.name.trim();draft.id ||=uid();const record=structuredClone({...draft,version:1,definition:definition(),updatedAt:new Date().toISOString()});await updateBuilds(list=>{const i=list.findIndex(b=>b.id===record.id);if(i<0)list.push(record);else list.splice(i,1,record);});listSaved();$('saved').value=draft.id;$('clone').hidden=false;notice(_t('buildSaved'));}catch(e){notice(_t('couldNotSaveBuild',{e:e.message}));}});
$('saved').addEventListener('change',()=>{try{const b=saved().find(b=>b.id===$('saved').value);if(b){draft=structuredClone(b);render();notice(_t('savedBuildLoaded'));}}catch(e){notice(e.message);}});
$('new').addEventListener('click',()=>{draft={id:null,name:'',class:draft.class,slots:[]};render();$('saved').value='';notice(_t('newBuildNotice'));});
$('delete').addEventListener('click',async()=>{if(!draft.id)return;try{const id=draft.id;await updateBuilds(list=>{const i=list.findIndex(b=>b.id===id);if(i>=0)list.splice(i,1);});draft.id=null;$('clone').hidden=true;listSaved();notice(_t('savedBuildDeleted'));}catch(e){notice(e.message);}});
$('export').addEventListener('click',()=>{$('toml').value=toml();$('exportPreview').hidden=false;const url=URL.createObjectURL(new Blob([toml()],{type:'text/plain'})),a=document.createElement('a');a.href=url;a.download=(draft.name||'build').replace(/[^a-z0-9_-]/gi,'_')+'.toml';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});

const normalize=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
$('import').addEventListener('click',()=>{$('importFile').value='';$('importFile').click();});
$('importFile').addEventListener('change',async()=>{
  const file=$('importFile').files[0];if(!file)return;
  $('import').disabled=true;
  try{
    if(file.size>2000000)throw Error(_t('chooseTomlSmall'));
    const builds=parseBuildToml(await file.text()), incoming=[], failures=[], reports=[];
    let count=0;
    for(const source of builds){
      notice(_t('importingProgress',{n:source.name,i:count+failures.length+1,t:builds.length}));
      try{
        const {build,skipped}=await prepareImported(source);
        if(incoming.some(b=>normalize(b.name)===normalize(build.name)))throw Error(_t('duplicateBuildName'));
        incoming.push({...build,id:uid(),version:1,sourceFile:file.name,definition:definition(build),updatedAt:new Date().toISOString()});
        count++;if(skipped.length)reports.push(_t('importSkipped',{n:source.name,s:skipped.join(', ')}));
      }catch(e){failures.push(source.name+': '+e.message);}
    }
    let result;
    while(true){
      const plan=importPlan(saved(),incoming), conflicts=plan.filter(p=>p.conflict);
      const choice=conflicts.length?await chooseImportConflicts(conflicts):'keep';
      if(choice==='cancel'){notice(_t('importCancelled'));return;}
      result=await updateBuilds(list=>applyImport(list,incoming,choice,conflictSnapshot(plan)));
      if(!result.retry)break;
      notice(_t('savedBuildsChangedConflict'));
    }
    listSaved();
    notice(_t('importComplete',{a:result.added,r:result.replaced,k:result.skipped})+(failures.length?_t('importFailedList',{f:failures.join('; ')}):'')+(reports.length?' '+reports.join('; ')+'.':''));
  }catch(e){notice(_t('importFailed',{e:e.message}));}finally{$('import').disabled=false;}
});
async function prepareImported(source){
    const build=source;
    const slotNames={Cloak:'Chest',Helm:'Head',Gloves:'Hands',Bracers:'Wrists',Belt:'Waist',Pants:'Legs',Boots:'Feet','Main-Hand':'Main-hand','Off-Hand':'Off-hand'};
    const skipped=[];const importedSlots=build.slot.flatMap(r=>{if(r.name==='Potion'){skipped.push(_t('potionSlot'));return [];}if(r.any_item)return [r];const items=(r.items||[]).filter(name=>{if(/\((Cubed|Crafted|[^)]*Bounties[^)]*)\)/i.test(name)){skipped.push(name);return false;}return true;});return items.length?[{...r,items}]:[];});
    const rows=importedSlots.map(r=>{const slot=slotNames[r.name]||r.name;if(!slots.includes(slot))throw Error(_t('unsupportedSlot',{s:r.name}));
      const item=info.items.find(it=>normalize(it.name)===normalize((r.items?.[0]||'').replace(/\s*\([^)]*\)\s*$/,''))||normalize(it.name)==='ringofthezodiac'&&normalize(r.items?.[0]||'')==='obsidianringofthezodiac');if(!item&&!r.any_item&&!/\((Crafted|[^)]*Bounties[^)]*)\)/i.test(r.items?.[0]||''))throw Error(_t('unknownItem',{s:r.items?.[0]}));return{slot,item:item?.id||null,externalName:item?.name||r.items?.[0],any_item:r.any_item,sets:r.sets,notes:r.notes,source:r,wants:[],alternatives:(r.items||[]).slice(1).map(name=>{const alt=info.items.find(it=>normalize(it.name)===normalize(name)||normalize(it.name)==='ringofthezodiac'&&normalize(name)==='obsidianringofthezodiac');return alt?.name||name;})};});
    if(new Set(rows.map(r=>r.slot)).size!==rows.length)throw Error(_t('slotRepeated'));
    let hero=build.class?info.classes.findIndex(c=>normalize(c)===normalize(build.class)):info.classes.findIndex((_,c)=>rows.filter(r=>r.item).every(r=>info.items.find(it=>it.id===r.item).classes.includes(c)));
    if(hero<0)throw Error(_t('noMatchingClass'));
    for(const row of rows){
      const item=info.items.find(it=>it.id===row.item);
      if(item&&!item.classes.includes(hero))throw Error(_t('itemUnavailableToClass',{i:item.name,c:info.classes[hero]}));
      const key=uid();const stems=item?await new Promise((resolve,reject)=>{if(workerFailure){reject(Error(workerFailure));return;}pending.set(key,{resolve,reject});try{worker.postMessage({type:'stems',key,class:hero,slot:item.slot,item:item.id});}catch(e){failRequests(e.message,key);}}):{};
      for(const name of row.source.stat_priority||[]){const alias=/^sockets?\b/i.test(name)?'Sockets':({armor:'DR',life:'Life',elitedamage:'DamageVsElite',elitedamagereduction:'DamReductionVsElite'})[normalize(name.replace(/\s*\(Secondary\)/i,''))];const cleanName=name.replace(/\s*\(Secondary\)/i,'').replace(/Death Nova/i,'Blood Nova').replace(/^Cooldown$/i,'Cooldown Reduction');const stem=Object.keys(stems).find(s=>(alias?s===alias:(normalize(statNameEnglish(s))===normalize(cleanName)||normalize(statName(s))===normalize(cleanName)||legacyStatNames(s).some(n=>normalize(n)===normalize(cleanName)))||normalize(s)===normalize(cleanName)));const canonicalStem=stem||alias||Object.keys(STATS).find(s=>(normalize(statNameEnglish(s))===normalize(cleanName)||normalize(statName(s))===normalize(cleanName)||legacyStatNames(s).some(n=>normalize(n)===normalize(cleanName)))||normalize(s)===normalize(cleanName));const keyStem=canonicalStem||cleanName;if(!row.wants.some(w=>w.stem===keyStem))row.wants.push({stem:keyStem,min:null,imported:true,exportName:canonicalStem?statNameEnglish(canonicalStem):cleanName,label:canonicalStem?null:cleanName});}
      delete row.source;
    }
    return {build:{name:build.name,class:hero,slots:rows},skipped};
}

$('clone').addEventListener('click',async()=>{
  if(!draft.id)return;
  if(pending.size)return notice(_t('waitAffixesClone'));
  try{
    const copy=structuredClone(draft);copy.id=uid();copy.name=copy.name.trim()+' - Copy';
    delete copy.sourceFile;
    copy.version=1;copy.updatedAt=new Date().toISOString();copy.definition=definition(copy);
    await updateBuilds(list=>list.push(copy));
    draft=copy;listSaved();render();$('saved').value=copy.id;
    notice(_t('buildCloned',{n:copy.name}));
  }catch(e){notice(_t('couldNotCloneBuild',{e:e.message}));}
});

$('exportAll').addEventListener('click',()=>{
  try{
    const builds=saved();if(!builds.length)return notice(_t('noSavedBuildsExport'));
    const text=builds.map(build=>toml(build)).join('\n');
    $('toml').value=text;$('exportPreview').hidden=false;
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain'})),a=document.createElement('a');
    a.href=url;a.download='saved-builds.toml';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notice(_t('exportedBuilds',{n:builds.length}));
  }catch(e){notice(_t('couldNotExportBuilds',{e:e.message}));}
});

function chooseImportConflicts(conflicts){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='build-conflicts';dialog.setAttribute('aria-label',_t('importConflicts'));
    const title=document.createElement('h2');title.textContent=_t('savedBuildConflicts');dialog.append(title);
    const explanation=document.createElement('p');explanation.textContent=_t('conflictExplanation');dialog.append(explanation);
    const list=document.createElement('ul');for(const {build} of conflicts){const li=document.createElement('li');li.textContent=build.name;list.append(li);}dialog.append(list);
    const finish=choice=>{dialog.close();dialog.remove();resolve(choice);};
    for(const [choice,label] of [['keep',_t('keepSaved')],['overwrite',_t('overwriteConflicts')],['copies',_t('importAsCopies')],['cancel',_t('cancelImport')]]){
      const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=label;button.addEventListener('click',()=>finish(choice));dialog.append(button);
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish('cancel');});document.body.append(dialog);dialog.showModal();dialog.querySelector('button').focus();
  });
}
window.addEventListener('storage',event=>{if(event.key===KEY){const selected=$('saved').value;listSaved();$('saved').value=selected;}});

function failRequests(message,key){
  const _fb={searchEngineUnavailable:(p)=>`Search engine unavailable: ${p.e}. Reload the page to retry.`,couldNotLoadAffixes:(p)=>`Could not load affixes: ${p.e}`,couldNotLoadItemTables:(p)=>`Could not load item tables: ${p.e}`,workerCrashed:()=>`Worker crashed`,couldNotReadWorker:()=>`Could not read the worker response`};
  const _t=(k,p)=>typeof window!=='undefined'&&typeof window.t==='function'?window.t(k,p):(_fb[k]?_fb[k](p||{}):k);
  const error=Error(message);
  if(key===undefined)workerFailure=_t('searchEngineUnavailable',{e:message});
  for(const [id,request] of pending){
    if(key!==undefined&&id!==key)continue;
    pending.delete(id);
    if(request.reject)request.reject(error);
    else if(request.generation===generation){const box=$('affixes-'+request.i);if(box)box.textContent=_t('couldNotLoadAffixes',{e:message});}
  }
  notice(_t('couldNotLoadItemTables',{e:message}));
}
worker.addEventListener('error',event=>{event.preventDefault();failRequests(event.message||_t('workerCrashed'));});
worker.addEventListener('messageerror',()=>failRequests(_t('couldNotReadWorker')));