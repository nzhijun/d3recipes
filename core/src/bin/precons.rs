// Copyright 2026 FNG. Use, modification and redistribution are permitted under the conditions in LICENSE:
// credit the source, and visibly link to the site or repository if you use its outputs in a user-facing application.
//! Prepared builds ("precons") on the same engine as custom search: reads the resolved rows (class, item, required / forced / Mystic
//! stats per row) and writes the page's `premade_*.json`.
//!
//!     precons --resolved rows.json --out web/premade_sc.json [--hc] [--carry old.json] [--prices H,R,C,P] [--node-cap N]
//!             [--max-convert N] [--max-switch N] [--cost-switch N] [--no-craft-any] [--max-improve N] [--threads N] [--data web/data.json] [--no-mystic-check]
//!
//! A recipe ends on a natural primal carrying the row's required stats (a row naming exactly two stats and no third may carry one of
//! them), and the Mystic must be able to add the row's Mystic stat (or the missing one of the two) by replacing a line ranked below it
//! in the row's priorities, or not listed at all (never the weapon damage range). When no recipe allows that within `--mystic-budget`
//! nodes, the row ships without the Mystic step (`nomystic` names the stat that does not fit). Every limit is a setting; 255 for a
//! count means unlimited. Prices are whole numbers (default 100, 500, 75, 2500 = the page's 1 : 5 : 0.75 : 25 in hundredths).
//! `--staples DEF.json` generates the staples (class-agnostic items, each on the cheapest class: a natural primal, or an ancient or better
//! for `want = "ancient"`, any legendary for `want = "any"` (follower tokens), never Improve Legendary since it costs ashes) from their resolved definitions; `--salvage` generates the
//! cheapest natural primal per slot (any item, any class, no Improve Legendary). `--carry` copies whichever of the two is not generated.
use d3cube::data::Data;
use d3cube::plan::{Checkpoint, Hit, Query};
use d3cube::run_query;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

const CLASSES: [&str; 7] = ["DemonHunter", "Barbarian", "Wizard", "WitchDoctor", "Monk", "Crusader", "Necromancer"];
const MAIN_STEMS: [&str; 9] = ["Str", "Dex", "Int", "StrDex", "StrInt", "StrVit", "DexInt", "DexVit", "IntVit"];
const NO_MAGNITUDE: [&str; 2] = ["Sockets", "Indestructible"];
/// a stop-off ancient or legendary must roll each required stat at this fraction of its maximum (the player's definition)
const GOOD_ENOUGH: f64 = 0.80;

struct Opts {
    resolved: String,
    toml: String,
    dry_run: bool,
    out: String,
    data: String,
    carry: Option<String>,
    hc: bool,
    prices: [u64; 4],
    node_cap: usize,
    max_convert: u32,
    /// hero hand-overs allowed per route during the cube steps (255 = unlimited) and what one costs, in price units
    max_switch: u32,
    /// an item that several classes can make may be crafted by any of them; crafting as another class than the row's uses one swap
    craft_any: bool,
    cost_switch: u64,
    max_improve: u32,
    threads: usize,
    /// off: no Mystic rule (to compare with the old generator, which had none)
    mystic_check: bool,
    staples: Option<String>,
    salvage: bool,
}

