// Deterministic game simulation (port of shared/sim.js). One Sim = one run with 1..6 players, stepped at 20 Hz.
use crate::data::{class, data, dungeon, or1, weapon_idx, Class, Dungeon};
use crate::meta::{char_stats, js_round, power, Char, Stats};
use serde_json::{json, Value};
use std::collections::HashMap;

pub const CULL: f64 = 290.0;     // a full-HD window shows up to ~275 px from the hero
const BASE_SPEED: f64 = 52.0;
const BASE_HP: f64 = 100.0;
const PICKUP_R: f64 = 26.0;
const TOUCH_R: f64 = 10.0;      // hearts, magnets and chests are not pulled in: walk over them
const CELL: f64 = 24.0;
const HARD_GRACE: f64 = 180.0;    // seconds the last boss has, then the run fails
const SHRINE_R: f64 = 26.0;       // a shrine is captured by standing in this circle
const SHRINE_DIST: f64 = 125.0;   // shrines sit on a ring this far from the start

pub struct Rng(u32);
impl Rng {
    pub fn new(seed: u32) -> Self { Rng(seed) }
    /// mulberry32, bit-exact with the JS version.
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6D2B79F5);
        let mut t = (self.0 ^ (self.0 >> 15)).wrapping_mul(1 | self.0);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

fn r1(v: f64) -> f64 { js_round(v * 10.0) / 10.0 }
fn lvl_need(l: u32) -> f64 { js_round(7.0 + 5.0 * ((l - 1) as f64).powf(1.15)) }
fn dist2(ax: f64, ay: f64, bx: f64, by: f64) -> f64 { (ax - bx) * (ax - bx) + (ay - by) * (ay - by) }

pub struct WStats { pub dmg: f64, pub cd: f64, pub count: usize, pub area: f64, pub pierce: i32, pub dur: f64, pub speed: f64, pub knock: f64, pub slow: f64, pub burn: f64, pub tick: f64, pub rate: f64 }

pub fn weapon_stats(wix: usize, l: u32, extra: usize) -> WStats {
    let d = &data().weapons[wix];
    let k = (l - 1) as f64;
    let g = |n: &str| d.grow.iter().any(|x| x == n);
    let base_count = if d.count == 0.0 { 1.0 } else { d.count };
    WStats {
        dmg: d.dmg * 1.5 * (1.0 + 0.28 * k),
        cd: d.cd * 0.95f64.powf(k),
        count: base_count as usize + if g("count") { (k / 2.0).floor() as usize } else { 0 } + if d.kind == "turret" { extra } else { 0 },
        area: d.area * if g("area") || d.kind == "orbit" { 1.0 + 0.08 * k } else { 1.0 },
        pierce: d.pierce as i32 + if g("pierce") { (k / 3.0).floor() as i32 } else { 0 },
        dur: d.dur * if g("dur") { 1.0 + 0.1 * k } else { 1.0 },
        speed: d.speed, knock: d.knock, slow: d.slow, burn: d.burn, tick: d.tick, rate: d.rate,
    }
}

#[derive(Clone)]
pub struct Choice(pub char, pub String, pub u32);

pub struct PWeapon { pub wix: usize, pub lvl: u32, pub cd: f64, pub ang: f64 }

pub struct Player {
    pub id: u32,
    pub name: String,
    pub cls: String,
    pub cl: &'static Class,
    st: Stats,
    pub power: i64,
    pub x: f64, pub y: f64, dx: f64, dy: f64, face: i32,
    pub hp: f64, pub max_hp: f64, pub spd: f64,
    inv: f64, pub dead: bool, rev: f64,
    pub level: u32, xp: f64, pub kills: u32, pub coins: f64,
    pub weapons: Vec<PWeapon>,
    pub passives: Vec<(usize, u32)>,
    pub pending: Vec<Vec<Choice>>,
    blink_cd: f64, freeze_cd: f64,
    pub gone: bool,
    pub reward: f64,
    pub dmg_done: f64,
}

#[derive(Default, Clone)]
pub struct Enemy {
    id: i64, typ: usize, beh: String, x: f64, y: f64, hp: f64, max_hp: f64, dmg: f64, spd: f64, r: f64, xp: f64,
    kx: f64, ky: f64, t: f64, dead: bool, flash: i32, slow_until: f64, slow_f: f64, freeze_until: f64,
    burn_until: f64, burn_dps: f64, burn_owner: Option<usize>, hm: HashMap<i64, f64>,
    boss: bool, stage: usize, elite: bool, big: bool, st: f64, dash_x: f64, dash_y: f64, bt: f64, bs: f64, arch_spd: f64,
}

#[derive(Clone, Copy, PartialEq, Default, Debug)]
enum OK { #[default] P, B, X, Z, T, O }

#[derive(Default)]
struct Obj {
    id: i64, kind: OK, wix: usize, x: f64, y: f64, vx: f64, vy: f64, ang: f64, r: f64, dmg: f64, pierce: i32, life: f64, max: f64,
    owner: usize, hit: Vec<i64>, hm: HashMap<i64, f64>, slow: f64, sx: f64, sy: f64, tx: f64, ty: f64, t: f64, dur: f64, burn: f64,
    tick: f64, every: f64, cd: f64, rate: f64, speed: f64, louze: bool, dummy: bool,
}

struct EBul { id: i64, x: f64, y: f64, vx: f64, vy: f64, dmg: f64, life: f64 }
struct Pick { id: i64, tier: u8, x: f64, y: f64, v: f64, mag: bool }

#[derive(Clone)]
pub enum Ev {
    Hit(f64, f64), Crit(f64, f64), Die(f64, f64, u8), Ring(f64, f64, f64, usize), Boom(f64, f64, f64), Chain(Vec<f64>), BossWarn(usize), Atk(f64, f64, u32, usize), Shrine(usize, bool),
    Personal(char, u32),   // L u x g $ + M C m v: only the owner needs these
}

pub struct OverPlayer { pub kills: u32, pub coins: f64, pub reward: f64 }
pub struct Over { pub cleared: bool, pub time: f64, pub players: Vec<OverPlayer> }

pub struct SimPlayerIn { pub name: String, pub cls: String, pub level: u32, pub equip: crate::meta::Equip, pub arms: std::collections::BTreeMap<String, u32>, pub held: String }

pub struct Sim {
    rnd: Rng,
    dun: &'static Dungeon,
    pub tick: u64,
    nid: i64,
    pub players: Vec<Player>,
    enemies: Vec<Enemy>,
    objs: Vec<Obj>,
    ebul: Vec<EBul>,
    picks: Vec<Pick>,
    ev: Vec<Ev>,
    pub over: Option<Over>,
    spawn_acc: f64,
    elite_done: u32,
    boss_n: usize,
    grid: HashMap<i64, Vec<usize>>,
    pub threat: f64,
    pub e_mul: f64,
    d_mul: f64,
    c_mul: f64,
    louze: usize,
    shrines: Vec<Shrine>,
    siege_t: f64,
}

struct Shrine { x: f64, y: f64, prog: f64, held: bool }

impl Sim {
    pub fn new(seed: u32, dungeon_id: &str, players: Vec<SimPlayerIn>) -> Sim {
        let dun = dungeon(dungeon_id).expect("dungeon");
        let mut sim = Sim {
            rnd: Rng::new(seed), dun, tick: 0, nid: 1, players: vec![], enemies: vec![], objs: vec![], ebul: vec![], picks: vec![], ev: vec![], over: None,
            spawn_acc: 0.0, elite_done: 0, boss_n: 0, grid: HashMap::new(), threat: 0.0, e_mul: 1.0, d_mul: 1.0, c_mul: 1.0, louze: weapon_idx("louze"), shrines: vec![], siege_t: 0.0,
        };
        for (i, c) in players.into_iter().enumerate() { let p = sim.make_player(i as u32 + 1, c); sim.players.push(p); }
        let k = dun.shrines;                                   // team dungeons: shrines on a ring; no RNG is used when there are none
        if k > 0 { let off = sim.rnd.next() * 6.283; sim.shrines = (0..k).map(|i| { let a = off + i as f64 / k as f64 * 6.283; Shrine { x: a.cos() * SHRINE_DIST, y: a.sin() * SHRINE_DIST, prog: 0.0, held: false } }).collect(); }
        let n = sim.players.len();
        let top = sim.players.iter().map(|p| p.power).max().unwrap_or(100) as f64;
        sim.threat = top * (1.0 + 0.25 * (n as f64 - 1.0));
        sim.e_mul = (sim.threat / 100.0).sqrt();
        sim.d_mul = sim.e_mul.sqrt();
        sim.c_mul = (sim.threat / 100.0).powf(0.25) * (1.0 + 0.7 * (n as f64 - 1.0));
        let e_mul = sim.e_mul;
        for (i, p) in sim.players.iter_mut().enumerate() {
            p.reward = (e_mul / (p.power as f64 / 100.0).sqrt()).max(1.0).min(4.0);
            if n > 1 { let a = i as f64 / n as f64 * 6.283; p.x = a.cos() * 12.0; p.y = a.sin() * 12.0; }
        }
        sim
    }

    fn make_player(&mut self, id: u32, c: SimPlayerIn) -> Player {
        let cl = class(&c.cls).expect("class");
        let ch = Char { id: 0, name: c.name.clone(), cls: c.cls.clone(), level: c.level, xp: 0, equip: c.equip, arms: c.arms, held: c.held };
        let mut p = Player { id, name: c.name, cls: c.cls, cl, st: char_stats(&ch), power: power(&ch), x: 0.0, y: 0.0, dx: 0.0, dy: 0.0, face: 1, hp: 0.0, max_hp: 0.0, spd: 0.0,
            inv: 0.0, dead: false, rev: 0.0, level: 1, xp: 0.0, kills: 0, coins: 0.0, weapons: vec![], passives: vec![], pending: vec![], blink_cd: 0.0, freeze_cd: 6.0, gone: false, reward: 1.0, dmg_done: 0.0 };
        p.weapons.push(PWeapon { wix: weapon_idx(&cl.weapon), lvl: 1, cd: 0.4, ang: 0.0 });
        Self::recalc(&mut p);
        p.hp = p.max_hp;
        p
    }

