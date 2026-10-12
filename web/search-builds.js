import {baseQuery,pickHits} from './search-settings.js?v=c3f9a6b7d8';
import {readSettings,clonePanel,hitHtml,esc,searchStarted,searchEnded} from './ui.js?v=c3f9a6b7d8';
import {statName,CLASS_NAMES,itemName} from './stats.js?v=c3f9a6b7d8';
import {supportsSanctify,defaultSanctifyCap} from './recipe.js?v=c3f9a6b7d8';
const $=id=>document.getElementById('search-builds-'+id);
let info,build,rows=[],active=null,job=0;
const V=new URL(import.meta.url).searchParams.get('v');
const worker=new Worker('./worker.js'+(V?'?v='+V:''),{type:'module'});
const tiers=['primal'];
const select = document.getElementById('search-builds-saved');
const status = document.getElementById('search-builds-status');
const key = 'd3recipes-user-builds-v1';
// The cost and limit boxes are custom search's own, copied, so both pages offer the same ones.
const panel=clonePanel('search-builds-');panel.id='search-builds-costs';panel.querySelector('label[for="search-builds-secs"]').textContent='Time limit per item (s)';document.getElementById('search-builds-costs-slot').replaceWith(panel);
let capEdited=false;
function updateSanctify(){
  const season=Math.max(1,Math.round(+document.getElementById('season').value||40));
  if(!capEdited)$('sn').value=defaultSanctifyCap(season);
  $('sanctifyWarning').hidden=supportsSanctify(season)||($('sn').value.trim()!==''&&+$('sn').value<=0);
}
$('sn').addEventListener('input',()=>{capEdited=true;updateSanctify();});
document.getElementById('season').addEventListener('input',updateSanctify);updateSanctify();

function refresh() {
  const selected = select.value;
  try {
    const builds = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(builds)) throw new Error('Invalid saved build data');
    select.replaceChildren(new Option('Choose a saved build', ''));
    for (const build of builds) select.add(new Option(build.name, build.id));
    const current = builds.find(record => record.id === selected);
    if (current) select.value = selected;
    const changed = JSON.stringify(build) !== JSON.stringify(current);
    if (changed) renderBuild();
    if (!builds.length) status.textContent = 'No saved builds yet. Create a build to get started.';
    else if (changed) status.textContent = current ? 'Saved build changed. Search again with its updated items and stats.' : 'Selected build is no longer saved. Choose another build.';
    else if (!active) status.textContent = '';
  } catch (error) {
    cancel();build=undefined;rows=[];$('rows').replaceChildren();$('run').disabled=true;
    
    select.replaceChildren(new Option('Choose a saved build', ''));
    status.textContent = 'Could not load saved builds: ' + error.message;
  }
}

document.getElementById('search-builds-create').addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('d3-navigate', {detail:'create-build'}));
});
window.addEventListener('d3-route', event => {
  if (event.detail === 'search-builds') refresh();
});
window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) refresh();
});
refresh();

