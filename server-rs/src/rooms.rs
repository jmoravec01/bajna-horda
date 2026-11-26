// Co-op rooms (port of server/rooms.js). Every account owns one room (its code); friends connect to it over a WebSocket.
use crate::data::{data, dungeon};
use crate::db::Db;
use crate::meta::{add_to_bag, apply_run, boss_drops, chest_items, new_char, power, valid_name, Char, RunResult};
use crate::sim::{Ev, Sim, SimPlayerIn};
use serde_json::{json, Value};
use std::collections::HashMap;
use rand::RngCore;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc::Sender;

pub enum Out { Text(String), Close(u16), Ping }

struct Member {
    id: u64, tx: Sender<Out>, user_id: Option<i64>, name: String, cls: String, ch: Option<Char>, room: Option<String>, pid: u32, left: bool,
    msgs: u32, tick: Instant, last_seen: Instant, born: Instant, misses: u8, ip: String, chest: Option<u64>,
}
/// The end-of-run chest (20 % after a clear): every player of the run sees it, the first one to open it takes everything.
struct Chest { items: Vec<String>, members: Vec<u64>, by: Option<String>, born: Instant }
const CHEST_SECS: u64 = 120;
struct Room {
    code: String, owner_id: i64, owner_name: String, members: Vec<u64>, running: bool, dun: String, sim: Option<Sim>, evbuf: Vec<Ev>, last: Instant, acc: f64, gen: u64, solo: bool,
}
#[derive(Default)]
struct State { ip_miss: HashMap<String, (u32, Instant)>, rooms: HashMap<String, Room>, members: HashMap<u64, Member>, by_user: HashMap<i64, u64>, next_id: u64, next_gen: u64, chests: HashMap<u64, Chest>, next_chest: u64 }

#[derive(Clone)]
pub struct Hub { st: Arc<Mutex<State>>, db: Arc<Db> }

pub struct Who { pub user_id: Option<i64>, pub name: String, pub cls: String, pub char_id: i64, pub ip: String }

impl Hub {
    pub fn new(db: Arc<Db>) -> Hub { Hub { st: Arc::new(Mutex::new(State { next_id: 1, ..Default::default() })), db } }
    fn lock(&self) -> std::sync::MutexGuard<'_, State> { self.st.lock().unwrap_or_else(|e| e.into_inner()) }

    pub fn stats(&self) -> (usize, usize) { let s = self.lock(); (s.rooms.len(), s.rooms.values().map(|r| r.members.len()).sum()) }

    pub fn connect(&self, tx: Sender<Out>, who: Who) -> u64 {
        let mut s = self.lock();
        let id = s.next_id; s.next_id += 1;
        if let Some(uid) = who.user_id {                // a second connection of the same account replaces the first
            if let Some(old) = s.by_user.get(&uid).copied() {
                if let Some(m) = s.members.get(&old) { send(m, json!({"t": "err", "code": "busy"})); let _ = m.tx.try_send(Out::Close(1000)); }
                self.leave_locked(&mut s, old);
                s.members.remove(&old);
            }
            s.by_user.insert(uid, id);
        }
        let ch = match who.user_id {
            Some(uid) => (if who.char_id != 0 { self.db.get_char(who.char_id, uid) } else { None }).or_else(|| self.db.load_profile(uid).and_then(|p| p.chars.into_iter().next())),
            None => Some(new_char(0, &who.name, &who.cls)),   // guests join with a fresh level-1 character
        };
        s.members.insert(id, Member { id, tx, user_id: who.user_id, name: who.name, cls: who.cls, ch, room: None, pid: 0, left: false, msgs: 0, tick: Instant::now(), last_seen: Instant::now(), born: Instant::now(), misses: 0, ip: who.ip, chest: None });
        id
    }

    pub fn closed(&self, id: u64) {
        let mut s = self.lock();
        self.leave_locked(&mut s, id);
        if let Some(m) = s.members.remove(&id) { if let Some(uid) = m.user_id { if s.by_user.get(&uid) == Some(&id) { s.by_user.remove(&uid); } } }
    }
    pub fn touch(&self, id: u64) { if let Some(m) = self.lock().members.get_mut(&id) { m.last_seen = Instant::now(); } }

