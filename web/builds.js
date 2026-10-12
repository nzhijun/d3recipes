// Copyright 2026 FNG. Use, modification and redistribution are permitted under the conditions in LICENSE:
// credit the source, and visibly link to the site or repository if you use its outputs in a user-facing application.
// Prepared builds: the side/top navigation and the per-build recipe pages. Reads premade_sc.json / premade_hc.json
// (see export_premade.py); needs no wasm, so it is usable before the search engine has finished loading.
import { statName, statAbbr, CLASS_NAMES, SLOT_NAMES, materials, itemName } from "./stats.js?v=440ee39fb2";
import { stepsHtml, matsHtml, tooltipRows, savedList, requestHash } from "./recipe.js?v=440ee39fb2";
import { esc } from "./ui.js?v=440ee39fb2";

const $ = (id) => document.getElementById(id);
const V = new URL(import.meta.url).searchParams.get("v");
const qs = V && V !== "0" ? `?v=${V}` : "";

const cache = {};                 // "sc" | "hc" -> Promise<{season, builds}>
let route = "search";             // "search" (the start page) | "staples" | build id
let current = null;               // loaded data for the active mode

const modeKey = () => ($("hc").value === "1" ? "hc" : "sc");
const className = (c) => { const t = typeof window !== "undefined" && window.t ? window.t(c) : c; return t !== c ? t : (CLASS_NAMES[c] || c); };
// like className, but for the raw `Chest`/`Amulet`/… keys SLOT_NAMES and the i18n dictionaries share; falls back to the English name
const slotName = (s) => { const t = typeof window !== "undefined" && window.t ? window.t(s) : s; return t !== s ? t : (SLOT_NAMES[s] || s); };
// like className, but for an item's English name; the i18n dictionaries share its key, so it follows the language switch
const itemLabel = (s) => { const t = typeof window !== "undefined" && window.t ? window.t(s) : s; return t !== s ? t : s; };
// the class index the generator writes in `by` / `who` / `mystic_by` (the order of data.json's `classes`)
const CLASS_ORDER = ["DemonHunter", "Barbarian", "Wizard", "WitchDoctor", "Monk", "Crusader", "Necromancer"];
const heroName = (c) => className(CLASS_ORDER[c]);

