import {baseQuery,pickHits} from "./search-settings.js?v=a7c8b9d0e1";
// Copyright 2026 FNG. Use, modification and redistribution are permitted under the conditions in LICENSE:
// credit the source, and visibly link to the site or repository if you use its outputs in a user-facing application.
import { statName, statAbbr, isSecondary, RANGE_STEMS, WEAPON_SLOTS, fmtValue, isPct, HIDDEN, CLASS_NAMES, SLOT_NAMES, materials, itemName } from "./stats.js?v=a7c8b9d0e1";
import { slotPlural, matsHtml, stepsHtml, mysticCanFinish, tooltipRows, requestHash, parseRequestHash, savedList, savedHas, savedToggle, savedRemove, DEFAULT_CONVERTS, supportsSanctify, defaultSanctifyCap, DEFAULT_SANCTIFY_PRICE } from "./recipe.js?v=a7c8b9d0e1";

import { combo, hitHtml, readSettings, searchStarted, searchEnded } from "./ui.js?v=a7c8b9d0e1";

const $ = (id) => document.getElementById(id);
// Forward the cache-busting version index.html stamped onto our own src= down to the worker, which forwards it
// again to its own sub-fetches (pkg/d3cube.js, the wasm binary, data.json) — see worker.js and LEDGER V137.
const V = new URL(import.meta.url).searchParams.get("v");
const worker = new Worker(`./worker.js${V ? "?v=" + V : ""}`, { type: "module" });
let info = null;
let stemList = [];           // [{stem, name}]
let statMax = new Map();     // stem -> the highest value the picked item can roll (box units)
let wants = [];              // [{stem, min}]
let itemList = [];           // [{id, name, slot, classes, cross}]
let pickedItem = null;       // the one item the player is chasing
let searchId = 0;
const stemCache = new Map();
const pending = new Map();

// Small persisted preferences (season, mode, theme). Storage can be unavailable (private windows), so never rely on it.
const store = {
  get(k) { try { return localStorage.getItem("d3r-" + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem("d3r-" + k, v); } catch (e) { /* ignore */ } },
};

// "Before you start" prompt: shown until acknowledged. Version the key so materially changed wording can re-prompt.
const RULES_KEY = "rules-v1";
function initRules() {
  const dlg = $("rules");
  const ok = () => { acked = true; store.set(RULES_KEY, "1"); dlg.close("ok"); };
  $("rulesOk").addEventListener("click", ok);
  // Esc must not count as reading it. Some browsers close a modal <dialog> on Esc even when "cancel" is prevented,
  // so reopen if it closed without the button.
  let acked = !!store.get(RULES_KEY);
  dlg.addEventListener("cancel", (e) => e.preventDefault());
  dlg.addEventListener("close", () => { if (!acked && !dlg.returnValue) dlg.showModal(); });
  $("rulesBtn").addEventListener("click", () => { dlg.returnValue = ""; dlg.showModal(); });
  if (!store.get(RULES_KEY) && typeof dlg.showModal === "function") dlg.showModal();
}
initRules();

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === "ready") { info = m.info; start(); }
  else if (m.type === "stems") { const r = pending.get(m.key); if (r) { pending.delete(m.key); r({ stems: m.stems, max: m.max }); } }
  else if (m.type === "progress" || m.type === "done") { if (m.id === searchId) onResults(m.results, m.type === "done"); }
  else if (m.type === "error") { $("status").textContent = window.t('errorPrefix') + m.message; $("go").disabled = false; }
};

const className = (c) => { const t = typeof window !== "undefined" && window.t ? window.t(c) : c; return t !== c ? t : (CLASS_NAMES[c] || c); };
const slotName = (s) => { const t = typeof window !== "undefined" && window.t ? window.t(s) : s; return t !== s ? t : (SLOT_NAMES[s] || s); };

// ---------- theme, season / mode ----------

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function syncThemeButton() { $("theme").innerHTML = currentTheme() === "dark" ? "&#9788;" : "&#9790;"; }
function initTheme() {
  syncThemeButton();
  $("theme").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
    syncThemeButton();
  });
}