    fn pl(p: &Player, name: &str) -> u32 {
        match data().passives.iter().position(|x| x == name) { Some(i) => p.passives.iter().find(|(k, _)| *k == i).map(|(_, l)| *l).unwrap_or(0), None => 0 }
    }
    fn recalc(p: &mut Player) {
        let frac = if p.max_hp > 0.0 { p.hp / p.max_hp } else { 1.0 };
        p.max_hp = js_round(BASE_HP * p.cl.hp * p.st.hp * (1.0 + 0.12 * Self::pl(p, "srdce") as f64));
        p.spd = BASE_SPEED * p.cl.spd * p.st.spd * (1.0 + 0.06 * Self::pl(p, "boty") as f64);
        p.hp = js_round(p.max_hp * frac).max(1.0);
    }

    pub fn set_input(&mut self, id: u32, dx: f64, dy: f64) {
        if id == 0 || id as usize > self.players.len() || !dx.is_finite() || !dy.is_finite() { return; }
        let p = &mut self.players[id as usize - 1];
        let (mut dx, mut dy) = (dx, dy);
        let l = dx.hypot(dy);
        if l > 1.0 { dx /= l; dy /= l; }
        p.dx = dx; p.dy = dy;
    }

    // ---------- helpers ----------
    fn dmg_mul(&self, pi: usize) -> f64 {
        let p = &self.players[pi];
        let mut m = p.st.dmg * p.cl.dmg * (1.0 + 0.1 * Self::pl(p, "sila") as f64) * (1.0 + 0.08 * self.held() as f64);   // every held shrine: +8 % damage for the team
        if p.cl.ramp != 0.0 {
            let s = self.tick as f64 * data().consts.dt;
            m *= if s < 120.0 { 0.7 } else { 0.7 + 0.9 * ((s - 120.0) / 360.0).min(1.0) };
        }
        m
    }
    fn cd_mul(&self, pi: usize) -> f64 {
        let p = &self.players[pi];
        (p.st.cd * (1.0 - 0.06 * Self::pl(p, "spech") as f64)).max(0.4)
    }
    fn now(&self) -> f64 { self.tick as f64 * data().consts.dt }
    fn held(&self) -> usize { self.shrines.iter().filter(|s| s.held).count() }
    /// A boss cannot be hurt until enough shrines are held: all of them for the last one.
    fn shielded(&self, stage: usize) -> bool {
        let total = self.shrines.len();
        total > 0 && self.held() < (total * (stage + 1)).div_ceil(self.dun.stages().len())
    }
    fn hard_end(&self) -> f64 { self.dun.stages().last().map_or(480.0, |s| s.at) + HARD_GRACE }

    fn grid_build(&mut self) {
        for a in self.grid.values_mut() { a.clear(); }
        for (i, e) in self.enemies.iter().enumerate() {
            let k = ((e.x / CELL).floor() as i64 + 4096) * 8192 + (e.y / CELL).floor() as i64 + 4096;
            self.grid.entry(k).or_default().push(i);
        }
        if self.grid.len() > 2000 { self.grid.retain(|_, a| !a.is_empty()); }
    }
    /// Indices of living enemies whose circle touches the circle (x, y, r).
    fn near(&self, x: f64, y: f64, r: f64) -> Vec<usize> {
        let mut out = vec![];
        let c0 = ((x - r - 12.0) / CELL).floor() as i64; let c1 = ((x + r + 12.0) / CELL).floor() as i64;
        let d0 = ((y - r - 12.0) / CELL).floor() as i64; let d1 = ((y + r + 12.0) / CELL).floor() as i64;
        for cx in c0..=c1 { for cy in d0..=d1 {
            if let Some(a) = self.grid.get(&((cx + 4096) * 8192 + cy + 4096)) {
                for &i in a { let e = &self.enemies[i]; if e.dead { continue; } let rr = r + e.r; if dist2(e.x, e.y, x, y) <= rr * rr { out.push(i); } }
            }
        } }
        out
    }
    fn nearest(&self, x: f64, y: f64, max_r: f64, k: usize, skip: &[usize]) -> Vec<usize> {
        let mut out: Vec<(usize, f64)> = Vec::with_capacity(k + 1);
        for (i, e) in self.enemies.iter().enumerate() {
            if e.dead || skip.contains(&i) { continue; }
            let d = dist2(e.x, e.y, x, y);
            if d > max_r * max_r { continue; }
            let pos = out.iter().position(|(_, od)| *od > d).unwrap_or(out.len());
            out.insert(pos, (i, d));
            if out.len() > k { out.pop(); }
        }
        out.into_iter().map(|(i, _)| i).collect()
    }
    fn emit(&mut self, e: Ev) { if self.ev.len() < 200 { self.ev.push(e); } }

    // ---------- damage ----------
    fn hurt_enemy(&mut self, ei: usize, dmg: f64, owner: Option<usize>, quiet: bool) {
        if self.enemies[ei].dead || (self.enemies[ei].boss && self.shielded(self.enemies[ei].stage)) { return; }
        let mut dmg = dmg;
        if let Some(pi) = owner {
            if !quiet {
                let crit = 0.05 + self.players[pi].cl.crit;
                if self.rnd.next() < crit { dmg *= 2.0; let (x, y) = (r1(self.enemies[ei].x), r1(self.enemies[ei].y)); self.emit(Ev::Crit(x, y)); }
                let burn = self.players[pi].cl.burn;
                if burn != 0.0 { self.burn(ei, dmg * burn, 2.0, Some(pi)); }
            }
        }
        let e = &mut self.enemies[ei];
        e.hp -= dmg; e.flash = 2;
        let (x, y) = (r1(e.x), r1(e.y));
        if let Some(pi) = owner { self.players[pi].dmg_done += dmg; }
        if !quiet { self.emit(Ev::Hit(x, y)); }
        if self.enemies[ei].hp <= 0.0 { self.kill(ei, owner); }
    }
    fn burn(&mut self, ei: usize, dps: f64, secs: f64, owner: Option<usize>) {
        let now = self.now();
        let e = &mut self.enemies[ei];
        e.burn_dps = e.burn_dps.max(dps); e.burn_until = now + secs; e.burn_owner = owner;
    }
    fn slow(&mut self, ei: usize, f: f64, secs: f64) {
        let now = self.now();
        let e = &mut self.enemies[ei];
        let f = if e.boss { f * 0.4 } else { f };
        e.slow_f = f.max(if e.slow_until > now { e.slow_f } else { 0.0 });
        e.slow_until = now + secs;
    }
    fn knock(&mut self, ei: usize, fx: f64, fy: f64, amt: f64) {
        let e = &mut self.enemies[ei];
        if e.boss || amt == 0.0 { return; }
        let (dx, dy) = (e.x - fx, e.y - fy);
        let l = dx.hypot(dy);
        let l = if l == 0.0 { 1.0 } else { l };
        let k = if e.big { 0.4 } else { 1.0 };
        e.kx += dx / l * amt * k * 6.0; e.ky += dy / l * amt * k * 6.0;
    }
    fn kill(&mut self, ei: usize, owner: Option<usize>) {
        self.enemies[ei].dead = true;
        let (x, y, boss, stage, elite, exp) = { let e = &self.enemies[ei]; (e.x, e.y, e.boss, e.stage, e.elite, e.xp) };
        self.emit(Ev::Die(r1(x), r1(y), if boss { 2 } else if elite { 1 } else { 0 }));
        if let Some(pi) = owner { self.players[pi].kills += 1; }
        if boss {
            if stage + 1 == self.dun.stages().len() { self.finish(true); return; }      // the last boss clears the dungeon
            self.drop(x, y, 6, 0.0);                                                       // the others pay with a chest and coins
            for i in 0..4 { let a = i as f64 * 1.6; self.drop(x + a.cos() * 8.0, y + a.sin() * 8.0, 3, 5.0); }
            return;
        }
        let oi = owner.unwrap_or(0);
        let xp = exp * (1.0 + 0.15 * (self.now() * self.dun.pace / 120.0).min(4.0));
        self.drop(x, y, if xp < 3.0 { 0 } else if xp < 8.0 { 1 } else { 2 }, xp);
        if elite { self.drop(x + 4.0, y, 6, 0.0); return; }
        let r = self.rnd.next();
        let luck = or1(self.players[oi].cl.heart_luck);
        if r < 0.10 { self.drop(x + 3.0, y + 3.0, 3, 1.0); }
        else if r < 0.10 + 0.012 * luck { self.drop(x, y, 4, 0.0); }
        else if r < 0.125 + 0.012 * luck { self.drop(x, y, 5, 0.0); }
    }
    fn drop(&mut self, x: f64, y: f64, tier: u8, v: f64) {
        // xp gems and coins that land next to one of the last few drops fuse into it (same xp in total, fewer sprites, events and bytes per snapshot)
        if tier <= 3 {
            if let Some(g) = self.picks.iter_mut().rev().take(40).find(|g| !g.mag && g.tier <= 3 && (g.tier == 3) == (tier == 3) && dist2(g.x, g.y, x, y) < 49.0) {
                g.v += v; if g.tier < 3 { g.tier = if g.v < 3.0 { 0 } else if g.v < 8.0 { 1 } else { 2 }; }
                return;
            }
        }
        let id = self.nid; self.nid += 1;
        self.picks.push(Pick { id, tier, x, y, v, mag: false });
    }

    fn hurt_player(&mut self, pi: usize, dmg: f64, fx: f64, fy: f64) {
        if self.players[pi].dead || self.players[pi].inv > 0.0 { return; }
        let (dodge, blink, blink_cd) = { let p = &self.players[pi]; (p.cl.dodge, p.cl.blink, p.blink_cd) };
        if dodge != 0.0 && self.rnd.next() < dodge { self.players[pi].inv = 0.2; let id = self.players[pi].id; self.emit(Ev::Personal('m', id)); return; }
        if blink != 0.0 && blink_cd <= 0.0 {
            let p = &mut self.players[pi];
            p.blink_cd = 8.0; p.inv = 1.0;
            let a = (p.y - fy).atan2(p.x - fx);
            p.x += a.cos() * 30.0; p.y += a.sin() * 30.0;
            let (x, y) = (r1(p.x), r1(p.y));
            self.emit(Ev::Ring(x, y, 14.0, 5));
            return;
        }
        let p = &mut self.players[pi];
        p.hp -= dmg * or1(p.cl.armor); p.inv = 0.5;
        let id = p.id;
        let died = p.hp <= 0.0;
        if died { p.hp = 0.0; p.dead = true; p.rev = 0.0; }
        self.emit(Ev::Personal('u', id));
        if died { self.emit(Ev::Personal('x', id)); }
    }

