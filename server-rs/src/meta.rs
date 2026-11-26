// Meta progression: character stats, levels, equipment, run rewards. Port of shared/meta.js.
use crate::data::{self, arm, class, data, dungeon, dungeon_index, mode_len, Arm};
use std::collections::BTreeMap;
use regex::Regex;
use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq)]
pub struct Equip {
    pub armor: u32,
    pub ring: u32,
    pub boots: u32,
}
impl Equip {
    pub fn new() -> Self {
        Equip { armor: 1, ring: 1, boots: 1 }
    }
    pub fn get(&self, slot: &str) -> Option<u32> {
        match slot { "armor" => Some(self.armor), "ring" => Some(self.ring), "boots" => Some(self.boots), _ => None }
    }
    pub fn set(&mut self, slot: &str, v: u32) {
        match slot { "armor" => self.armor = v, "ring" => self.ring = v, "boots" => self.boots = v, _ => {} }
    }
}

#[derive(Clone, Debug)]
pub struct Char {
    pub id: i64,
    pub name: String,
    pub cls: String,
    pub level: u32,
    pub xp: i64,
    pub equip: Equip,
    pub arms: BTreeMap<String, u32>,   // armory: weapon id -> upgrade (+0..+9)
    pub held: String,
}

#[derive(Clone, Debug)]
pub struct Profile {
    pub coins: i64,
    pub chars: Vec<Char>,
    pub single: usize,
    pub multi: usize,
    pub bag: Vec<String>,          // spare weapons (boss drops, chest loot), sold or handed to a character
}
impl Profile {
    pub fn progress(&self, mode: &str) -> usize { if mode == "single" { self.single } else { self.multi } }
    fn set_progress(&mut self, mode: &str, v: usize) { if mode == "single" { self.single = v } else { self.multi = v } }
}

pub fn new_char(id: i64, name: &str, cls: &str) -> Char {
    Char { id, name: name.to_string(), cls: cls.to_string(), level: 1, xp: 0, equip: Equip::new(),
        arms: BTreeMap::from([(data().starter.clone(), 0)]), held: data().starter.clone() }
}
pub fn new_profile() -> Profile {
    Profile { coins: 0, chars: vec![], single: 1, multi: 1, bag: vec![] }
}

pub fn valid_name(s: &str) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^[\p{L}\p{N} _.-]{2,16}$").unwrap()).is_match(s.trim())
}

pub fn xp_need(level: u32) -> i64 {
    js_round(60.0 + 30.0 * ((level - 1) as f64).powf(1.25)) as i64
}
pub fn upgrade_cost(lvl: u32) -> i64 {
    js_round(25.0 * (lvl as f64).powf(1.4)) as i64
}
pub fn js_round(x: f64) -> f64 { (x + 0.5).floor() }

