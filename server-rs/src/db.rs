// SQLite storage: accounts, sessions, characters. Same schema and password/ticket formats as server/db.js, so both servers can share one database file.
use crate::meta::{new_profile, Char, Equip, Profile};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use hmac::{Hmac, Mac};
use rand::RngCore;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::sync::{Mutex, OnceLock};
use unicode_normalization::UnicodeNormalization;

pub struct Db(Mutex<Connection>);

pub struct User { pub id: i64, pub name: String, pub room: String }
pub struct Row { pub id: i64, pub name: String, pub pass: String }

pub fn sha256_hex(s: &str) -> String { hex(&Sha256::digest(s.as_bytes())) }
fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{:02x}", x)).collect() }

/// Lookalike names share a key: case, accents and the usual digit/letter swaps are folded.
pub fn name_key(n: &str) -> String {
    static M: OnceLock<Regex> = OnceLock::new();
    static S: OnceLock<Regex> = OnceLock::new();
    let nfkd: String = n.nfkd().collect();
    let m = M.get_or_init(|| Regex::new(r"\p{M}").unwrap());
    let s = S.get_or_init(|| Regex::new(r"\s+").unwrap());
    let t = m.replace_all(&nfkd, "").to_lowercase();
    let t: String = t.chars().map(|c| match c { '1' | 'i' | '|' => 'l', '0' => 'o', c => c }).collect();
    s.replace_all(&t, " ").into_owned()
}

const ALPHA: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
fn room_code() -> String {
    let mut r = rand::rng();
    (0..5).map(|_| ALPHA[(r.next_u32() as usize) % ALPHA.len()] as char).collect()
}
pub fn random_token(n: usize) -> String {
    let mut b = vec![0u8; n];
    rand::rng().fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}
fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

pub fn hash_password(pw: &str) -> String {
    let mut salt = [0u8; 16];
    rand::rng().fill_bytes(&mut salt);
    let key = scrypt_key(pw, &salt);
    format!("s1${}${}", STANDARD.encode(salt), STANDARD.encode(key))
}
fn scrypt_key(pw: &str, salt: &[u8]) -> [u8; 32] {
    let params = scrypt::Params::new(14, 8, 1, 32).expect("scrypt params");
    let mut out = [0u8; 32];
    scrypt::scrypt(pw.as_bytes(), salt, &params, &mut out).expect("scrypt");
    out
}
pub fn check_password(pw: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split('$').collect();
    if parts.len() != 3 || parts[0] != "s1" { return false; }
    let (Ok(salt), Ok(want)) = (STANDARD.decode(parts[1]), STANDARD.decode(parts[2])) else { return false };
    if want.len() != 32 { return false; }
    let got = scrypt_key(pw, &salt);
    ct_eq(&want, &got)
}
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
/// HMAC-SHA256, base64url, first 32 characters (same as the JS `sign`).
pub fn sign(secret: &str, body: &str) -> String {
    let mut m = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    m.update(body.as_bytes());
    URL_SAFE_NO_PAD.encode(m.finalize().into_bytes())[..32].to_string()
}