    // ---------- main step ----------
    pub fn step(&mut self) {
        if self.over.is_some() { return; }
        let dt = data().consts.dt;
        self.tick += 1; self.ev.clear();
        let t = self.now();
        let alive: Vec<usize> = (0..self.players.len()).filter(|&i| !self.players[i].dead).collect();
        if alive.is_empty() { self.finish(false); return; }

        for pi in 0..self.players.len() {
            {
                let p = &mut self.players[pi];
                p.inv = (p.inv - dt).max(0.0); p.blink_cd = (p.blink_cd - dt).max(0.0);
            }
            if self.players[pi].dead {
                if self.players.len() > 1 && !self.players[pi].gone {
                    let (px, py) = (self.players[pi].x, self.players[pi].y);
                    let helper = alive.iter().any(|&q| dist2(self.players[q].x, self.players[q].y, px, py) < 18.0 * 18.0);
                    let p = &mut self.players[pi];
                    p.rev = if helper { p.rev + dt } else { (p.rev - dt).max(0.0) };
                    if p.rev >= 3.0 { p.dead = false; p.hp = (p.max_hp / 2.0).ceil(); p.inv = 2.0; p.rev = 0.0; let id = p.id; self.emit(Ev::Personal('v', id)); }
                }
                continue;
            }
            let (px, py) = (self.players[pi].x, self.players[pi].y);
            let mut sp = self.players[pi].spd;
            let swim = self.players[pi].cl.swim;
            if swim != 0.0 && self.objs.iter().any(|o| o.kind == OK::Z && o.louze && o.owner == pi && dist2(o.x, o.y, px, py) < o.r * o.r) { sp *= swim; }
            {
                let p = &mut self.players[pi];
                p.x += p.dx * sp * dt; p.y += p.dy * sp * dt;
                if p.dx != 0.0 { p.face = if p.dx > 0.0 { 1 } else { -1 }; }
                if p.cl.regen != 0.0 { p.hp = (p.hp + p.cl.regen * dt).min(p.max_hp); }
            }
            let heal = self.players[pi].cl.heal_aura;
            if heal != 0.0 {
                let (px, py) = (self.players[pi].x, self.players[pi].y);
                for &q in &alive {
                    if dist2(self.players[q].x, self.players[q].y, px, py) < 70.0 * 70.0 {
                        let k = if q == pi { 0.4 } else { 1.0 };
                        let qp = &mut self.players[q];
                        qp.hp = (qp.hp + heal * dt * k).min(qp.max_hp);
                    }
                }
            }
            if self.players[pi].cl.freeze != 0.0 {
                self.players[pi].freeze_cd -= dt;
                if self.players[pi].freeze_cd <= 0.0 {
                    self.players[pi].freeze_cd = 10.0;
                    let (px, py) = (self.players[pi].x, self.players[pi].y);
                    self.emit(Ev::Ring(r1(px), r1(py), 60.0, 6));
                    for e in self.enemies.iter_mut() {
                        if !e.dead && dist2(e.x, e.y, px, py) < (60.0 + e.r) * (60.0 + e.r) { e.freeze_until = t + if e.boss { 0.8 } else { 2.0 }; }
                    }
                }
            }
        }

        self.objs.retain(|o| !o.dummy);
        self.director(t, &alive);
        self.update_shrines(&alive);
        self.grid_build();
        self.update_enemies(t, &alive);
        for pi in 0..self.players.len() { if !self.players[pi].dead { self.fire(pi, t); } }
        self.update_objs(t);
        self.update_picks(&alive);
        self.enemies.retain(|e| !e.dead);
        if self.over.is_none() && t >= self.hard_end() { self.finish(false); }
    }

    pub fn finish_now(&mut self) { self.finish(false); }
    fn finish(&mut self, cleared: bool) {
        self.over = Some(Over { cleared, time: self.now(), players: self.players.iter().map(|p| OverPlayer { kills: p.kills, coins: p.coins, reward: p.reward }).collect() });
    }

    // ---------- shrines ----------
    // Capturing needs two players in the circle (three in the raid), or everyone still alive if fewer, and the circle must be fairly clear of enemies.
    // Held shrines heal whoever stands in them and give the team +8 % damage each; every so often a held shrine is lost to a siege.
    fn update_shrines(&mut self, alive: &[usize]) {
        if self.shrines.is_empty() { return; }
        let dt = data().consts.dt;
        let want = (if self.dun.raid { 3 } else { 2 }).min(alive.len());
        for si in 0..self.shrines.len() {
            let (sx, sy) = (self.shrines[si].x, self.shrines[si].y);
            let inside = alive.iter().filter(|&&i| dist2(self.players[i].x, self.players[i].y, sx, sy) < SHRINE_R * SHRINE_R).count();
            if self.shrines[si].held {
                for &i in alive { if dist2(self.players[i].x, self.players[i].y, sx, sy) < SHRINE_R * SHRINE_R { let p = &mut self.players[i]; p.hp = (p.hp + p.max_hp * 0.04 * dt).min(p.max_hp); } }
                continue;
            }
            let foes = self.enemies.iter().filter(|e| !e.dead && dist2(e.x, e.y, sx, sy) < (SHRINE_R + e.r) * (SHRINE_R + e.r)).count();
            let h = &mut self.shrines[si];
            if inside >= want && foes <= 3 { h.prog += dt / 8.0 * (1.0 + 0.4 * (inside - want) as f64); }
            else if inside == 0 { h.prog = (h.prog - dt / 25.0).max(0.0); }
            if h.prog >= 1.0 {
                h.prog = 1.0; h.held = true;
                self.emit(Ev::Shrine(si, true));
                for k in 0..6 { let a = k as f64 * 1.05; self.drop(sx + a.cos() * 9.0, sy + a.sin() * 9.0, 2, 6.0); }
            }
        }
        let every = if self.dun.raid { 80.0 } else { 150.0 };
        self.siege_t += dt;
        if self.siege_t >= every {
            self.siege_t = 0.0;
            let held: Vec<usize> = (0..self.shrines.len()).filter(|&i| self.shrines[i].held).collect();
            if !held.is_empty() && !alive.is_empty() {
                let si = held[(self.rnd.next() * held.len() as f64) as usize % held.len()];
                let (sx, sy) = (self.shrines[si].x, self.shrines[si].y);
                self.shrines[si].held = false; self.shrines[si].prog = 0.4;
                self.emit(Ev::Shrine(si, false));
                let id = self.spawn(alive, 5);                     // an elite storms the lost shrine
                if let Some(e) = self.enemies.iter_mut().find(|e| e.id == id) { e.x = sx; e.y = sy; }
            }
        }
    }

    // ---------- spawning ----------
    fn director(&mut self, t: f64, alive: &[usize]) {
        let dt = data().consts.dt;
        let n = self.players.len();
        let tp = t * self.dun.pace;                                // difficulty clock
        // elites at 2:00 and 4:00 (single: bosses at 1:00, 3:00, 5:00; team runs: 2:00, 5:30, 9:00)
        if self.elite_done < 2 && t >= 120.0 + self.elite_done as f64 * 120.0 { self.elite_done += 1; self.spawn(alive, 5); }
        if let Some(st) = self.dun.stages().get(self.boss_n) {
            if t >= st.at { self.spawn(alive, 6 + self.boss_n); self.boss_n += 1; self.emit(Ev::BossWarn(self.boss_n)); }
        }
        let ramp = tp.min(480.0) / 60.0;
        let rate = (0.7 + 0.9 * ramp) * self.c_mul * self.dun.spawn * if self.enemies.iter().any(|e| e.boss && !e.dead) { 0.5 } else { 1.0 };
        let cap = js_round((60.0 + 22.0 * ramp) * (1.0 + 0.5 * (n as f64 - 1.0))) as usize;
        self.spawn_acc += rate * dt;
        while self.spawn_acc >= 1.0 {
            self.spawn_acc -= 1.0;
            if self.enemies.len() >= cap { continue; }
            let d = self.dun;
            let avail: Vec<usize> = (0..d.roster.len()).filter(|&i| t * d.pace >= d.roster[i].at).collect();
            let tot: f64 = avail.iter().map(|&i| d.roster[i].weight).sum();
            let mut x = self.rnd.next() * tot;
            let mut idx = avail[0];
            for &i in &avail { x -= d.roster[i].weight; if x <= 0.0 { idx = i; break; } }
            let group = if data().arch[&d.roster[idx].arch].beh == "zig" { 3 + (self.rnd.next() * 3.0).floor() as usize } else { 1 };
            for _ in 0..group { self.spawn(alive, idx); }
        }
    }

