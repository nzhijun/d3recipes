// Copyright 2026 FNG. Use, modification and redistribution are permitted under the conditions in LICENSE:
// credit the source, and visibly link to the site or repository if you use its outputs in a user-facing application.
// Shared page pieces: the type-ahead picker and the recipe result card, used by custom search and the build pages.
import { statAbbr, isSecondary, RANGE_STEMS, WEAPON_SLOTS, materials } from "./stats.js?v=440ee39fb2";
import { matsHtml, stepsHtml, tooltipRows, supportsSanctify, defaultSanctifyCap, DEFAULT_SANCTIFY_PRICE } from "./recipe.js?v=440ee39fb2";

// ---------- keyboard-navigable autocomplete ----------
// source() -> [{html, value}] for the current text; Up/Down move, Enter (or click) picks, Escape closes.

export const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

export function combo(input, box, source, emptyText, onPick) {
  const controller = new AbortController();
  const on = (target, type, listener) => target.addEventListener(type, listener, { signal: controller.signal });
  let items = [], active = -1;
  const paint = () => {
    box.innerHTML = items.length
      ? items.map((x, i) => `<div role="option" data-i="${i}">${x.html}</div>`).join("") +
        `<div class="keys" aria-hidden="true"><kbd>&uarr;</kbd><kbd>&darr;</kbd> ${window.t('keyboardMove')} <kbd>&crarr;</kbd> ${window.t('keyboardSelect')} <kbd>esc</kbd> ${window.t('keyboardClose')}</div>`
      : `<div class="empty">${emptyText}</div>`;
    setActive(active, false);
  };
  // One highlight only: the keyboard and the mouse pointer move the same marker (a resting pointer must not
  // look like a second, competing selection).
  const setActive = (i, scroll) => {
    active = i;
    box.querySelectorAll("[data-i]").forEach((el, k) => {
      el.classList.toggle("active", k === i);
      el.setAttribute("aria-selected", String(k === i));
    });
    const a = box.querySelector(".active");
    if (a && scroll) a.scrollIntoView({ block: "nearest" });
  };
  const open = () => { items = source(); active = items.length ? 0 : -1; paint(); box.hidden = false; input.setAttribute("aria-expanded", "true"); };
  const close = () => { box.hidden = true; input.setAttribute("aria-expanded", "false"); };
  const pick = (i) => { const x = items[i]; if (!x) return; input.value = ""; close(); onPick(x.value); };
  on(input, "input", open);
  on(input, "focus", open);
  on(input, "keydown", (e) => {
    const down = e.key === "ArrowDown" || e.key === "Down", up = e.key === "ArrowUp" || e.key === "Up";
    if (down || up) {
      e.preventDefault();
      if (box.hidden) { open(); return; }
      if (!items.length) return;
      setActive(down ? Math.min(items.length - 1, active + 1) : Math.max(0, active - 1), true);
    } else if (e.key === "Enter") {
      if (!box.hidden && items.length) { e.preventDefault(); pick(Math.max(0, active)); }
    } else if (e.key === "Escape" || e.key === "Tab") {
      close();
    }
  });
  // mousedown (not click) so the pick lands before the input loses focus
  // Only a pointer that really moved counts: browsers also fire a phantom mousemove when the list scrolls or redraws under
  // a resting pointer, which must not steal the highlight back from the arrow keys.
  let px = -1, py = -1;
  on(box, "mousemove", (e) => {
    if (e.clientX === px && e.clientY === py) return;
    px = e.clientX; py = e.clientY;
    const el = e.target.closest("[data-i]");
    if (el && +el.dataset.i !== active) setActive(+el.dataset.i, false);
  });
  on(box, "mousedown", (e) => {
    const el = e.target.closest("[data-i]");
    if (el) { e.preventDefault(); pick(+el.dataset.i); }
  });
  on(document, "click", (e) => { if (e.target !== input && !box.contains(e.target)) close(); });
  // dispose removes every listener, for pages that redraw their pickers
  return { close, dispose: () => { controller.abort(); close(); items = []; } };
}

const TAGS = {
  primal:  { best: [() => window.t('tagBest'), "t-best"], part: [() => window.t('tagFinishMystic'), "t-best"] },
  crafted: { best: [() => window.t('tagBestCraftedPrimal'), "t-best"], part: [() => window.t('tagCraftedPrimalFinishMystic'), "t-best"] },
  ancient: { best: [() => window.t('tagGreatAncient'), "t-ancient"], part: [() => window.t('tagGreatAncientFinishMystic'), "t-ancient"] },
  normal:  { best: [() => window.t('tagLegendary'), "t-normal"], part: [() => window.t('tagLegendaryFinishMystic'), "t-normal"] },
};


