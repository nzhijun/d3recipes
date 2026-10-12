// Copyright 2026 FNG. Use, modification and redistribution are permitted under the conditions in LICENSE:
// credit the source, and visibly link to the site or repository if you use its outputs in a user-facing application.
//! Resolve `builds.toml` into the row-level JSON `bin/precons.rs` consumes via `--resolved` (or now directly via
//! `--toml`): every row's item name, its free-text stat priorities mapped onto real rollable stat families, its
//! "forced" (always-present) stats, and `any_item` rows expanded into eligible candidates. Port of the Python
//! resolution phase in `tools/webapp/build_premade_list.py` (its `PREMADE_DRY_RUN=1` output) plus
//! `tools/webapp/builds_toml.py` and `tools/webapp/resolve_build_items.py` -- see those for the original prose;
//! this is a straight behavioral port, not a new model, so the bar is matching their output exactly.
use crate::data::{Data, Item, U};
use crate::sim::Sim;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

/// slot names a `[[build.slot]]` may use -> the one game-data slot pool an `any_item` row of that name draws from.
fn any_slot(toml_slot: &str) -> Option<&'static str> {
    Some(match toml_slot {
        "Helm" => "Helm",
        "Shoulders" => "Shoulders",
        "Bracers" => "Bracers",
        "Gloves" => "Gloves",
        "Boots" => "Boots",
        "Pants" => "Legs",
        "Chest" => "Chest",
        "Belt" => "Belt",
        "Cloak" => "Cloak",
        "Amulet" => "Amulet",
        "Ring 1" | "Ring 2" | "Ring" => "Ring",
        "Mojo" => "Mojo",
        "Source" => "Orb",
        "Quiver" => "Quiver",
        "Phylactery" => "Phylactery",
        "Voodoo Mask" => "VoodooMask",
        "Spirit Stone" => "SpiritStone_Monk",
        "Wizard Hat" => "WizardHat",
        "Mighty Belt" => "MightyBelt",
        _ => return None,
    })
}