    fn spawn(&mut self, alive: &[usize], idx: usize) -> i64 {
        let d = self.dun;
        let t = self.now();
        let target = alive[(self.rnd.next() * alive.len() as f64).floor() as usize % alive.len()];
        let a = self.rnd.next() * 6.283;
        let dist = 235.0 + self.rnd.next() * 20.0;
        let (arch, hp_base, scale, elite, boss);
        let bst = self.dun.stages().get(idx.wrapping_sub(6));
        if let Some(b) = bst { arch = &data().arch[&d.boss.arch]; hp_base = d.boss.hp * b.hp; scale = d.boss.scale * b.size; boss = true; elite = false; }
        else if idx == 5 { arch = &data().arch[&d.elite]; hp_base = arch.hp * 8.0; scale = 1.5; elite = true; boss = false; }
        else { arch = &data().arch[&d.roster[idx].arch]; hp_base = arch.hp; scale = 1.0; elite = false; boss = false; }
        let tpace = t * d.pace;
        let ts_hp = 1.0 + tpace / 60.0 * 0.6;
        let ts_dmg = 1.0 + tpace / 60.0 * 0.12;
        let hp = hp_base * if boss { 1.0 } else { ts_hp } * self.e_mul * d.diff;
        let (tx, ty) = (self.players[target].x, self.players[target].y);
        let id = self.nid; self.nid += 1;
        let spd = arch.spd * if boss { 0.8 } else { 1.0 } * (1.0 + self.rnd.next() * 0.12);
        let mut e = Enemy { id, typ: idx, beh: arch.beh.clone(), x: tx + a.cos() * dist, y: ty + a.sin() * dist, hp, max_hp: hp,
            dmg: arch.dmg * if boss { 1.3 * bst.map_or(1.0, |b| b.dmg) } else { 1.0 } * ts_dmg * self.d_mul * d.diff.sqrt() * d.hit, spd, r: arch.r * scale, xp: arch.xp * if elite { 6.0 } else { 1.0 },
            t: self.rnd.next() * 3.0, boss, elite, big: arch.r * scale >= 8.0, arch_spd: arch.spd, ..Default::default() };
        if boss { e.beh = "boss".to_string(); e.bt = 3.0; e.bs = bst.map_or(8.0, |b| b.every); e.xp = 0.0; e.stage = idx - 6; }
        self.enemies.push(e);
        id
    }

    fn update_enemies(&mut self, t: f64, alive: &[usize]) {
        let dt = data().consts.dt;
        let odd = (self.tick & 1) as i64;
        for i in 0..self.enemies.len() {
            if self.enemies[i].dead { continue; }
            if self.enemies[i].burn_until > t {
                let dps = self.enemies[i].burn_dps;
                self.enemies[i].hp -= dps * dt;
                if self.enemies[i].hp <= 0.0 { let o = self.enemies[i].burn_owner; self.kill(i, o); continue; }
            }
            {
                let e = &mut self.enemies[i];
                e.flash = (e.flash - 1).max(0);
                if e.kx != 0.0 || e.ky != 0.0 {
                    e.x += e.kx * dt; e.y += e.ky * dt; e.kx *= 0.8; e.ky *= 0.8;
                    if e.kx.abs() + e.ky.abs() < 1.0 { e.kx = 0.0; e.ky = 0.0; }
                }
                if e.freeze_until > t { continue; }
            }
            let (ex, ey) = (self.enemies[i].x, self.enemies[i].y);
            let mut tp = alive[0]; let mut bd = f64::INFINITY;
            for &p in alive { let d = dist2(self.players[p].x, self.players[p].y, ex, ey); if d < bd { bd = d; tp = p; } }
            let dist = { let d = bd.sqrt(); if d == 0.0 { 1.0 } else { d } };
            let (tpx, tpy) = (self.players[tp].x, self.players[tp].y);
            let (ux, uy) = ((tpx - ex) / dist, (tpy - ey) / dist);
            if dist > 340.0 && !self.enemies[i].boss {
                let a = self.rnd.next() * 6.283; let e = &mut self.enemies[i]; e.x = tpx + a.cos() * 245.0; e.y = tpy + a.sin() * 245.0; continue;
            }
            let mut sp = { let e = &self.enemies[i]; e.spd * if e.slow_until > t { 1.0 - e.slow_f } else { 1.0 } };
            let (mut mx, mut my) = (ux, uy);
            self.enemies[i].t += dt;
            let beh = self.enemies[i].beh.clone();
            match beh.as_str() {
                "zig" => { let w = (self.enemies[i].t * 5.0).sin() * 0.8; mx = ux - uy * w; my = uy + ux * w; }
                "shoot" => {
                    if dist < 75.0 {
                        sp = 0.0;
                        self.enemies[i].st -= dt;
                        if self.enemies[i].st <= 0.0 {
                            self.enemies[i].st = 2.2;
                            let id = self.nid; self.nid += 1;
                            let (x, y, dmg) = { let e = &self.enemies[i]; (e.x, e.y, e.dmg) };
                            self.ebul.push(EBul { id, x, y, vx: ux * 52.0, vy: uy * 52.0, dmg, life: 4.0 });
                        }
                    }
                }
                "dash" => {
                    let e = &mut self.enemies[i];
                    if e.st > 0.0 {
                        e.st -= dt;
                        if e.st > 0.6 { sp = 0.0; } else { mx = e.dash_x; my = e.dash_y; sp *= 3.2; }
                    } else if dist < 90.0 && e.t % 4.0 < dt { e.st = 1.1; e.dash_x = ux; e.dash_y = uy; }
                }
                "boss" => {
                    self.boss_ai(i, t, tp, dist);
                    let e = &self.enemies[i];
                    sp = e.spd * if e.slow_until > t { 1.0 - e.slow_f * 0.4 } else { 1.0 };
                }
                _ => {}
            }
            { let e = &mut self.enemies[i]; e.x += mx * sp * dt; e.y += my * sp * dt; }
            // light separation (half of the enemies each step)
            if (self.enemies[i].id & 1) == odd && !self.enemies[i].boss {
                let (ex, ey, er) = { let e = &self.enemies[i]; (e.x, e.y, e.r) };
                let (mut sx, mut sy) = (0.0, 0.0);
                for o in self.near(ex, ey, 0.0) {
                    if o == i { continue; }
                    let q = &self.enemies[o];
                    let (dx, dy) = (ex - q.x, ey - q.y);
                    let d2 = dx * dx + dy * dy; let rr = (er + q.r) * 0.9;
                    if d2 < rr * rr && d2 > 0.01 { let d = d2.sqrt(); sx += dx / d * (rr - d); sy += dy / d * (rr - d); }
                }
                let e = &mut self.enemies[i]; e.x += sx * 0.35; e.y += sy * 0.35;
            }
            // contact damage
            let (ex, ey, er, edmg) = { let e = &self.enemies[i]; (e.x, e.y, e.r, e.dmg) };
            for &p in alive {
                let rr = er + 4.0;
                if dist2(self.players[p].x, self.players[p].y, ex, ey) < rr * rr { self.hurt_player(p, edmg, ex, ey); }
            }
        }
        // enemy bullets
        let mut bullets = std::mem::take(&mut self.ebul);
        for b in bullets.iter_mut() {
            b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
            for &p in alive {
                if dist2(self.players[p].x, self.players[p].y, b.x, b.y) < 36.0 { self.hurt_player(p, b.dmg, b.x, b.y); b.life = 0.0; break; }
            }
        }
        bullets.retain(|b| b.life > 0.0);
        // bullets pushed during the loop above (none) would be lost: ebul is only filled by shooters earlier in this step
        let mut added = std::mem::take(&mut self.ebul);
        bullets.append(&mut added);
        self.ebul = bullets;
        let _ = odd;
    }

    fn boss_ai(&mut self, i: usize, t: f64, tp: usize, dist: f64) {
        let dt = data().consts.dt;
        let stages = self.dun.stages();
        let st = &stages[self.enemies[i].stage];
        let enrage = if self.enemies[i].stage + 1 == stages.len() && t > st.at + 60.0 { 1.5 } else { 1.0 };   // the last boss gets angry after a minute
        self.enemies[i].bt -= dt;
        if self.enemies[i].bt <= 0.0 {
            self.enemies[i].bt = 3.0 / enrage;
            let n = st.ring; let off = self.rnd.next() * 6.283;
            let (x, y, dmg) = { let e = &self.enemies[i]; (e.x, e.y, e.dmg) };
            for k in 0..n {
                let a = off + k as f64 / n as f64 * 6.283;
                let id = self.nid; self.nid += 1;
                self.ebul.push(EBul { id, x, y, vx: a.cos() * 45.0, vy: a.sin() * 45.0, dmg: dmg * 0.6, life: 5.0 });
            }
        }
        self.enemies[i].bs -= dt;
        if self.enemies[i].bs <= 0.0 {
            self.enemies[i].bs = st.every / enrage;
            let idx = 1.min(self.dun.roster.len() - 1);
            let (bx, by) = (self.enemies[i].x, self.enemies[i].y);
            for k in 0..st.minions {
                let _ = self.spawn(&[tp], idx);
                let m = self.enemies.len() - 1;
                self.enemies[m].x = bx + (k as f64).cos() * 20.0; self.enemies[m].y = by + (k as f64).sin() * 20.0;
            }
        }
        self.enemies[i].spd = if dist < 12.0 { 0.0 } else { self.enemies[i].arch_spd * 0.8 };
    }

