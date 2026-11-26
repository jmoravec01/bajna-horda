// SQLite storage: accounts, sessions, characters. A "profile" is the shape shared/meta.js works on.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { newChar, newProfile } from '../shared/meta.js';

const scrypt = promisify(scryptCb);
export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(process.env.DB_PATH || join(DATA_DIR, 'horde.db'));
db.exec(`
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
`);

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
// lookalike names share a key: case, accents and the usual digit/letter swaps are folded
export const nameKey = (n) => n.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[1i|]/g, 'l').replace(/0/g, 'o').replace(/\s+/g, ' ');

export async function hashPassword(pw) {
  const salt = randomBytes(16), key = await scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function checkPassword(pw, stored) {
  const [v, salt, key] = stored.split('$');
  if (v !== 's1') return false;
  const want = Buffer.from(key, 'base64'), got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(want, got);
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = () => Array.from({ length: 5 }, () => ALPHA[randomInt(ALPHA.length)]).join('');

export const q = {
  byKey: db.prepare('SELECT id, name, pass FROM users WHERE name_key = ?'),
  insUser: db.prepare('INSERT INTO users (name, name_key, pass, created, room) VALUES (?, ?, ?, ?, ?)'),
  insSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)'),
  session: db.prepare('SELECT u.id, u.name, u.room FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?'),
  delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purge: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
  user: db.prepare('SELECT id, name, room, coins, prog_single, prog_multi FROM users WHERE id = ?'),
  chars: db.prepare('SELECT * FROM chars WHERE user_id = ? ORDER BY id'),
  char: db.prepare('SELECT * FROM chars WHERE id = ? AND user_id = ?'),
  countChars: db.prepare('SELECT COUNT(*) AS n FROM chars WHERE user_id = ?'),
  insChar: db.prepare('INSERT INTO chars (user_id, name, cls, created) VALUES (?, ?, ?, ?)'),
  delChar: db.prepare('DELETE FROM chars WHERE id = ? AND user_id = ?'),
  saveUser: db.prepare('UPDATE users SET coins = ?, prog_single = ?, prog_multi = ? WHERE id = ?'),
  saveChar: db.prepare('UPDATE chars SET level = ?, xp = ?, e_weapon = ?, e_armor = ?, e_ring = ?, e_boots = ? WHERE id = ?'),
  useTicket: db.prepare('INSERT OR IGNORE INTO used_tickets (nonce, expires) VALUES (?, ?)'),
  ticketUsed: db.prepare('SELECT 1 FROM used_tickets WHERE nonce = ?'),
  purgeTickets: db.prepare('DELETE FROM used_tickets WHERE expires <= ?'),
};

export function createUser(name, hash) {
  for (let i = 0; i < 20; i++) {
    try { return Number(q.insUser.run(name, nameKey(name), hash, Date.now(), roomCode()).lastInsertRowid); }
    catch (e) { if (!/UNIQUE.*room/.test(e.message)) throw e; }    // a room-code clash: try another code
  }
  throw new Error('room_code');
}
export function newSession(userId, days = 365) {
  const token = randomBytes(32).toString('base64url');
  q.insSession.run(sha256(token), userId, Date.now() + days * 864e5);
  return token;
}
const rowChar = (r) => ({ id: r.id, name: r.name, cls: r.cls, level: r.level, xp: r.xp, equip: { weapon: r.e_weapon, armor: r.e_armor, ring: r.e_ring, boots: r.e_boots } });
export function loadProfile(userId) {
  const u = q.user.get(userId); if (!u) return null;
  const p = newProfile();
  p.coins = u.coins; p.progress = { single: u.prog_single, multi: u.prog_multi };
  p.chars = q.chars.all(userId).map(rowChar);
  return p;
}
export function saveProfile(userId, p) {
  db.exec('BEGIN');
  try {
    q.saveUser.run(Math.floor(p.coins), p.progress.single, p.progress.multi, userId);
    for (const c of p.chars) q.saveChar.run(c.level, c.xp, c.equip.weapon, c.equip.armor, c.equip.ring, c.equip.boots, c.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const getChar = (id, userId) => { const r = q.char.get(id, userId); return r ? rowChar(r) : null; };
export { newChar };
