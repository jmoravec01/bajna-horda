import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const PORT = 18000 + Math.floor(Math.random() * 1000), BASE = `http://127.0.0.1:${PORT}`;
let proc, dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'horde-'));
  // SERVER=rust runs the same tests against the Rust port (cargo build --release in server-rs first)
  const env = { ...process.env, PORT, DATA_DIR: dir, HOST: '127.0.0.1', RUN_TIME_RATIO: '0', REG_PER_HOUR: '1000', APP_ROOT: process.cwd() };
  proc = process.env.SERVER === 'rust' ? spawn('server-rs/target/release/horde-server', [], { env, stdio: 'pipe' }) : spawn('node', ['server/server.js'], { env, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { proc.kill(); rmSync(dir, { recursive: true, force: true }); });

const api = async (method, path, body, token) => {
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const reg = async (name) => (await api('POST', 'register', { name, pass: 'secret1' })).j;

test('static files, health, headers', async () => {
  const r = await fetch(BASE + '/'); assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(BASE + '/shared/data.js')).status, 200);
  assert.equal((await fetch(BASE + '/shared/../server/db.js')).status, 404);
  assert.equal((await fetch(BASE + '/%2e%2e/server/db.js')).status, 404);
  assert.equal((await fetch(BASE + '/%zz')).status, 404);
  assert.equal((await fetch(BASE + '/health')).status, 200);
  assert.equal((await api('GET', 'nope')).status, 404);
  assert.equal((await api('GET', 'constructor')).status, 404);
});

test('register, login, lookalike names, validation', async () => {
  const a = await reg('Tomáš');
  assert.ok(a.token && a.room.length === 5 && a.profile.chars.length === 0);
  assert.equal((await api('POST', 'register', { name: 'T0MAS', pass: 'secret1' })).status, 409);
  assert.equal((await api('POST', 'register', { name: 'x', pass: 'secret1' })).j.error, 'name');
  assert.equal((await api('POST', 'register', { name: 'Okay', pass: '123' })).j.error, 'pass');
  assert.equal((await api('POST', 'login', { name: 'tomas', pass: 'bad' })).status, 401);
  const l = await api('POST', 'login', { name: 'tomas', pass: 'secret1' }); assert.equal(l.status, 200);
  assert.equal((await api('GET', 'me')).status, 401);
  assert.equal((await api('GET', 'me', null, l.j.token)).j.user, 'Tomáš');
  assert.equal((await api('POST', 'logout', null, l.j.token)).status, 200);
  assert.equal((await api('GET', 'me', null, l.j.token)).status, 401);
  const bad = await fetch(`${BASE}/api/login`, { method: 'POST', body: '{nope' }); assert.equal(bad.status, 400);
  const big = await fetch(`${BASE}/api/login`, { method: 'POST', body: 'x'.repeat(10000) }).catch(() => ({ status: 413 })); assert.equal(big.status, 413);
});

test('characters: create, limit, delete, upgrade, other accounts are untouchable', async () => {
  const a = await reg('Karel'), b = await reg('Pavel');
  for (let i = 0; i < 8; i++) assert.equal((await api('POST', 'chars', { name: 'H' + i, cls: 'vedma' }, a.token)).status, 200);
  assert.equal((await api('POST', 'chars', { name: 'Nine', cls: 'vedma' }, a.token)).j.error, 'full');
  assert.equal((await api('POST', 'chars', { name: 'Bad', cls: '__proto__' }, b.token)).j.error, 'class');
  const pa = (await api('GET', 'me', null, a.token)).j.profile, id = pa.chars[0].id;
  assert.equal((await api('POST', 'upgrade', { charId: id, slot: 'weapon' }, a.token)).j.error, 'poor');
  assert.equal((await api('POST', 'chars/delete', { id }, b.token)).status, 200);   // not his: no effect
  assert.equal((await api('GET', 'me', null, a.token)).j.profile.chars.length, 8);
  await api('POST', 'chars/delete', { id }, a.token);
  assert.equal((await api('GET', 'me', null, a.token)).j.profile.chars.length, 7);
});