    // ---------- weapons ----------
    fn fire(&mut self, pi: usize, t: f64) {
        let dt = data().consts.dt;
        let dm = self.dmg_mul(pi); let cm = self.cd_mul(pi);
        let extra = self.players[pi].cl.extra as usize;
        for wi in 0..self.players[pi].weapons.len() {
            let (wix, lvl) = { let w = &self.players[pi].weapons[wi]; (w.wix, w.lvl) };
            let d = &data().weapons[wix];
            let st = weapon_stats(wix, lvl, extra);
            let dmg = st.dmg * dm;
            if d.kind == "orbit" { self.orbit(pi, wi, &st, wix, dmg, t); continue; }
            self.players[pi].weapons[wi].cd -= dt;
            if self.players[pi].weapons[wi].cd > 0.0 { continue; }
            let cd = st.cd * cm;
            let (px, py) = (self.players[pi].x, self.players[pi].y);
            match d.kind.as_str() {
                "proj" => {
                    let ts = self.nearest(px, py, 140.0, st.count, &[]);
                    if ts.is_empty() { self.players[pi].weapons[wi].cd = 0.0; continue; }
                    for k in 0..st.count {
                        let tg = ts[k % ts.len()];
                        let (tx, ty) = (self.enemies[tg].x, self.enemies[tg].y);
                        let a = (ty - py).atan2(tx - px) + if k >= ts.len() { (k - ts.len() + 1) as f64 * 0.25 } else { 0.0 };
                        let id = self.nid; self.nid += 1;
                        self.objs.push(Obj { id, kind: OK::P, wix, x: px, y: py, vx: a.cos() * st.speed, vy: a.sin() * st.speed, ang: a, r: st.area, dmg, pierce: st.pierce, life: st.dur, owner: pi, slow: st.slow, ..Default::default() });
                    }
                    self.players[pi].weapons[wi].cd = cd;
                }
                "boomerang" => {
                    let ts = self.nearest(px, py, 150.0, st.count, &[]);
                    if ts.is_empty() { self.players[pi].weapons[wi].cd = 0.0; continue; }
                    for k in 0..st.count {
                        let tg = ts[k % ts.len()];
                        let (tx, ty) = (self.enemies[tg].x, self.enemies[tg].y);
                        let a = (ty - py).atan2(tx - px) + if k >= ts.len() { 0.5 * k as f64 } else { 0.0 };
                        let id = self.nid; self.nid += 1;
                        self.objs.push(Obj { id, kind: OK::B, wix, x: px, y: py, vx: a.cos() * st.speed, vy: a.sin() * st.speed, r: st.area, dmg, life: st.dur, max: st.dur, owner: pi, ..Default::default() });
                    }
                    self.players[pi].weapons[wi].cd = cd;
                }
                "pulse" => {
                    if self.near(px, py, st.area + 6.0).is_empty() { self.players[pi].weapons[wi].cd = 0.0; continue; }
                    let knock = st.knock * or1(self.players[pi].cl.knock);
                    for e in self.near(px, py, st.area) { self.hurt_enemy(e, dmg, Some(pi), false); self.knock(e, px, py, knock); }
                    self.emit(Ev::Ring(r1(px), r1(py), r1(st.area), wix));
                    self.players[pi].weapons[wi].cd = cd;
                }
                "chain" => {
                    let first = self.nearest(px, py, 100.0, 1, &[]).first().copied();
                    let Some(first) = first else { self.players[pi].weapons[wi].cd = 0.0; continue; };
                    let mut hit: Vec<usize> = vec![]; let mut pts = vec![r1(px), r1(py)];
                    let mut cur = Some(first); let mut dd = dmg;
                    let mut k = 0;
                    while k < st.count { let Some(c) = cur else { break };
                        hit.push(c); self.hurt_enemy(c, dd, Some(pi), false);
                        pts.push(r1(self.enemies[c].x)); pts.push(r1(self.enemies[c].y)); dd *= 0.85;
                        let (cx, cy) = (self.enemies[c].x, self.enemies[c].y);
                        cur = self.nearest(cx, cy, st.area, 1, &hit).first().copied();
                        k += 1;
                    }
                    self.emit(Ev::Chain(pts));
                    self.players[pi].weapons[wi].cd = cd;
                }
                "bomb" => {
                    let ts = self.nearest(px, py, 130.0, 6, &[]);
                    if ts.is_empty() { self.players[pi].weapons[wi].cd = 0.0; continue; }
                    for _ in 0..st.count {
                        let tg = ts[(self.rnd.next() * ts.len() as f64).floor() as usize % ts.len()];
                        let (tx, ty) = (self.enemies[tg].x, self.enemies[tg].y);
                        let id = self.nid; self.nid += 1;
                        self.objs.push(Obj { id, kind: OK::X, wix, x: px, y: py, sx: px, sy: py, tx, ty, t: st.dur, dur: st.dur, r: st.area, dmg, burn: st.burn, owner: pi, ..Default::default() });
                    }
                    self.players[pi].weapons[wi].cd = cd;
                }
                "zone" => {
                    let ts = self.nearest(px, py, 130.0, st.count.max(3), &[]);
                    if ts.is_empty() { self.players[pi].weapons[wi].cd = 0.0; continue; }
                    let zs = self.players[pi].cl.zone_slow;
                    for k in 0..st.count {
                        let tg = ts[k % ts.len()];
                        let (tx, ty) = (self.enemies[tg].x, self.enemies[tg].y);
                        let id = self.nid; self.nid += 1;
                        let slow = st.slow.max(if zs != 0.0 && wix == self.louze { zs } else { 0.0 });
                        self.objs.push(Obj { id, kind: OK::Z, wix, x: tx, y: ty, r: st.area, life: st.dur, tick: 0.0, every: st.tick, dmg, slow, owner: pi, louze: wix == self.louze, ..Default::default() });
                    }
                    self.players[pi].weapons[wi].cd = cd;
                }
                "turret" => {
                    let mine = self.objs.iter().filter(|o| o.kind == OK::T && o.owner == pi).count();
                    if mine >= st.count { self.players[pi].weapons[wi].cd = 0.0; continue; }
                    let a = self.rnd.next() * 6.283;
                    let id = self.nid; self.nid += 1;
                    self.objs.push(Obj { id, kind: OK::T, wix, x: px + a.cos() * 16.0, y: py + a.sin() * 16.0, r: 7.0, life: st.dur, cd: 0.3, rate: st.rate * cm, dmg, speed: st.speed, owner: pi, ..Default::default() });
                    self.players[pi].weapons[wi].cd = cd;
                }
                _ => {}
            }
            if self.players[pi].weapons[wi].cd > 0.0 { let id = self.players[pi].id; self.emit(Ev::Atk(r1(px), r1(py), id, wix)); }
        }
    }

    fn orbit(&mut self, pi: usize, wi: usize, st: &WStats, wix: usize, dmg: f64, t: f64) {
        let dt = data().consts.dt;
        let rev0 = (self.players[pi].weapons[wi].ang / 6.2832).floor();
        self.players[pi].weapons[wi].ang += st.speed * dt;
        if (self.players[pi].weapons[wi].ang / 6.2832).floor() != rev0 { let (x, y, id) = (r1(self.players[pi].x), r1(self.players[pi].y), self.players[pi].id); self.emit(Ev::Atk(x, y, id, wix)); }
        let ang = self.players[pi].weapons[wi].ang;
        let r = 26.0 + st.area * 0.3;
        let (px, py, pid) = (self.players[pi].x, self.players[pi].y, self.players[pi].id as i64);
        for i in 0..st.count {
            let a = ang + i as f64 / st.count as f64 * 6.283;
            let (bx, by) = (px + a.cos() * r, py + a.sin() * r);
            self.objs.push(Obj { id: -(pid * 100 + wi as i64 * 10 + i as i64), kind: OK::O, wix, x: bx, y: by, ang: a, r: 6.0, dummy: true, ..Default::default() });
            for e in self.near(bx, by, 6.0) {
                let key = pid * 10 + wi as i64;
                if self.enemies[e].dead { continue; }
                if self.enemies[e].hm.get(&key).copied().unwrap_or(0.0) > t { continue; }
                self.enemies[e].hm.insert(key, t + 0.45);
                self.hurt_enemy(e, dmg, Some(pi), false); self.knock(e, px, py, 4.0);
            }
        }
    }

    fn update_objs(&mut self, t: f64) {
        let dt = data().consts.dt;
        let mut list = std::mem::take(&mut self.objs);
        let mut keep: Vec<Obj> = Vec::with_capacity(list.len());
        let mut i = 0;
        while i < list.len() {
            let mut o = std::mem::take(&mut list[i]);
            i += 1;
            if o.dummy { keep.push(o); continue; }
            let mut live = true;
            match o.kind {
                OK::P => {
                    o.x += o.vx * dt; o.y += o.vy * dt; o.life -= dt;
                    for e in self.near(o.x, o.y, o.r) {
                        if !live || self.enemies[e].dead || o.hit.contains(&self.enemies[e].id) { continue; }
                        o.hit.push(self.enemies[e].id);
                        self.hurt_enemy(e, o.dmg, Some(o.owner), false);
                        if o.slow != 0.0 { self.slow(e, o.slow, 1.5); }
                        o.pierce -= 1;
                        if o.pierce < 0 { live = false; }
                    }
                    if o.life <= 0.0 { live = false; }
                }
                OK::B => {
                    o.life -= dt;
                    if o.life < o.max / 2.0 {
                        let (dx, dy) = (self.players[o.owner].x - o.x, self.players[o.owner].y - o.y);
                        let l = { let l = dx.hypot(dy); if l == 0.0 { 1.0 } else { l } };
                        let sp = o.vx.hypot(o.vy);
                        o.vx = dx / l * sp * 1.1; o.vy = dy / l * sp * 1.1;
                        if l < 6.0 { live = false; }
                    }
                    o.x += o.vx * dt; o.y += o.vy * dt; o.ang += 0.6;
                    for e in self.near(o.x, o.y, o.r) {
                        if self.enemies[e].dead { continue; }
                        let eid = self.enemies[e].id;
                        if o.hm.get(&eid).copied().unwrap_or(0.0) > t { continue; }
                        o.hm.insert(eid, t + 0.4);
                        self.hurt_enemy(e, o.dmg, Some(o.owner), false);
                    }
                    if o.life <= -0.5 { live = false; }
                }
                OK::X => {
                    o.t -= dt;
                    let k = 1.0 - o.t.max(0.0) / o.dur;
                    o.x = o.sx + (o.tx - o.sx) * k; o.y = o.sy + (o.ty - o.sy) * k;
                    if o.t <= 0.0 {
                        live = false;
                        self.emit(Ev::Boom(r1(o.x), r1(o.y), o.r));
                        for e in self.near(o.x, o.y, o.r) {
                            self.hurt_enemy(e, o.dmg, Some(o.owner), false);
                            if o.burn != 0.0 && !self.enemies[e].dead { self.burn(e, o.dmg * o.burn, 3.0, Some(o.owner)); }
                        }
                    }
                }
                OK::Z => {
                    o.life -= dt; o.tick -= dt;
                    if o.tick <= 0.0 {
                        o.tick = o.every;
                        for e in self.near(o.x, o.y, o.r) {
                            self.hurt_enemy(e, o.dmg, Some(o.owner), true);
                            if o.slow != 0.0 && !self.enemies[e].dead { self.slow(e, o.slow, 0.8); }
                        }
                    }
                    if o.life <= 0.0 { live = false; }
                }
                OK::T => {
                    o.life -= dt;
                    let (hx, hy) = (self.players[o.owner].x - o.x, self.players[o.owner].y - o.y);
                    let hd = hx.hypot(hy);
                    if hd > 40.0 { o.x += hx / hd * 40.0 * dt; o.y += hy / hd * 40.0 * dt; }
                    o.cd -= dt;
                    if o.cd <= 0.0 {
                        let tg = self.nearest(o.x, o.y, 110.0, 1, &[]).first().copied();
                        if let Some(tg) = tg {
                            let a = (self.enemies[tg].y - o.y).atan2(self.enemies[tg].x - o.x);
                            o.cd = 1.0 / o.rate.max(0.2);
                            let id = self.nid; self.nid += 1;
                            // like the JS version, a shot fired this step is moved in the same step
                            list.push(Obj { id, kind: OK::P, wix: o.wix, x: o.x, y: o.y, vx: a.cos() * o.speed, vy: a.sin() * o.speed, ang: a, r: 3.0, dmg: o.dmg, pierce: 0, life: 1.2, owner: o.owner, ..Default::default() });
                        } else { o.cd = 0.2; }
                    }
                    if o.life <= 0.0 { live = false; }
                }
                OK::O => {}
            }
            if live { keep.push(o); }
        }
        self.objs = keep;
    }