    pub fn heartbeat(&self) {
        let mut s = self.lock();
        s.chests.retain(|_, c| c.born.elapsed().as_secs() < CHEST_SECS);
        for m in s.members.values() {
            let waits_for_chest = m.chest.is_some_and(|c| s.chests.contains_key(&c));
            if m.last_seen.elapsed().as_secs() > 70 || (m.room.is_none() && m.born.elapsed().as_secs() > 45 && !waits_for_chest) { let _ = m.tx.try_send(Out::Close(1001)); } else { let _ = m.tx.try_send(Out::Ping); }
        }
    }

    pub fn handle(&self, id: u64, text: &str) {
        let mut s = self.lock();
        {
            let Some(m) = s.members.get_mut(&id) else { return };
            if m.tick.elapsed().as_millis() > 1000 { m.tick = Instant::now(); m.msgs = 0; }
            m.msgs += 1;
            if m.msgs > 90 { let _ = m.tx.try_send(Out::Close(1008)); return; }
        }
        let Ok(d) = serde_json::from_str::<Value>(text) else { return };
        let Some(t) = d.get("t").and_then(|v| v.as_str()) else { return };
        let num = |k: &str| d.get(k).map(crate::js_number).unwrap_or(f64::NAN);
        let room_code = s.members.get(&id).and_then(|m| m.room.clone());
        match t {
            "ping" => { let n = num("n"); let n = if n.is_finite() && n != 0.0 { n } else { 0.0 }; if let Some(m) = s.members.get(&id) { send(m, json!({"t": "pong", "n": n})); } }
            "open" => self.open(&mut s, id),
            "solo" => { let dun = d.get("dun").and_then(|v| v.as_str()).unwrap_or("").to_string(); self.solo(&mut s, id, &dun); }
            "join" => { let code: String = d.get("code").and_then(|v| v.as_str()).unwrap_or("").to_uppercase().chars().take(8).collect(); self.join(&mut s, id, &code); }
            "in" => {
                if let (Some(code), Some(m)) = (room_code, s.members.get(&id)) {
                    let (pid, left) = (m.pid, m.left);
                    if let Some(sim) = s.rooms.get_mut(&code).and_then(|r| r.sim.as_mut()) { if pid != 0 && !left { sim.set_input(pid, num("dx"), num("dy")); } }
                }
            }
            "pick" => {
                if let (Some(code), Some(m)) = (room_code, s.members.get(&id)) {
                    let (pid, left) = (m.pid, m.left);
                    let i = num("i"); let i = if i.is_finite() { i.trunc() as i64 } else { 0 };
                    if let Some(sim) = s.rooms.get_mut(&code).and_then(|r| r.sim.as_mut()) { if pid != 0 && !left { sim.choose(pid, i); } }
                }
            }
            "dun" => {
                let Some(code) = room_code else { return };
                let Some(room) = s.rooms.get(&code) else { return };
                if room.running || !self.is_host(&s, room, id) { return; }
                let want = d.get("dun").and_then(|v| v.as_str()).unwrap_or("");
                let multi: Vec<&str> = data().dungeons.iter().filter(|x| x.mode == "multi").map(|x| x.id.as_str()).collect();
                let unlocked = self.db.load_profile(room.owner_id).map(|p| p.multi).unwrap_or(1);
                if let Some(i) = multi.iter().position(|x| *x == want) { if i < unlocked { let w = want.to_string(); s.rooms.get_mut(&code).unwrap().dun = w; self.broadcast(&s, &code); } }
            }
            "char" => {
                let Some(code) = room_code else { return };
                if s.rooms.get(&code).map(|r| r.running).unwrap_or(true) { return; }
                let Some(uid) = s.members.get(&id).and_then(|m| m.user_id) else { return };
                let cid = num("id"); let cid = if cid.is_finite() { cid.trunc() as i64 } else { 0 };
                if let Some(c) = self.db.get_char(cid, uid) { s.members.get_mut(&id).unwrap().ch = Some(c); self.broadcast(&s, &code); }
            }
            "start" => {
                let Some(code) = room_code else { return };
                let ok = s.rooms.get(&code).map(|r| !r.running && self.is_host(&s, r, id)).unwrap_or(false);
                if ok { self.start_run(&mut s, &code); }
            }
            "loot" => self.loot(&mut s, id),
            "leave" => self.leave_locked(&mut s, id),
            _ => {}
        }
    }