function syncContext() {
  const season = Math.max(1, Math.round(+$("season").value || 40));
  $("sanctifyAvailable").hidden = !supportsSanctify(season);
  $("ctxText").textContent = window.t('seasonCtx', { s: season, m: $("hc").value === "1" ? window.t('hardcore') : window.t('softcore') });
  store.set("season", String(season));
  store.set("hc", $("hc").value);
}
function initContext() {
  const s = store.get("season"), h = store.get("hc");
  if (s && +s > 0) $("season").value = s;
  if (h === "0" || h === "1") $("hc").value = h;
  syncContext();
  $("season").addEventListener("input", syncContext);
  $("hc").addEventListener("change", syncContext);
  $("ctxBtn").addEventListener("click", () => {
    const open = $("ctxEdit").hidden;
    $("ctxEdit").hidden = !open;
    $("ctxBtn").setAttribute("aria-expanded", String(open));
    $("ctxBtn").textContent = open ? window.t('actionDone') : window.t('ctxChange');
  });
}


// ---------- setup ----------

let sanctifyCapEdited = false;
function updateSanctifyControls() {
  const season = Math.max(1, Math.round(+$("season").value || 40));
  if (!sanctifyCapEdited) $("sn").value = defaultSanctifyCap(season);
  $("sanctifyWarning").hidden = supportsSanctify(season) || ($("sn").value.trim() !== "" && +$("sn").value <= 0);
}

function start() {
  initTheme();
  initContext();
  $("loading").hidden = true;
  $("app").hidden = false;
  $("cls").innerHTML = info.classes.map((c, i) => [i, className(c)]).sort((x, y) => x[1].localeCompare(y[1])).map(([i, n]) => `<option value="${i}">${esc(n)}</option>`).join("");
  $("cls").addEventListener("change", loadStems);
  itemList = info.items;
  combo($("itemFind"), $("itemPick"), itemSource, window.t('noMatchingItem'), pickItem);
  combo($("find"), $("pick"), statSource, window.t('noMatchingStatItem'), (stem) => { wants.push({ stem, min: "" }); renderChips(); });
  $("go").addEventListener("click", go);
  initActions();
  updateSanctifyControls(); $("season").addEventListener("input", updateSanctifyControls);
  $("sn").addEventListener("input", () => { sanctifyCapEdited = true; updateSanctifyControls(); });
  renderItemChips();
  loadStems().then(() => onRoute(routeOfHash()));
}

function itemSource() {
  const q = $("itemFind").value.trim().toLowerCase();
  if (!q) return [];
  return itemList.filter((it) => {
    const en = it.name.toLowerCase();
    const slot = slotName(it.slot).toLowerCase();
    const zh = itemName(it.name);
    return en.includes(q) || slot.includes(q) || (zh !== it.name && zh.toLowerCase().includes(q));
  }).slice(0, 60)
    .map((it) => {
      const zh = itemName(it.name);
      const showName = zh && zh !== it.name ? `${esc(zh)} <span class="hint">${esc(it.name)}</span>` : esc(it.name);
      return { value: it, html: `${showName} <span class="hint">${esc(slotName(it.slot))}</span>` };
    });
}

function statSource() {
  const q = $("find").value.trim().toLowerCase();
  const have = new Set(wants.map((w) => w.stem));
  return stemList.filter((s) => {
    if (have.has(s.stem)) return false;
    if (!q) return true;
    if (s.name.toLowerCase().includes(q)) return true;
    if (s.stem.toLowerCase().includes(q)) return true;
    const zhName = statName(s.stem);
    if (zhName !== s.name && zhName.toLowerCase().includes(q)) return true;
    return false;
  }).slice(0, 60)
    .map((s) => {
      const zh = statName(s.stem);
      const en = s.name;
      const show = zh !== en ? `${esc(zh)} <span class="hint">${esc(en)}</span>` : esc(zh);
      return { value: s.stem, html: show };
    });
}

function pickItem(it) {
  pickedItem = it;
  const ci = +$("cls").value;
  if (!it.classes.includes(ci) && !it.cross.includes(ci)) $("cls").value = String(it.classes[0] ?? it.cross[0] ?? ci);
  renderItemChips();
  loadStems();
}