test('single run: ticket, plausibility, replay protection, rewards persist', async () => {
  const a = await reg('Runner'); await api('POST', 'chars', { name: 'Run', cls: 'golem' }, a.token);
  const id = (await api('GET', 'me', null, a.token)).j.profile.chars[0].id;
  assert.equal((await api('POST', 'run/start', { charId: id, dungeon: 's2' }, a.token)).status, 400);       // locked
  assert.equal((await api('POST', 'run/start', { charId: id + 99, dungeon: 's1' }, a.token)).status, 400);   // not his
  const { ticket } = (await api('POST', 'run/start', { charId: id, dungeon: 's1' }, a.token)).j;
  const forged = ticket.slice(0, -2) + (ticket.endsWith('a') ? 'bb' : 'aa');
  assert.equal((await api('POST', 'run/finish', { ticket: forged, kills: 1, coins: 0, time: 10, cleared: false }, a.token)).status, 400);
  assert.equal((await api('POST', 'run/finish', { ticket, kills: 99999, coins: 0, time: 10, cleared: false }, a.token)).j.error, 'implausible');
  assert.equal((await api('POST', 'run/finish', { ticket, kills: 10, coins: 0, time: 10, cleared: true }, a.token)).j.error, 'implausible');   // a clear needs the boss time
  const ok = await api('POST', 'run/finish', { ticket, kills: 300, coins: 40, time: 420, cleared: true }, a.token);
  assert.equal(ok.status, 200); assert.ok(ok.j.reward.xp > 0 && ok.j.profile.progress.single === 2);
  assert.equal((await api('POST', 'run/finish', { ticket, kills: 300, coins: 40, time: 420, cleared: true }, a.token)).status, 409);   // replay
  const b = await reg('Other');
  assert.equal((await api('POST', 'run/finish', { ticket, kills: 1, coins: 0, time: 1, cleared: false }, b.token)).status, 400);        // not his ticket
  assert.equal((await api('GET', 'me', null, a.token)).j.profile.progress.single, 2);
});