    fn host_id(&self, s: &State, room: &Room) -> Option<u64> {
        room.members.iter().copied().find(|m| s.members.get(m).and_then(|x| x.user_id) == Some(room.owner_id)).or_else(|| room.members.first().copied())
    }
    fn is_host(&self, s: &State, room: &Room, id: u64) -> bool { self.host_id(s, room) == Some(id) }

    fn room_msg(&self, s: &State, room: &Room, me: u64) -> Value {
        let unlocked = self.db.load_profile(room.owner_id).map(|p| p.multi).unwrap_or(1);
        let members: Vec<Value> = room.members.iter().filter_map(|m| s.members.get(m)).filter_map(|x| x.ch.as_ref().map(|c| json!({"id": x.id, "name": x.name, "cls": c.cls, "level": c.level, "power": power(c), "charId": c.id}))).collect();
        json!({"t": "room", "code": room.code, "hostName": room.owner_name, "hostId": self.host_id(s, room), "you": me, "state": if room.running { "run" } else { "lobby" }, "dun": room.dun, "unlocked": unlocked, "members": members})
    }
    fn broadcast(&self, s: &State, code: &str) {
        let Some(room) = s.rooms.get(code) else { return };
        for mid in &room.members { if let Some(m) = s.members.get(mid) { send(m, self.room_msg(s, room, m.id)); } }
    }

    // A world is found by three hero faces: 3 letters A..L, one per class. 12^3 = 1728 combinations,
    // so guessing is throttled per socket (5 misses) and per IP (20 misses / 10 min).
    fn open(&self, s: &mut State, id: u64) {
        let (has_room, has_char, user_id, name) = { let m = s.members.get(&id).unwrap(); (m.room.is_some(), m.ch.is_some(), m.user_id, m.name.clone()) };
        if has_room { return; }
        let err = |s: &State, c: &str| { if let Some(m) = s.members.get(&id) { send(m, json!({"t": "err", "code": c})); } };
        let Some(uid) = user_id else { return err(s, "need_account") };
        if !has_char { return err(s, "need_char"); }
        let mut rng = rand::rng();
        let code = (0..200).map(|_| (0..3).map(|_| (b'A' + (rng.next_u32() % 12) as u8) as char).collect::<String>()).find(|c| !s.rooms.contains_key(c));
        let Some(code) = code else { return err(s, "full_world") };
        s.next_gen += 1; let gen = s.next_gen;
        s.rooms.insert(code.clone(), Room { code: code.clone(), owner_id: uid, owner_name: name, members: vec![id], running: false, dun: "m1".into(), sim: None, evbuf: vec![], last: Instant::now(), acc: 0.0, gen, solo: false });
        s.members.get_mut(&id).unwrap().room = Some(code.clone());
        self.broadcast(s, &code);
    }

    // A single-player run is a private one-player room: the server runs the sim, so coins/xp/progress cannot be faked.
    fn solo(&self, s: &mut State, id: u64, dun: &str) {
        let (has_room, user_id, char_id, name) = { let m = s.members.get(&id).unwrap(); (m.room.is_some(), m.user_id, m.ch.as_ref().map(|c| c.id).unwrap_or(0), m.name.clone()) };
        if has_room { return; }
        let err = |s: &State, c: &str| { if let Some(m) = s.members.get(&id) { send(m, json!({"t": "err", "code": c})); } };
        let (Some(uid), true) = (user_id, char_id != 0) else { return err(s, "need_account") };
        let Some(d) = crate::data::dungeon(dun) else { return err(s, "bad") };
        let ok = d.mode == "single" && self.db.load_profile(uid).map(|p| crate::meta::unlocked(&p, d)).unwrap_or(false);
        if !ok { return err(s, "bad"); }
        s.next_gen += 1; let gen = s.next_gen;
        let code = format!("~{id}");
        s.rooms.insert(code.clone(), Room { code: code.clone(), owner_id: uid, owner_name: name, members: vec![id], running: false, dun: dun.to_string(), sim: None, evbuf: vec![], last: Instant::now(), acc: 0.0, gen, solo: true });
        s.members.get_mut(&id).unwrap().room = Some(code.clone());
        self.start_run(s, &code);
    }