fn opts() -> Opts {
    let mut o = Opts {
        resolved: String::new(),
        toml: String::new(),
        dry_run: false,
        out: String::new(),
        data: concat!(env!("CARGO_MANIFEST_DIR"), "/../web/data.json").to_string(),
        carry: None,
        hc: false,
        prices: [100, 500, 75, 2500],
        node_cap: 20_000_000,
        max_convert: 255,
        max_switch: 5,
        craft_any: true,
        cost_switch: 100,
        max_improve: 255,
        threads: std::thread::available_parallelism().map_or(4, |n| n.get()),
        mystic_check: true,
        staples: None,
        salvage: false,
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        let val = || args.get(i + 1).cloned().unwrap_or_else(|| panic!("{} needs a value", args[i]));
        match args[i].as_str() {
            "--hc" => {
                o.hc = true;
                i += 1;
                continue;
            }
            "--no-craft-any" => {
                o.craft_any = false;
                i += 1;
                continue;
            }
            "--salvage" => {
                o.salvage = true;
                i += 1;
                continue;
            }
            "--no-mystic-check" => {
                o.mystic_check = false;
                i += 1;
                continue;
            }
            "--dry-run" => {
                o.dry_run = true;
                i += 1;
                continue;
            }
            "--resolved" => o.resolved = val(),
            "--toml" => o.toml = val(),
            "--out" => o.out = val(),
            "--data" => o.data = val(),
            "--carry" => o.carry = Some(val()),
            "--prices" => {
                let v: Vec<u64> = val().split(',').map(|x| x.trim().parse().expect("--prices H,R,C,P")).collect();
                o.prices = [v[0], v[1], v[2], v[3]];
            }
            "--node-cap" => o.node_cap = val().parse().unwrap(),
            "--max-convert" => o.max_convert = val().parse().unwrap(),
            "--max-switch" => o.max_switch = val().parse().unwrap(),
            "--cost-switch" => o.cost_switch = val().parse().unwrap(),
            "--max-improve" => o.max_improve = val().parse().unwrap(),
            "--threads" => o.threads = val().parse().unwrap(),
            "--staples" => o.staples = Some(val()),
            a => panic!("unknown argument {a}"),
        }
        i += 2;
    }
    assert!(
        (!o.resolved.is_empty() || !o.toml.is_empty()) && !o.out.is_empty(),
        "usage: precons --toml builds.toml --out premade.json [--hc] [--dry-run] ... (or --resolved rows.json for a pre-resolved file)"
    );
    o
}

/// One search: a row's (class, item(s), stats); identical rows share it.
#[derive(Clone, PartialEq)]
struct Task {
    class: usize,
    slot: String,
    items: Vec<u32>,
    required: Vec<String>,
    min_match: usize,
    mystic: Option<String>,
    /// stats the Mystic must not replace: those ranked above the stat it adds (the wanted ones are never replaced anyway)
    keep: Vec<String>,
}

fn stems(v: &Value) -> Vec<String> {
    v.as_array().map_or(Vec::new(), |a| a.iter().map(|s| s["stem"].as_str().unwrap().to_string()).collect())
}

fn hex(s: &str) -> u32 {
    u32::from_str_radix(s, 16).unwrap()
}

fn task_of(row: &Value) -> Option<Task> {
    let class = CLASSES.iter().position(|c| Some(*c) == row["search_class"].as_str())?;
    let items: Vec<u32> = if row["any_item"] == true {
        row["any_eligible"].as_array()?.iter().map(|s| hex(s.as_str().unwrap())).collect()
    } else {
        vec![hex(row["item_id"].as_str()?)]
    };
    let required = stems(&row["required_stats"]);
    let mystic = row["mystic_stat"]["stem"].as_str().map(|s| s.to_string());
    // a row naming exactly two stats and no third: a primal with one of them is a hit, the Mystic adds the other
    let min_match = if required.len() == 2 && mystic.is_none() { 1 } else { required.len() };
    // the Mystic adds the row's Mystic stat (or, on a two-stat row, the lower-ranked of the two): lines ranked above it stay
    let pos = |v: &Value| v["pos"].as_i64().unwrap_or(99);
    let rank = if mystic.is_some() { pos(&row["mystic_stat"]) } else { row["required_stats"].as_array()?.iter().map(pos).max().unwrap_or(99) };
    let listed = row["required_stats"].as_array()?.iter().chain(row["forced_stats"].as_array().into_iter().flatten());
    let keep = listed.filter(|s| pos(s) < rank).map(|s| s["stem"].as_str().unwrap().to_string()).collect();
    Some(Task { class, slot: row["hero_slot"].as_str()?.to_string(), items, required, min_match, mystic, keep })
}