/// Legacy characters (no armory yet) get the starter weapon at +(old weapon level - 1).
pub fn fix_arms(c: &mut Char, arms: Option<BTreeMap<String, u32>>, legacy_weapon: u32) {
    let d = data();
    c.arms = arms.unwrap_or_else(|| BTreeMap::from([(d.starter.clone(), legacy_weapon.max(1).saturating_sub(1).min(d.consts.max_plus))]));
    if arm(&c.held).is_none() || !c.arms.contains_key(&c.held) {
        c.held = if c.arms.contains_key(&d.starter) { d.starter.clone() } else { c.arms.keys().find(|k| arm(k).is_some()).cloned().unwrap_or_else(|| d.starter.clone()) };
    }
}
pub fn arm_of(c: &Char) -> (&'static Arm, u32) {
    let d = data();
    let w = if c.arms.contains_key(&c.held) { arm(&c.held) } else { None }.or_else(|| arm(&d.starter)).expect("starter");
    (w, c.arms.get(&w.id).copied().unwrap_or(0))
}
pub fn arm_dmg(w: &Arm, plus: u32) -> f64 { w.dmg * (1.0 + 0.05 * plus as f64) }
pub fn arm_up_cost(w: &Arm, plus: u32) -> i64 { js_round(18.0 * w.tier as f64 * ((plus + 1) as f64).powf(1.5)) as i64 }
/// A sale pays a quarter of the shop price plus 30 % of what was spent on upgrades: a bad rate on purpose.
pub fn arm_sell(w: &Arm, plus: u32) -> i64 { js_round(0.25 * w.price as f64 + 0.3 * (0..plus).map(|k| arm_up_cost(w, k) as f64).sum::<f64>()) as i64 }
pub const BAG_MAX: usize = 60;
/// Puts a dropped weapon in the bag; a full bag sells it on the spot. Returns false when it was sold.
pub fn add_to_bag(p: &mut Profile, id: &str) -> bool {
    if p.bag.len() >= BAG_MAX { if let Some(w) = arm(id) { p.coins += arm_sell(w, 0); } return false; }
    p.bag.push(id.to_string()); true
}
fn random_arm(tier: u32) -> String {
    let all: Vec<&Arm> = data().arms.iter().filter(|a| a.tier == tier).collect();
    all[rand::random::<u32>() as usize % all.len()].id.clone()
}
/// What the boss itself drops on a clear: the weakest weapons (one in a single run, two in a team run, a better one now and then in the raid).
pub fn boss_drops(d: &data::Dungeon) -> Vec<String> {
    (0..if d.mode == "multi" { 2 } else { 1 }).map(|_| random_arm(if d.raid && rand::random::<f64>() < 0.35 { 2 } else { 1 })).collect()
}
/// The end chest: the dungeon's legendary weapon among a few ordinary ones.
pub fn chest_items(d: &data::Dungeon) -> Vec<String> {
    let mut v: Vec<String> = data().legend_of.get(&d.id).cloned().into_iter().collect();
    let base = if d.raid { 3 } else { 2 };
    for _ in 0..3 { v.push(random_arm(base + (rand::random::<u32>() % 2))); }
    v
}

/// buy | up | equip a held weapon; Some(error) or None after applying the change.
pub fn arm_error(p: &mut Profile, char_id: i64, op: &str, id: &str) -> Option<&'static str> {
    let Some(idx) = p.chars.iter().position(|c| c.id == char_id) else { return Some("bad") };
    let Some(w) = arm(id) else { return Some("bad") };
    let has = p.chars[idx].arms.contains_key(id);
    match op {
        "buy" => {
            if has { return Some("owned"); }
            if w.legend.is_some() { return Some("bad"); }      // a legendary weapon only drops from a chest
            if p.chars[idx].level < w.need { return Some("level"); }
            if p.coins < w.price { return Some("poor"); }
            p.coins -= w.price; p.chars[idx].arms.insert(id.to_string(), 0); None
        }
        "equip" if has => { p.chars[idx].held = id.to_string(); None }
        "sell" if has => {                // not the one in the hand, not the free starter
            if p.chars[idx].held == id || id == data().starter { return Some("held"); }
            let plus = p.chars[idx].arms.remove(id).unwrap_or(0);
            p.coins += arm_sell(w, plus); None
        }
        "up" if has => {
            let plus = p.chars[idx].arms[id];
            if plus >= data().consts.max_plus { return Some("max"); }
            let cost = arm_up_cost(w, plus);
            if p.coins < cost { return Some("poor"); }
            p.coins -= cost; p.chars[idx].arms.insert(id.to_string(), plus + 1); None
        }
        _ => Some("bad"),
    }
}

/// take | sell | sellall on the bag; `i` is the bag slot.
pub fn bag_error(p: &mut Profile, char_id: i64, op: &str, i: usize) -> Option<&'static str> {
    match op {
        "sellall" => {
            let (keep, sold): (Vec<String>, Vec<String>) = std::mem::take(&mut p.bag).into_iter().partition(|id| arm(id).is_none_or(|w| w.legend.is_some()));
            p.coins += sold.iter().filter_map(|id| arm(id)).map(|w| arm_sell(w, 0)).sum::<i64>();
            p.bag = keep; None
        }
        "sell" => {
            let Some(w) = p.bag.get(i).and_then(|id| arm(id)) else { return Some("bad") };
            p.bag.remove(i); p.coins += arm_sell(w, 0); None
        }
        "take" => {
            let Some(idx) = p.chars.iter().position(|c| c.id == char_id) else { return Some("bad") };
            let Some(id) = p.bag.get(i).cloned() else { return Some("bad") };
            if p.chars[idx].arms.contains_key(&id) { return Some("owned"); }
            p.bag.remove(i); p.chars[idx].arms.insert(id, 0); None
        }
        _ => Some("bad"),
    }
}

