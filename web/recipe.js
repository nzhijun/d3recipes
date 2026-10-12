// Copyright 2026 FNG. Use, modification and redistribution are permitted under the conditions in LICENSE:
// credit the source, and visibly link to the site or repository if you use its outputs in a user-facing application.
// Recipe rendering shared by the custom search (app.js) and the prepared builds (builds.js).
import { statName, statAbbr, isSecondary, RANGE_STEMS, fmtValue, materials, MATERIAL_ICONS, MATERIAL_GROUPS, SLOT_NAMES } from "./stats.js?v=b8d9a2c3e4";

const slotName = (s) => { const t = typeof window !== "undefined" && window.t ? window.t(s) : s; return t !== s ? t : (SLOT_NAMES[s] || s); };

const PLURAL_FIX = { "Chest Armor": "chest armor pieces", Pants: "pants", Boots: "boots", Gloves: "gloves", Bracers: "bracers", Shoulders: "shoulders", Source: "sources" };
export function slotPlural(slot, n) {
  const s = slotName(slot);
  if (n === 1) {
    const one = s.replace(/^(.*) \((\dH)\)$/, "$2 $1");
    return one.toLowerCase().replace(/^(\dh)/, (m) => m.toUpperCase());
  }
  if (PLURAL_FIX[s]) return PLURAL_FIX[s];
  const m = /^(.*) \((\dH)\)$/.exec(s);
  const base = (m ? m[1] : s).toLowerCase();
  const pl = /(s|x)$/.test(base) ? base : base + "s";
  return m ? `${m[2]} ${pl}` : pl;
}

// The icons ship with the page; the coloured abbreviation tile underneath only shows if one fails to load.
const iconsPresent = true;

export function matIconHtml(name, qty) {
  const ic = MATERIAL_ICONS[name] || { file: "", abbr: name.slice(0, 2), color: "#666" };
  return `<span class="mat" title="${name}: ${qty.toLocaleString("en-US")}" aria-label="${name}: ${qty.toLocaleString("en-US")}">` +
    `<span class="fb" style="background:${ic.color}">${ic.abbr}</span>` +
    (ic.file && iconsPresent ? `<img src="icons/${ic.file}" alt="" onload="this.previousElementSibling.remove()" onerror="this.remove()">` : "") +
    `<span class="n">${qty.toLocaleString("en-US")}</span></span>`;
}

// One wide icon for a group of materials that all appear with the same count (the three crafting grades, the five legendary
// materials); anything else stays a single tile. `m` is materials(h): {name: quantity}.
export function matsHtml(m) {
  const out = [];
  const grouped = new Set();
  // Always the same order: Death's Breath, the three crafting grades, the five legendary materials, Forgotten Souls, Primordial Ashes.
  const ORDER = ["Death's Breath", ...MATERIAL_GROUPS[0].names, ...MATERIAL_GROUPS[1].names, "Forgotten Soul", "Primordial Ashes", "Angelic Crucible"];
  const rank = (n) => (ORDER.includes(n) ? ORDER.indexOf(n) : ORDER.length);
  for (const [name, qty] of Object.entries(m).sort((a, b) => rank(a[0]) - rank(b[0]))) {
    if (grouped.has(name)) continue;
    const g = MATERIAL_GROUPS.find((x) => x.names.includes(name) && x.names.every((n) => m[n] === qty));
    if (!g) { out.push(matIconHtml(name, qty)); continue; }
    g.names.forEach((n) => grouped.add(n));
    const label = `${g.names.join(", ")}: ${qty.toLocaleString("en-US")} each`;
    out.push(`<span class="mat wide" title="${label}" aria-label="${label}"><img src="icons/${g.file}" alt="">` +
      `<span class="n">${qty.toLocaleString("en-US")}</span></span>`);
  }
  return out.join("");
}

const OP_TEXT = { S: (n) => window.t('opSanctify', { n }), R: (n) => window.t('opReforge', { n }), P: (n) => window.t('opImproveWithAshes', { n }), C: (n) => window.t('opConvert', { n }) };