// Only one target item per search: once chosen, the search box gives way to the item's chip.
function renderItemChips() {
  const it = pickedItem;
  $("itemChips").innerHTML = it
    ? `<div class="chip"><span>${esc(itemName(it.name))} <span class="hint">${esc(slotName(it.slot))}</span></span><button title="${window.t('chooseDifferentItem')}" aria-label="${window.t('chooseDifferentItem')}">&times;</button></div>`
    : "";
  $("itemFind").hidden = !!it;
  if (!it) $("itemPick").hidden = true;
  const b = $("itemChips").querySelector("button");
  if (b) b.addEventListener("click", () => { pickedItem = null; renderItemChips(); loadStems(); $("itemFind").focus(); });
}

function stemsFor(ci, slot, item) {
  const key = ci + "/" + slot + "/" + item;
  if (stemCache.has(key)) return Promise.resolve(stemCache.get(key));
  return new Promise((res) => {
    pending.set(key, (s) => { stemCache.set(key, s); res(s); });
    worker.postMessage({ type: "stems", key, class: ci, slot, item });
  });
}

let stemsGen = 0;   // overlapping loads (a hero ticked, then unticked) commit only the newest
async function loadStems() {
  const gen = ++stemsGen;
  const ci = +$("cls").value;
  const all = new Map();
  const maxOf = new Map();
  if (pickedItem) {
    // what the item can roll for its own class and for every other class (one of them may roll or enchant a stat the item's
    // class never gets, e.g. Lightning damage on a Necromancer's amulet, enchanted by a Wizard)
    const classes = [ci, ...[0, 1, 2, 3, 4, 5, 6].filter((c) => c !== ci)];
    for (const c of classes) {
      const { stems: st, max } = await stemsFor(c, pickedItem.slot, pickedItem.id);
      for (const k of Object.keys(st)) if (!HIDDEN.test(k)) all.set(k, statName(k));
      // the highest each stat can roll on this item for any hero, in the units of the box (percentages as 15, not 0.15)
      for (const [k, v] of Object.entries(max)) { const u = Math.round((isPct(k) ? v * 100 : v) * 1e4) / 1e4; if (!(u <= (maxOf.get(k) ?? -1))) maxOf.set(k, u); }
    }
  }
  if (gen !== stemsGen) return;
  stemList = [...all.entries()].map(([stem, name]) => ({ stem, name })).sort((a, b) => a.name.localeCompare(b.name));
  statMax = maxOf;
  wants = wants.filter((w) => all.has(w.stem));
  renderChips();
}

// a typed minimum, kept between 0 and the item's best roll of that stat ("" stays empty)
function clampMin(stem, v) {
  if (v === "" || Number.isNaN(+v)) return "";
  const hi = statMax.get(stem);
  const x = Math.max(0, hi === undefined ? +v : Math.min(+v, hi));
  return String(Math.round(x * 1e4) / 1e4);
}

function renderChips() {
  $("chips").innerHTML = wants.map((w, i) => `<div class="chip"><span>${esc(statName(w.stem))}</span>${w.stem === "Sockets" ? "" : `<input type="number" step="any" min="0"${statMax.has(w.stem) ? ` max="${statMax.get(w.stem)}" title="${window.t('highestRoll', {v: isPct(w.stem) ? statMax.get(w.stem) + " %" : fmtValue(w.stem, statMax.get(w.stem))})}"` : ""} placeholder="${window.t('minPh')}${isPct(w.stem) ? " %" : ""}" value="${esc(w.min)}" data-i="${i}">`}<button data-x="${i}" title="${window.t('remove')}" aria-label="${window.t('remove')}">&times;</button></div>`).join("");
  $("chips").querySelectorAll("input").forEach((el) => {
    el.addEventListener("input", () => { wants[+el.dataset.i].min = el.value; });
    // out-of-range numbers are pulled back to the nearest roll the item can have when the box is left
    el.addEventListener("change", () => { const w = wants[+el.dataset.i]; w.min = clampMin(w.stem, el.value); el.value = w.min; });
  });
  $("chips").querySelectorAll("button").forEach((el) => el.addEventListener("click", () => { wants.splice(+el.dataset.x, 1); renderChips(); }));
}