// ---- co-op ----
const wsc = (qs) => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?${qs}`), q = []; let wait = null;
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (wait && wait.f(m)) { const w = wait; wait = null; w.r(m); } else q.push(m); };
  ws.onopen = () => res({ ws, send: (o) => ws.send(JSON.stringify(o)), next: (f, ms = 4000) => new Promise((r, j) => { const i = q.findIndex(f); if (i >= 0) return r(q.splice(i, 1)[0]); const t = setTimeout(() => j(new Error('timeout')), ms); wait = { f, r: (m) => { clearTimeout(t); r(m); } }; }) });
  ws.onerror = () => rej(new Error('ws error'));
});

test('co-op: host + guest + friend, run, snapshots, rewards, leaving', async () => {
  const h = await reg('Hostik'); await api('POST', 'chars', { name: 'Tank', cls: 'krakonos' }, h.token);
  const f = await reg('Frienda'); await api('POST', 'chars', { name: 'Heal', cls: 'perun' }, f.token);
  const hid = (await api('GET', 'me', null, h.token)).j.profile.chars[0].id, fid = (await api('GET', 'me', null, f.token)).j.profile.chars[0].id;
  const stranger = await wsc('nick=Nobody&cls=bohatyr'); stranger.send({ t: 'open' });
  assert.equal((await stranger.next((m) => m.t === 'err')).code, 'need_account'); stranger.send({ t: 'join', code: 'ABC' });
  assert.equal((await stranger.next((m) => m.t === 'err')).code, 'not_found'); stranger.ws.close();   // nobody has opened a world yet
  const H = await wsc(`token=${h.token}&char=${hid}`); H.send({ t: 'open' });
  const r1 = await H.next((m) => m.t === 'room'); assert.match(r1.code, /^[A-L]{3}$/); h.room = r1.code; assert.equal(r1.members.length, 1); assert.equal(r1.hostId, r1.you); assert.equal(r1.unlocked, 1);
  const F = await wsc(`token=${f.token}&char=${fid}`); F.send({ t: 'join', code: h.room });
  const G = await wsc('nick=Gast&cls=morana'); G.send({ t: 'join', code: h.room.toLowerCase() });
  const r3 = await H.next((m) => m.t === 'room' && m.members.length === 3); assert.deepEqual(r3.members.map((m) => m.cls).sort(), ['krakonos', 'morana', 'perun']);
  assert.equal(r3.members.find((m) => m.cls === 'morana').level, 1);
  F.send({ t: 'start' }); await new Promise((r) => setTimeout(r, 200));                     // a non-host cannot start
  H.send({ t: 'dun', dun: 'm3' });                                                           // locked dungeon: ignored
  H.send({ t: 'start' });
  const st = await H.next((m) => m.t === 'start'); assert.equal(st.dun, 'm1'); assert.equal(st.players.length, 3);
  await F.next((m) => m.t === 'start'); await G.next((m) => m.t === 'start');
  const late = await wsc('nick=Late&cls=perun'); late.send({ t: 'join', code: h.room }); assert.equal((await late.next((m) => m.t === 'err')).code, 'in_run'); late.ws.close();
  H.send({ t: 'in', dx: 1, dy: 0 }); H.send({ t: 'pick', i: 0 }); H.send({ t: 'in', dx: 'x', dy: null }); H.send({ t: '__proto__' }); H.ws.send('not json');
  const a = await H.next((m) => m.t === 's'), b = await H.next((m) => m.t === 's' && m.s.k > a.s.k + 6);
  assert.equal(a.s.p.length, 3); assert.ok(b.s.p.find((p) => p[0] === st.you)[1] > a.s.p.find((p) => p[0] === st.you)[1], 'host moved right');
  assert.ok(JSON.stringify(a).length < 8000);
  G.ws.close();                                                                              // a guest drops mid-run
  await new Promise((r) => setTimeout(r, 300));
  assert.ok((await H.next((m) => m.t === 's' && m.s.p.some((p) => p[5] === 1))).s);         // his character is down
  H.ws.close(); F.ws.close();
});

test('co-op: guessing face combinations closes the socket after 5 misses', async () => {
  const g = await wsc('nick=Guesser&cls=perun'), closed = new Promise((r) => { g.ws.onclose = r; });
  for (const code of ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']) g.send({ t: 'join', code });
  await closed;
});

test('co-op: one connection per account, malformed websocket frames, flood', async () => {
  const u = await reg('Single1'); await api('POST', 'chars', { name: 'Xx', cls: 'baba' }, u.token);
  const c1 = await wsc(`token=${u.token}`); c1.send({ t: 'open' }); await c1.next((m) => m.t === 'room');
  const closed = new Promise((r) => { c1.ws.onclose = r; });
  const c2 = await wsc(`token=${u.token}`); c2.send({ t: 'open' });
  assert.equal((await c1.next((m) => m.t === 'err')).code, 'busy'); await closed;
  await c2.next((m) => m.t === 'room');
  // raw socket: unmasked frame and an oversized frame must be rejected, the server must survive
  for (const frame of [Buffer.from([0x81, 0x02, 0x68, 0x69]), Buffer.concat([Buffer.from([0x81, 0xFE, 0xFF, 0xFF, 0, 0, 0, 0]), Buffer.alloc(100)])]) {
    await new Promise((res) => {
      const s = net.connect(PORT, '127.0.0.1', () => s.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      let sent = false;
      s.on('data', (d) => { if (!sent && /101/.test(d.toString())) { sent = true; s.write(frame); } });
      s.on('close', res); s.on('error', res); setTimeout(() => { s.destroy(); res(); }, 1000);
    });
  }
  assert.equal((await fetch(BASE + '/ws')).status, 404);                                       // a plain GET is not an upgrade
  for (let i = 0; i < 200; i++) c2.send({ t: 'ping', n: i });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await fetch(BASE + '/health')).status, 200);                                  // still alive
  c2.ws.close();
});