impl Db {
    pub fn open(path: &str) -> rusqlite::Result<Db> {
        let c = Connection::open(path)?;
        c.execute_batch("
          PRAGMA journal_mode = WAL;
          PRAGMA foreign_keys = ON;
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, created INTEGER NOT NULL,
            room TEXT NOT NULL UNIQUE, coins INTEGER NOT NULL DEFAULT 0, prog_single INTEGER NOT NULL DEFAULT 1, prog_multi INTEGER NOT NULL DEFAULT 1
          );
          CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS chars (
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, cls TEXT NOT NULL,
            level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0,
            e_weapon INTEGER NOT NULL DEFAULT 1, e_armor INTEGER NOT NULL DEFAULT 1, e_ring INTEGER NOT NULL DEFAULT 1, e_boots INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS chars_user ON chars(user_id);
          CREATE TABLE IF NOT EXISTS used_tickets (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
        ")?;
        Ok(Db(Mutex::new(c)))
    }
    fn c(&self) -> std::sync::MutexGuard<'_, Connection> { self.0.lock().unwrap_or_else(|e| e.into_inner()) }

    pub fn secret(&self, env: Option<String>) -> String {
        if let Some(s) = env { if !s.is_empty() { return s; } }
        let c = self.c();
        if let Ok(Some(v)) = c.query_row("SELECT v FROM meta WHERE k = 'secret'", [], |r| r.get::<_, String>(0)).optional() { return v; }
        let s = random_token(32);
        let _ = c.execute("INSERT INTO meta (k, v) VALUES ('secret', ?)", [&s]);
        s
    }
    pub fn by_key(&self, key: &str) -> Option<Row> {
        self.c().query_row("SELECT id, name, pass FROM users WHERE name_key = ?", [key], |r| Ok(Row { id: r.get(0)?, name: r.get(1)?, pass: r.get(2)? })).optional().ok().flatten()
    }
    /// Err(true) = the name key is taken, Err(false) = other error.
    pub fn create_user(&self, name: &str, hash: &str) -> Result<i64, bool> {
        let c = self.c();
        for _ in 0..20 {
            match c.execute("INSERT INTO users (name, name_key, pass, created, room) VALUES (?, ?, ?, ?, ?)", params![name, name_key(name), hash, now_ms(), room_code()]) {
                Ok(_) => return Ok(c.last_insert_rowid()),
                Err(e) => {
                    let m = e.to_string();
                    if m.contains("UNIQUE") && m.contains("room") { continue; }   // a room-code clash: try another code
                    return Err(m.contains("UNIQUE"));
                }
            }
        }
        Err(false)
    }
    pub fn new_session(&self, user_id: i64) -> String {
        let token = random_token(32);
        let _ = self.c().execute("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)", params![sha256_hex(&token), user_id, now_ms() + 365 * 864_00_000]);
        token
    }
    pub fn session(&self, token: &str) -> Option<User> {
        self.c().query_row("SELECT u.id, u.name, u.room FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?", params![sha256_hex(token), now_ms()],
            |r| Ok(User { id: r.get(0)?, name: r.get(1)?, room: r.get(2)? })).optional().ok().flatten()
    }
    pub fn del_session(&self, token: &str) { let _ = self.c().execute("DELETE FROM sessions WHERE token_hash = ?", [sha256_hex(token)]); }
    pub fn user(&self, id: i64) -> Option<User> {
        self.c().query_row("SELECT id, name, room FROM users WHERE id = ?", [id], |r| Ok(User { id: r.get(0)?, name: r.get(1)?, room: r.get(2)? })).optional().ok().flatten()
    }
    pub fn owner_of_room(&self, code: &str) -> Option<(i64, String)> {
        self.c().query_row("SELECT id, name FROM users WHERE room = ?", [code], |r| Ok((r.get(0)?, r.get(1)?))).optional().ok().flatten()
    }
    pub fn load_profile(&self, user_id: i64) -> Option<Profile> {
        let c = self.c();
        let (coins, ps, pm): (i64, i64, i64) = c.query_row("SELECT coins, prog_single, prog_multi FROM users WHERE id = ?", [user_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional().ok().flatten()?;
        let mut p = new_profile();
        p.coins = coins; p.single = ps as usize; p.multi = pm as usize;
        let mut st = c.prepare("SELECT id, name, cls, level, xp, e_weapon, e_armor, e_ring, e_boots FROM chars WHERE user_id = ? ORDER BY id").ok()?;
        let rows = st.query_map([user_id], |r| Ok(row_char(r))).ok()?;
        for r in rows.flatten() { p.chars.push(r); }
        Some(p)
    }
    pub fn save_profile(&self, user_id: i64, p: &Profile) -> rusqlite::Result<()> {
        let mut c = self.c();
        let tx = c.transaction()?;
        tx.execute("UPDATE users SET coins = ?, prog_single = ?, prog_multi = ? WHERE id = ?", params![p.coins, p.single as i64, p.multi as i64, user_id])?;
        for ch in &p.chars {
            tx.execute("UPDATE chars SET level = ?, xp = ?, e_weapon = ?, e_armor = ?, e_ring = ?, e_boots = ? WHERE id = ?", params![ch.level, ch.xp, ch.equip.weapon, ch.equip.armor, ch.equip.ring, ch.equip.boots, ch.id])?;
        }
        tx.commit()
    }
    pub fn get_char(&self, id: i64, user_id: i64) -> Option<Char> {
        self.c().query_row("SELECT id, name, cls, level, xp, e_weapon, e_armor, e_ring, e_boots FROM chars WHERE id = ? AND user_id = ?", params![id, user_id], |r| Ok(row_char(r))).optional().ok().flatten()
    }
    pub fn insert_char(&self, user_id: i64, name: &str, cls: &str) { let _ = self.c().execute("INSERT INTO chars (user_id, name, cls, created) VALUES (?, ?, ?, ?)", params![user_id, name, cls, now_ms()]); }
    pub fn delete_char(&self, id: i64, user_id: i64) { let _ = self.c().execute("DELETE FROM chars WHERE id = ? AND user_id = ?", params![id, user_id]); }
    pub fn ticket_used(&self, nonce: &str) -> bool { self.c().query_row("SELECT 1 FROM used_tickets WHERE nonce = ?", [nonce], |_| Ok(())).optional().ok().flatten().is_some() }
    pub fn use_ticket(&self, nonce: &str, expires: i64) { let _ = self.c().execute("INSERT OR IGNORE INTO used_tickets (nonce, expires) VALUES (?, ?)", params![nonce, expires]); }
    pub fn purge(&self) {
        let now = now_ms();
        let c = self.c();
        let _ = c.execute("DELETE FROM sessions WHERE expires <= ?", [now]);
        let _ = c.execute("DELETE FROM used_tickets WHERE expires <= ?", [now]);
    }
}

fn row_char(r: &rusqlite::Row) -> Char {
    Char { id: r.get(0).unwrap_or(0), name: r.get(1).unwrap_or_default(), cls: r.get(2).unwrap_or_default(), level: r.get(3).unwrap_or(1), xp: r.get(4).unwrap_or(0),
        equip: Equip { weapon: r.get(5).unwrap_or(1), armor: r.get(6).unwrap_or(1), ring: r.get(7).unwrap_or(1), boots: r.get(8).unwrap_or(1) } }
}