// ---------- search: one pass per result category ----------
// Categories, best first. Each is its own search so the cheapest of EACH kind is found: an ancient or plain legendary
// is usually far cheaper than a primal, and the player chooses the trade. "crafted" (Improve Legendary) only counts
// when the search may end on an Improve Legendary step.
const TIERS = [
  { key: "primal", quality: "primal", crafted: false, label: "primal" },
  { key: "crafted", quality: "crafted", crafted: true, label: "crafted primal" },
  { key: "ancient", quality: "ancient", crafted: false, label: "ancient" },
  { key: "normal", quality: "normal", crafted: false, label: "legendary" },
];

let run = null;   // the run in flight, or the last one: {base, deadline, i, results, wantsSnap, item, show, stopped, capped, warnings, finished, onUpdate, onDone, onCancel}

// The request the form currently describes (see recipe.js for the shape).
function readRequest() {
  return {
    ...readSettings(contextNow().season),
    c: +$("cls").value, i: pickedItem.id, w: wants.map((w) => [w.stem, clampMin(w.stem, String(w.min))]), po: $("po").checked,
  };
}
const contextNow = () => ({ season: Math.max(1, Math.round(+$("season").value || 40)), hc: $("hc").value === "1" });


function startTier() {
  const t = run.tiers[run.i];
  const left = Math.max(1000, run.deadline - performance.now());
  const budget = Math.max(1500, left / (run.tiers.length - run.i));
  const q = { ...run.base, quality: t.quality, end_on_primalize: t.crafted };
  if (t.crafted && q.max_primalize < 1) { nextTier(); return; }
  searchId += 1;
  worker.postMessage({ type: "search", id: searchId, query: q, budgetMs: budget });
  run.onUpdate(run, false, window.t('searchingRecipes', { t: t.label }));
}

function nextTier() {
  run.i += 1;
  if (run.i >= run.tiers.length) { finish(); return; }
  startTier();
}

// One search for one request. The worker runs one search at a time, so a new run replaces (and cancels) the one in flight.
function startRun(req, item, season, hc, secs, onUpdate, onDone, onCancel) {
  if (run && !run.finished) { run.finished = true; worker.postMessage({ type: "cancel" }); if (run.onCancel) run.onCancel(); }
  searchStarted();
  run = {
    base: baseQuery(req, item, season, hc), deadline: performance.now() + Math.max(1, secs) * 1000,
    // Primal only keeps natural primals alone: no crafted primal, ancient or plain legendary, so the whole time limit goes to them
    tiers: req.po ? TIERS.filter((t) => t.key === "primal") : TIERS, po: !!req.po,
    i: 0, results: {}, wantsSnap: req.w.map((w) => w[0]), item, show: req.n,
    stopped: false, capped: false, warnings: new Set(), finished: false, onUpdate, onDone, onCancel,
  };
  startTier();
}

function onResults(r, final) {
  const t = run.tiers[run.i];
  r.warnings.forEach((w) => run.warnings.add(w));
  run.results[t.key] = r;
  if (final && !r.status.done) run.stopped = true;   // ran out of time in this category
  if (final && r.status.capped) run.capped = true;   // the planner's own search limit, not the clock
  run.onUpdate(run, false);
  if (final) nextTier();
}

function finish() {
  run.finished = true;
  searchEnded();
  run.onDone(run);
}

// ---------- the search page ----------

let last = null;          // {req, item, season, hc}: what the results on screen answer, for Copy link and Save
let lastApplied = "";     // the request link already loaded into the form
let notice = "";          // one line to show under the next finished search (a link replaced the visitor's season or mode)

function go() {
  if (!pickedItem) { $("status").textContent = window.t('searchFirstItem'); return; }
  const req = readRequest(), { season, hc } = contextNow();
  const secs = Math.max(1, Math.round(+$("secs").value || 0));
  last = { req, item: pickedItem, season, hc };
  const note = notice;
  notice = "";
  $("out").innerHTML = "";
  $("actions").hidden = true;
  $("go").disabled = true;
  // the address bar now is the link to this search, so bookmarking the page keeps the request, season and mode
  try { history.replaceState(null, "", requestHash(req, season, hc)); lastApplied = location.hash; } catch (e) { /* ignore */ }
  startRun(req, pickedItem, season, hc, secs,
    (r, final, status) => { if (status) $("status").textContent = status; else $("out").innerHTML = resultsHtml(r, false); },
    (r) => {
      $("go").disabled = false;
      $("status").textContent = r.stopped ? window.t('stoppedAtLimit') : note;
      $("out").innerHTML = resultsHtml(r, true);
      showActions();
      dropStale();   // the season or mode changed while this search ran: its results answer the old ones
    },
    () => { $("go").disabled = false; });
}