pub fn power(c: &Char) -> i64 {
    let e = &c.equip;
    let (w, plus) = arm_of(c);
    100 + 10 * (c.level as i64 - 1) + 5 * ((e.armor + e.ring + e.boots) as i64 - 3) + js_round(5.0 * (arm_dmg(w, plus) - 1.0) / 0.04) as i64
}

pub struct Stats { pub hp: f64, pub dmg: f64, pub spd: f64, pub cd: f64, pub magnet: f64 }
pub fn char_stats(c: &Char) -> Stats {
    let e = &c.equip;
    let l = (c.level - 1) as f64;
    let (w, plus) = arm_of(c);
    let mut st = Stats {
        hp: (1.0 + 0.03 * l) * (1.0 + 0.05 * (e.armor as f64 - 1.0)),
        dmg: (1.0 + 0.04 * l) * arm_dmg(w, plus) * (1.0 + 0.02 * (e.ring as f64 - 1.0)),
        spd: 1.0 + 0.015 * (e.boots as f64 - 1.0),
        cd: 1.0 - 0.01 * (e.boots as f64 - 1.0),
        magnet: 1.0 + 0.03 * (e.ring as f64 - 1.0),
    };
    let v = w.perk_val * (1.0 + plus as f64 / data().consts.max_plus as f64);   // the perk grows with the upgrade
    match w.perk.as_deref() {
        Some("hp") => st.hp *= 1.0 + v,
        Some("spd") => st.spd *= 1.0 + v / 2.0,
        Some("cd") => st.cd *= 1.0 - v,
        Some("magnet") => st.magnet *= 1.0 + 3.0 * v,
        _ => {}
    }
    st
}

pub struct RunResult<'a> {
    pub dungeon_id: &'a str,
    pub kills: f64,
    pub coins_picked: f64,
    pub time_sec: f64,
    pub cleared: bool,
    pub reward_mul: f64,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reward { pub xp: i64, pub coins: i64 }

pub fn run_reward(r: &RunResult) -> Reward {
    let d = dungeon(r.dungeon_id).expect("dungeon");
    let half = if r.cleared { 1.0 } else { 0.5 };
    let xp = ((r.time_sec * 0.4 + r.kills * 0.6 + if r.cleared { 250.0 } else { 0.0 }) * d.xp * r.reward_mul * half).floor();
    let coins = ((r.coins_picked + r.kills * 0.1 + if r.cleared { 60.0 } else { 0.0 }) * d.xp * r.reward_mul * half).floor();
    Reward { xp: xp as i64, coins: coins as i64 }
}

pub fn add_xp(c: &mut Char, xp: i64) {
    let max = data().consts.max_level;
    c.xp += xp;
    while c.level < max && c.xp >= xp_need(c.level) {
        c.xp -= xp_need(c.level);
        c.level += 1;
    }
    if c.level >= max { c.xp = 0; }
}

pub fn unlocked(p: &Profile, d: &data::Dungeon) -> bool {
    dungeon_index(d) < p.progress(&d.mode)
}

/// Applies a finished run to the profile and returns the reward (None when the character is not in the profile).
pub fn apply_run(p: &mut Profile, char_id: i64, r: &RunResult) -> Option<Reward> {
    let d = dungeon(r.dungeon_id)?;
    let idx = p.chars.iter().position(|c| c.id == char_id)?;
    let rew = run_reward(r);
    add_xp(&mut p.chars[idx], rew.xp);
    p.coins += rew.coins;
    if r.cleared {
        let i = dungeon_index(d);
        let cur = p.progress(&d.mode);
        if i + 1 >= cur && i + 1 < mode_len(&d.mode) { p.set_progress(&d.mode, i + 2); }
    }
    Some(rew)
}