// heroName(classIndex) -> the hero's display name, for hand-over steps.
export function hitHtml(h, tier, snap, item, cls, season, heroName) {
  const wantStems = new Set(snap);
  const matchedStems = new Set(h.matched.map((i) => snap[i]));
  const missing = snap.filter((_, i) => !h.matched.includes(i));
  const perfect = !missing.length;
  const [tagText, tagCls] = TAGS[tier][perfect ? "best" : "part"];
  const seen = new Set();
  const parts = [];
  for (const s of snap) {
    if (matchedStems.has(s)) { seen.add(s); parts.push(`<span class="want">${statAbbr(s)}</span>`); }
  }
  const onWeapon = WEAPON_SLOTS.has(item.slot);
  for (const l of h.lines) {
    if (l.stem === "item power" || seen.has(l.stem) || isSecondary(l.stem) || l.stem === "Sockets" || l.stem === "Indestructible") continue;
    if (wantStems.has(l.stem)) continue;
    if (onWeapon && RANGE_STEMS.has(l.stem)) continue;
    seen.add(l.stem);
    parts.push(`<span class="extra">${statAbbr(l.stem)}</span>`);
  }
  if (!perfect) parts.push(`<span class="want">${window.t('mysticFinish')} ${missing.map((m) => statAbbr(m)).join(" or ")}</span>`);
  const lines = tooltipRows(h.lines).map((r) => {
    const w = wantStems.has(r.stem);
    return `<span class="${w ? "want" : ""}">${r.label}</span><span class="v ${w ? "want" : ""}">${r.value}</span>`;
  }).join("");
  const mats = matsHtml(materials(h));
  const craftedNote = tier === "crafted" ? `<div class="small">${window.t('improveLegendaryPrimalNote')}</div>` : "";
  const crucibleNote = tier === "crafted" && supportsSanctify(season)
    ? `<div class="small">${window.t('crucibleNote')}</div>` : "";
  return `<article class="hit"><div class="head"><span class="tag ${tagCls}">${tagText()}</span><span class="aff">${parts.join(", ")}</span></div>
    ${stepsHtml(h, missing, wantStems, { cls, name: heroName })}${craftedNote}${crucibleNote}<div class="mats">${mats}</div>
    <details class="full"><summary>${window.t('fullTooltip')}</summary><div class="lines">${lines}</div></details></article>`;
}

// The cost and limit boxes shared by custom search and the build search, as the request fields the search reads.
// A box left at its default is undefined, so links and saved searches follow the season's default.
export function readSettings(season, prefix = "") {
  const $ = (id) => document.getElementById(prefix + id);
  const num = (id) => Math.max(0, Math.round(+$(id).value || 0));
  const sa = $("csa").value.trim(), sn = $("sn").value.trim();
  return {
    sa: sa === "" || +sa === +DEFAULT_SANCTIFY_PRICE ? undefined : sa,
    sn: sn === defaultSanctifyCap(season) ? undefined : sn,
    p: ["cc", "ch", "cr", "cp"].map((id) => $(id).value), f: num("floor"), n: Math.max(1, Math.round(+$("top").value || 1)),
    // most hand-overs to another class during the cube steps ("" = no limit), and the cost of each hand-over
    xn: $("xn").value.trim() === "" ? "" : String(Math.max(0, Math.round(+$("xn").value || 0))),
    xs: String(Math.max(0, +$("cs").value || 0)),   // an empty cost searches as 0, so the link says 0
    // most Convert Set Item steps per recipe ("" = no limit)
    cn: $("cn").value.trim() === "" ? "" : String(Math.max(0, Math.round(+$("cn").value || 0))),
  };
}

// A second copy of custom search's "Costs and Limits" panel for another page, built from the first so the two always offer the
// same boxes. Ids gain the prefix; every box starts at its default. Returns the <details> element.
export function clonePanel(prefix) {
  const panel = document.getElementById("cc").closest("details").cloneNode(true);
  for (const el of panel.querySelectorAll("[id]")) el.id = prefix + el.id;
  for (const el of panel.querySelectorAll("[for]")) el.htmlFor = prefix + el.getAttribute("for");
  for (const el of panel.querySelectorAll("[aria-describedby]")) el.setAttribute("aria-describedby", prefix + el.getAttribute("aria-describedby"));
  for (const el of panel.querySelectorAll("input")) el.value = el.defaultValue;
  return panel;
}

// ---------- how big a search the device may hold ----------
// Each search node takes about 145 bytes (3 million = 0.4 GB, 5 million = 0.7 GB, 10 million = 1.5 GB), and the clock does not bound memory.
// 3 million is the floor everyone gets. A device that reports 4 GB or more of memory (deviceMemory: Chrome and Edge only, rounded, capped
// at 8) gets more, unless it is a phone or tablet. A page killed during a search drops that device back to the floor for a week.
const CAP_FLOOR = 3_000_000;
export function capFor({ memoryGB, small, killed }) {
  if (killed || small || !memoryGB) return CAP_FLOOR;
  return memoryGB >= 8 ? 10_000_000 : memoryGB >= 4 ? 5_000_000 : CAP_FLOOR;
}
const RUN_KEY = "d3r-search-running", LOW_KEY = "d3r-cap-low", WEEK = 7 * 24 * 3600 * 1000;
const lowRecently = () => { try { return Date.now() - +localStorage.getItem(LOW_KEY) < WEEK; } catch (e) { return false; } };
export function nodeCap() {
  const nav = typeof navigator === "undefined" ? {} : navigator;
  const small = !!(nav.userAgentData && nav.userAgentData.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || "");
  return capFor({ memoryGB: nav.deviceMemory, small, killed: lowRecently() });
}
// A search in flight leaves a marker in this tab's session storage. A normal close or navigation clears it (pagehide); a tab the system
// killed does not get to, so the next load finds the marker and remembers that this device could not hold the search.
export function searchStarted() { try { sessionStorage.setItem(RUN_KEY, "1"); } catch (e) { /* ignore */ } }
export function searchEnded() { try { sessionStorage.removeItem(RUN_KEY); } catch (e) { /* ignore */ } }
try {
  if (sessionStorage.getItem(RUN_KEY)) { localStorage.setItem(LOW_KEY, String(Date.now())); sessionStorage.removeItem(RUN_KEY); }
  addEventListener("pagehide", searchEnded);
} catch (e) { /* no storage or no window: nothing to remember */ }