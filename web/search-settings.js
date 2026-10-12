import {isPct} from "./stats.js?v=440ee39fb2";
import { nodeCap } from "./ui.js?v=440ee39fb2";
import {DEFAULT_CONVERTS,mysticCanFinish,defaultSanctifyCap,DEFAULT_SANCTIFY_PRICE} from "./recipe.js?v=440ee39fb2";
export function baseQuery(req, item, season, hc) {
  // The planner works in whole numbers; hundredths keep ratios like 0.75 exact.
  const cost = (v) => Math.max(1, Math.round((+v || 0) * 100));
  const [cc, ch, cr, cp] = req.p;
  // Improve Legendary is limited by its price alone. Convert stays at 2 here (cheap and branching at every step, it widens the
  // search the most) until it gets a control of its own. set_roots: a set item's recipe may start from any piece of its set.
  return {
    class: req.c, slots: [item.slot], items: [item.id], season, hardcore: hc,
    // every class may take the item (`max_switch` hand-overs during the cube steps, any class at the Mystic)
    switch: [0, 1, 2, 3, 4, 5, 6].filter((c) => c !== req.c), max_switch: req.xn === "" ? 255 : Math.min(254, +req.xn || 0),
    cost_switch: Math.max(0, Math.round((+req.xs || 0) * 100)),
    // any class's Hope of Cain may create the item (each class has its own sequence; a class item lands from its own pool, verified in game,
    // LEDGER V104, V109-V110). Another class creating it counts as a hand-over, so "Most hero swaps" 0 turns this off.
    craft_any: true,
    node_cap: nodeCap(),
    eligible: true, n0: 0, maxpos: 4096, maxsteps: 1000, max_primalize: 255, max_convert: (req.cn ?? DEFAULT_CONVERTS) === "" ? 255 : Math.min(254, +(req.cn ?? DEFAULT_CONVERTS) || 0), set_roots: true,
    max_sanctify: (req.sn ?? defaultSanctifyCap(season)) === "" ? 255 : Math.min(254, Math.max(0, Math.round(+(req.sn ?? defaultSanctifyCap(season)) || 0))),
    cost_s: cost(req.sa ?? DEFAULT_SANCTIFY_PRICE),
    cost_h: cost(ch), cost_r: cost(cr), cost_p: cost(cp), cost_c: cost(cc), top: 4, min_frac: Math.min(1, req.f / 100),
    wants: req.w.map(([stem, m]) => {
      const min = m === "" ? null : (isPct(stem) ? +m / 100 : +m);
      return { fam: [stem], min: min !== null && !Number.isNaN(min) ? min : null };
    }),
    // "all wanted stats" is the target; routes one stat short come back separately (finish them at the Mystic)
    min_match: req.w.length,
    // the search is cheapest-first, so once a route lands every stat (or all but one, for the Mystic) nothing later is cheaper
    end_on_near: req.w.length >= 2,
  };
}

export function pickHits(key, r, snap, show) {
  const perfect = r.full.slice(0, show);
  let partial = [];
  if (snap.length >= 2) {
    const best = perfect.length ? perfect[0].cost : Infinity;
    const wantStems = new Set(snap);
    // only recipes whose item has a line the Mystic can swap out
    partial = r.near.filter((h) => h.cost < best && mysticCanFinish(h, snap.filter((_, i) => !h.matched.includes(i)), wantStems)).slice(0, 1);
  }
  return [...perfect, ...partial];
}