// results on screen answer one season and mode; once either changes they no longer apply, so drop them
function dropStale() {
  const { season, hc } = contextNow();
  if (!last || (last.season === season && last.hc === hc) || $("go").disabled) return;
  $("out").innerHTML = "";
  $("actions").hidden = true;
  $("status").textContent = window.t('ctxChanged', { s: season, m: hc ? window.t('hardcore') : window.t('softcore') });
}
$("season").addEventListener("input", dropStale);
$("hc").addEventListener("change", dropStale);

const labelOf = (item, req) => `${itemName(item.name)} · ${req.w.map(([s]) => statAbbr(s)).join(", ") || "any roll"}`;

function showActions() {
  $("actions").hidden = false;
  $("actionNote").textContent = "";
  $("saveBtn").textContent = savedHas(last.req) ? window.t('savedToggleOn') : window.t('savedToggleOff');
}

function initActions() {
  $("copyLink").addEventListener("click", async () => {
    if (!last) return;
    const url = location.origin + location.pathname + requestHash(last.req, last.season, last.hc);
    try { await navigator.clipboard.writeText(url); $("actionNote").textContent = window.t('linkCopied'); }
    catch (e) { $("actionNote").textContent = window.t('copyAddress'); }
  });
  $("saveBtn").addEventListener("click", () => {
    if (!last) return;
    const now = savedToggle(last.req, labelOf(last.item, last.req));
    $("saveBtn").textContent = now ? window.t('savedToggleOn') : window.t('savedToggleOff');
    $("actionNote").textContent = now ? window.t('addedToSaved') : window.t('removedFromSaved');
  });
}

// Load a request link into the form and run it. The link's season and mode win over the visitor's remembered ones.
async function applyLink(parsed) {
  const { req, season, hc } = parsed;
  const it = itemList.find((x) => x.id === req.i);
  if (!it || !info.classes[req.c]) { $("status").textContent = window.t('linkNamesUnknown'); return; }
  const was = contextNow();
  $("season").value = String(season);
  $("hc").value = hc ? "1" : "0";
  $("season").dispatchEvent(new Event("input", { bubbles: true }));
  $("hc").dispatchEvent(new Event("change", { bubbles: true }));
  $("cls").value = String(req.c);
  pickedItem = it;
  renderItemChips();
  ["cc", "ch", "cr", "cp"].forEach((id, k) => { $(id).value = req.p[k]; });
  $("xn").value = req.xn;
  $("cn").value = req.cn ?? DEFAULT_CONVERTS;
  $("csa").value = req.sa ?? DEFAULT_SANCTIFY_PRICE; $("sn").value = req.sn ?? defaultSanctifyCap(season);
  sanctifyCapEdited = req.sn != null;
  updateSanctifyControls();
  $("cs").value = req.xs;
  $("floor").value = String(req.f);
  $("top").value = String(req.n);
  $("po").checked = !!req.po;
  wants = req.w.map(([stem, min]) => ({ stem, min }));
  await loadStems();   // drops any stat the item cannot roll and redraws the chips
  if (was.season !== season || was.hc !== hc) {
    notice = window.t('openedLink', { s: season, m: hc ? window.t('hardcore') : window.t('softcore'), os: was.season, om: was.hc ? window.t('hardcore') : window.t('softcore') });
  }
  go();
}

// ---------- the saved page: every saved request, computed for the season and mode chosen now ----------

let savedToken = 0;       // bumped to abandon a computation in flight (leaving the page, or recomputing)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function stopSaved() { savedToken += 1; }