    // ---------- pickups, levels ----------
    fn update_picks(&mut self, alive: &[usize]) {
        let picks = std::mem::take(&mut self.picks);
        let mut keep: Vec<Pick> = Vec::with_capacity(picks.len());
        let mut all_mag = false;
        for mut g in picks {
            if all_mag && g.tier <= 3 { g.mag = true; }
            let mut taken = false;
            let mut best: Option<usize> = None; let mut bd = f64::INFINITY;
            for &pi in alive {
                let p = &self.players[pi];
                let d2 = dist2(p.x, p.y, g.x, g.y);
                let rad = if g.tier <= 3 { PICKUP_R * p.st.magnet * or1(p.cl.magnet) * (1.0 + 0.25 * Self::pl(p, "magnet") as f64) } else { TOUCH_R };
                if d2 < bd { bd = d2; best = Some(pi); }
                if g.mag || d2 < rad * rad { g.mag = true; best = Some(pi); bd = d2; break; }
            }
            if let (Some(b), true) = (best, g.mag) {
                let d = { let d = bd.sqrt(); if d == 0.0 { 1.0 } else { d } };
                let sp = 140.0 * data().consts.dt;
                let (bx, by) = (self.players[b].x, self.players[b].y);
                g.x += (bx - g.x) / d * sp.min(d); g.y += (by - g.y) / d * sp.min(d);
                if d < 5.0 { if self.take(b, &g, alive) { all_mag = true; } taken = true; }
            }
            if !taken { keep.push(g); }
        }
        if all_mag { for g in keep.iter_mut().filter(|g| g.tier <= 3) { g.mag = true; } }
        self.picks = keep;
        if self.picks.len() > 400 { let n = self.picks.len() - 400; self.picks.drain(0..n); }
    }
    /// Returns true when the pickup was a magnet.
    fn take(&mut self, pi: usize, g: &Pick, alive: &[usize]) -> bool {
        let pid = self.players[pi].id;
        match g.tier {
            0..=2 => {
                self.add_xp(pi, g.v);
                let (px, py) = (self.players[pi].x, self.players[pi].y);
                for &q in alive { if q != pi && dist2(self.players[q].x, self.players[q].y, px, py) < 150.0 * 150.0 { self.add_xp(q, g.v * 0.5); } }
                self.emit(Ev::Personal('g', pid));
            }
            3 => { let m = or1(self.players[pi].cl.coins); self.players[pi].coins += g.v * m; self.emit(Ev::Personal('$', pid)); }
            4 => { let p = &mut self.players[pi]; p.hp = (p.hp + p.max_hp * 0.25).min(p.max_hp); self.emit(Ev::Personal('+', pid)); }
            5 => { self.emit(Ev::Personal('M', pid)); return true; }
            6 => { self.players[pi].coins += 15.0; let c = self.choices(pi); self.players[pi].pending.push(c); self.emit(Ev::Personal('C', pid)); }
            _ => {}
        }
        false
    }
    fn add_xp(&mut self, pi: usize, v: f64) {
        let mul = { let p = &self.players[pi]; or1(p.cl.xp) * (1.0 + 0.1 * Self::pl(p, "moudrost") as f64) };
        self.players[pi].xp += v * mul;
        while self.players[pi].xp >= lvl_need(self.players[pi].level) {
            let need = lvl_need(self.players[pi].level);
            self.players[pi].xp -= need; self.players[pi].level += 1;
            let c = self.choices(pi); self.players[pi].pending.push(c);
            let id = self.players[pi].id; self.emit(Ev::Personal('L', id));
        }
    }
    fn choices(&mut self, pi: usize) -> Vec<Choice> {
        let c = &data().consts;
        let mut pool: Vec<Choice> = vec![];
        let p = &self.players[pi];
        for w in &p.weapons { if w.lvl < c.max_item_lvl { pool.push(Choice('w', data().weapons[w.wix].id.clone(), w.lvl + 1)); } }
        if p.weapons.len() < c.max_weapons { for (wi, w) in data().weapons.iter().enumerate() { if !p.weapons.iter().any(|x| x.wix == wi) { pool.push(Choice('w', w.id.clone(), 1)); } } }
        for &(k, l) in &p.passives { if l < c.max_item_lvl { pool.push(Choice('p', data().passives[k].clone(), l + 1)); } }
        if p.passives.len() < c.max_passives { for (k, q) in data().passives.iter().enumerate() { if !p.passives.iter().any(|(x, _)| *x == k) { pool.push(Choice('p', q.clone(), 1)); } } }
        let mut out = vec![];
        while out.len() < 3 && !pool.is_empty() {
            let i = (self.rnd.next() * pool.len() as f64).floor() as usize % pool.len();
            out.push(pool.remove(i));
        }
        if out.is_empty() { out.push(Choice('h', "heal".to_string(), 0)); }
        out
    }
    pub fn choose(&mut self, id: u32, i: i64) -> bool {
        if id == 0 || id as usize > self.players.len() { return false; }
        let pi = id as usize - 1;
        if self.players[pi].pending.is_empty() || i < 0 { return false; }
        let Some(c) = self.players[pi].pending[0].get(i as usize).cloned() else { return false };
        self.players[pi].pending.remove(0);
        match c.0 {
            'w' => {
                let wix = weapon_idx(&c.1);
                if let Some(w) = self.players[pi].weapons.iter_mut().find(|w| w.wix == wix) { w.lvl = c.2; }
                else { self.players[pi].weapons.push(PWeapon { wix, lvl: 1, cd: 0.3, ang: 0.0 }); }
            }
            'p' => {
                let k = data().passives.iter().position(|x| *x == c.1).unwrap_or(0);
                let p = &mut self.players[pi];
                if let Some(e) = p.passives.iter_mut().find(|(x, _)| *x == k) { e.1 = c.2; } else { p.passives.push((k, c.2)); }
                Self::recalc(p);
            }
            _ => { let p = &mut self.players[pi]; p.hp = (p.hp + p.max_hp * 0.5).min(p.max_hp); }
        }
        true
    }

    // ---------- view ----------
    /// Snapshot for one player. `evs` lets the caller pass the events of several steps (the server sends every second step).
    pub fn snapshot(&self, pid: u32, evs: Option<&[Ev]>) -> Value {
        let me = &self.players[pid as usize - 1];
        let r2 = CULL * CULL;
        let near = |x: f64, y: f64| dist2(x, y, me.x, me.y) < r2;
        let now = self.now();
        let evs: &[Ev] = evs.unwrap_or(&self.ev);
        let mut v: Vec<Value> = vec![];
        for e in evs {
            match e {
                Ev::Personal(k, id) => { if *id == pid { v.push(json!([k.to_string(), id])); } }
                Ev::BossWarn(n) => v.push(json!(["B", n])),
                Ev::Shrine(i, held) => v.push(json!(["S", i, if *held { 1 } else { 0 }])),
                Ev::Chain(pts) => { if near(pts[0], pts[1]) { v.push(json!(["c", pts])); } }
                Ev::Hit(x, y) => { if near(*x, *y) { v.push(json!(["h", x, y])); } }
                Ev::Crit(x, y) => { if near(*x, *y) { v.push(json!(["k", x, y])); } }
                Ev::Die(x, y, b) => { if near(*x, *y) { v.push(json!(["d", x, y, b])); } }
                Ev::Ring(x, y, r, w) => { if near(*x, *y) { v.push(json!(["r", x, y, r, w])); } }
                Ev::Atk(x, y, id, w) => { if near(*x, *y) { v.push(json!(["a", x, y, id, w])); } }
                Ev::Boom(x, y, r) => { if near(*x, *y) { v.push(json!(["b", x, y, r])); } }
            }
        }
        let players: Vec<Value> = self.players.iter().map(|p| json!([p.id, r1(p.x), r1(p.y), p.hp.ceil(), p.max_hp, if p.dead { 1 } else { 0 }, p.face, if p.inv > 0.0 { 1 } else { 0 }, r1(p.rev)])).collect();
        let mut es: Vec<Value> = vec![];
        for e in &self.enemies {
            if e.dead || !near(e.x, e.y) { continue; }
            let hpq = if e.max_hp != 0.0 { js_round(e.hp / e.max_hp * 100.0).max(1.0) } else { 100.0 };
            let flags = (if e.flash != 0 { 1 } else { 0 }) | (if e.freeze_until > now { 2 } else { 0 }) | (if e.burn_until > now { 4 } else { 0 }) | (if e.slow_until > now { 8 } else { 0 }) | (if e.boss && self.shielded(e.stage) { 16 } else { 0 });
            es.push(json!([e.id, e.typ, r1(e.x), r1(e.y), hpq, flags]));
        }
        let os: Vec<Value> = self.objs.iter().filter(|o| near(o.x, o.y)).map(|o| json!([o.id, o.wix, r1(o.x), r1(o.y), r1(o.ang), r1(o.r), if o.kind == OK::Z { js_round(o.life * 10.0) / 10.0 } else { 0.0 }])).collect();
        let bs: Vec<Value> = self.ebul.iter().filter(|b| near(b.x, b.y)).map(|b| json!([b.id, r1(b.x), r1(b.y)])).collect();
        let gs: Vec<Value> = self.picks.iter().filter(|g| near(g.x, g.y)).map(|g| json!([g.id, g.tier, r1(g.x), r1(g.y)])).collect();
        let mut ps = serde_json::Map::new();
        for &(k, l) in &me.passives { ps.insert(data().passives[k].clone(), json!(l)); }
        let boss_pct = match self.enemies.iter().find(|e| e.boss && !e.dead) { Some(b) => js_round(b.hp / b.max_hp * 100.0).max(1.0), None => 0.0 };
        let ch = me.pending.first().map(|c| c.iter().map(|Choice(k, id, l)| json!([k.to_string(), id, l])).collect::<Vec<_>>());
        let mut s = json!({
            "k": self.tick, "T": r1(now), "p": players, "e": es, "o": os, "b": bs, "g": gs, "v": v,
            "me": { "xp": me.xp.floor(), "need": lvl_need(me.level), "level": me.level, "coins": me.coins.floor(), "kills": me.kills, "spd": r1(me.spd), "pend": me.pending.len(),
                    "ch": ch, "w": me.weapons.iter().map(|w| json!([w.wix, w.lvl])).collect::<Vec<_>>(), "ps": ps, "dead": me.dead, "boss": boss_pct, "shield": self.enemies.iter().any(|e| e.boss && !e.dead && self.shielded(e.stage)) },
        });
        if !self.shrines.is_empty() {
            s["sh"] = json!(self.shrines.iter().map(|h| json!([js_round(h.x) as i64, js_round(h.y) as i64, js_round(h.prog * 100.0) as i64, if h.held { 1 } else { 0 }])).collect::<Vec<_>>());
        }
        if let Some(o) = &self.over {
            s["over"] = json!({ "cleared": o.cleared, "time": o.time, "players": o.players.iter().enumerate().map(|(i, p)| json!({ "id": i + 1, "kills": p.kills, "coins": p.coins, "reward": p.reward, "dead": self.players[i].dead })).collect::<Vec<_>>() });
        }
        s
    }