/// `mystic`: keep the Mystic step possible (the row's Mystic rule); without it, every wanted stat must roll.
fn query(t: &Task, o: &Opts, mystic: bool) -> Query {
    let min_match = if mystic { t.min_match } else { t.required.len() };
    // the smaller Mystic budget only where the Mystic has something to do (a row without a Mystic step gets the full budget)
    serde_json::from_value(json!({
        "class": t.class, "slots": [t.slot], "items": t.items, "set_roots": true, "season": 40, "hardcore": o.hc, "eligible": true,
        "maxsteps": 100000, "max_primalize": o.max_improve, "max_convert": o.max_convert, "node_cap": o.node_cap, "fallback": mystic,
        "switch": (0..CLASSES.len()).filter(|&c| c != t.class).collect::<Vec<_>>(), "max_switch": o.max_switch, "cost_switch": o.cost_switch, "craft_any": o.craft_any,
        "cost_h": o.prices[0], "cost_r": o.prices[1], "cost_c": o.prices[2], "cost_p": o.prices[3],
        "quality": "primal", "end_on_primalize": false, "top": 1, "trail": true,
        "wants": t.required.iter().map(|s| json!({"fam": [s]})).collect::<Vec<_>>(), "min_match": min_match,
        "mystic_finish": mystic, "mystic": if mystic { t.mystic.iter().collect::<Vec<_>>() } else { Vec::new() }, "keep": t.keep
    }))
    .unwrap()
}

fn r3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// [[stem, value, max]] without the item-power line.
fn tt(cp: &Checkpoint) -> Value {
    json!(cp.lines.iter().filter(|l| l.stem != "item power").map(|l| json!([l.stem, r3(l.value), r3(l.max)])).collect::<Vec<_>>())
}

/// What to stop on at this step: [name, quality, main stem, value].
fn marker(cp: &Checkpoint) -> Value {
    let lines: Vec<_> = cp.lines.iter().filter(|l| !["item power", "Sockets", "Indestructible"].contains(&l.stem.as_str())).collect();
    let main = lines.iter().find(|l| MAIN_STEMS.contains(&l.stem.as_str())).or(lines.first());
    match main {
        Some(l) => json!([cp.name, cp.quality, l.stem, r3(l.value)]),
        None => json!([cp.name, cp.quality, null, null]),
    }
}

fn good_enough(cp: &Checkpoint, required: &[String]) -> bool {
    required.iter().all(|s| {
        let best = cp.lines.iter().filter(|l| &l.stem == s).max_by(|a, b| a.value.total_cmp(&b.value));
        match best {
            None => false,
            Some(_) if NO_MAGNITUDE.contains(&s.as_str()) => true,
            Some(l) => l.max > 0.0 && l.value / l.max >= GOOD_ENOUGH,
        }
    })
}