const MAIN = new Set(["Str", "Dex", "Int", "StrDex", "StrInt", "StrVit", "DexInt", "DexVit", "IntVit"]);

// What to look for at a checkpoint: its main-stat roll (falls back to the first real line), plus the item's name when it
// changed (Convert Set Item) and "ancient"/"primal" when that is what the item is at that point.
export function stopOn(cp, prev) {
  const lines = cp.lines.filter((l) => l.stem !== "item power" && l.stem !== "Sockets" && l.stem !== "Indestructible");
  const main = lines.find((l) => MAIN.has(l.stem)) || lines[0];
  const val = main ? `${fmtValue(main.stem, main.value)} ${statAbbr(main.stem)}` : "";
  const prefix = !prev || cp.name !== prev.name ? cp.name : (cp.quality === "ancient" || cp.quality === "primal") ? cp.quality : "";
  const w = typeof window !== "undefined" && window.t ? window.t("withShort") : "w/";
  return prefix && val ? `${prefix} ${w} ${val}` : (prefix || val);
}

// Can the Mystic add every `missing` stat? It rerolls a line the player does not need, within the same kind: a primary
// target needs a spare primary, a secondary target a spare secondary (the real reroll pools are finer than this, so the
// check stays simple). The weapon-damage range is never counted: rolling off it is almost always a mistake. Only lines the
// engine lists in `h.mystic` count: swapping them for the missing stat obeys the roll rules (no All Res next to a single
// resistance, no Life per Hit next to Life per Kill, ...).
export function mysticCanFinish(h, missing, wantStems) {
  const legal = new Set(h.mystic || []);
  const spare = h.lines.filter((l) => l.stem !== "item power" && l.stem !== "Indestructible" && !RANGE_STEMS.has(l.stem) && !wantStems.has(l.stem) && legal.has(l.stem));
  // the engine has already checked the kind from the game data (`mystic_class` marks such a result): Crowd Control Reduction is a
  // secondary there, whatever isSecondary says
  if (h.mystic_class !== undefined) return spare.length > 0;
  const sec = spare.filter((l) => isSecondary(l.stem)).length;
  const need = { sec: missing.filter((m) => isSecondary(m)).length, pri: missing.filter((m) => !isSecondary(m)).length };
  return spare.length - sec >= need.pri && sec >= need.sec;
}

// heroes: {cls, name(c)} for a custom search; when the route hands the item to another class, every step says who does it.
export function stepsHtml(h, missing, wantStems, heroes) {
  const out = [];
  const cps = h.checkpoints || [];
  const who = h.route_class || [];
  const crafter = h.craft_class ?? (heroes && heroes.cls);
  const switched = heroes && (crafter !== heroes.cls || who.some((c) => c !== heroes.cls));
  const as = (c) => (switched ? ` <b>${window.t('asBy', { c: heroes.name(c) })}</b>` : "");
  const stopNote = (cp, prev) => cp ? ` <span class="note">${window.t('stopOnNote', { t: stopOn(cp, prev) })}</span>` : "";
  const hopeNote = (h.hope > 7 || h.route.some(([op]) => op === "C") || h.root_name !== h.name) && cps[0]
    ? stopNote(cps[0], null) : "";
  out.push(`${window.t('craftAndUpgrade', { n: h.hope, item: slotPlural(h.slot, h.hope) })}${switched ? as(crafter) : ""}${hopeNote}`);
  h.route.forEach(([op, n], k) => {
    const last = k === h.route.length - 1;
    const cp = cps[k + 1];
    const note = n > 7 && !last ? stopNote(cp, cps[k]) : "";
    out.push((OP_TEXT[op] || (() => op))(n) + (switched ? as(who[k]) : "") + note);
  });
  if (missing.length) {
    const legal = (h.mystic || []).filter((s) => !wantStems.has(s) && !RANGE_STEMS.has(s));
    const holder = who.length ? who[who.length - 1] : crafter;
    const by = heroes && h.mystic_class !== undefined && (h.mystic_class !== holder || switched) ? ` <b>${window.t('asBy', { c: heroes.name(h.mystic_class) })}</b>` : "";
    out.push(legal.length && missing.length === 1
      ? `${window.t('mysticArrow', { legal: legal.map((s) => statName(s)).join(" or "), target: statName(missing[0]) })}${by}`
      : `${window.t('mysticRoll', { s: missing.map((m) => statName(m)).join(" or ") })}${by}`);
  }
  return `<ul class="steps">${out.map((s) => `<li>${s}</li>`).join("")}</ul>`;
}