    pub fn events(&self) -> &[Ev] { &self.ev }
    /// A player who left the room: down for good, no revive.
    pub fn kill_player(&mut self, pid: u32) { if let Some(p) = self.players.get_mut(pid as usize - 1) { p.hp = 0.0; p.dead = true; p.gone = true; } }
    pub fn dungeon_id(&self) -> &str { &self.dun.id }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::{new_char, Equip};

    fn input(cls: &str, level: u32) -> SimPlayerIn {
        let mut e = Equip::new();
        let k = (1 + level / 6).min(20);
        e.armor = k; e.ring = k; e.boots = k;
        let held = if level > 1 { format!("sword{}", (1 + level / 20).min(4)) } else { "staff1".to_string() };
        SimPlayerIn { name: "bot".into(), cls: cls.into(), level, equip: if level > 1 { e } else { Equip::new() }, arms: std::collections::BTreeMap::from([(held.clone(), (k - 1).min(9))]), held }
    }

    // Port of tools/bot.js: flees from enemies, collects gems, always takes the first upgrade.
    fn bot_step(sim: &mut Sim, pi: usize) {
        let id = sim.players[pi].id;
        if sim.players[pi].dead { sim.set_input(id, 0.0, 0.0); return; }
        while !sim.players[pi].pending.is_empty() { sim.choose(id, 0); }
        let (px, py) = (sim.players[pi].x, sim.players[pi].y);
        let (mut fx, mut fy) = (0.0f64, 0.0f64);
        for e in &sim.enemies {
            let (dx, dy) = (px - e.x, py - e.y);
            let d2 = dx * dx + dy * dy; let r = 60.0 + e.r;
            if d2 < r * r && d2 > 0.01 { let d = d2.sqrt(); let w = (r - d) / r; let k = if e.boss { 2.0 } else { 1.0 }; fx += dx / d * w * w * k; fy += dy / d * w * w * k; }
        }
        for b in &sim.ebul { let (dx, dy) = (px - b.x, py - b.y); let d2 = dx * dx + dy * dy; if d2 < 900.0 && d2 > 0.01 { let d = d2.sqrt(); fx += dx / d * 0.8; fy += dy / d * 0.8; } }
        let mut best: Option<(f64, f64)> = None; let mut bd = 1e9;
        for g in &sim.picks { let d = dist2(g.x, g.y, px, py); if d < bd && d < 90.0 * 90.0 { bd = d; best = Some((g.x, g.y)); } }
        if fx.hypot(fy) < 0.6 {            // team dungeons: go and hold the shrines together (everyone heads for the same one)
            if let Some(h) = sim.shrines.iter().find(|h| !h.held) {
                let (dx, dy) = (h.x - px, h.y - py); let d = dx.hypot(dy);
                if d > 12.0 { fx += dx / d * 0.9; fy += dy / d * 0.9; }
            }
        }
        if let Some((gx, gy)) = best { if fx.hypot(fy) < 0.6 { let d = bd.sqrt().max(1e-9); fx += (gx - px) / d * 0.7; fy += (gy - py) / d * 0.7; } }
        if fx.hypot(fy) < 0.05 { let a = sim.tick as f64 * 0.02 + id as f64; fx = a.cos() * 0.3; fy = a.sin() * 0.3; }
        sim.set_input(id, fx, fy);
    }
    fn run_bot(dun: &str, players: Vec<SimPlayerIn>, seed: u32) -> Sim {
        let mut sim = Sim::new(seed, dun, players);
        while sim.over.is_none() && (sim.tick as f64) * data().consts.dt < 900.0 { for pi in 0..sim.players.len() { bot_step(&mut sim, pi); } sim.step(); }
        sim
    }

    #[test]
    fn rng_matches_js_mulberry32() {
        let mut r = Rng::new(42);
        let got: Vec<f64> = (0..5).map(|_| r.next()).collect();
        let want = [0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693, 0.17481389874592423];
        for (g, w) in got.iter().zip(want) { assert!((g - w).abs() < 1e-15, "{got:?}"); }
    }

    #[test]
    fn gems_and_coins_that_land_together_fuse() {
        let mut sim = Sim::new(5, "s1", vec![input("bohatyr", 1)]);
        sim.picks.clear();
        sim.drop(100.0, 100.0, 0, 1.0); sim.drop(103.0, 101.0, 0, 1.0); sim.drop(101.0, 99.0, 0, 1.0); sim.drop(300.0, 300.0, 0, 1.0); sim.drop(100.0, 100.0, 3, 1.0); sim.drop(100.0, 100.0, 4, 0.0);
        assert_eq!(sim.picks.len(), 4);
        assert_eq!((sim.picks[0].v, sim.picks[0].tier), (3.0, 1));
    }
    #[test]
    fn every_class_and_dungeon_runs() {
        for d in &data().dungeons { for c in &data().classes {
            let mut sim = Sim::new(3, &d.id, vec![input(&c.id, 1)]);
            for i in 0..20 * 30 { if sim.over.is_some() { break; } sim.set_input(1, (i as f64 / 40.0).cos(), (i as f64 / 40.0).sin()); while !sim.players[0].pending.is_empty() { sim.choose(1, 0); } sim.step(); }
        } }
    }

    #[test]
    fn deterministic() {
        let run = || { let mut s = Sim::new(42, "s2", vec![input("perun", 5), input("golem", 9)]);
            for i in 0..20 * 90 { s.set_input(1, (i as f64 / 30.0).sin(), (i as f64 / 50.0).cos()); s.set_input(2, (i as f64 / 30.0).cos(), 0.3); for p in 0..2 { while !s.players[p].pending.is_empty() { s.choose(p as u32 + 1, 1); } } s.step(); }
            s.snapshot(1, None).to_string() };
        assert_eq!(run(), run());
    }

    #[test]
    fn difficulty_follows_the_strongest_player() {
        let low = Sim::new(1, "m1", vec![input("bohatyr", 1), input("bohatyr", 20)]);
        let solo = Sim::new(1, "m1", vec![input("bohatyr", 1)]);
        let strong = Sim::new(1, "m1", vec![input("bohatyr", 20)]);
        assert!(low.e_mul > solo.e_mul * 1.4 && low.e_mul > strong.e_mul);
        assert!(low.players[0].reward > 1.3 && low.players[0].reward > low.players[1].reward);
    }

    #[test]
    fn revive_boss_and_failure() {
        let mut s = Sim::new(9, "m1", vec![input("bohatyr", 1), input("bohatyr", 1)]);
        s.players[0].dead = true; s.players[0].hp = 0.0; s.players[0].x = 0.0; s.players[0].y = 0.0; s.players[1].x = 0.0; s.players[1].y = 0.0;
        for _ in 0..80 { s.step(); }
        assert!(!s.players[0].dead && s.players[0].hp > 0.0);
        let mut b = Sim::new(2, "s1", vec![input("golem", 30)]);
        b.tick = 20 * 301; for _ in 0..3 { b.step(); }      // a late start spawns the three bosses one after another
        let bi = b.enemies.iter().position(|e| e.boss && e.stage == 2).expect("last boss spawned");
        b.hurt_enemy(bi, 1e9, Some(0), false);
        assert!(b.over.as_ref().unwrap().cleared);
        let mut f = Sim::new(2, "s1", vec![input("bohatyr", 1)]);
        f.players[0].dead = true; f.step();
        assert!(!f.over.as_ref().unwrap().cleared);
    }

    #[test]
    fn three_bosses_each_tougher_only_the_last_clears() {
        let mut s = Sim::new(4, "s1", vec![input("golem", 30)]);
        let mut hp = vec![];
        for (i, at) in s.dun.stages().iter().map(|b| b.at).collect::<Vec<_>>().into_iter().enumerate() {
            s.tick = (at * 20.0).round() as u64 + 1; s.step();
            let bi = s.enemies.iter().position(|e| e.boss && e.stage == i).expect("boss spawned");
            assert!(!s.enemies.iter().any(|e| e.boss && e.stage == i + 1));
            hp.push(s.enemies[bi].max_hp);
            if i < 2 { s.hurt_enemy(bi, 1e9, Some(0), false); assert!(s.over.is_none()); assert!(s.picks.iter().any(|g| g.tier == 6)); }
        }
        assert!(hp[0] < hp[1] && hp[1] < hp[2]);
        let t = s.enemies.iter().position(|e| e.boss && e.stage == 2).unwrap();
        s.hurt_enemy(t, 1e9, Some(0), false); assert!(s.over.as_ref().unwrap().cleared);
    }