// ---------------------------------------------------------------------------
// builds.toml -> typed doc (loud: unknown keys are a hard error, same as builds_toml.py's deliberate strictness)

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct GeneralToml {
    #[allow(dead_code)]
    item: String,
    #[serde(default)]
    #[allow(dead_code)]
    note: String,
    #[serde(default)]
    #[allow(dead_code)]
    want: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    label: String,
    #[serde(default)]
    #[allow(dead_code)]
    stat_priority: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SlotToml {
    name: String,
    #[serde(default)]
    items: Vec<String>,
    #[serde(default)]
    stat_priority: Vec<String>,
    #[serde(default)]
    notes: Vec<String>,
    #[serde(default)]
    any_item: bool,
    #[serde(default = "default_true")]
    sets: bool,
}
fn default_true() -> bool {
    true
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct BuildToml {
    name: String,
    #[serde(default)]
    class: Option<String>,
    #[serde(default, rename = "slot")]
    slots: Vec<SlotToml>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct DocToml {
    #[serde(default)]
    #[allow(dead_code)]
    general: Vec<GeneralToml>,
    #[serde(default, rename = "build")]
    builds: Vec<BuildToml>,
}

// ---------------------------------------------------------------------------
// item-name resolution (port of resolve_build_items.py)

/// hardcoded shorthand used by builds.toml that won't match any real item name as-is.
fn name_alias(n: &str) -> Option<&'static str> {
    Some(match n {
        "coe" => "convention of elements",
        "squirts" => "squirts necklace",
        _ => return None,
    })
}

/// Strip a trailing "(Cubed)"/"(Crafted)"/"(...Bounties...)" parenthetical and surrounding whitespace.
fn strip_tags(name: &str) -> String {
    let lower = name.to_lowercase();
    for tag in ["(cubed)", "(crafted)"] {
        if let Some(pos) = lower.rfind(tag) {
            if lower[pos + tag.len()..].trim().is_empty() {
                return name[..pos].trim_end().to_string();
            }
        }
    }
    if let Some(open) = lower.rfind('(') {
        if lower.trim_end().ends_with(')') && lower[open..].contains("bounties") {
            return name[..open].trim_end().to_string();
        }
    }
    name.trim().to_string()
}

fn normalize(name: &str) -> String {
    let stripped = strip_tags(name);
    let mut n = stripped.trim().to_lowercase();
    if let Some(rest) = n.strip_prefix("the") {
        if rest.starts_with(char::is_whitespace) {
            n = rest.trim_start().to_string();
        }
    }
    let n: String = n.chars().filter(|&c| c != '\'' && c != '\u{2019}').collect();
    let n = n.split_whitespace().collect::<Vec<_>>().join(" ");
    name_alias(&n).map(str::to_string).unwrap_or(n)
}

enum Scope {
    Ok { idx: usize, cubed_tag: bool },
    Crafted,
    Bounty,
    Ambiguous,
    Miss,
}

fn resolve_raw(raw: &str, by_norm: &HashMap<String, Vec<usize>>) -> Scope {
    let lower = raw.to_lowercase();
    if lower.contains("(crafted)") {
        return Scope::Crafted;
    }
    if lower.contains('(') && lower.contains(')') && lower.contains("bounties") {
        return Scope::Bounty;
    }
    match by_norm.get(&normalize(raw)) {
        Some(v) if v.len() == 1 => Scope::Ok { idx: v[0], cubed_tag: lower.contains("(cubed)") },
        Some(_) => Scope::Ambiguous,
        None => Scope::Miss,
    }
}

// ---------------------------------------------------------------------------
// stat-name display text (port of build_premade_list.py's STATS / camel / stat_name)

fn stats_display(stem: &str) -> Option<&'static str> {
    Some(match stem {
        "ArcaneD" => "Arcane Damage (weapon)", "ArcanePowerOnCrit" => "Arcane Power on Critical Hit", "ArcaneResist" => "Arcane Resistance",
        "Bleed" => "Chance to Bleed", "BleedPercent" => "Bleed Damage", "Block" => "Chance to Block",
        "CCReduction" => "Crowd Control Reduction", "ColdD" => "Cold Damage (weapon)", "ColdResist" => "Cold Resistance",
        "CooldownReduction" => "Cooldown Reduction", "CriticalChance" => "Critical Hit Chance", "CriticalD" => "Critical Hit Damage",
        "CrushingBlow" => "Chance for Crushing Blow", "DR" => "Armor (bonus)", "DamReductionVsElite" => "Damage Reduction from Elites",
        "Damage" => "Damage", "DamageBonusArcane" => "Arcane Skill Damage", "DamageBonusCold" => "Cold Skill Damage",
        "DamageBonusFire" => "Fire Skill Damage", "DamageBonusHoly" => "Holy Skill Damage", "DamageBonusLightning" => "Lightning Skill Damage",
        "DamageBonusPhysical" => "Physical Skill Damage", "DamageBonusPoison" => "Poison Skill Damage", "DamageVsElite" => "Damage Against Elites",
        "DefenseMelee" => "Melee Damage Reduction", "DefenseMissile" => "Ranged Damage Reduction", "Dex" => "Dexterity",
        "DexInt" => "Dexterity and Intelligence", "DexVit" => "Dexterity and Vitality", "Experience" => "Bonus Experience per Kill",
        "FireD" => "Fire Damage (weapon)", "FireResist" => "Fire Resistance", "Gold" => "Gold Find",
        "GoldPickUpRadius" => "Gold Pickup Radius", "Haste" => "Attack Speed", "HatredRegen" => "Hatred Regeneration",
        "HealthGlobeBonus" => "Health Globe Healing Bonus", "HealthGlobeChance" => "Chance to Drop Health Globe",
        "HitBlind" => "Chance to Blind on Hit", "HitChill" => "Chance to Chill on Hit", "HitFear" => "Chance to Fear on Hit",
        "HitFreeze" => "Chance to Freeze on Hit", "HitImmobilize" => "Chance to Immobilize on Hit", "HitKnockback" => "Chance to Knockback on Hit",
        "HitLife" => "Life per Hit", "HitMana" => "Mana per Hit", "HitSlow" => "Chance to Slow on Hit", "HitStun" => "Chance to Stun on Hit",
        "HolyD" => "Holy Damage (weapon)", "Indestructible" => "Indestructible", "Int" => "Intelligence",
        "IntVit" => "Intelligence and Vitality", "KillLife" => "Life after Each Kill", "KillMana" => "Mana after Each Kill",
        "Life" => "Maximum Life", "LifeS" => "Life per Second", "LightningD" => "Lightning Damage (weapon)",
        "LightningResist" => "Lightning Resistance", "MF" => "Magic Find", "ManaRegen" => "Mana Regeneration",
        "MaxArcanePower" => "Maximum Arcane Power", "MaxDiscipline" => "Maximum Discipline", "MaxEssence" => "Maximum Essence",
        "MaxFury" => "Maximum Fury", "MaxMana" => "Maximum Mana", "MaxSpirit" => "Maximum Spirit", "MaxWrath" => "Maximum Wrath",
        "MinMaxDam" => "Damage Range", "PhysicalResist" => "Physical Resistance", "PoisonD" => "Poison Damage (weapon)",
        "PoisonResist" => "Poison Resistance", "REQ" => "Level Requirement Reduction", "Regen" => "Life Regeneration",
        "ResistAll" => "All Resistance", "ResistFreeze" => "Freeze Duration Reduction", "ResistRoot" => "Immobilize Duration Reduction",
        "ResistStun" => "Stun Duration Reduction", "ResistStunRootFreeze" => "Stun/Immobilize/Freeze Duration Reduction",
        "ResourceCostReduction" => "Resource Cost Reduction", "Run" => "Movement Speed", "SpiritHeals" => "Life per Spirit Spent",
        "SpiritRegen" => "Spirit Regeneration", "SplashDamage" => "Area Damage", "Str" => "Strength", "StrDex" => "Strength and Dexterity",
        "StrInt" => "Strength and Intelligence", "StrVit" => "Strength and Vitality", "Thorns" => "Thorns", "Vit" => "Vitality",
        "WrathHeals" => "Life per Wrath Spent", "WrathRegen" => "Wrath Regeneration", "FuryHeals" => "Life per Fury Spent",
        "Sockets" => "Socket", "item power" => "Legendary power",
        _ => return None,
    })
}

/// "ArcanePowerOnCrit" -> "Arcane Power On Crit" (port of build_premade_list.py's camel()).
fn camel(s: &str) -> String {
    let s = s.replace('_', " ");
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    for i in 0..chars.len() {
        out.push(chars[i]);
        if i + 1 < chars.len() {
            let (c0, c1) = (chars[i], chars[i + 1]);
            if (c0.is_ascii_lowercase() || c0.is_ascii_digit()) && c1.is_ascii_uppercase() {
                out.push(' ');
            }
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn stat_name(stem: &str) -> String {
    if let Some(v) = stats_display(stem) {
        return v.to_string();
    }
    if let Some(rest) = stem.strip_prefix("Skill_") {
        if let Some((_cls, skill)) = rest.split_once('_') {
            return format!("{} damage", camel(skill));
        }
    }
    if let Some(rest) = stem.strip_prefix("Ethereal_") {
        if let Some((power, skill)) = rest.split_once('_') {
            return format!("{} ({} passive)", camel(skill), camel(power));
        }
    }
    camel(stem)
}

// ---------------------------------------------------------------------------
// free-text stat matching (port of build_premade_list.py's match_stat and helpers)

fn norm_free_text(s: &str) -> String {
    let lower = s.to_lowercase().replace("(secondary)", "").replace("(soj)", "");
    lower.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn nospace(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}

const ELEMENTS: [&str; 7] = ["fire", "cold", "lightning", "poison", "arcane", "holy", "physical"];

/// freetext (one of builds.toml's numbered stat-priority strings) -> (stem, None) or (None, why-not).
fn match_stat(freetext: &str, candidate_stems: &HashSet<String>) -> (Option<String>, Option<String>) {
    let text = norm_free_text(freetext);
    if text.contains("ramaladni") {
        return (None, Some("Ramaladni's Gift adds a socket via crafting, not a roll -- never a search target".to_string()));
    }
    if let Some(alias) = match text.as_str() {
        "life %" => Some("Life"),
        "elite damage" => Some("DamageVsElite"),
        "elite damage reduction" => Some("DamReductionVsElite"),
        // the page's names for the ring/amulet damage range (MinMaxDam) and bonus Armor (DR); a weapon rolls neither as an affix, so
        // a weapon's "Damage Range" stays unresolved ("aliased ..., but not rollable on this item"), as DECISIONS says
        "damage range" => Some("MinMaxDam"),
        "armor" => Some("DR"),
        _ => None,
    } {
        return if candidate_stems.contains(alias) {
            (Some(alias.to_string()), None)
        } else {
            (None, Some(format!("aliased to {alias}, but not rollable on this item")))
        };
    }
    // builds.toml's fan-community skill name for a real affix family spelled differently in the dumped data
    if text.contains("death nova") {
        if let Some(hit) = candidate_stems.iter().find(|s| s.starts_with("Skill_") && nospace(s).contains("bloodnova")) {
            return (Some(hit.clone()), None);
        }
    }
    let mut hits: Vec<&String> = candidate_stems
        .iter()
        .filter(|stem| {
            let name = stat_name(stem).to_lowercase();
            text.contains(&name) || name.contains(&text)
        })
        .collect();
    if hits.is_empty() {
        let nt = nospace(&text);
        hits = candidate_stems
            .iter()
            .filter(|stem| {
                let nn = nospace(&stat_name(stem));
                nt.contains(&nn) || nn.contains(&nt)
            })
            .collect();
    }
    if hits.is_empty() {
        for elem in ELEMENTS {
            if text.starts_with(&format!("{elem} damage")) {
                let bonus = format!("DamageBonus{}{}", &elem[..1].to_uppercase(), &elem[1..]);
                if candidate_stems.contains(&bonus) {
                    return (Some(bonus), None);
                }
            }
        }
        return (None, Some(format!("no rollable stat on this item matched {freetext:?}")));
    }
    if hits.len() > 1 {
        // several stats contain the words ("Area Damage" is inside "Damage" and is SplashDamage's own name): the one named exactly so wins
        let exact: Vec<&String> = hits.iter().copied().filter(|stem| stat_name(stem).to_lowercase() == text).collect();
        if exact.len() == 1 {
            return (Some(exact[0].clone()), None);
        }
        hits.sort();
        return (None, Some(format!("ambiguous: {freetext:?} matched {hits:?}")));
    }
    (Some(hits[0].clone()), None)
}

// ---------------------------------------------------------------------------
// candidate stems, "forced" (always-present) stems, and stems_compatible (ports of the same-named
// build_premade_list.py functions, built on the already-verified Sim primitives instead of re-deriving them)

fn want(d: &Data, item: &Item, ai: usize, out: &mut HashSet<String>) {
    let a = &d.affixes[ai];
    let socket = a.socket && !item.weapon;
    if (!a.specs.is_empty() || socket) && !a.stem.is_empty() {
        out.insert(a.stem.clone());
    }
}

/// Every affix a fixed slot group could actually resolve to on a real roll: replays `Sim::resolve_slot`'s own
/// 3-tier escalation (strict type match, then wildcard-type, then class+weight only, ignoring type) -- the
/// SAME function real Reforge/Hope of Cain draws use, not a separate approximation of it -- and returns every
/// member tied at the tier that first has any (not just the one a real roll would randomly land on). Deliberately
/// does not reuse `candidate_affixes` here: that one skips this escalation (wild=true unconditionally) and also
/// skips the primary/secondary/flex pick-count gating below, which makes it a looser "what might ever be
/// achievable" list for the live stat picker, not the strict "what this exact item can actually resolve to" this
/// resolver needs (cf. `Sim::candidate_affixes` in sim.rs).
fn fixed_group_stems(sim: &Sim, item: &Item, gid: u32) -> Vec<usize> {
    let Some(members) = sim.d.group_members.get(&gid) else { return Vec::new() };
    for wild_tier in 0..3u8 {
        let mut best: Option<u32> = None;
        let mut tied: Vec<usize> = Vec::new();
        for &ai in members {
            let a = &sim.d.affixes[ai];
            if !(a.g7c == gid || a.g80 == gid) {
                continue;
            }
            let ok = if wild_tier == 2 {
                !((a.cls != U && a.cls as usize != sim.cls) || a.weight[sim.cls] < 1)
            } else {
                sim.eligible_base(item, ai, true, true, wild_tier == 1)
            };
            if !ok || a.tier > sim.ilvl {
                continue;
            }
            match best {
                Some(b) if a.tier < b => {}
                Some(b) if a.tier == b => tied.push(ai),
                _ => {
                    best = Some(a.tier);
                    tied.clear();
                    tied.push(ai);
                }
            }
        }
        if !tied.is_empty() {
            return tied;
        }
    }
    Vec::new()
}

/// Every stat family this item can actually resolve to: its fixed-slot groups (via `fixed_group_stems` above)
/// plus every primary/secondary/flex affix its own pick counts make reachable at all (gated the same way
/// `Sim::picks` gates them: a kind with zero picks on this item contributes nothing).
fn candidate_stems(sim: &mut Sim, item_idx: usize) -> HashSet<String> {
    let d = sim.d.clone();
    let item = &d.items[item_idx];
    sim.set_class(item);
    let mut out = HashSet::new();
    for &gid in item.fixed.iter().filter(|&&g| g != U) {
        for ai in fixed_group_stems(sim, item, gid) {
            want(&d, item, ai, &mut out);
        }
    }
    let (na, nb, nc) = (item.na, item.nb, item.nc);
    for kind_opt in [Some(0u32), Some(1u32), None] {
        match kind_opt {
            Some(0) if na == 0 => continue,
            Some(1) if nb == 0 => continue,
            None if nc == 0 => continue,
            _ => {}
        }
        for ai in 0..d.affixes.len() {
            if let Some(k) = kind_opt {
                if d.affixes[ai].kind != k {
                    continue;
                }
            }
            if sim.eligible_base(item, ai, false, false, false) {
                want(&d, item, ai, &mut out);
            }
        }
    }
    out
}

fn splitmix64(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9E3779B97F4A7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

/// Stems present on EVERY roll of this item (fixed affixes): sample enough rolls with varying chain state and
/// intersect. Doesn't need to match Python's RNG bit-for-bit -- a fixed affix is deterministic-present regardless
/// of seed, so any well-mixed sequence of x0 values finds the same answer.
fn always_stems(sim: &mut Sim, item_idx: usize) -> HashSet<String> {
    let mut state = splitmix64(item_idx as u64 ^ 0xA5A5_A5A5_A5A5_A5A5);
    let mut common: Option<HashSet<String>> = None;
    for _ in 0..400 {
        state = splitmix64(state);
        let d = sim.d.clone();
        let stems: HashSet<String> = sim.drop_item(item_idx, state, false, false).into_iter().map(|ai| d.affixes[ai].stem.clone()).collect();
        common = Some(match common {
            None => stems,
            Some(c) => c.intersection(&stems).cloned().collect(),
        });
        if common.as_ref().unwrap().is_empty() {
            break;
        }
    }
    common.unwrap_or_default()
}

#[derive(PartialEq, Eq, Hash, Clone, Copy)]
enum Resource {
    Fixed(u32),
    Kind(u32),
}

fn stem_resources(sim: &mut Sim, item_idx: usize, stem: &str) -> HashSet<Resource> {
    let d = sim.d.clone();
    let item = &d.items[item_idx];
    sim.set_class(item);
    let mut out = HashSet::new();
    for &gid in item.fixed.iter().filter(|&&g| g != U) {
        for ai in fixed_group_stems(sim, item, gid) {
            if d.affixes[ai].stem == stem {
                out.insert(Resource::Fixed(gid));
            }
        }
    }
    for (ai, a) in d.affixes.iter().enumerate() {
        if a.stem != stem || !sim.eligible_base(item, ai, false, false, false) {
            continue;
        }
        let in_fixed_group = item.fixed.iter().any(|&g| g != U && (a.g7c == g || a.g80 == g));
        if !in_fixed_group {
            out.insert(Resource::Kind(a.kind));
        }
    }
    out
}

/// Only matches `resource_capacity`'s Python original exactly (`{0: a, 1: b, None: c}.get(val, 0)`), including
/// its quirk: a flex-pool-only resource (pick_kind not literally 0 or 1) reads as capacity 0, not `c`. Faithfully
/// porting this, not "fixing" it, since the verified real-world incompatible pairs found so far (Unity's
/// Socket+CDR, In-geom's Elite Damage+CDR, Funerary Pick's Haste+Damage) are all single FIXED-slot resources,
/// where this doesn't come up -- changing flex's capacity would change answers the project hasn't verified either way.
fn resource_capacity(item: &Item, r: Resource) -> u32 {
    match r {
        Resource::Fixed(_) => 1,
        Resource::Kind(0) => item.na,
        Resource::Kind(1) => item.nb,
        Resource::Kind(_) => 0,
    }
}

/// Conservative pairwise check: INCOMPATIBLE only when two stems share the exact same single resource and that
/// resource has capacity <=1.
fn stems_compatible(sim: &mut Sim, item_idx: usize, stems: &[String]) -> bool {
    let d = sim.d.clone();
    let resources: Vec<HashSet<Resource>> = stems.iter().map(|s| stem_resources(sim, item_idx, s)).collect();
    for i in 0..stems.len() {
        for j in (i + 1)..stems.len() {
            if resources[i].len() == 1 && resources[i] == resources[j] {
                let r = *resources[i].iter().next().unwrap();
                if resource_capacity(&d.items[item_idx], r) <= 1 {
                    return false;
                }
            }
        }
    }
    true
}

/// A worn primal that can have a socket always has one, and it takes the first primary pick (`Sim::picks`). A stat that can only come
/// from a primary pick therefore cannot be rolled when the picks left after the socket are already spoken for by the stats chosen so
/// far: no natural primal carries it, only the Mystic can add it (the Andariel's Visage helm and Blood Nova).
fn squeezed_out_by_socket(sim: &mut Sim, item_idx: usize, stem: &str, chosen: &[String]) -> bool {
    let d = sim.d.clone();
    let item = &d.items[item_idx];
    if !item.worn || item.weapon {
        return false;
    }
    let only_primary = |sim: &mut Sim, s: &str| stem_resources(sim, item_idx, s) == HashSet::from([Resource::Kind(0)]);
    // the socket comes from a primary pick (not from a fixed slot, which already gives it)
    if stem == "Sockets" || !only_primary(sim, stem) {
        return false;
    }
    let socket = stem_resources(sim, item_idx, "Sockets");
    if socket.is_empty() || socket.iter().any(|r| matches!(r, Resource::Fixed(_))) || !socket.contains(&Resource::Kind(0)) {
        return false;
    }
    let spoken_for = chosen.iter().filter(|s| s.as_str() != "Sockets" && only_primary(sim, s)).count() as u32;
    item.na.saturating_sub(1) < spoken_for + 1
}

// ---------------------------------------------------------------------------
// one item row's required/forced/mystic/free stats (port of build_premade_list.py main()'s per-item loop)

struct StatPick {
    required: Vec<Value>,
    required_stems: Vec<String>,
    forced: Vec<Value>,
    mystic: Option<Value>,
    free: Vec<Value>,
}

fn pick_stats(sim: &mut Sim, item_idx: usize, texts: &[String], cand_stems: &HashSet<String>) -> StatPick {
    let forced_stems = always_stems(sim, item_idx);
    let mut p = StatPick { required: Vec::new(), required_stems: Vec::new(), forced: Vec::new(), mystic: None, free: Vec::new() };
    for (pos, text) in texts.iter().enumerate() {
        let (stem, why) = match_stat(text, cand_stems);
        let Some(stem) = stem else {
            p.free.push(json!({"text": text, "reason": why}));
            continue;
        };
        if forced_stems.contains(&stem) {
            p.forced.push(json!({"text": text, "stem": stem, "name": stat_name(&stem), "pos": pos}));
            continue;
        }
        if p.required.len() < 2 {
            if let Some(first) = p.required_stems.first() {
                if !stems_compatible(sim, item_idx, &[first.clone(), stem.clone()]) {
                    let first_name = p.required[0]["name"].as_str().unwrap();
                    p.free.push(json!({"text": text, "reason": format!(
                        "provably incompatible with {first_name:?} on this item (both can only come from the same single affix slot)")}));
                    continue;
                }
            }
            // what is left would be required: but no natural primal can carry it next to the socket, so the Mystic adds it
            if squeezed_out_by_socket(sim, item_idx, &stem, &p.required_stems) {
                let entry = json!({"text": text, "stem": stem, "name": stat_name(&stem), "pos": pos});
                if p.mystic.is_none() {
                    p.mystic = Some(entry);
                } else {
                    p.free.push(json!({"text": text, "reason": "the forced socket of a worn primal leaves no primary pick for it"}));
                }
                continue;
            }
            p.required_stems.push(stem.clone());
            p.required.push(json!({"text": text, "stem": stem, "name": stat_name(&stem), "pos": pos}));
        } else if p.mystic.is_none() {
            p.mystic = Some(json!({"text": text, "stem": stem, "name": stat_name(&stem), "pos": pos}));
        } else {
            p.free.push(json!({"text": text, "reason": "beyond the top 3 resolved priorities"}));
        }
    }
    p
}

// ---------------------------------------------------------------------------
// any_item rows (port of build_premade_list.py's resolve_any)

fn resolve_any(d: &Data, sim: &mut Sim, cls_idx: usize, slot_name: &str, row: &SlotToml) -> Value {
    let Some(game_slot) = any_slot(slot_name) else {
        return json!({"slot": slot_name, "item": null, "warnings": [format!("any_item: {slot_name:?} has no single item pool")]});
    };
    let slot = d.slots.iter().find(|s| s.name == game_slot).expect("any_slot name must exist in Data.slots");
    let mut pool: Vec<usize> = slot.pools[cls_idx].iter().map(|&(i, _)| i).collect();
    if !row.sets {
        pool.retain(|&i| d.items[i].setid == 0);
    }
    if pool.is_empty() {
        return json!({"slot": slot_name, "item": null, "warnings": [format!(
            "any_item: no item in the {game_slot} pool for {} (with sets = {})", d.classes[cls_idx], row.sets)]});
    }
    let istems: HashMap<usize, HashSet<String>> = pool.iter().map(|&i| (i, candidate_stems(sim, i))).collect();
    let mut required: Vec<Value> = Vec::new();
    let mut required_stems: Vec<String> = Vec::new();
    let mut mystic: Option<Value> = None;
    let mut free: Vec<Value> = Vec::new();
    let mut elig: Vec<usize> = pool.clone();
    for text in &row.stat_priority {
        let scan: &Vec<usize> = if required.len() < 2 { &elig } else { &pool };
        let mut per_order: Vec<String> = Vec::new();
        let mut per: HashMap<String, Vec<usize>> = HashMap::new();
        let mut why0: Option<String> = None;
        for &i in scan {
            let (st, why) = match_stat(text, &istems[&i]);
            match st {
                Some(stem) => {
                    if !per.contains_key(&stem) {
                        per_order.push(stem.clone());
                    }
                    per.entry(stem).or_default().push(i);
                }
                None => {
                    if why0.is_none() {
                        why0 = why;
                    }
                }
            }
        }
        if per.is_empty() {
            free.push(json!({"text": text, "reason": why0.unwrap_or_else(|| format!("no item in this slot can roll {text:?}"))}));
            continue;
        }
        if required.len() < 2 {
            let mut keys = per_order.clone();
            keys.sort_by_key(|k| std::cmp::Reverse(per[k].len()));
            let mut matched = false;
            for st in keys {
                let its = &per[&st];
                let keep: Vec<usize> = its
                    .iter()
                    .copied()
                    .filter(|&i| {
                        if required_stems.is_empty() {
                            return true;
                        }
                        let mut v = required_stems.clone();
                        v.push(st.clone());
                        stems_compatible(sim, i, &v)
                    })
                    .collect();
                if !keep.is_empty() {
                    required.push(json!({"text": text, "stem": st, "name": stat_name(&st)}));
                    required_stems.push(st);
                    elig = keep;
                    matched = true;
                    break;
                }
            }
            if !matched {
                free.push(json!({"text": text, "reason": "no item can roll this together with the stats above"}));
            }
        } else if mystic.is_none() {
            let mut best: Option<(&String, usize)> = None;
            for st in &per_order {
                let cnt = per[st].len();
                if best.map_or(true, |(_, bc)| cnt > bc) {
                    best = Some((st, cnt));
                }
            }
            let st = best.unwrap().0.clone();
            mystic = Some(json!({"text": text, "stem": st, "name": stat_name(&st)}));
        } else {
            free.push(json!({"text": text, "reason": "beyond the top 3 resolved priorities"}));
        }
    }
    json!({
        "slot": slot_name, "item": format!("(any {slot_name})"), "item_id": null, "raw": null,
        "alternate": 0, "alternates_in_row": 1, "cubed_tag": false, "any_item": true,
        "any_candidates": elig.len(), "any_eligible": elig.iter().map(|&i| format!("{:08x}", d.items[i].id)).collect::<Vec<_>>(),
        "hero_slot": game_slot, "search_class": d.classes[cls_idx],
        "required_stats": required, "mystic_stat": mystic, "unresolved_stats": free, "notes": row.notes,
        "warnings": Vec::<String>::new(), "result": {"found": null, "dry_run": true},
    })
}

// ---------------------------------------------------------------------------
// top-level entry point (port of build_premade_list.py main()'s resolution-only pass, PREMADE_DRY_RUN=1)

/// item index -> every slot name it's native to (not a cross-class listing), sorted (matches
/// `sorted(slot_names)[0]` in Python for picking the row's `hero_slot`).
fn slot_index(d: &Data) -> HashMap<usize, Vec<String>> {
    let mut idx: HashMap<usize, std::collections::BTreeSet<String>> = HashMap::new();
    for s in &d.slots {
        for (c, pool) in s.pools.iter().enumerate() {
            if s.cross.contains(&c) {
                continue;
            }
            for &(item_idx, _) in pool {
                idx.entry(item_idx).or_default().insert(s.name.clone());
            }
        }
    }
    idx.into_iter().map(|(k, v)| (k, v.into_iter().collect())).collect()
}

fn by_norm_index(d: &Data) -> HashMap<String, Vec<usize>> {
    let mut m: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, it) in d.items.iter().enumerate() {
        m.entry(normalize(&it.name)).or_default().push(i);
    }
    m
}

pub fn resolve_builds(toml_text: &str, d: Rc<Data>, hardcore: bool) -> Value {
    let doc: DocToml = toml::from_str(toml_text).expect("builds.toml parse error");
    let by_norm = by_norm_index(&d);
    let slots_of = slot_index(&d);
    let mut sims: HashMap<usize, Sim> = HashMap::new();

    let mut out_builds = Vec::new();
    for b in &doc.builds {
        // pass 1: resolve every row's items, voting for the build's class by its class-restricted items
        // (first-seen class wins a tie, matching Python's dict-insertion-order max()).
        struct PreparedRow<'a> {
            row: &'a SlotToml,
            targets: Vec<(&'a String, usize, bool)>, // (raw, item_idx, cubed_tag)
            any: bool,
            warnings: Vec<String>,
        }
        let mut prepared: Vec<PreparedRow> = Vec::new();
        let mut vote_order: Vec<usize> = Vec::new();
        let mut vote_count: HashMap<usize, u32> = HashMap::new();
        for row in &b.slots {
            if row.any_item {
                prepared.push(PreparedRow { row, targets: Vec::new(), any: true, warnings: Vec::new() });
                continue;
            }
            if row.name == "Potion" {
                prepared.push(PreparedRow { row, targets: Vec::new(), any: false, warnings: vec!["Potion slot: out of scope, skipped".to_string()] });
                continue;
            }
            let mut targets = Vec::new();
            let mut warn = Vec::new();
            let mut seen_ids: HashSet<u32> = HashSet::new();
            for raw in &row.items {
                let scope = resolve_raw(raw, &by_norm);
                let (idx, cubed_tag) = match scope {
                    Scope::Ok { idx, cubed_tag } => (idx, cubed_tag),
                    Scope::Crafted => {
                        warn.push(format!("{raw:?} -> crafted"));
                        continue;
                    }
                    Scope::Bounty => {
                        warn.push(format!("{raw:?} -> bounty"));
                        continue;
                    }
                    Scope::Ambiguous => {
                        warn.push(format!("{raw:?} -> ambiguous"));
                        continue;
                    }
                    Scope::Miss => {
                        warn.push(format!("{raw:?} -> miss"));
                        continue;
                    }
                };
                let id = d.items[idx].id;
                if !seen_ids.insert(id) {
                    warn.push(format!("{raw:?} duplicates an earlier item in this row, skipped"));
                    continue;
                }
                targets.push((raw, idx, cubed_tag));
                if let Some(rc) = d.items[idx].icls {
                    if !vote_count.contains_key(&rc) {
                        vote_order.push(rc);
                    }
                    *vote_count.entry(rc).or_insert(0) += 1;
                }
            }
            if targets.is_empty() {
                warn.push("no resolvable item in this row, skipped".to_string());
            }
            prepared.push(PreparedRow { row, targets, any: false, warnings: warn });
        }

        let cls_idx: Option<usize> = if let Some(name) = &b.class {
            Some(d.classes.iter().position(|c| c == name).unwrap_or_else(|| panic!("build {:?}: unknown class {:?}", b.name, name)))
        } else {
            let mut best: Option<(usize, u32)> = None;
            for &c in &vote_order {
                let cnt = vote_count[&c];
                if best.map_or(true, |(_, bc)| cnt > bc) {
                    best = Some((c, cnt));
                }
            }
            best.map(|(c, _)| c)
        };

        let Some(cls_idx) = cls_idx else {
            let rows_out: Vec<Value> = prepared
                .iter()
                .map(|p| {
                    let mut w = p.warnings.clone();
                    w.push("build class could not be inferred (no class-restricted item resolved; add class = \"...\" to the build) -- row skipped".to_string());
                    json!({"slot": p.row.name, "item": null, "warnings": w})
                })
                .collect();
            out_builds.push(json!({"title": b.name, "class": null, "rows": rows_out}));
            continue;
        };
        let cls_name = d.classes[cls_idx].clone();

        let mut rows_out: Vec<Value> = Vec::new();
        for p in &prepared {
            if p.any {
                let sim = sims.entry(cls_idx).or_insert_with(|| Sim::new(d.clone(), cls_idx, true));
                rows_out.push(resolve_any(&d, sim, cls_idx, &p.row.name, p.row));
                continue;
            }
            if p.targets.is_empty() {
                rows_out.push(json!({"slot": p.row.name, "item": null, "warnings": p.warnings}));
                continue;
            }
            let n_alt = p.targets.len();
            for (alt_i, &(raw, item_idx, cubed_tag)) in p.targets.iter().enumerate() {
                let item = &d.items[item_idx];
                let mut warnings_i = p.warnings.clone();
                let item_cls_idx = item.icls.unwrap_or(cls_idx);
                if item.icls.is_some_and(|rc| rc != cls_idx) {
                    warnings_i.push(format!("item is restricted to {} but the build is {}: searched as {}", d.classes[item_cls_idx], cls_name, d.classes[item_cls_idx]));
                }
                let Some(slot_names) = slots_of.get(&item_idx) else {
                    let mut w = warnings_i.clone();
                    w.push("item not found in any Hope of Cain pool (slot unknown) -- skipped".to_string());
                    rows_out.push(json!({"slot": p.row.name, "item": item.name, "alternate": alt_i, "alternates_in_row": n_alt, "warnings": w}));
                    continue;
                };
                let slot_name = slot_names[0].clone();
                let sim = sims.entry(item_cls_idx).or_insert_with(|| Sim::new(d.clone(), item_cls_idx, true));
                let cand_stems = candidate_stems(sim, item_idx);
                let picks = pick_stats(sim, item_idx, &p.row.stat_priority, &cand_stems);
                rows_out.push(json!({
                    "slot": p.row.name, "item": item.name, "item_id": format!("{:08x}", item.id), "raw": raw,
                    "alternate": alt_i, "alternates_in_row": n_alt, "cubed_tag": cubed_tag,
                    "hero_slot": slot_name, "search_class": d.classes[item_cls_idx],
                    "required_stats": picks.required, "forced_stats": picks.forced, "mystic_stat": picks.mystic,
                    "unresolved_stats": picks.free, "notes": p.row.notes, "warnings": warnings_i,
                    "result": {"found": null, "dry_run": true},
                }));
            }
        }
        out_builds.push(json!({"title": b.name, "class": cls_name, "rows": rows_out}));
    }

    json!({"generated_by": "resolve.rs", "season": d.season, "hardcore": hardcore, "good_enough_threshold": 0.80, "builds": out_builds})
}