// Full-tooltip rows. A weapon-damage roll arrives as two lines (minimum, then the spread added on top); show one "min–max" row.
export function tooltipRows(lines) {
  const rows = [];
  const num = (v) => Math.round(v).toLocaleString("en-US");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.stem === "item power") continue;
    if (RANGE_STEMS.has(l.stem) && lines[i + 1] && lines[i + 1].stem === l.stem) {
      rows.push({ stem: l.stem, label: statName(l.stem).replace(" (weapon)", ""), value: `${num(l.value)}–${num(l.value + lines[i + 1].value)}` });
      i += 1;
    } else {
      rows.push({ stem: l.stem, label: statName(l.stem), value: l.max === 0 && l.value === 0 ? "" : fmtValue(l.stem, l.value) });
    }
  }
  // Major affixes first: weapon damage, then main stats, then the other primaries, then the secondaries (gold find and the like).
  const rank = (r) => (RANGE_STEMS.has(r.stem) ? 0 : MAIN.has(r.stem) ? 1 : isSecondary(r.stem) ? 3 : 2);
  return rows.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

// ---------- requests: shareable links and the saved list ----------
// A request is what the player asked for, not the answer: {c: class index, i: item id, w: [[stem, min]], p: [Convert, Hope of Cain,
// Reforge, Improve Legendary] prices as typed, f: good-roll floor %, n: recipes shown}. The same request on the same season and
// mode always gives the same recipes, so a link (or a saved entry) only has to carry the request.
export const DEFAULT_PRICES = ["0.75", "1", "5", "25"];
export const DEFAULT_SWITCH = "1";   // swap cost
export const DEFAULT_SWAPS = "4";    // hand-overs during the cube steps ("" = no limit)
export const DEFAULT_CONVERTS = "4"; // Convert Set Item steps per recipe ("" = no limit)
// Light's Calling (Angelic Crucibles): Season 27, then every sixth season from 34 in the theme rotation (S46 on is projected, not announced)
export const supportsSanctify = (season) => season === 27 || (season >= 34 && (season - 34) % 6 === 0);
export const defaultSanctifyCap = (season) => supportsSanctify(season) ? "2" : "0";
export const DEFAULT_SANCTIFY_PRICE = "5"; // the Reforge price

export function requestHash(req, season, hc) {
  const e = encodeURIComponent;
  const w = req.w.map(([s, m]) => e(s) + (m === "" || m == null ? "" : "~" + e(m))).join(",");
  // the swap settings appear in the link only when they differ from the defaults, so older links and saved searches stay the same
  // Sanctification: the price only when it is not the default, the cap only when it is not the season's default (`sn` absent = that default)
  const sanctify = (req.sa != null ? `&sa=${e(req.sa)}` : "") + (req.sn != null ? `&sn=${e(req.sn)}` : "");
  const cv = (req.cn ?? DEFAULT_CONVERTS) !== DEFAULT_CONVERTS ? `&cn=${e(req.cn)}` : "";
  const x = (req.xn ?? DEFAULT_SWAPS) !== DEFAULT_SWAPS || (req.xs ?? DEFAULT_SWITCH) !== DEFAULT_SWITCH ? `&xn=${e(req.xn ?? DEFAULT_SWAPS)}&xs=${e(req.xs ?? DEFAULT_SWITCH)}` : "";
  const po = req.po ? "&po=1" : "";
  return `#search?c=${req.c}&i=${req.i}&w=${w}&s=${season}&m=${hc ? "hc" : "sc"}&p=${req.p.map(e).join(",")}&f=${req.f}&n=${req.n}${x}${cv}${sanctify}${po}`;
}