    fn join(&self, s: &mut State, id: u64, code: &str) {
        let (has_room, has_char, ip) = { let m = s.members.get(&id).unwrap(); (m.room.is_some(), m.ch.is_some(), m.ip.clone()) };
        if has_room { return; }
        let err = |s: &State, c: &str| { if let Some(m) = s.members.get(&id) { send(m, json!({"t": "err", "code": c})); } };
        if !has_char { return err(s, "need_char"); }
        let blocked = s.ip_miss.get(&ip).map(|(n, t)| *n >= 20 && t.elapsed().as_secs() < 600).unwrap_or(false);
        if blocked || !s.rooms.get(code).map(|r| !r.solo).unwrap_or(false) {
            if let Some(m) = s.members.get_mut(&id) { m.misses += 1; if m.misses >= 5 { let _ = m.tx.try_send(Out::Close(1008)); } }
            let e = s.ip_miss.entry(ip).or_insert((0, Instant::now()));
            if e.1.elapsed().as_secs() >= 600 { *e = (0, Instant::now()); }
            e.0 += 1;
            return err(s, "not_found");
        }
        let room = s.rooms.get(code).unwrap();
        if room.running { return err(s, "in_run"); }
        if room.members.len() >= data().consts.max_players { return err(s, "full"); }
        s.rooms.get_mut(code).unwrap().members.push(id);
        s.members.get_mut(&id).unwrap().room = Some(code.to_string());
        self.broadcast(s, code);
    }

    fn leave_locked(&self, s: &mut State, id: u64) {
        let Some(code) = s.members.get(&id).and_then(|m| m.room.clone()) else { return };
        let pid = { let m = s.members.get_mut(&id).unwrap(); m.room = None; m.left = true; m.pid };
        if s.rooms.get(&code).map(|r| r.solo).unwrap_or(false) {   // quitting or dropping pays out what was earned so far
            if let Some(sim) = s.rooms.get_mut(&code).and_then(|r| r.sim.as_mut()) { if sim.over.is_none() { sim.finish_now(); self.end_run(s, &code); } }
            s.rooms.remove(&code); return;
        }
        let Some(room) = s.rooms.get_mut(&code) else { return };
        room.members.retain(|m| *m != id);
        if let (Some(sim), true) = (room.sim.as_mut(), pid != 0) { sim.kill_player(pid); }
        if room.members.is_empty() { s.rooms.remove(&code); return; }
        if !room.running { self.broadcast(s, &code); }
    }