/// The row as the page reads it (see the old export_premade.py: `cost` = steps, `w` = weighted cost).
/// `moved`: no recipe rolls every required stat, so the Mystic adds this one (the lowest-ranked required stat) instead.
fn row_out(row: &Value, task: Option<&Task>, hit: Option<&Hit>, dropped: bool, moved: Option<&String>, capped: bool) -> Value {
    let mut need: Vec<(i64, String)> = row["required_stats"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(row["forced_stats"].as_array().into_iter().flatten())
        .map(|s| (s["pos"].as_i64().unwrap_or(99), s["stem"].as_str().unwrap().to_string()))
        .collect();
    let mut mystic = row["mystic_stat"]["stem"].as_str().map(|s| s.to_string());
    let mut o = json!({
        "slot": row["slot"], "item": row["item"], "mystic": null, "cubed": row["cubed_tag"] == true,
        "alt": row["alternate"].as_u64().unwrap_or(0), "nalt": row["alternates_in_row"].as_u64().unwrap_or(1)
    });
    if row["any_item"] == true {
        o["any"] = json!(true);
    }
    let (Some(h), Some(t)) = (hit, task) else {
        need.sort_by_key(|n| n.0);
        o["need"] = json!(need.iter().map(|n| &n.1).collect::<Vec<_>>());
        o["mystic"] = json!(mystic);
        o["found"] = json!(false);
        return o;
    };
    if capped {
        // the search stopped on its node budget: this is the cheapest recipe found, not proven the cheapest
        o["capped"] = json!(true);
    }
    let last = h.trail.last().unwrap();
    let moved_task;
    let t = match moved {
        Some(m) => {
            moved_task = Task { required: t.required.iter().filter(|s| *s != m).cloned().collect(), ..t.clone() };
            need.retain(|n| &n.1 != m);
            // the Mystic can do one stat: a row that also had a Mystic stat loses it
            if let Some(old) = mystic.replace(m.clone()) {
                o["nomystic"] = json!(old);
            }
            &moved_task
        }
        None => t,
    };
    if dropped {
        // no recipe leaves room for the Mystic step: say which stat does not fit
        // (a two-stat row falls back to rolling both, so nothing is left for the Mystic there)
        o["nomystic"] = json!(mystic.take());
    }
    // one of two stats missing (min_match 1): the Mystic adds it
    if !dropped && moved.is_none() && t.min_match < t.required.len() {
        if let Some(gone) = t.required.iter().find(|s| !last.lines.iter().any(|l| &&l.stem == s)) {
            need.retain(|n| &n.1 != gone);
            mystic = Some(gone.clone());
        }
    }
    need.sort_by_key(|n| n.0);
    let path: String = h.route.iter().map(|&(op, n)| op.to_string().repeat(n as usize)).collect();
    let lin: Vec<Value> = h.trail.iter().map(marker).collect();
    // the hero (class index) doing each step of `path`, only when the route hands the item over at all
    let who: Vec<usize> = h.route.iter().zip(&h.route_class).flat_map(|(&(_, n), &c)| std::iter::repeat(c).take(n as usize)).collect();
    let holder = who.last().copied().unwrap_or(h.craft_class);
    let handed = h.craft_class != t.class || who.iter().any(|&c| c != t.class) || (mystic.is_some() && h.mystic_class != holder);
    o["need"] = json!(need.iter().map(|n| &n.1).collect::<Vec<_>>());
    o["mystic"] = json!(mystic);
    if row["any_item"] == true {
        o["item"] = json!(h.name);
    }
    let mut cheap = Vec::new();
    for want in ["normal", "ancient"] {
        let at = h.trail[..h.trail.len() - 1].iter().position(|cp| {
            cp.name == h.name && cp.quality == want && t.required.iter().all(|s| cp.lines.iter().any(|l| &l.stem == s)) && good_enough(cp, &t.required)
        });
        if let Some(k) = at {
            cheap.push(json!({"q": want, "steps": h.hope as usize + k, "path": &path[..k], "who": if handed { json!(&who[..k]) } else { Value::Null }, "lin": &lin[..=k], "tt": tt(&h.trail[k])}));
        }
    }
    o["found"] = json!(true);
    o["cost"] = json!(h.steps);
    o["w"] = json!(h.cost);
    o["n"] = json!(h.hope);
    o["rs"] = json!(h.slot);
    o["path"] = json!(path);
    if handed {
        o["who"] = json!(who);
        o["by"] = json!(t.class);
        o["craft"] = json!(h.craft_class);
        o["mystic_by"] = json!(h.mystic_class);
    }
    o["q"] = json!(h.quality);
    o["seed"] = json!(format!("{:08x}", h.seed));
    o["tt"] = tt(last);
    o["lin"] = json!(lin);
    if !cheap.is_empty() {
        o["cheap"] = json!(cheap);
    }
    o
}

/// Runs `f` over `jobs` on `threads` threads, each with its own copy of the data; results in job order.
fn par<T: Sync, R: Send>(threads: usize, data_json: &str, jobs: &[T], f: impl Fn(&Rc<Data>, &T) -> R + Sync) -> Vec<R> {
    let next = AtomicUsize::new(0);
    let out: Mutex<Vec<(usize, R)>> = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| {
                let d = Rc::new(Data::from_json(data_json).unwrap());
                loop {
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    if i >= jobs.len() {
                        break;
                    }
                    let r = f(&d, &jobs[i]);
                    out.lock().unwrap().push((i, r));
                }
            });
        }
    });
    let mut v = out.into_inner().unwrap();
    v.sort_by_key(|x| x.0);
    v.into_iter().map(|x| x.1).collect()
}