function cancel(){searchEnded();worker.postMessage({type:'cancel'});job++;active=null;$('cancel').hidden=true;$('run').disabled=!info||!build;}
const heroName=c=>CLASS_NAMES[info.classes[c]]||info.classes[c];
// One card per slot, like the prepared lists: the item and the stats wanted, then the recipe cards custom search shows.
function rowHtml(row){
 const items=row.any_item?'Any item':[(row.externalName||info?.items.find(it=>it.id===row.item)?.name||'Unknown item'),...(row.alternatives||[])].map(itemName).join(' or ');
 const stats=targetStats(row).map((w,i)=>esc(w.label||statName(w.stem))).join(', ');
 const name=itemName(row.externalName||info?.items.find(it=>it.id===row.item)?.name||row.slot);
 return `<section class="card slot"><h3>${esc(row.slot)}</h3>
  <div class="bhead"><span class="nm">${esc(items)}</span><span class="small">${stats}</span></div>
  <label class="small"><input type="checkbox" data-row="${row.index}" style="width:auto" aria-label="${esc('Already have '+name)}"> Already have it</label>
  <div id="build-match-${row.index}" class="small">Not searched</div>
</section>`;
}
function renderBuild(){
 cancel();
 try{build=JSON.parse(localStorage.getItem(key)||'[]').find(b=>b.id===select.value);rows=(build?.slots||[]).map((r,i)=>({...r,index:i,owned:false,results:{}}));
 $('rows').innerHTML=rows.map(rowHtml).join('');
 $('rows').querySelectorAll('input').forEach(el=>el.addEventListener('change',()=>setOwned(rows[+el.dataset.row],el.checked)));$('run').disabled=!info||!build;
 }catch(e){status.textContent=e.message;}
}
function setOwned(row,owned){
 row.owned=owned;row.best=null;row.results={};
 document.getElementById('build-match-'+row.index).textContent=owned?'Excluded from search':'Not searched';
 if(active){
   active.queue=active.queue.filter(queued=>queued!==row);
   if(owned&&active.row===row){worker.postMessage({type:'cancel'});job++;nextRow();}
   else if(!owned&&active.row!==row)active.queue.push(row);
 }
 
}
select.addEventListener('change',renderBuild);
$('cancel').addEventListener('click',()=>{cancel();status.textContent='Search cancelled.';});
$('run').addEventListener('click',()=>{
 cancel();for(const row of rows)row.best=null;
 const number=id=>Math.max(0,Math.round(+$(id).value||0)),season=Math.max(1,+document.getElementById('season').value||40);
 active={queue:rows.filter(r=>!r.owned),settings:{...readSettings(season,'search-builds-'),c:build.class},secs:Math.max(1,number('secs')),season,hc:document.getElementById('hc').value==='1'};
 $('run').disabled=true;$('cancel').hidden=false;searchStarted();nextRow();
});
// every stat the build lists is searched for, however many and however the build was made
function targetStats(row){return row.wants;}
function bestCandidate(candidates){return candidates.filter(candidate=>candidate.tier==='primal').sort((a,b)=>b.hit.matched.length-a.hit.matched.length||a.hit.cost-b.hit.cost)[0];}
function searchItems(row,items){
 const normalize=name=>String(name).replace(/\s*\([^)]*\)\s*$/,'').replace(/^the\s+/i,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const alternatives=new Set((row.alternatives||[]).map(normalize));
 return items.filter(item=>item.id===row.item||alternatives.has(normalize(item.name)));
}
function nextRow(){
 let row=active.queue.shift();while(row?.owned)row=active.queue.shift();
 if(!row){cancel();status.textContent='Build search complete. Costs use the selected weights.';return;}
 active.row=row;active.tier=0;active.deadline=performance.now()+active.secs*1000;row.results={};row.best=null;row.limited=false;row.limitedBy=null;
 const items=searchItems(row,info.items),item=items[0];
 if(!item){document.getElementById('build-match-'+row.index).textContent=row.any_item?'Choose a specific item in the editor before searching.':'Item unavailable.';nextRow();return;}
 row.itemData=item;active.query=baseQuery({...active.settings,w:row.wants.map(w=>[w.stem,w.min==null?'':String(w.min)])},item,active.season,active.hc);active.query.items=items.map(item=>item.id);active.query.slots=[...new Set(items.map(item=>item.slot))];startTier();
}
function startTier(){const tier=tiers[active.tier];status.textContent='Searching '+active.row.itemData.name+' ('+tier+')...';worker.postMessage({type:'search',id:++job,query:{...active.query,quality:tier,end_on_primalize:tier==='crafted'},budgetMs:Math.max(1500,Math.max(1000,active.deadline-performance.now())/(tiers.length-active.tier))});}
// which limit ended the row's search, so the user knows what to change
function limitNote(row){return row.limitedBy==='size'?'The search reached its size limit, so a cheaper recipe may exist.':'The search stopped at the time limit; a longer limit may find a better recipe.';}
function showMatches(row){
 const snap=targetStats(row).map(w=>w.stem);let chosen=[];
 for(const tier of tiers){if(!row.results[tier])continue;for(const hit of pickHits(tier,row.results[tier],snap,active.settings.n)){chosen.push({tier,hit});}}
 const best=bestCandidate(chosen);row.best=best;if(best)row.itemData=info.items.find(item=>item.name===best.hit.name)||row.itemData;
 const cell=document.getElementById('build-match-'+row.index);
 if(chosen.length){
   const named=row.alternatives?.length;
   cell.innerHTML=chosen.map(({tier,hit})=>(named?`<div class="nm">${esc(itemName(hit.name))}</div>`:'')+hitHtml(hit,tier,snap,row.itemData,build.class,active.season,heroName)).join('')+(row.limited?'<div class="small">'+limitNote(row)+'</div>':'');
 }else cell.textContent='No matching recipe found.'+(row.limited?' '+limitNote(row):'');
}
worker.onmessage=({data:m})=>{
 if(m.type==='ready'){info=m.info;if(select.value)renderBuild();$('run').disabled=!build;}
 else if(active&&m.id===job&&(m.type==='progress'||m.type==='done')){const row=active.row;row.results[tiers[active.tier]]=m.results;if(m.results.status.capped){row.limited=true;row.limitedBy='size';}else if(m.type==='done'&&!m.results.status.done&&!row.limited){row.limited=true;row.limitedBy='time';}showMatches(row);if(m.type==='done'){active.tier++;if(active.tier<tiers.length)startTier();else nextRow();}}
 else if(m.type==='error'){if(m.key!==undefined)return;if(m.id!==undefined&&(!active||m.id!==job))return;if(m.id===undefined){engineFailed(m.message);return;}if(active){document.getElementById('build-match-'+active.row.index).textContent='Search failed: '+m.message;nextRow();}else status.textContent='Search engine: '+m.message;}
};
window.addEventListener('d3-route',event=>{if(event.detail!=='search-builds'&&active)cancel();});
for(const el of document.querySelectorAll('#search-builds-costs input, #season, #hc'))el.addEventListener('change',()=>{if(active)cancel();for(const row of rows){row.best=null;document.getElementById('build-match-'+row.index).textContent=row.owned?'Excluded from search':'Settings changed — search again';}});
function engineFailed(message){
  if(active){document.getElementById('build-match-'+active.row.index).textContent='Search failed: '+message;cancel();}
  info=null;$('run').disabled=true;status.textContent='Search engine unavailable: '+message+'. Reload the page to retry.';
}
worker.addEventListener('error',event=>{event.preventDefault();engineFailed(event.message||'Worker crashed');});
worker.addEventListener('messageerror',()=>engineFailed('Could not read the worker response'));