    fn start_run(&self, s: &mut State, code: &str) {
        let members: Vec<u64> = s.rooms[code].members.clone();
        let players: Vec<SimPlayerIn> = members.iter().map(|m| { let c = s.members[m].ch.as_ref().unwrap(); SimPlayerIn { name: c.name.clone(), cls: c.cls.clone(), level: c.level, equip: c.equip.clone(), arms: c.arms.clone(), held: c.held.clone() } }).collect();
        let seed: u32 = rand::random::<u32>() >> 1;
        let dun = s.rooms[code].dun.clone();
        let sim = Sim::new(seed, &dun, players);
        let list: Vec<Value> = members.iter().enumerate().map(|(i, m)| { let c = s.members[m].ch.as_ref().unwrap(); let (w, plus) = crate::meta::arm_of(c); json!({"id": i + 1, "name": c.name, "cls": c.cls, "arm": w.id, "plus": plus}) }).collect();
        for (i, m) in members.iter().enumerate() {
            let mm = s.members.get_mut(m).unwrap(); mm.pid = i as u32 + 1; mm.left = false;
            send(mm, json!({"t": "start", "dun": dun, "you": i + 1, "players": list}));
        }
        let room = s.rooms.get_mut(code).unwrap();
        room.sim = Some(sim); room.running = true; room.evbuf.clear(); room.acc = 0.0; room.last = Instant::now();
        let gen = room.gen;
        let hub = self.clone(); let code = code.to_string();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(std::time::Duration::from_millis(25));
            loop { iv.tick().await; if !hub.tick(&code, gen) { break; } }
        });
    }

    /// One scheduler tick of a room; false when the loop should stop.
    fn tick(&self, code: &str, gen: u64) -> bool {
        let mut s = self.lock();
        let dt = data().consts.dt;
        let Some(room) = s.rooms.get_mut(code) else { return false };
        if room.gen != gen || !room.running { return false; }
        let Some(sim) = room.sim.as_mut() else { return false };
        let now = Instant::now();
        room.acc += now.duration_since(room.last).as_secs_f64() * 1000.0; room.last = now;
        let mut snaps: Vec<(u32, Value)> = vec![];
        let mut n = 0;
        while room.acc >= dt * 1000.0 && n < 4 && sim.over.is_none() {
            room.acc -= dt * 1000.0; n += 1;
            sim.step();
            if room.evbuf.len() < 400 { room.evbuf.extend(sim.events().iter().cloned()); }
            if sim.tick % 2 == 0 || sim.over.is_some() {
                for pid in 1..=sim.players.len() as u32 { snaps.push((pid, sim.snapshot(pid, Some(&room.evbuf)))); }
                room.evbuf.clear();
            }
        }
        if room.acc > 500.0 { room.acc = 0.0; }
        let over = sim.over.is_some();
        let members = room.members.clone();
        for (pid, snap) in snaps {
            for mid in &members { if let Some(m) = s.members.get(mid) { if m.pid == pid { send(m, json!({"t": "s", "s": snap})); } } }
        }
        if over { self.end_run(&mut s, code); return false; }
        true
    }

    fn end_run(&self, s: &mut State, code: &str) {
        let (sim, dun, members) = { let r = s.rooms.get_mut(code).unwrap(); (r.sim.take().unwrap(), r.dun.clone(), r.members.clone()) };
        let over = sim.over.as_ref().unwrap();
        let d = dungeon(&dun).expect("dungeon");
        // a cleared run: 20 % chance of a chest with the dungeon's legendary weapon, visible to everyone in the run
        let chest = if over.cleared && rand::random::<f64>() < 0.2 {
            s.next_chest += 1; let cid = s.next_chest;
            let items = chest_items(d);
            s.chests.insert(cid, Chest { items: items.clone(), members: members.clone(), by: None, born: Instant::now() });
            Some((cid, items))
        } else { None };
        for mid in members {
            let (pid, user_id, ch) = { let m = &s.members[&mid]; (m.pid, m.user_id, m.ch.clone()) };
            let r = over.players.get((pid as usize).wrapping_sub(1));
            let (mut reward, mut level_up, mut level, mut drops) = (json!({}), 0i64, ch.as_ref().map(|c| c.level).unwrap_or(1) as i64, Vec::<String>::new());
            if let (Some(uid), Some(c), Some(r)) = (user_id, ch.as_ref(), r) {
                if c.id != 0 {
                    if let Some(mut prof) = self.db.load_profile(uid) {
                        let before = prof.chars.iter().find(|q| q.id == c.id).map(|q| q.level as i64).unwrap_or(1);
                        let cleared = over.cleared && r.kills > 0;     // an idle alt does not get the clear
                        if let Some(rw) = apply_run(&mut prof, c.id, &RunResult { dungeon_id: &dun, kills: r.kills as f64, coins_picked: r.coins, time_sec: over.time, cleared, reward_mul: r.reward }) {
                            reward = json!({"xp": rw.xp, "coins": rw.coins});
                            if cleared { drops = boss_drops(d); for w in &drops { add_to_bag(&mut prof, w); } }
                            if self.db.save_profile(uid, &prof).is_ok() {
                                level = prof.chars.iter().find(|q| q.id == c.id).map(|q| q.level as i64).unwrap_or(before);
                                level_up = level - before;
                                if let Some(nc) = self.db.get_char(c.id, uid) { s.members.get_mut(&mid).unwrap().ch = Some(nc); }
                            } else { drops.clear(); }
                        }
                    }
                }
            }
            let m = s.members.get_mut(&mid).unwrap();
            m.chest = chest.as_ref().map(|c| c.0);
            send(m, json!({"t": "end", "over": {"cleared": over.cleared, "time": over.time}, "kills": r.map(|x| x.kills).unwrap_or(0), "reward": reward, "levelUp": level_up, "level": level, "carry": r.map(|x| x.reward).unwrap_or(1.0),
                "drops": drops, "chest": chest.as_ref().map(|c| json!({"items": c.1}))}));
            m.pid = 0;
        }
        if s.rooms.get(code).map(|r| r.solo).unwrap_or(false) { s.rooms.remove(code); return; }
        s.rooms.get_mut(code).unwrap().running = false;
        self.broadcast(s, code);
    }

    /// The first player to open the chest takes everything in it; the others only see what it held.
    fn loot(&self, s: &mut State, id: u64) {
        let Some(cid) = s.members.get(&id).and_then(|m| m.chest) else { return };
        let Some(chest) = s.chests.get(&cid) else { return };
        if chest.by.is_some() { return; }
        let Some(uid) = s.members.get(&id).and_then(|m| m.user_id) else {
            if let Some(m) = s.members.get(&id) { send(m, json!({"t": "err", "code": "need_account"})); }
            return;
        };
        let (items, members) = (chest.items.clone(), chest.members.clone());
        let Some(mut prof) = self.db.load_profile(uid) else { return };
        for w in &items { add_to_bag(&mut prof, w); }
        if self.db.save_profile(uid, &prof).is_err() { return; }
        let by = s.members[&id].name.clone();
        s.chests.get_mut(&cid).unwrap().by = Some(by.clone());
        for mid in members {
            if let Some(m) = s.members.get(&mid) { send(m, json!({"t": "looted", "by": by, "items": items, "mine": mid == id})); }
        }
    }
}