function load(key) {
  if (!cache[key]) {
    cache[key] = fetch(`./premade_${key}.json${qs}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch((e) => { delete cache[key]; throw e; });
  }
  return cache[key];
}

// ---------- recipe -> the shapes recipe.js renders ----------

const marker = (m) => ({ name: m[0], quality: m[1], lines: m[2] ? [{ stem: m[2], value: m[3] }] : [] });

// `who`: the hero class doing each letter of `path` (only present when the recipe hands the item to another class); a new group starts
// whenever the operation or the hero changes, as in a custom search result.
function hitOf(row, path, lin, who) {
  const route = [];
  const route_class = [];
  [...path].forEach((ch, i) => {
    const last = route[route.length - 1];
    const c = who ? who[i] : undefined;
    if (last && last[0] === ch && route_class[route_class.length - 1] === c) last[1] += 1; else { route.push([ch, 1]); route_class.push(c); }
  });
  // checkpoint k = the item after the first k groups of steps (0 = the Hope of Cain item)
  const checkpoints = [marker(lin[0])];
  let at = 0;
  for (const [, n] of route) { at += n; checkpoints.push(marker(lin[Math.min(at, lin.length - 1)])); }
  return { hope: row.n, slot: row.rs, route, route_class: who ? route_class : [], craft_class: who ? row.craft : undefined, checkpoints, root_name: lin[0][0], name: lin[lin.length - 1][0] };
}

// Cost in Hope of Cain units with the relative prices the search minimises (Convert Set Item 0.75, Hope of Cain 1, Reforge 5, Improve Legendary 25),
// and the plain number of actions (crafts + operations). Cost is what you pay in materials; steps is how long it takes.
const PRICE = { R: 5, C: 0.75, P: 25 };
// hand-overs between heroes (the build's class -> the crafter, crafter -> first step, step -> step, last step -> Mystic) cost 1 each, the generator's default swap price
const handOvers = (row, who) => {
  if (!who) return 0;
  const seq = [row.by, row.craft, ...who, ...(row.mystic ? [row.mystic_by] : [])];
  return seq.reduce((a, c, i) => a + (i && c !== seq[i - 1] ? 1 : 0), 0);
};
const costOf = (n, path, row, who) => Number((n + [...path].reduce((a, c) => a + (PRICE[c] || 0), 0) + (row ? handOvers(row, who) : 0)).toFixed(2));
const stepsOf = (n, path) => n + path.length;
const SHOW_COSTS = new URLSearchParams(location.search).has("costs");
const costHtml = (n, path, row, who) => (SHOW_COSTS ? `<span class="cost" title="${window.t('costTip')}">${window.t('cost')} ${costOf(n, path, row, who)} &middot; ${stepsOf(n, path)} ${window.t('steps')}</span>` : "");

const linesOf = (tt) => tt.map(([stem, value, max]) => ({ stem, value, max }));

function fullTooltip(tt, need) {
  if (!tt) return "";
  const want = new Set(need);
  const rows = tooltipRows(linesOf(tt)).map((r) => {
    const w = want.has(r.stem);
    return `<span class="${w ? "want" : ""}">${esc(r.label)}</span><span class="v ${w ? "want" : ""}">${esc(r.value)}</span>`;
  }).join("");
  return `<details class="full" open><summary>${window.t('fullTooltip')}</summary><div class="lines">${rows}</div></details>`;
}

function recipeBody(row, path, lin, tt, note = "", tooltip = true, who = row.who) {
  const h = hitOf(row, path, lin, who);
  const mats = matsHtml(materials(h));
  // a recipe that hands the item over names the hero at every step
  const heroes = who ? { cls: row.by, name: heroName } : undefined;
  return (row.intro ? `<p class="mk">${row.intro}</p>` : "") + stepsHtml(h, [], new Set(row.need), heroes) + note + `<div class="mats">${mats}</div>` + (tooltip ? fullTooltip(tt, row.need) : "");
}

const QUALITY = {
  primal: [() => window.t('qualityPrimal'), "t-primal"],
  crafted: [() => window.t('qualityCraftedPrimal'), "t-primal"],
  ancient: [() => window.t('qualityAncient'), "t-ancient"],
  normal: [() => window.t('qualityLegendary'), "t-normal"]
};

function rowHtml(row, tooltip = true) {
  const name = !row.item ? "" : `<span class="nm">${esc(itemName(row.item))}${row.cubed ? ` <span class="cb">${window.t('cubed')}</span>` : ""}${row.any ? ` <span class="cb">${window.t('anyItem')}</span>` : ""}</span>`;
  if (!row.found) {
    return `<div class="rec"><div class="nm">${esc(itemName(row.item))}</div><div class="small">${window.t('noNaturalPrimal')} <a href="./" data-route="search">${window.t('customSearch')}</a>.</div></div>`;
  }
  const [qt, qc] = QUALITY[row.q] || QUALITY.normal;
  const stats = row.need.map((s) => `<span class="want">${esc(statAbbr(s))}</span>`).join(", ");
  const holder = row.who ? (row.who.length ? row.who[row.who.length - 1] : row.craft) : undefined;
  const mysticBy = row.mystic && row.who && row.mystic_by !== holder ? ` ${window.t('asClass', { c: esc(heroName(row.mystic_by)) })}` : "";
  const mystic = row.mystic ? ` <span class="small">${window.t('mysticPlus')}${mysticBy}: ${esc(statName(row.mystic))}</span>`
    : row.nomystic ? ` <span class="small">${window.t('noRoomFor', { s: esc(statName(row.nomystic)) })}</span>` : "";
  const craftedNote = row.q === "crafted" ? `<div class="small">${window.t('improveLegendaryPrimalNote')}</div>` : "";
  const cheap = (row.cheap || []).map((c) => {
    const [ct] = QUALITY[c.q] || QUALITY.normal;
    return `<details class="full cheap"><summary>${window.t('cheaper')} ${ct().toLowerCase()}${SHOW_COSTS ? `, ${window.t('cost')} ${costOf(row.n, c.path, row, c.who)} (${stepsOf(row.n, c.path)} ${window.t('steps')})` : ""}</summary>${recipeBody(row, c.path, c.lin, c.tt, "", tooltip, c.who)}</details>`;
  }).join("");
  return `<details class="rec"><summary${row.item ? "" : ' class="noname"'}>${name}
    <span class="meta"><span class="tag ${qc}">${qt()}</span><span class="aff">${stats}</span>${mystic}${costHtml(row.n, row.path, row, row.who)}</span></summary>
    <div class="body">${recipeBody(row, row.path, row.lin, row.tt, craftedNote, tooltip)}${cheap}</div></details>`;
}

function buildHtml(b, data) {
  const slots = [];
  for (const r of b.rows) {
    const last = slots[slots.length - 1];
    if (last && last.name === r.slot) last.rows.push(r); else slots.push({ name: r.slot, rows: [r] });
  }
  const sc = data.hardcore ? window.t("hardcore") : window.t("softcore");
  const head = `<div class="bhead"><h2>${esc(b.title)}</h2><span class="small">${esc(className(b.class))} &middot; ${window.t('seasonLabel', { s: data.season })} &middot; ${sc}</span></div>`;
  const note = +$("season").value !== data.season
    ? `<div class="warn modeflag">${window.t('theseRecipesForSeason', { s: data.season })}</div>` : "";
  const cards = slots.map((s) => `<section class="card slot"><h3>${esc(slotName(s.name))}</h3>${s.rows.map((r) => rowHtml(r)).join("")}</section>`).join("");
  return head + note + cards;
}

// ---------- staples: class-agnostic items, each made on whichever class is cheapest ----------

function staplesHtml(data) {
  const sc = data.hardcore ? window.t("hardcore") : window.t("softcore");
  const head = `<div class="bhead"><h2>${window.t('staplesTitle')}</h2><span class="small">${window.t('anyClass')} &middot; ${window.t('seasonLabel', { s: data.season })} &middot; ${sc}</span></div>
    <p class="small" style="margin:0 0 12px">${window.t('staplesDesc')}</p>`;
  const cards = data.staples.map((st) => {
    const t = st.tier;
        const body = t ? rowHtml({ ...t.row, item: st.label, intro: `${window.t('makeClass', { c: esc(className(t.class)) })}`, cubed: false, mystic: null }, t.row.need.length > 0) : `<div class="small">${window.t('noRouteFound')}</div>`;
    return `<section class="card slot"><h3>${esc(itemLabel(st.item))}</h3>${st.note ? `<p class="small" style="margin:0 0 8px">${esc(window.t(st.note))}</p>` : ""}${body}</section>`;
  }).join("");
  return head + cards;
}

// ---------- cheapest natural primal per slot, for salvaging ----------

function salvageHtml(data) {
  const sc = data.hardcore ? window.t("hardcore") : window.t("softcore");
  const head = `<div class="bhead"><h2>${window.t('cheapPrimalSalvagingTitle')}</h2><span class="small">${window.t('anyClass')} &middot; ${window.t('seasonLabel', { s: data.season })} &middot; ${sc}</span></div>
    <p class="small" style="margin:0 0 12px">${window.t('cheapPrimalSalvagingDesc')}</p>`;
  const rows = data.salvage.map((a) => {
    const r = a.row;
    const slot = slotName(a.slot);
    return `<details class="rec"><summary><span class="nm">${esc(slot)}</span>
      <span class="meta"><span class="aff">${window.t('makeClass', { c: esc(className(a.class)) })}</span>${costHtml(r.n, r.path, r, r.who)}</span></summary>
      <div class="body">${recipeBody(r, r.path, r.lin, r.tt, `<div class="small">${window.t('youGet')} ${esc(itemName(r.item))}</div>`, false)}</div></details>`;
  }).join("");
  return head + `<section class="card slot">${rows || `<div class="small">${window.t('nothingFound')}</div>`}</section>`;
}

// ---------- navigation ----------

// the lists are rolled for one season; for any other season they would not match, so they are not offered
const listed = (data) => (Math.max(1, Math.round(+$("season").value || 40))) === data.season;

// Sidebar entries are real links, so Open in new tab works; a plain click is still handled here (see the nav click handler).
const hrefOf = (id) => (id === "search" ? location.pathname + location.search : "#" + encodeURIComponent(id));
const navLink = (id, label, cls = "") => `<a class="nb ${cls}" href="${esc(hrefOf(id))}" data-route="${esc(id)}"${route === id ? ' aria-current="page"' : ""}>${label}</a>`;

// Saved requests sit right under Custom search. Each opens as a search link for the season and mode chosen now.
function savedHtml() {
  const saved = savedList();
  if (!saved.length) return "";
  const season = Math.max(1, Math.round(+$("season").value || 40)), hc = $("hc").value === "1";
  return `<div class="grp"><span class="gl">${window.t('navSaved')}</span>${navLink("saved", `${window.t('allSaved')} (${saved.length})`)}` +
    saved.map((e) => { const h = esc(requestHash(e.req, season, hc)); return `<a class="nb" href="${h}" data-link="${h}">${esc(e.label)}</a>`; }).join("") + `</div>`;
}

function navHtml(data) {
  if (!listed(data)) {
    return `<div class="grp">${navLink("search", window.t('customSearch'), "mode")}${navLink("create-build", window.t('editBuildsNav'), "mode")}${navLink("search-builds", window.t('searchBuildItemsNav'), "mode")}</div>` + savedHtml() +
      `<div class="grp"><span class="small">${window.t('noPreparedBuilds', { s: Math.max(1, Math.round(+$("season").value || 40)) })}</span></div>`;
  }
  const groups = [];
  for (const b of data.builds) {
    let g = groups.find((x) => x.cls === b.class);
    if (!g) groups.push(g = { cls: b.class, list: [] });
    g.list.push(b);
  }
  const btn = navLink;
  return `<div class="grp">${btn("search", window.t('customSearch'), "mode")}${btn("create-build", window.t('editBuildsNav'), "mode")}${btn("search-builds", window.t('searchBuildItemsNav'), "mode")}</div>` + savedHtml() +
    (data.staples && data.staples.length ? `<div class="grp"><span class="gl">${window.t('anyClass')}</span>${btn("staples", window.t('staples'))}${data.salvage && data.salvage.length ? btn("salvage", window.t('cheapPrimals')) : ""}</div>` : "") +
    `<div class="grp"><span class="gl top">${window.t('builds')}</span></div>` +
    groups.map((g) => `<div class="grp"><span class="gl">${esc(className(g.cls))}</span>${g.list.map((b) => btn(b.id, esc(b.title))).join("")}</div>`).join("");
}

let announced = "";
function show() {
  if (current && !listed(current) && route !== "search" && route !== "create-build" && route !== "search-builds" && route !== "saved") route = "search";   // a build link from another season: fall back to the search
  const isBuild = route !== "search" && route !== "create-build" && route !== "search-builds" && route !== "saved";   // "staples" and every build id share the build view
  $("viewSearch").hidden = route !== "search";
$("viewCreateBuild").hidden = route !== "create-build";
$("viewSearchBuilds").hidden = route !== "search-builds";
  $("viewSaved").hidden = route !== "saved";
  $("viewBuild").hidden = !isBuild;
  if (current) {
    $("nav").innerHTML = navHtml(current);
    const on = $("nav").querySelector('[aria-current="page"]');
    // centre the current build inside the nav only (scrollIntoView would also scroll the page)
    const nav = $("nav");
    if (on) nav.scrollTo({ left: on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2, top: on.offsetTop - (nav.clientHeight - on.offsetHeight) / 2 });
  }
  if (isBuild && current) {
    const b = current.builds.find((x) => x.id === route);
    $("viewBuild").innerHTML = route === "staples" ? staplesHtml(current) : route === "salvage" ? salvageHtml(current) : b ? buildHtml(b, current) : `<div class="card empty">${window.t('noSuchBuild')}</div>`;
    // a card holding exactly one recipe opens from a click anywhere on it (see the click handler below)
    $("viewBuild").querySelectorAll("section.slot").forEach((c) => c.classList.toggle("single", c.querySelectorAll(":scope > details.rec").length === 1));
  }
  // app.js loads the search (or the saved page) for the view; announce each change once, so redrawing the nav does not restart it
  const key = route + "|" + location.hash;
  if (key !== announced) { announced = key; window.dispatchEvent(new CustomEvent("d3-route", { detail: route })); }
}

function go(next, push = true) {
  route = next;
  if (push) history.pushState(null, "", next === "search" ? location.pathname + location.search : "#" + next);
  show();
  window.scrollTo({ top: 0 });
}

function fromHash() {
  let h = "";
  try { h = decodeURIComponent(location.hash.replace(/^#/, "").split("?")[0]); } catch (e) { /* malformed: start page */ }
  route = h || "search";
  if (!["search", "create-build", "search-builds", "staples", "salvage", "saved"].includes(route) && current && !current.builds.some((b) => b.id === route)) route = "search";
}

// The saved mode lives in localStorage and app.js restores it only after the search engine has loaded, which is after the first
// refresh() below has already picked a file. Restore it here first, so a cold start with Hardcore saved loads premade_hc.json.
function restoreMode() {
  let saved = null;
  try { saved = localStorage.getItem("d3r-hc"); } catch (e) { /* storage blocked: keep the page's own value */ }
  if (saved === "0" || saved === "1") $("hc").value = saved;
}

async function refresh() {
  try {
    current = await load(modeKey());
  } catch (e) {
    $("nav").innerHTML = `<span class="small">${window.t('couldNotLoadPrepared', { e: esc(e.message) })}</span>`;
    fromHash();
    show();   // the search and saved views need no prepared data
    return;
  }
  fromHash();
  show();
}

// Recipes open and close from a click almost anywhere: on the card around a single recipe, or on the recipe itself (its summary
// already toggles natively, so nested summaries and links are left alone). Selecting text never counts as a click.
// a plain left click is handled in the page; Ctrl, Cmd, Shift, Alt or a middle click is left to the browser (new tab or window)
const plain = (e) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
$("viewBuild").addEventListener("click", (e) => {
  const link = e.target.closest("a[data-route]");
  if (link) { if (plain(e)) { e.preventDefault(); go(link.dataset.route); } return; }
  if (String(window.getSelection()).length || e.target.closest("a, button")) return;
  const rec = e.target.closest("details.rec");
  if (rec) {
    if (e.target.closest("summary")) return;          // the recipe's own summary, or a nested one (tooltip, cheaper option): native toggle
    rec.open = !rec.open;
    return;
  }
  const card = e.target.closest("section.slot.single");
  if (card) { const r = card.querySelector(":scope > details.rec"); r.open = !r.open; }
});
$("home").addEventListener("click", (e) => { if (!plain(e)) return; e.preventDefault(); go("search"); });
$("nav").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link], a[data-route]");
  if (!a || !plain(e)) return;
  e.preventDefault();
  if (a.dataset.link) { location.hash = a.dataset.link.slice(1); window.scrollTo({ top: 0 }); } else go(a.dataset.route);
});
window.addEventListener("d3-saved", show);
window.addEventListener("d3-navigate", event => go(event.detail));
window.addEventListener("popstate", () => { fromHash(); show(); });
$("hc").addEventListener("change", refresh);
$("season").addEventListener("input", show);
// nav is empty until the data arrives; the search view alone must work if the fetch fails, so show it at once.
restoreMode();
fromHash();
$("viewSearch").hidden = route !== "search";
$("viewCreateBuild").hidden = route !== "create-build";
$("viewSearchBuilds").hidden = route !== "search-builds";
refresh();
window.addEventListener("d3-lang-change", () => { if (current) show(); });