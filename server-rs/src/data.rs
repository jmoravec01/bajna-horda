// Game data shared with the browser: loaded from data.json (generated from shared/data.js by tools/gen-data.mjs).
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Consts {
    pub dt: f64,
    pub max_chars: usize,
    pub max_players: usize,
    pub run_seconds: f64,
    pub max_level: u32,
    pub max_weapons: usize,
    pub max_passives: usize,
    pub max_item_lvl: u32,
    pub max_equip: u32,
    pub max_plus: u32,
    pub team_seconds: f64,
}

#[derive(Deserialize, Debug)]
pub struct BossStage {
    pub at: f64,
    pub hp: f64,
    pub dmg: f64,
    pub size: f64,
    pub ring: usize,
    pub minions: usize,
    pub every: f64,
}

#[derive(Deserialize, Debug)]
pub struct Arm {
    pub id: String,
    pub tier: u32,
    pub dmg: f64,
    pub perk: Option<String>,
    pub perk_val: f64,
    pub need: u32,
    pub price: i64,
    pub legend: Option<String>,   // the dungeon whose chest drops it
}

// Class traits: a missing trait is 0, which behaves like the JS `cl.x || default`.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Class {
    pub id: String,
    pub weapon: String,
    pub hp: f64,
    pub spd: f64,
    pub dmg: f64,
    pub armor: f64,
    pub crit: f64,
    pub heal_aura: f64,
    pub magnet: f64,
    pub burn: f64,
    pub xp: f64,
    pub regen: f64,
    pub heart_luck: f64,
    pub zone_slow: f64,
    pub swim: f64,
    pub ramp: f64,
    pub knock: f64,
    pub dodge: f64,
    pub coins: f64,
    pub blink: f64,
    pub freeze: f64,
    pub extra: f64,
}

#[derive(Deserialize, Debug, Default)]
#[serde(default)]
pub struct Weapon {
    pub id: String,
    pub kind: String,
    pub dmg: f64,
    pub cd: f64,
    pub count: f64,
    pub area: f64,
    pub speed: f64,
    pub dur: f64,
    pub pierce: f64,
    pub knock: f64,
    pub slow: f64,
    pub burn: f64,
    pub tick: f64,
    pub rate: f64,
    pub grow: Vec<String>,
}

#[derive(Deserialize, Debug)]
pub struct Arch {
    pub hp: f64,
    pub dmg: f64,
    pub spd: f64,
    pub r: f64,
    pub xp: f64,
    pub beh: String,
}

#[derive(Deserialize, Debug)]
pub struct RosterEntry {
    pub arch: String,
    pub at: f64,
    pub weight: f64,
}

#[derive(Deserialize, Debug)]
pub struct BossDef {
    pub arch: String,
    pub hp: f64,
    pub scale: f64,
}

#[derive(Deserialize, Debug)]
pub struct Dungeon {
    pub id: String,
    pub mode: String,
    pub diff: f64,
    pub xp: f64,
    pub secs: f64,
    pub shrines: usize,
    pub pace: f64,
    pub spawn: f64,
    pub hit: f64,
    pub raid: bool,
    pub stages: String,
    pub roster: Vec<RosterEntry>,
    pub elite: String,
    pub boss: BossDef,
}

#[derive(Deserialize, Debug)]
pub struct Data {
    pub consts: Consts,
    pub classes: Vec<Class>,
    pub weapons: Vec<Weapon>,
    pub passives: Vec<String>,
    pub arch: HashMap<String, Arch>,
    pub dungeons: Vec<Dungeon>,
    pub slots: Vec<String>,
    pub starter: String,
    pub boss_stages: HashMap<String, Vec<BossStage>>,
    pub legend_of: HashMap<String, String>,
    pub arms: Vec<Arm>,
}

pub fn data() -> &'static Data {
    static D: OnceLock<Data> = OnceLock::new();
    D.get_or_init(|| serde_json::from_str(include_str!("../data.json")).expect("data.json"))
}

pub fn class(id: &str) -> Option<&'static Class> {
    data().classes.iter().find(|c| c.id == id)
}
pub fn arm(id: &str) -> Option<&'static Arm> {
    data().arms.iter().find(|a| a.id == id)
}
pub fn dungeon(id: &str) -> Option<&'static Dungeon> {
    data().dungeons.iter().find(|d| d.id == id)
}
pub fn weapon_idx(id: &str) -> usize {
    data().weapons.iter().position(|w| w.id == id).expect("weapon id")
}
/// Position of a dungeon inside its own mode ("single" / "multi").
pub fn dungeon_index(d: &Dungeon) -> usize {
    data().dungeons.iter().filter(|x| x.mode == d.mode).position(|x| x.id == d.id).unwrap_or(0)
}
pub fn mode_len(mode: &str) -> usize {
    data().dungeons.iter().filter(|x| x.mode == mode).count()
}
impl Dungeon {
    pub fn stages(&self) -> &'static [BossStage] { &data().boss_stages[&self.stages] }
}
pub fn or1(x: f64) -> f64 {
    if x == 0.0 { 1.0 } else { x }
}