/// One staple or salvage search: a natural primal (or ancient or better) with `required`, no Improve Legendary.
fn simple_query(class: usize, slot: &str, items: &[u32], required: &[String], ancient: bool, o: &Opts) -> Query {
    serde_json::from_value(json!({
        "class": class, "slots": [slot], "items": items, "set_roots": true, "season": 40, "hardcore": o.hc, "eligible": true,
        "maxsteps": 100000, "max_primalize": 0, "max_convert": o.max_convert, "node_cap": o.node_cap.min(3_000_000),
        // cube steps may be handed to other heroes; no `craft_any`, since every creating class is searched anyway and the cheapest kept
        "switch": (0..CLASSES.len()).filter(|&c| c != class).collect::<Vec<_>>(), "max_switch": o.max_switch, "cost_switch": o.cost_switch,
        "cost_h": o.prices[0], "cost_r": o.prices[1], "cost_c": o.prices[2], "cost_p": o.prices[3],
        "quality": if ancient { "ancient+" } else { "primal" }, "min_frac": if ancient { GOOD_ENOUGH } else { 0.0 }, "top": 1, "trail": true,
        "wants": required.iter().map(|s| json!({"fam": [s]})).collect::<Vec<_>>(), "min_match": required.len()
    }))
    .unwrap()
}

/// A staple or salvage row in the page's format (no stop-offs).
fn simple_row(slot: &str, item: &str, required: &[String], hit: &Hit) -> Value {
    let row = json!({
        "slot": slot, "item": item, "cubed_tag": false, "alternate": 0, "alternates_in_row": 1, "forced_stats": [], "mystic_stat": null,
        "required_stats": required.iter().enumerate().map(|(i, s)| json!({"stem": s, "pos": i})).collect::<Vec<_>>()
    });
    let t = Task { class: hit.craft_class, slot: slot.to_string(), items: vec![], required: required.to_vec(), min_match: required.len(), mystic: None, keep: vec![] };
    let mut o = row_out(&row, Some(&t), Some(hit), false, None, false);
    if let Some(m) = o.as_object_mut() {
        m.remove("cheap");
    }
    o["item"] = json!(hit.name);
    o
}

fn slug(title: &str) -> String {
    let mut s = String::new();
    for c in title.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            s.push(c);
        } else if !s.ends_with('-') {
            s.push('-');
        }
    }
    s.trim_matches('-').to_string()
}