// -> {req, season, hc} or null when the fragment is not a request link
export function parseRequestHash(hash) {
  const m = /^#search\?(.*)$/.exec(hash || "");
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const d = decodeURIComponent;
  const num = (k) => (q.has(k) && q.get(k) !== "" && !Number.isNaN(+q.get(k)) ? +q.get(k) : null);
  const c = num("c"), i = num("i");
  if (c === null || i === null) return null;
  const w = (q.get("w") || "").split(",").filter(Boolean).map((x) => { const [s, v = ""] = x.split("~"); const n = d(v); return [d(s), /^\d*\.?\d*$/.test(n) ? n : ""]; });
  const p = (q.get("p") || "").split(",").map(d);
  const season = Math.max(1, Math.round(num("s") || 40));
  return {
    req: {
      po: q.get("po") === "1",
      c, i, w, p: p.length === 4 && p.every((x) => +x > 0) ? p : DEFAULT_PRICES.slice(), f: num("f") ?? 75, n: Math.max(1, num("n") || 1),
      sa: Number.isFinite(num("sa")) && num("sa") > 0 && num("sa") * 100 <= Number.MAX_SAFE_INTEGER ? q.get("sa") : undefined,
      sn: q.has("sn") && (q.get("sn") === "" || /^\d+$/.test(q.get("sn"))) ? q.get("sn") : undefined,
      cn: q.has("cn") ? (q.get("cn") === "" ? "" : /^\d+$/.test(q.get("cn")) ? q.get("cn") : DEFAULT_CONVERTS) : DEFAULT_CONVERTS,
      xn: q.has("xn") ? (q.get("xn") === "" ? "" : /^\d+$/.test(q.get("xn")) ? q.get("xn") : DEFAULT_SWAPS) : DEFAULT_SWAPS,
      // a finite cost the engine can take in hundredths (a crafted `xs=Infinity` would reach it as null)
      xs: Number.isFinite(num("xs")) && num("xs") >= 0 && num("xs") * 100 <= Number.MAX_SAFE_INTEGER ? q.get("xs") : DEFAULT_SWITCH,
    },
    season, hc: q.get("m") === "hc",
  };
}

export const savedId = (req) => `${req.c}/${req.i}/${req.w.map(([s, m]) => s + "~" + m).join(",")}/${req.p.join(",")}/${req.f}` +
  ((req.xn ?? DEFAULT_SWAPS) !== DEFAULT_SWAPS || (req.xs ?? DEFAULT_SWITCH) !== DEFAULT_SWITCH ? `/${req.xn ?? DEFAULT_SWAPS}~${req.xs ?? DEFAULT_SWITCH}` : "") +
  ((req.cn ?? DEFAULT_CONVERTS) !== DEFAULT_CONVERTS ? `/c${req.cn}` : "") +
  (req.sa != null ? `/sa${req.sa}` : "") + (req.sn != null ? `/sn${req.sn}` : "") + (req.po ? "/po" : "");

const SAVED_KEY = "d3r-saved";
export function savedList() {
  try { const v = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"); return Array.isArray(v) ? v.filter((e) => e && e.id && e.req) : []; } catch (e) { return []; }
}
function savedWrite(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable: the entry just will not persist */ }
  window.dispatchEvent(new Event("d3-saved"));
}
export const savedHas = (req) => savedList().some((e) => e.id === savedId(req));
export function savedToggle(req, label) {
  const id = savedId(req), list = savedList();
  const at = list.findIndex((e) => e.id === id);
  if (at >= 0) list.splice(at, 1); else list.push({ id, label, req });
  savedWrite(list);
  return at < 0;
}
export function savedRemove(id) { savedWrite(savedList().filter((e) => e.id !== id)); }