// Meta progression: character stats, levels, equipment, run rewards. Port of shared/meta.js.
use crate::data::{self, class, data, dungeon, dungeon_index, mode_len};
use regex::Regex;
use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq)]
pub struct Equip {
    pub weapon: u32,
    pub armor: u32,
    pub ring: u32,
    pub boots: u32,
}
impl Equip {
    pub fn new() -> Self {
        Equip { weapon: 1, armor: 1, ring: 1, boots: 1 }
    }
    pub fn get(&self, slot: &str) -> Option<u32> {
        match slot { "weapon" => Some(self.weapon), "armor" => Some(self.armor), "ring" => Some(self.ring), "boots" => Some(self.boots), _ => None }
    }
    pub fn set(&mut self, slot: &str, v: u32) {
        match slot { "weapon" => self.weapon = v, "armor" => self.armor = v, "ring" => self.ring = v, "boots" => self.boots = v, _ => {} }
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
}

#[derive(Clone, Debug)]
pub struct Profile {
    pub coins: i64,
    pub chars: Vec<Char>,
    pub single: usize,
    pub multi: usize,
}
impl Profile {
    pub fn progress(&self, mode: &str) -> usize { if mode == "single" { self.single } else { self.multi } }
    fn set_progress(&mut self, mode: &str, v: usize) { if mode == "single" { self.single = v } else { self.multi = v } }
}

pub fn new_char(id: i64, name: &str, cls: &str) -> Char {
    Char { id, name: name.to_string(), cls: cls.to_string(), level: 1, xp: 0, equip: Equip::new() }
}
pub fn new_profile() -> Profile {
    Profile { coins: 0, chars: vec![], single: 1, multi: 1 }
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

pub fn power(c: &Char) -> i64 {
    let e = &c.equip;
    100 + 10 * (c.level as i64 - 1) + 5 * ((e.weapon + e.armor + e.ring + e.boots) as i64 - 4)
}

pub struct Stats { pub hp: f64, pub dmg: f64, pub spd: f64, pub cd: f64, pub magnet: f64 }
pub fn char_stats(c: &Char) -> Stats {
    let e = &c.equip;
    let l = (c.level - 1) as f64;
    Stats {
        hp: (1.0 + 0.03 * l) * (1.0 + 0.05 * (e.armor as f64 - 1.0)),
        dmg: (1.0 + 0.04 * l) * (1.0 + 0.04 * (e.weapon as f64 - 1.0)) * (1.0 + 0.02 * (e.ring as f64 - 1.0)),
        spd: 1.0 + 0.015 * (e.boots as f64 - 1.0),
        cd: 1.0 - 0.01 * (e.boots as f64 - 1.0),
        magnet: 1.0 + 0.03 * (e.ring as f64 - 1.0),
    }
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