    #[test]
    fn team_runs_last_ten_minutes_and_shrines_gate_the_boss() {
        assert_eq!(Sim::new(1, "s1", vec![input("golem", 30)]).hard_end(), 480.0);
        let mut s = Sim::new(5, "m1", vec![input("golem", 30), input("golem", 30)]);
        assert_eq!(s.hard_end(), 720.0);
        assert_eq!(s.shrines.len(), 3);
        s.tick = 20 * 121; s.step();
        let bi = s.enemies.iter().position(|e| e.boss && e.stage == 0).expect("first boss");
        let hp = s.enemies[bi].hp;
        s.hurt_enemy(bi, 1e6, Some(0), false);
        assert_eq!(s.enemies[bi].hp, hp, "a boss is shielded while no shrine is held");
        // one player alone cannot take a shrine: two are needed
        let (sx, sy) = (s.shrines[0].x, s.shrines[0].y);
        let hold = |s: &mut Sim, both: bool| for _ in 0..20 * 10 {
            s.enemies.retain(|e| e.boss);
            s.players[0].x = sx; s.players[0].y = sy; s.players[1].x = if both { sx } else { sx + 90.0 }; s.players[1].y = sy;
            for p in s.players.iter_mut() { p.hp = p.max_hp; }
            s.step();
        };
        hold(&mut s, false);
        assert_eq!(s.held(), 0);
        hold(&mut s, true);
        assert_eq!(s.held(), 1);
        let bi = s.enemies.iter().position(|e| e.boss && e.stage == 0).unwrap();
        let hp = s.enemies[bi].hp;
        s.hurt_enemy(bi, 10.0, Some(0), false);
        assert!(s.enemies[bi].hp < hp, "one shrine opens the first boss");
        assert!(s.shielded(2), "the last boss wants every shrine");
    }

    #[test]
    fn bad_input_is_ignored_and_snapshots_stay_small() {
        let mut s = Sim::new(1, "s1", vec![input("bohatyr", 1)]);
        s.set_input(1, f64::NAN, 1.0); s.set_input(7, 1.0, 1.0); s.set_input(1, 1e9, 1e9);
        assert!(s.players[0].dx.hypot(s.players[0].dy) <= 1.0001);
        assert!(!s.choose(1, 0) && !s.choose(9, 0));
        for _ in 0..20 * 120 { s.set_input(1, 1.0, 0.0); while !s.players[0].pending.is_empty() { s.choose(1, 0); } s.step(); }
        assert!(s.snapshot(1, None).to_string().len() < 20000);
    }

    #[test]
    fn bot_clears_the_first_dungeon() {
        let wins = (1..=4).filter(|&seed| run_bot("s1", vec![input("bohatyr", 1)], seed).over.unwrap().cleared).count();
        assert!(wins >= 2, "wins {wins}");
    }

    /// cargo test --release cost -- --ignored --nocapture : server CPU per second of play
    #[test]
    #[ignore]
    fn cost() {
        for (dun, lvls) in [("s1", vec![1u32]), ("s3", vec![18]), ("m3", vec![25, 25, 25, 25]), ("r1", vec![40, 40, 40, 40])] {
            let players = lvls.iter().enumerate().map(|(i, &l)| input(&data().classes[i * 3 % 12].id, l)).collect();
            let mut sim = Sim::new(7, dun, players);
            let (mut st, mut sn, mut bytes, mut steps, mut snaps, mut maxe) = (0f64, 0f64, 0usize, 0u32, 0u32, 0usize);
            while sim.over.is_none() && (sim.tick as f64) * data().consts.dt < 300.0 {
                for pi in 0..sim.players.len() { bot_step(&mut sim, pi); }
                for pi in 0..sim.players.len() { sim.players[pi].hp = sim.players[pi].max_hp; }   // keep alive: measure a full 5 min
                let t = std::time::Instant::now(); sim.step(); st += t.elapsed().as_secs_f64(); steps += 1;
                maxe = maxe.max(sim.enemies.len());
                if sim.tick % 2 == 0 { for pid in 1..=sim.players.len() as u32 { let t = std::time::Instant::now(); let v = sim.snapshot(pid, None); let j = v.to_string(); sn += t.elapsed().as_secs_f64(); bytes += j.len(); snaps += 1; } }
            }
            let secs = steps as f64 * data().consts.dt;
            println!("{dun} {}p: step {:.0} us, snapshot {:.0} us, CPU {:.1} % of one core, {:.1} kB/s per player, max enemies {maxe}", lvls.len(), st / steps as f64 * 1e6, sn / snaps as f64 * 1e6, (st + sn) / secs * 100.0, bytes as f64 / secs / 1000.0 / lvls.len() as f64);
        }
    }

    /// One scenario, one JSON line. HORDE_DUN=s2 HORDE_LVLS=8 (one level per player: "12,12,12")
    /// HORDE_CLASSES=perun,vedma,golem (optional fixed party; else every class leads once, others rotate in)
    /// HORDE_BOT=normal|idle   HORDE_SEEDS=30 HORDE_SEED0=0
    /// cargo test --release sweep -- --ignored --nocapture | grep '^{'
    #[test]
    #[ignore]
    fn sweep() {
        let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
        let dun = env("HORDE_DUN", "s1");
        let lvls: Vec<u32> = env("HORDE_LVLS", "1").split(',').filter_map(|v| v.trim().parse().ok()).collect();
        let fixed: Vec<String> = env("HORDE_CLASSES", "").split(',').filter(|v| !v.is_empty()).map(String::from).collect();
        let (seeds, seed0): (u32, u32) = (env("HORDE_SEEDS", "10").parse().unwrap_or(10), env("HORDE_SEED0", "0").parse().unwrap_or(0));
        let idle = env("HORDE_BOT", "normal") == "idle";
        assert!(!lvls.is_empty() && (fixed.is_empty() || fixed.len() == lvls.len()), "HORDE_CLASSES needs one class per level");
        let parties: Vec<Vec<String>> = if fixed.is_empty() { (0..data().classes.len()).map(|ci| (0..lvls.len()).map(|i| data().classes[(ci + i * 3) % 12].id.clone()).collect()).collect() } else { vec![fixed.clone()] };
        let (mut n, mut win, mut tt) = (0u32, 0u32, 0.0f64); let mut times: Vec<f64> = vec![]; let mut by_class = serde_json::Map::new(); let mut end_min = std::collections::BTreeMap::<u32, u32>::new();
        for party in &parties {
            let mut cw = 0u32;
            for seed in seed0 + 1..=seed0 + seeds {
                let players = party.iter().zip(&lvls).map(|(c, &l)| input(c, l)).collect();
                let mut sim = Sim::new(seed, &dun, players);
                while sim.over.is_none() && (sim.tick as f64) * data().consts.dt < 900.0 { for pi in 0..sim.players.len() { if idle { let id = sim.players[pi].id; sim.set_input(id, 0.0, 0.0); } else { bot_step(&mut sim, pi); } } sim.step(); }
                let o = sim.over.unwrap(); n += 1; tt += o.time; times.push(o.time);
                if o.cleared { win += 1; cw += 1; } else { *end_min.entry((o.time / 60.0) as u32).or_insert(0) += 1; }
            }
            by_class.insert(party[0].clone(), serde_json::json!(cw * 100 / seeds));
        }
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("{}", serde_json::json!({"dun": dun, "lvls": lvls, "classes": fixed, "bot": if idle { "idle" } else { "normal" }, "runs": n, "clear_pct": (win as f64 * 1000.0 / n as f64).round() / 10.0,
            "avg_time_s": (tt / n as f64).round(), "median_time_s": times[times.len() / 2].round(), "deaths_by_minute": end_min, "clear_by_lead_class_pct": if fixed.is_empty() { serde_json::Value::Object(by_class) } else { serde_json::Value::Null }}));
    }

    /// cargo test --release balance -- --ignored --nocapture  (same matrix as tools/balance.js)
    #[test]
    #[ignore]
    fn balance() {
        let scen: [(&str, &str, &[u32]); 8] = [("s1 lvl1", "s1", &[1]), ("s2 lvl8", "s2", &[8]), ("s3 lvl18", "s3", &[18]), ("m1 2x lvl5", "m1", &[5, 5]), ("m2 3x lvl12", "m2", &[12, 12, 12]), ("m3 4x lvl25", "m3", &[25, 25, 25, 25]), ("r1 4x lvl40", "r1", &[40, 40, 40, 40]), ("m1 lvl1+lvl20", "m1", &[1, 20])];
        for (label, dun, lvls) in scen {
            let (mut win, mut n, mut tt) = (0, 0, 0.0);
            let seeds: u32 = std::env::var("HORDE_SEEDS").ok().and_then(|v| v.parse().ok()).unwrap_or(2);   // HORDE_SEEDS=25 -> 25 runs per class
            let seed0: u32 = std::env::var("HORDE_SEED0").ok().and_then(|v| v.parse().ok()).unwrap_or(0);   // HORDE_SEED0=100: seeds 101.. (parallel workers use different ranges)
            let mut by_class = String::new();
            for (ci, c) in data().classes.iter().enumerate() { let mut cw = 0; for seed in seed0 + 1..=seed0 + seeds {
                let players = lvls.iter().enumerate().map(|(i, &l)| input(&data().classes[(ci + i * 3) % 12].id, l)).collect();
                let sim = run_bot(dun, players, seed); let o = sim.over.unwrap();
                n += 1; tt += o.time; if o.cleared { win += 1; cw += 1; }
            } by_class += &format!(" {}={}%", c.id, cw * 100 / seeds); }
            println!("{label:<16} runs {n} clear {}%  avg time {}s  by class:{by_class}", win * 100 / n, (tt / n as f64).round());
        }
        let _ = new_char(1, "x", "perun");
    }
}
