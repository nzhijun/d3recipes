// Copyright 2026 FNG. Use, modification and redistribution are permitted under the conditions in LICENSE:
// credit the source, and visibly link to the site or repository if you use its outputs in a user-facing application.
//! Follower tokens (Templar Relic, Enchantress Focus, Scoundrel Token) are staples in the prepared lists only: custom search
//! never offers them, and the engine's page-facing calls refuse them. The prepared-list generator still reaches them.
use d3cube::data::Data;
use d3cube::plan::Query;
use d3cube::{run_query, Engine, FOLLOWER_SLOTS};
use std::rc::Rc;

fn text() -> String {
    std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../web/data.json")).expect("web/data.json")
}

fn query(slot: &str, items: &[u32]) -> Query {
    serde_json::from_value(serde_json::json!({
        "class": 0, "slots": [slot], "items": items, "season": 40, "hardcore": false, "maxsteps": 100, "max_primalize": 0,
        "quality": "any", "top": 1
    }))
    .unwrap()
}

#[test]
fn picker_and_slot_list_leave_the_tokens_out() {
    let e = Engine::new(&text()).unwrap_or_else(|_| panic!("data"));
    let info: serde_json::Value = serde_json::from_str(&e.describe()).unwrap();
    for s in info["slots"].as_array().unwrap() {
        assert!(!FOLLOWER_SLOTS.contains(&s["name"].as_str().unwrap()), "slot list: {s}");
    }
    let items = info["items"].as_array().unwrap();
    assert!(items.len() > 600, "picker still lists the gear: {}", items.len());
    for it in items {
        assert!(!FOLLOWER_SLOTS.contains(&it["slot"].as_str().unwrap()), "picker: {it}");
    }
}

#[test]
fn stems_and_stat_max_are_empty_for_a_token_slot() {
    let e = Engine::new(&text()).unwrap_or_else(|_| panic!("data"));
    for s in FOLLOWER_SLOTS {
        assert_eq!(e.stems(0, s, 0), "{}");
        assert_eq!(e.stat_max(0, s, 0), "{}");
    }
    assert_ne!(e.stems(0, "Helm", 0), "{}", "an ordinary slot still lists its stats");
}

#[test]
fn a_query_naming_a_token_slot_or_item_is_flagged() {
    let e = Engine::new(&text()).unwrap_or_else(|_| panic!("data"));
    let d = Data::from_json(&text()).unwrap();
    let token_id = d.items[d.slots.iter().find(|s| s.name == "ScoundrelToken").unwrap().pools[0][0].0].id;
    assert!(e.names_follower_token(&query("ScoundrelToken", &[])));
    assert!(e.names_follower_token(&query("Helm", &[token_id])));
    assert!(!e.names_follower_token(&query("Helm", &[])));
}

#[test]
fn the_list_generator_still_reaches_a_token() {
    let d = Rc::new(Data::from_json(&text()).unwrap());
    let r = run_query(d, query("ScoundrelToken", &[]), 100_000);
    assert!(!r.full.is_empty(), "the staples run searches token slots through run_query");
}