fn main() {
    let o = opts();
    let t0 = Instant::now();
    let data_json = std::fs::read_to_string(&o.data).expect("--data");
    let doc: Value = if !o.toml.is_empty() {
        let toml_text = std::fs::read_to_string(&o.toml).expect("--toml");
        let d = Rc::new(Data::from_json(&data_json).unwrap());
        d3cube::resolve::resolve_builds(&toml_text, d, o.hc)
    } else {
        serde_json::from_str(&std::fs::read_to_string(&o.resolved).expect("--resolved")).unwrap()
    };
    if o.dry_run {
        std::fs::write(&o.out, serde_json::to_string_pretty(&doc).unwrap()).expect("--out");
        eprintln!("(dry run) wrote {}", o.out);
        return;
    }

    // distinct searches
    let mut tasks: Vec<Task> = Vec::new();
    for b in doc["builds"].as_array().unwrap() {
        for r in b["rows"].as_array().unwrap() {
            if let Some(t) = task_of(r) {
                if !tasks.contains(&t) {
                    tasks.push(t);
                }
            }
        }
    }
    // the slowest searches first, roughly: set items (many roots) before the rest
    let next = AtomicUsize::new(0);
    let results: Mutex<HashMap<usize, (Option<Hit>, u64, bool, bool, Option<String>)>> = Mutex::new(HashMap::new());
    eprintln!("{} rows -> {} distinct searches on {} threads", doc["builds"].as_array().unwrap().iter().map(|b| b["rows"].as_array().unwrap().len()).sum::<usize>(), tasks.len(), o.threads);
    std::thread::scope(|s| {
        for _ in 0..o.threads {
            s.spawn(|| {
                let d = Rc::new(Data::from_json(&data_json).unwrap());
                loop {
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    if i >= tasks.len() {
                        break;
                    }
                    let t1 = Instant::now();
                    let t = &tasks[i];
                    let mut r = run_query(d.clone(), query(t, &o, o.mystic_check), 200_000);
                    let mut nodes = r.status.nodes;
                    // which search stopped on the node budget: the main one, or the one that moves the lowest-ranked stat to the Mystic
                    let mut capped_in: Vec<&str> = if r.status.capped { vec!["main search"] } else { vec![] };
                    let mut dropped = false;
                    // nothing leaves room for the Mystic step: the cheapest recipe with every wanted stat and no Mystic step, which the same
                    // search met on the way (`Query::fallback`), so the whole budget went to the search for a recipe the Mystic can finish
                    if r.full.is_empty() && o.mystic_check && (t.mystic.is_some() || t.min_match < t.required.len()) {
                        if let Some(fb) = r.fallback.take() {
                            r.full = vec![fb];
                        }
                        dropped = true;
                    }
                    // no recipe rolls every required stat (e.g. the item's only free primary is taken by the forced socket): the Mystic adds
                    // the lowest-ranked required stat instead, the same rule as a row naming two stats and no third
                    let mut moved = None;
                    if r.full.is_empty() && o.mystic_check && !t.required.is_empty() {
                        let m = t.required.last().unwrap().clone();
                        let t2 = Task { required: t.required[..t.required.len() - 1].to_vec(), min_match: t.required.len() - 1, mystic: Some(m.clone()), ..t.clone() };
                        r = run_query(d.clone(), query(&t2, &o, true), 200_000);
                        nodes += r.status.nodes;
                        if r.status.capped {
                            capped_in.push("search moving a stat to the Mystic");
                        }
                        if !r.full.is_empty() {
                            (moved, dropped) = (Some(m), false);
                        }
                    }
                    let capped = !capped_in.is_empty();
                    let hit = r.full.into_iter().next();
                    eprintln!(
                        "  [{i}] {} {:?}: {}{}{} ({} nodes, {:.1}s)",
                        CLASSES[t.class],
                        t.required,
                        hit.as_ref().map_or("NOT FOUND".to_string(), |h| format!("{} cost {}", h.name, h.cost)),
                        if dropped { " (no Mystic step)".to_string() } else if let Some(m) = &moved { format!(" (the Mystic adds {m})") } else { String::new() },
                        if capped { format!(" [HIT NODE BUDGET in the {}: not proven cheapest]", capped_in.join(" and the ")) } else { String::new() },
                        nodes,
                        t1.elapsed().as_secs_f64()
                    );
                    results.lock().unwrap().insert(i, (hit, nodes, capped, dropped, moved));
                }
            });
        }
    });
    let results = results.into_inner().unwrap();

    let carry: Value = o.carry.as_ref().map_or(json!({}), |p| serde_json::from_str(&std::fs::read_to_string(p).expect("--carry")).unwrap());
    let mut builds = Vec::new();
    let (mut rows, mut found) = (0, 0);
    for b in doc["builds"].as_array().unwrap() {
        if b["class"].is_null() {
            continue;
        }
        let mut out_rows = Vec::new();
        for r in b["rows"].as_array().unwrap() {
            if r["item"].is_null() {
                continue;
            }
            let task = task_of(r);
            let res = task.as_ref().and_then(|t| tasks.iter().position(|x| x == t)).map(|i| &results[&i]);
            let hit = res.and_then(|x| x.0.as_ref());
            rows += 1;
            found += hit.is_some() as usize;
            out_rows.push(row_out(r, task.as_ref(), hit, res.map_or(false, |x| x.3), res.and_then(|x| x.4.as_ref()), res.map_or(false, |x| x.2)));
        }
        builds.push(json!({"id": slug(b["title"].as_str().unwrap()), "title": b["title"], "class": b["class"], "rows": out_rows}));
    }
    // staple and salvage searches (one per class each) that stopped on the node budget
    let simple_capped = AtomicUsize::new(0);
    let simple_run = |d: &Rc<Data>, q: Query| {
        let r = run_query(d.clone(), q, 200_000);
        if r.status.capped {
            simple_capped.fetch_add(1, Ordering::SeqCst);
        }
        r.full.into_iter().next()
    };
    // staples: each definition on every class, the cheapest class wins (ties: class name)
    let staples = match &o.staples {
        None => carry.get("staples").cloned().unwrap_or(json!([])),
        Some(p) => {
            let defs: Value = serde_json::from_str(&std::fs::read_to_string(p).expect("--staples")).unwrap();
            let defs: Vec<Value> = defs["staples"].as_array().unwrap().clone();
            let jobs: Vec<(usize, usize)> = (0..defs.len()).flat_map(|k| (0..7).map(move |c| (k, c))).collect();
            let hits = par(o.threads, &data_json, &jobs, |d, &(k, c)| {
                let st = &defs[k];
                let req = stems(&st["required_stats"]);
                let mut q = simple_query(c, st["hero_slot"].as_str().unwrap(), &[hex(st["item_id"].as_str().unwrap())], &req, st["want"] == "ancient", &o);
                if st["want"] == "any" {
                    // any legendary of the item will do (follower tokens): no ancient or primal bar
                    q.quality = "any".into();
                    q.min_frac = 0.0;
                }
                simple_run(d, q)
            });
            let mut out = Vec::new();
            for (k, st) in defs.iter().enumerate() {
                let req = stems(&st["required_stats"]);
                let best = (0..7).filter_map(|c| hits[k * 7 + c].as_ref().map(|h| (h.cost, CLASSES[c], h))).min_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
                let tier = best.map(|(_, c, h)| json!({"class": c, "row": simple_row(st["hero_slot"].as_str().unwrap(), st["item"].as_str().unwrap(), &req, h)}));
                eprintln!("  staple {}: {}", st["item"], best.map_or("NOT FOUND".to_string(), |(w, c, h)| format!("{c} cost {w} ({} steps)", h.steps)));
                out.push(json!({"item": st["item"], "note": st["note"], "want": st["want"], "label": st["label"], "tier": tier}));
            }
            json!(out)
        }
    };
    // salvage: per slot, the cheapest natural primal of any item on any class, cheapest slot first
    let salvage = if !o.salvage {
        carry.get("salvage").cloned().unwrap_or(json!([]))
    } else {
        let d0 = Data::from_json(&data_json).unwrap();
        // every slot, the follower tokens too: they roll natural primals like any item (a hardcore Scoundrel Token on cast 9, seen in game)
        let slots: Vec<String> = d0.slots.iter().map(|s| s.name.clone()).collect();
        let jobs: Vec<(usize, usize)> = (0..slots.len()).flat_map(|k| (0..7).map(move |c| (k, c))).collect();
        let hits = par(o.threads, &data_json, &jobs, |d, &(k, c)| {
            if d.slots[k].pools[c].is_empty() {
                return None;
            }
            simple_run(d, simple_query(c, &slots[k], &[], &[], false, &o))
        });
        let mut out: Vec<(u64, String, Value)> = Vec::new();
        for (k, slot) in slots.iter().enumerate() {
            // a follower token costs the same on every class, but the engine rolls its stats from the crafting class: pick the class
            // whose main stat is the follower's (Templar Strength, Enchantress Intelligence, Scoundrel Dexterity), so the card names the right stat
            let only = match slot.as_str() {
                "TemplarRelic" => Some(5),
                "EnchantressFocus" => Some(2),
                "ScoundrelToken" => Some(0),
                _ => None,
            };
            let best = (0..7).filter(|&c| only.map_or(true, |o| o == c)).filter_map(|c| hits[k * 7 + c].as_ref().map(|h| (h.cost, CLASSES[c], h))).min_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
            if let Some((w, c, h)) = best {
                out.push((w, slot.clone(), json!({"slot": slot, "class": c, "row": simple_row(slot, &h.name, &[], h)})));
            }
        }
        out.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
        eprintln!("  salvage: {} slots", out.len());
        json!(out.into_iter().map(|x| x.2).collect::<Vec<_>>())
    };
    let out = json!({"season": 40, "hardcore": o.hc, "builds": builds, "staples": staples, "salvage": salvage});
    std::fs::write(&o.out, serde_json::to_string(&out).unwrap()).expect("--out");
    let capped = results.values().filter(|r| r.2).count();
    let dropped = results.values().filter(|r| r.3).count();
    let nodes: u64 = results.values().map(|r| r.1).sum();
    eprintln!(
        "wrote {}: {found}/{rows} rows found, {dropped} searches without a Mystic step, {capped} row searches hit the node budget (marked \"capped\" in the output), \
         {} staple/salvage searches hit it, {nodes} nodes, {:.1}s",
        o.out,
        simple_capped.load(Ordering::SeqCst),
        t0.elapsed().as_secs_f64()
    );
}