pub fn upgrade_equip(p: &mut Profile, char_id: i64, slot: &str) -> Option<&'static str> {
    let idx = match p.chars.iter().position(|c| c.id == char_id) { Some(i) => i, None => return Some("bad") };
    let lvl = match p.chars[idx].equip.get(slot) { Some(l) => l, None => return Some("bad") };
    if lvl >= data().consts.max_equip { return Some("max"); }
    let cost = upgrade_cost(lvl);
    if p.coins < cost { return Some("poor"); }
    p.coins -= cost;
    p.chars[idx].equip.set(slot, lvl + 1);
    None
}

pub fn create_char(p: &mut Profile, name: &str, cls: &str, id: i64) -> Option<&'static str> {
    if !valid_name(name) { return Some("name"); }
    if class(cls).is_none() { return Some("class"); }
    if p.chars.len() >= data().consts.max_chars { return Some("full"); }
    p.chars.push(new_char(id, name.trim(), cls));
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> Profile { let mut p = new_profile(); create_char(&mut p, "Kuba", "perun", 1); p }

    #[test]
    fn drops_chest_and_merchant() {
        for d in data().dungeons.iter() {
            let items = chest_items(d);
            assert_eq!(items.len(), 4, "legendary + three ordinary");
            assert_eq!(items[0], data().legend_of[&d.id]);
            assert!(items[1..].iter().all(|id| arm(id).is_some_and(|w| w.legend.is_none() && w.tier >= 2)));
            let weak = boss_drops(d);
            assert_eq!(weak.len(), if d.mode == "multi" { 2 } else { 1 });
            assert!(weak.iter().all(|id| arm(id).is_some_and(|w| w.tier <= if d.raid { 2 } else { 1 })), "the boss drops the weakest weapons");
        }
        let mut p = profile();
        for id in ["axe1", "club5", "sword2"] { add_to_bag(&mut p, id); }
        assert_eq!(bag_error(&mut p, 1, "take", 1), None);                    // the legendary club goes to the character
        assert!(p.chars[0].arms.contains_key("club5") && p.bag == ["axe1", "sword2"]);
        assert_eq!(bag_error(&mut p, 1, "take", 5), Some("bad"));
        add_to_bag(&mut p, "club5"); assert_eq!(bag_error(&mut p, 1, "take", 2), Some("owned"));
        let coins = p.coins; assert_eq!(bag_error(&mut p, 1, "sellall", 0), None);   // a legendary weapon is never sold in bulk
        assert_eq!(p.bag, ["club5"]); assert_eq!(p.coins, coins + arm_sell(arm("axe1").unwrap(), 0) + arm_sell(arm("sword2").unwrap(), 0));
        for _ in 0..BAG_MAX { add_to_bag(&mut p, "axe1"); }                    // a full bag sells the next drop at once
        let coins = p.coins; assert!(!add_to_bag(&mut p, "axe1")); assert!(p.coins > coins && p.bag.len() == BAG_MAX);
        // selling from a character: bad rate, never the held weapon or the starter
        p.coins = 1e6 as i64; p.chars[0].level = 50;
        assert_eq!(arm_error(&mut p, 1, "buy", "axe2"), None); assert_eq!(arm_error(&mut p, 1, "up", "axe2"), None);
        let paid = arm_sell(arm("axe2").unwrap(), 1); assert!(paid < arm("axe2").unwrap().price / 2);
        let c = p.coins; assert_eq!(arm_error(&mut p, 1, "sell", "axe2"), None); assert_eq!(p.coins, c + paid);
        assert_eq!(arm_error(&mut p, 1, "sell", "staff1"), Some("held"));
        assert_eq!(arm_error(&mut p, 1, "buy", "spear5"), Some("bad"));
    }
}
