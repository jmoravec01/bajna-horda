// Bájná horda server: static files, JSON API (accounts, characters, single-player runs) and co-op WebSockets. No npm dependencies.
import http from 'node:http';
import { isIP } from 'node:net';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { CLASS, DUNGEON, BOSS_AT } from '../shared/data.js';
import { validName, createChar, upgradeEquip, applyRun, unlocked } from '../shared/meta.js';
import { db, q, sha256, hashPassword, checkPassword, createUser, newSession, loadProfile, saveProfile, getChar, nameKey } from './db.js';
import { upgrade } from './ws.js';
import { connect, stats } from './rooms.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080), HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const CORS = new Set((process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));
const RUN_RATIO = Number(process.env.RUN_TIME_RATIO ?? 0.85);
const TICKET_MAX_AGE = 3 * 3600e3;

let SECRET = process.env.TICKET_SECRET || db.prepare("SELECT v FROM meta WHERE k = 'secret'").get()?.v;
if (!SECRET) { SECRET = randomBytes(32).toString('base64url'); db.prepare("INSERT INTO meta (k, v) VALUES ('secret', ?)").run(SECRET); }
const sign = (s) => createHmac('sha256', SECRET).update(s).digest('base64url').slice(0, 32);

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

// ---------- rate limiting ----------
function clientIp(req) {
  let ip = req.socket.remoteAddress || '?';
  if (TRUST_PROXY) { const xf = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean); if (xf.length && isIP(xf[xf.length - 1])) ip = xf[xf.length - 1]; }
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.includes(':')) ip = ip.split(':').slice(0, 4).join(':') + '::/64';
  return ip;
}
const openTicket = new Map();   // user -> nonce of the only redeemable ticket (shortcut: in memory, a restart forgets it)
const buckets = new Map();
function limited(key, max, ms) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b && buckets.size >= 50_000) { for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k); if (buckets.size >= 50_000) return true; }
  if (!b || b.reset <= now) { b = { n: 0, reset: now + ms }; buckets.set(key, b); }
  return ++b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k); q.purge.run(now); q.purgeTickets.run(now); }, 60_000).unref();

// ---------- auth ----------
const DUMMY = await hashPassword('timing-equaliser');
function authUser(req, url) {
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '') || url?.searchParams.get('token') || '';
  if (!tok || tok.length > 100) return null;
  return q.session.get(sha256(tok), Date.now()) || null;
}
function need(req) { const u = authUser(req); if (!u) throw new HttpError(401, 'unauthorized'); return u; }

async function readJson(req, limit = 4000) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'too_large'); chunks.push(c); }
  if (!size) return {};
  try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); return j && typeof j === 'object' ? j : {}; } catch { throw new HttpError(400, 'bad_json'); }
}
function session(id) { const u = q.user.get(id); return { token: newSession(id), user: u.name, room: u.room, profile: loadProfile(id) }; }

// ---------- API ----------
const API = {
  async 'POST register'(req) {
    if (limited('reg:' + clientIp(req), Number(process.env.REG_PER_HOUR || 8), 3600e3)) throw new HttpError(429, 'rate');
    const { name, pass } = await readJson(req);
    if (!validName(name)) throw new HttpError(400, 'name');
    if (typeof pass !== 'string' || pass.length < 6 || pass.length > 72) throw new HttpError(400, 'pass');
    if (q.byKey.get(nameKey(name.trim()))) throw new HttpError(409, 'taken');
    let id; try { id = createUser(name.trim(), await hashPassword(pass)); } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'taken'); throw e; }
    return session(id);
  },
  async 'POST login'(req) {
    if (limited('login:' + clientIp(req), 30, 600e3)) throw new HttpError(429, 'rate');
    const { name, pass } = await readJson(req);
    if (typeof name !== 'string' || typeof pass !== 'string' || pass.length > 72) throw new HttpError(400, 'badlogin');
    const u = q.byKey.get(nameKey(name.trim()));
    const ok = await checkPassword(pass, u ? u.pass : DUMMY);
    if (!u || !ok) throw new HttpError(401, 'badlogin');
    return session(u.id);
  },
  'POST logout'(req) { const tok = (req.headers.authorization || '').replace(/^Bearer /, ''); if (tok) q.delSession.run(sha256(tok)); return { ok: true }; },
  'GET me'(req) { const u = need(req); return { user: u.name, room: u.room, profile: loadProfile(u.id) }; },
  async 'POST chars'(req) {
    const u = need(req); const { name, cls } = await readJson(req);
    if (limited('chars:' + u.id, 30, 3600e3)) throw new HttpError(429, 'rate');
    const p = loadProfile(u.id), err = createChar(p, name, cls, 0);
    if (err) throw new HttpError(400, err);
    q.insChar.run(u.id, p.chars[p.chars.length - 1].name, cls, Date.now());
    return { profile: loadProfile(u.id) };
  },
  async 'POST chars/delete'(req) {
    const u = need(req); const { id } = await readJson(req);
    if (!Number.isInteger(id)) throw new HttpError(400, 'bad');
    q.delChar.run(id, u.id); return { profile: loadProfile(u.id) };
  },
  async 'POST upgrade'(req) {
    const u = need(req); const { charId, slot } = await readJson(req);
    const p = loadProfile(u.id), err = upgradeEquip(p, charId, slot);
    if (err) throw new HttpError(400, err);
    saveProfile(u.id, p); return { profile: p };
  },
  async 'POST run/start'(req) {
    const u = need(req); const { charId, dungeon } = await readJson(req);
    if (limited('run:' + u.id, 120, 3600e3)) throw new HttpError(429, 'rate');
    const d = DUNGEON[dungeon], p = loadProfile(u.id);
    if (!d || d.mode !== 'single' || !unlocked(p, d) || !getChar(charId, u.id)) throw new HttpError(400, 'bad');
    const nonce = randomBytes(9).toString('base64url'), body = `${u.id}.${charId}.${dungeon}.${Date.now()}.${nonce}`;
    if (openTicket.size > 20_000) openTicket.clear();
    openTicket.set(u.id, nonce);
    return { ticket: `${body}.${sign(body)}` };
  },
  async 'POST run/finish'(req) {
    const u = need(req); const b = await readJson(req);
    const parts = String(b.ticket || '').split('.');
    if (parts.length !== 6) throw new HttpError(400, 'bad_ticket');
    const body = parts.slice(0, 5).join('.'), want = Buffer.from(sign(body)), got = Buffer.from(parts[5]);
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw new HttpError(400, 'bad_ticket');
    const [uid, charId, dun, issued, nonce] = parts, age = Date.now() - Number(issued);
    if (Number(uid) !== u.id || !(age >= 0) || age > TICKET_MAX_AGE) throw new HttpError(400, 'bad_ticket');
    const time = Number(b.time), kills = Number(b.kills), coins = Number(b.coins), cleared = b.cleared === true;
    if (![time, kills, coins].every((n) => Number.isFinite(n) && n >= 0) || time > 960) throw new HttpError(400, 'bad');
    // a run cannot be reported faster than it takes to play, nor with more kills than the engine can produce
    if (time * 1000 * RUN_RATIO > age + 3000) throw new HttpError(400, 'too_fast');
    if (kills > time * 12 + 50 || coins > kills * 0.25 + time * 0.25 + 30) throw new HttpError(400, 'implausible');
    if (cleared && time < BOSS_AT - 10) throw new HttpError(400, 'implausible');
    if (openTicket.has(u.id) && openTicket.get(u.id) !== nonce) throw new HttpError(400, 'bad_ticket');
    if (q.ticketUsed.get(nonce)) throw new HttpError(409, 'ticket_used');
    q.useTicket.run(nonce, Date.now() + TICKET_MAX_AGE * 2);
    const p = loadProfile(u.id);
    const rew = applyRun(p, Number(charId), { dungeonId: dun, kills: Math.floor(kills), coinsPicked: Math.floor(coins), timeSec: time, cleared });
    if (!rew) throw new HttpError(400, 'bad');
    saveProfile(u.id, p); return { reward: rew, profile: p };
  },
};