function renderSaved() {
  const host = $("viewSaved");
  const list = savedList();
  stopSaved();
  if (!list.length) {
    host.innerHTML = `<div class="card empty">${window.t('nothingSavedYetDesc')}</div>`;
    return;
  }
  const { season, hc } = contextNow();
  host.innerHTML = `<div class="bhead"><h2>${window.t('savedTitle')}</h2><span class="small">Season ${season} &middot; ${hc ? window.t('hardcore') : window.t('softcore')}</span></div>
    <div class="actions"><button type="button" class="btn" id="recompute">${window.t('recompute')}</button><span id="savedStatus" class="small"></span></div>` +
    list.map((e) => `<section class="card saved" data-id="${esc(e.id)}"><div class="shead"><h3>${esc(e.label)}</h3>
      <span><a href="${esc(requestHash(e.req, season, hc))}">${window.t('openInSearch')}</a> <button type="button" class="link" data-rm>${window.t('remove')}</button></span></div>
      <div class="sout small">${window.t('waiting')}</div></section>`).join("");
  host.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
    const sec = b.closest("section.saved");
    savedRemove(sec.dataset.id);
    sec.remove();
    if (!host.querySelector("section.saved")) renderSaved();
  }));
  $("recompute").addEventListener("click", renderSaved);
  computeSaved(list, season, hc, ++savedToken);
}

function computeSaved(list, season, hc, token) {
  const status = $("savedStatus");
  const step = (k) => {
    if (token !== savedToken) return;
    if (k >= list.length) { status.textContent = ""; return; }
    const e = list[k], req = e.req;
    const item = itemList.find((x) => x.id === req.i);
    const sec = [...$("viewSaved").querySelectorAll("section.saved")].find((s) => s.dataset.id === e.id);
    if (!sec) { step(k + 1); return; }
    const out = sec.querySelector(".sout");
    if (!item || !info.classes[req.c]) { out.textContent = window.t('itemNotInVersion'); step(k + 1); return; }
    status.textContent = window.t('computingProgress', { n: k + 1, t: list.length });
    startRun(req, item, season, hc, 20,
      (r, final, st) => { if (!st) { out.classList.remove("small"); out.innerHTML = resultsHtml(r, false); } },
      (r) => { out.classList.remove("small"); out.innerHTML = resultsHtml(r, true); step(k + 1); },
      () => {});
  };
  step(0);
}

// ---------- routes ----------

const routeOfHash = () => { try { return decodeURIComponent(location.hash.replace(/^#/, "").split("?")[0]) || "search"; } catch (e) { return "search"; } };

// builds.js announces every view change (route + fragment); the engine may not be ready yet, in which case start() calls this again.
function onRoute(route) {
  if (!info) return;
  if (route !== "saved") stopSaved();
  if (route === "saved") renderSaved();
  else if (route === "search") {
    const h = location.hash;
    const parsed = h !== lastApplied ? parseRequestHash(h) : null;
    if (parsed) { lastApplied = h; applyLink(parsed); }
  }
}
window.addEventListener("d3-route", (e) => onRoute(e.detail));

// ---------- rendering ----------


const TIER_OF = { primal: "primal", crafted: "crafted", ancient: "ancient", normal: "normal" };




// Per category: the cheapest recipes that land every wanted stat, plus one "finish at the Mystic" recipe when it beats
// them (or when nothing lands every stat) — a rated best-effort instead of an empty answer.

function resultsHtml(run, final) {
  const snap = run.wantsSnap;
  let html = "";
  if (run.warnings.size) html += `<div class="warn">${[...run.warnings].map(esc).join("; ")}</div>`;
  // Drop any recipe that a better category matches or beats on cost with at least as many of the wanted stats
  // (e.g. a crafted primal that costs more than a natural primal): it would only be noise.
  const shown = [];
  let body = "";
  for (const t of TIERS) {
    const r = run.results[t.key];
    if (!r) continue;
    for (const h of pickHits(t.key, r, snap, run.show)) {
      if (shown.some((s) => s.matched >= h.matched.length && s.cost <= h.cost)) continue;
      shown.push({ matched: h.matched.length, cost: h.cost });
      body += hitHtml(h, TIER_OF[t.key], snap, run.item, run.base.class, run.base.season, (c) => className(info.classes[c]));
    }
  }
  if (shown.length) html += `<section class="card">${body}</section>`;
  else if (final) {
    const why = run.po && !run.stopped && !run.capped
      ? window.t('noPrimalRecipeFound')
      : run.stopped
      ? window.t('nothingBeforeLimit')
      : run.capped
        ? window.t('noRecipeInLimit')
        : window.t('noPassableRecipe');
    html += `<section class="card"><div class="empty">${why}</div></section>`;
  }
  return html;
}