fn send(m: &Member, v: Value) { let _ = m.tx.try_send(Out::Text(v.to_string())); }
pub fn guest_name(nick: &str) -> String { if valid_name(nick) { nick.trim().to_string() } else { "Host".to_string() } }

#[cfg(test)]
mod tests {
    use super::*;

    fn player(hub: &Hub, db: &Db, name: &str) -> (u64, i64, tokio::sync::mpsc::Receiver<Out>) {
        let uid = db.create_user(name, "x").unwrap(); db.insert_char(uid, name, "perun");
        let (tx, rx) = tokio::sync::mpsc::channel(64);
        (hub.connect(tx, Who { user_id: Some(uid), name: name.into(), cls: "perun".into(), char_id: 0, ip: "t".into() }), uid, rx)
    }
    fn texts(rx: &mut tokio::sync::mpsc::Receiver<Out>) -> Vec<Value> { let mut v = vec![]; while let Ok(o) = rx.try_recv() { if let Out::Text(t) = o { v.push(serde_json::from_str(&t).unwrap()); } } v }

    #[test]
    fn the_first_to_open_the_chest_takes_everything_and_the_others_only_see_it() {
        let db = Arc::new(Db::open(":memory:").unwrap()); let hub = Hub::new(db.clone());
        let (a, ua, mut ra) = player(&hub, &db, "Anna"); let (b, ub, mut rb) = player(&hub, &db, "Bara");
        let items = vec!["club5".to_string(), "axe2".to_string(), "sword2".to_string(), "mace3".to_string()];
        { let mut s = hub.lock();
          s.chests.insert(7, Chest { items: items.clone(), members: vec![a, b], by: None, born: Instant::now() });
          for id in [a, b] { s.members.get_mut(&id).unwrap().chest = Some(7); } }
        hub.handle(b, r#"{"t":"loot"}"#); hub.handle(a, r#"{"t":"loot"}"#); hub.handle(b, r#"{"t":"loot"}"#);
        let (ma, mb) = (texts(&mut ra), texts(&mut rb));
        assert_eq!(ma.len(), 1); assert_eq!(mb.len(), 1);                                   // one answer each, the late clicks do nothing
        assert_eq!((ma[0]["by"].as_str(), ma[0]["mine"].as_bool()), (Some("Bara"), Some(false)));
        assert_eq!((mb[0]["by"].as_str(), mb[0]["mine"].as_bool()), (Some("Bara"), Some(true)));
        assert_eq!(mb[0]["items"].as_array().unwrap().len(), 4);                           // everyone sees what fell
        assert_eq!(db.load_profile(ub).unwrap().bag, items); assert!(db.load_profile(ua).unwrap().bag.is_empty());
    }

    #[test]
    fn a_guest_cannot_take_a_chest() {
        let db = Arc::new(Db::open(":memory:").unwrap()); let hub = Hub::new(db.clone());
        let (tx, mut rx) = tokio::sync::mpsc::channel(8);
        let g = hub.connect(tx, Who { user_id: None, name: "Gast".into(), cls: "perun".into(), char_id: 0, ip: "t".into() });
        { let mut s = hub.lock(); s.chests.insert(1, Chest { items: vec!["club5".into()], members: vec![g], by: None, born: Instant::now() }); s.members.get_mut(&g).unwrap().chest = Some(1); }
        hub.handle(g, r#"{"t":"loot"}"#);
        assert_eq!(texts(&mut rx)[0]["code"], "need_account"); assert!(hub.lock().chests[&1].by.is_none());
    }
}
