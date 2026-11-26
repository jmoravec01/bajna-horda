// Co-op rooms (port of server/rooms.js). Every account owns one room (its code); friends connect to it over a WebSocket.
use crate::data::{data, dungeon};
use crate::db::Db;
use crate::meta::{apply_run, new_char, power, valid_name, Char, RunResult};
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
    msgs: u32, tick: Instant, last_seen: Instant, born: Instant, misses: u8, ip: String,
}
struct Room {
    code: String, owner_id: i64, owner_name: String, members: Vec<u64>, running: bool, dun: String, sim: Option<Sim>, evbuf: Vec<Ev>, last: Instant, acc: f64, gen: u64,
}
#[derive(Default)]
struct State { ip_miss: HashMap<String, (u32, Instant)>, rooms: HashMap<String, Room>, members: HashMap<u64, Member>, by_user: HashMap<i64, u64>, next_id: u64, next_gen: u64 }

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
        s.members.insert(id, Member { id, tx, user_id: who.user_id, name: who.name, cls: who.cls, ch, room: None, pid: 0, left: false, msgs: 0, tick: Instant::now(), last_seen: Instant::now(), born: Instant::now(), misses: 0, ip: who.ip });
        id
    }

    pub fn closed(&self, id: u64) {
        let mut s = self.lock();
        self.leave_locked(&mut s, id);
        if let Some(m) = s.members.remove(&id) { if let Some(uid) = m.user_id { if s.by_user.get(&uid) == Some(&id) { s.by_user.remove(&uid); } } }
    }
    pub fn touch(&self, id: u64) { if let Some(m) = self.lock().members.get_mut(&id) { m.last_seen = Instant::now(); } }

    pub fn heartbeat(&self) {
        let s = self.lock();
        for m in s.members.values() {
            if m.last_seen.elapsed().as_secs() > 70 || (m.room.is_none() && m.born.elapsed().as_secs() > 45) { let _ = m.tx.try_send(Out::Close(1001)); } else { let _ = m.tx.try_send(Out::Ping); }
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
        s.rooms.insert(code.clone(), Room { code: code.clone(), owner_id: uid, owner_name: name, members: vec![id], running: false, dun: "m1".into(), sim: None, evbuf: vec![], last: Instant::now(), acc: 0.0, gen });
        s.members.get_mut(&id).unwrap().room = Some(code.clone());
        self.broadcast(s, &code);
    }

    fn join(&self, s: &mut State, id: u64, code: &str) {
        let (has_room, has_char, ip) = { let m = s.members.get(&id).unwrap(); (m.room.is_some(), m.ch.is_some(), m.ip.clone()) };
        if has_room { return; }
        let err = |s: &State, c: &str| { if let Some(m) = s.members.get(&id) { send(m, json!({"t": "err", "code": c})); } };
        if !has_char { return err(s, "need_char"); }
        let blocked = s.ip_miss.get(&ip).map(|(n, t)| *n >= 20 && t.elapsed().as_secs() < 600).unwrap_or(false);
        if blocked || !s.rooms.contains_key(code) {
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
        let Some(room) = s.rooms.get_mut(&code) else { return };
        room.members.retain(|m| *m != id);
        if let (Some(sim), true) = (room.sim.as_mut(), pid != 0) { sim.kill_player(pid); }
        if room.members.is_empty() { s.rooms.remove(&code); return; }
        if !room.running { self.broadcast(s, &code); }
    }

    fn start_run(&self, s: &mut State, code: &str) {
        let members: Vec<u64> = s.rooms[code].members.clone();
        let players: Vec<SimPlayerIn> = members.iter().map(|m| { let c = s.members[m].ch.as_ref().unwrap(); SimPlayerIn { name: c.name.clone(), cls: c.cls.clone(), level: c.level, equip: c.equip.clone() } }).collect();
        let seed: u32 = rand::random::<u32>() >> 1;
        let dun = s.rooms[code].dun.clone();
        let sim = Sim::new(seed, &dun, players);
        let list: Vec<Value> = members.iter().enumerate().map(|(i, m)| { let c = s.members[m].ch.as_ref().unwrap(); json!({"id": i + 1, "name": c.name, "cls": c.cls}) }).collect();
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
        for mid in members {
            let (pid, user_id, ch) = { let m = &s.members[&mid]; (m.pid, m.user_id, m.ch.clone()) };
            let r = over.players.get((pid as usize).wrapping_sub(1));
            let (mut reward, mut level_up, mut level) = (json!({}), 0i64, ch.as_ref().map(|c| c.level).unwrap_or(1) as i64);
            if let (Some(uid), Some(c), Some(r)) = (user_id, ch.as_ref(), r) {
                if c.id != 0 {
                    if let Some(mut prof) = self.db.load_profile(uid) {
                        let before = prof.chars.iter().find(|q| q.id == c.id).map(|q| q.level as i64).unwrap_or(1);
                        if let Some(rw) = apply_run(&mut prof, c.id, &RunResult { dungeon_id: &dun, kills: r.kills as f64, coins_picked: r.coins, time_sec: over.time, cleared: over.cleared, reward_mul: r.reward }) {
                            reward = json!({"xp": rw.xp, "coins": rw.coins});
                            if self.db.save_profile(uid, &prof).is_ok() {
                                level = prof.chars.iter().find(|q| q.id == c.id).map(|q| q.level as i64).unwrap_or(before);
                                level_up = level - before;
                                if let Some(nc) = self.db.get_char(c.id, uid) { s.members.get_mut(&mid).unwrap().ch = Some(nc); }
                            }
                        }
                    }
                }
            }
            let m = s.members.get_mut(&mid).unwrap();
            send(m, json!({"t": "end", "over": {"cleared": over.cleared, "time": over.time}, "kills": r.map(|x| x.kills).unwrap_or(0), "reward": reward, "levelUp": level_up, "level": level, "carry": r.map(|x| x.reward).unwrap_or(1.0)}));
            m.pid = 0;
        }
        let _ = dungeon(&dun);
        s.rooms.get_mut(code).unwrap().running = false;
        self.broadcast(s, code);
    }
}

fn send(m: &Member, v: Value) { let _ = m.tx.try_send(Out::Text(v.to_string())); }
pub fn guest_name(nick: &str) -> String { if valid_name(nick) { nick.trim().to_string() } else { "Host".to_string() } }