// ---------- static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const cache = new Map();
function serveStatic(req, res, pathname) {
  let rel; try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(404, 'not_found'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const shared = rel.startsWith('/shared/'), root = join(ROOT, shared ? 'shared' : 'public');
  const file = normalize(join(root, shared ? rel.slice(8) : rel));
  if (!file.startsWith(root + sep)) throw new HttpError(404, 'not_found');
  let st; try { st = statSync(file); } catch { throw new HttpError(404, 'not_found'); }
  if (!st.isFile()) throw new HttpError(404, 'not_found');
  const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`, type = TYPES[extname(file)] || 'application/octet-stream';
  const h = { 'Content-Type': type, ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (extname(file) === '.html') h['Content-Security-Policy'] = CSP;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); res.end(); return; }
  let c = cache.get(file);
  if (!c || c.etag !== etag) { const raw = readFileSync(file); c = { etag, raw, gz: raw.length > 600 && /^(text|image\/svg|application\/(json|manifest))/.test(type) ? gzipSync(raw) : null }; cache.set(file, c); }
  const gz = c.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gz) { h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; }
  res.writeHead(200, h); res.end(req.method === 'HEAD' ? undefined : gz ? c.gz : c.raw);
}

// ---------- server ----------
const originOk = (origin, req) => !origin || CORS.has(origin) || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'), origin = req.headers.origin;
    if (origin && CORS.has(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ...stats() })); return; }
    if (url.pathname.startsWith('/api/')) {
      const h = Object.hasOwn(API, `${req.method} ${url.pathname.slice(5)}`) ? API[`${req.method} ${url.pathname.slice(5)}`] : null;
      if (!h) throw new HttpError(404, 'not_found');
      const out = await h(req, url);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(out)); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json', Connection: status === 413 ? 'close' : 'keep-alive' }); res.end(JSON.stringify({ error: e instanceof HttpError ? e.code : 'server' })); }
  }
});

server.on('upgrade', (req, socket) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws' || !originOk(req.headers.origin, req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    if (limited('ws:' + clientIp(req), 60, 60e3)) { socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return; }
    const u = authUser(req, url);
    let who;
    if (u) who = { userId: u.id, name: u.name, charId: Number(url.searchParams.get('char')) | 0 };
    else {
      if (url.searchParams.get('token')) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
      const nick = (url.searchParams.get('nick') || '').trim(), cls = url.searchParams.get('cls') || '';
      who = { userId: null, name: validName(nick) ? nick : 'Host', cls: Object.hasOwn(CLASS, cls) ? cls : 'bohatyr' };
    }
    const conn = upgrade(req, socket, { maxPayload: 512 });
    if (conn) connect(conn, who);
  } catch { socket.destroy(); }
});
process.on('uncaughtException', (e) => console.error('uncaught', e));
process.on('unhandledRejection', (e) => console.error('unhandled', e));
server.listen(PORT, HOST, () => console.log(`bajna-horda listening on ${HOST}:${PORT}`));
export { server };
