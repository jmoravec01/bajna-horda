// Co-op rooms. Every account owns one room (its code); friends connect to it over a WebSocket. The server runs the Sim.
import { randomInt } from 'node:crypto';
import { Sim } from '../shared/sim.js';
import { DT, DUNGEONS, DUNGEON, MAX_PLAYERS, CLASS } from '../shared/data.js';
import { power, applyRun, validName, newChar, unlocked } from '../shared/meta.js';
import { db, loadProfile, saveProfile, getChar } from './db.js';

const rooms = new Map();          // code -> Room
const byUser = new Map();         // userId -> Member (one live connection per account)
let nextId = 1;

const send = (m, obj) => m.conn.send(JSON.stringify(obj));

function resolveChar(m, charId) {
  if (m.userId) {
    const c = (charId && getChar(charId, m.userId)) || loadProfile(m.userId).chars[0];
    return c || null;
  }
  return newChar(0, m.name, m.cls);               // guests join with a fresh level-1 character
}

function roomMsg(room, m) {
  const owner = room.ownerId ? loadProfile(room.ownerId) : null;
  const host = [...room.members.values()].find((x) => x.userId === room.ownerId) || [...room.members.values()][0];
  return { t: 'room', code: room.code, hostName: room.ownerName, hostId: host?.id, you: m.id, state: room.state, dun: room.dun, unlocked: owner ? owner.progress.multi : 1,
    members: [...room.members.values()].map((x) => ({ id: x.id, name: x.name, cls: x.char.cls, level: x.char.level, power: power(x.char), charId: x.char.id })) };
}
const broadcast = (room) => { for (const m of room.members.values()) send(m, roomMsg(room, m)); };
const isHost = (room, m) => { const host = [...room.members.values()].find((x) => x.userId === room.ownerId) || [...room.members.values()][0]; return host === m; };

export function connect(conn, who) {
  const m = { id: nextId++, conn, ip: who.ip, userId: who.userId || null, name: who.name, cls: who.cls, char: null, room: null, pid: 0, left: false, msgs: 0, tick: Date.now() };
  if (m.userId) {                                   // a second connection of the same account replaces the first
    const old = byUser.get(m.userId);
    if (old) { send(old, { t: 'err', code: 'busy' }); old.conn.close(1000); leave(old); }
    byUser.set(m.userId, m);
  }
  m.char = resolveChar(m, who.charId);
  conn.onmessage = (text) => handle(m, text);
  conn.onclose = () => { leave(m); if (m.userId && byUser.get(m.userId) === m) byUser.delete(m.userId); };
  return m;
}

function handle(m, text) {
  const now = Date.now();
  if (now - m.tick > 1000) { m.tick = now; m.msgs = 0; }
  if (++m.msgs > 90) { m.conn.close(1008); return; }
  let d; try { d = JSON.parse(text); } catch { return; }
  if (!d || typeof d !== 'object' || typeof d.t !== 'string') return;
  const room = m.room;
  switch (d.t) {
    case 'ping': send(m, { t: 'pong', n: Number(d.n) || 0 }); break;
    case 'open': open(m); break;
    case 'solo': solo(m, String(d.dun || '')); break;
    case 'join': join(m, String(d.code || '').toUpperCase().slice(0, 8)); break;
    case 'in': if (room?.sim && m.pid && !m.left) room.sim.setInput(m.pid, Number(d.dx), Number(d.dy)); break;
    case 'pick': if (room?.sim && m.pid && !m.left) room.sim.choose(m.pid, Number(d.i) | 0); break;
    case 'dun': {
      if (!room || room.state !== 'lobby' || !isHost(room, m)) break;
      const i = DUNGEONS.multi.findIndex((x) => x.id === d.dun), owner = room.ownerId ? loadProfile(room.ownerId) : null;
      if (i >= 0 && i < (owner ? owner.progress.multi : 1)) { room.dun = DUNGEONS.multi[i].id; broadcast(room); }
      break;
    }
    case 'char': if (room && room.state === 'lobby' && m.userId) { const c = getChar(Number(d.id) | 0, m.userId); if (c) { m.char = c; broadcast(room); } } break;
    case 'start': if (room && room.state === 'lobby' && isHost(room, m)) startRun(room); break;
    case 'leave': leave(m); break;
  }
}

// A world is found by three hero faces: 3 letters A..L, one per class. 12^3 = 1728 combinations,
// so guessing is throttled per socket (5 misses) and per IP (20 misses / 10 min).
const ipMiss = new Map();
function open(m) {
  if (m.room) return;
  if (!m.userId) { send(m, { t: 'err', code: 'need_account' }); return; }
  if (!m.char) { send(m, { t: 'err', code: 'need_char' }); return; }
  let code = null;
  for (let i = 0; i < 200 && !code; i++) { const c = Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(12))).join(''); if (!rooms.has(c)) code = c; }
  if (!code) { send(m, { t: 'err', code: 'full_world' }); return; }
  const room = { code, ownerId: m.userId, ownerName: m.name, members: new Map(), state: 'lobby', dun: 'm1', sim: null, timer: null, evbuf: [], last: 0, acc: 0 };
  rooms.set(code, room); room.members.set(m.id, m); m.room = room;
  broadcast(room);
}

// A single-player run is a private one-player room: the server runs the sim, so coins/xp/progress cannot be faked.
function solo(m, dun) {
  if (m.room) return;
  if (!m.userId || !m.char?.id) { send(m, { t: 'err', code: 'need_account' }); return; }
  const d = Object.hasOwn(DUNGEON, dun) ? DUNGEON[dun] : null;
  if (!d || d.mode !== 'single' || !unlocked(loadProfile(m.userId), d)) { send(m, { t: 'err', code: 'bad' }); return; }
  const room = { code: '~' + m.id, solo: true, ownerId: m.userId, ownerName: m.name, members: new Map(), state: 'lobby', dun, sim: null, timer: null, evbuf: [], last: 0, acc: 0 };
  rooms.set(room.code, room); room.members.set(m.id, m); m.room = room;
  startRun(room);
}

function join(m, code) {
  if (m.room) return;
  if (!m.char) { send(m, { t: 'err', code: 'need_char' }); return; }
  const now = Date.now(), im = ipMiss.get(m.ip), blocked = im && im.n >= 20 && im.reset > now;
  const room = blocked ? null : rooms.get(code);
  if (!room || room.solo) {
    m.misses = (m.misses || 0) + 1; if (m.misses >= 5) m.conn.close(1008);
    const e = !im || im.reset <= now ? { n: 0, reset: now + 600e3 } : im; e.n++; ipMiss.set(m.ip, e);
    send(m, { t: 'err', code: 'not_found' }); return;
  }
  if (room.state !== 'lobby') { send(m, { t: 'err', code: 'in_run' }); return; }
  if (room.members.size >= MAX_PLAYERS) { send(m, { t: 'err', code: 'full' }); return; }
  room.members.set(m.id, m); m.room = room;
  broadcast(room);
}

function leave(m) {
  const room = m.room; if (!room) return;
  if (room.solo) {                                  // quitting or dropping pays out what was earned so far
    if (room.sim && !room.sim.over) { room.sim.finish(false); endRun(room); }
    clearInterval(room.timer); rooms.delete(room.code); m.room = null; m.left = true; return;
  }
  m.room = null; room.members.delete(m.id); m.left = true;
  if (room.sim && m.pid) { const p = room.sim.players[m.pid - 1]; if (p) { p.hp = 0; p.dead = true; p.gone = true; } }
  if (!room.members.size) { clearInterval(room.timer); rooms.delete(room.code); return; }
  if (room.state === 'lobby') broadcast(room);
}

function startRun(room) {
  const members = [...room.members.values()];
  const players = members.map((x) => ({ name: x.char.name, cls: x.char.cls, level: x.char.level, equip: x.char.equip }));
  room.sim = new Sim({ seed: randomInt(2 ** 31), dungeonId: room.dun, players });
  room.state = 'run'; room.evbuf = []; room.acc = 0; room.last = performance.now();
  const list = members.map((x, i) => { x.pid = i + 1; x.left = false; return { id: x.pid, name: x.char.name, cls: x.char.cls }; });
  for (const x of members) send(x, { t: 'start', dun: room.dun, you: x.pid, players: list });
  room.timer = setInterval(() => tick(room), 25);
}

function tick(room) {
  const sim = room.sim; if (!sim) return;
  const now = performance.now();
  room.acc += now - room.last; room.last = now;
  for (let n = 0; room.acc >= DT * 1000 && n < 4 && !sim.over; n++) {
    room.acc -= DT * 1000;
    sim.step();
    if (room.evbuf.length < 400) room.evbuf.push(...sim.ev);
    if (sim.tick % 2 === 0 || sim.over) {
      for (const x of room.members.values()) {
        if (!x.pid || x.conn.backlog() > 300_000) continue;
        send(x, { t: 's', s: sim.snapshot(x.pid, room.evbuf) });
      }
      room.evbuf = [];
    }
  }
  if (room.acc > 500) room.acc = 0;                   // the loop stalled: do not try to catch up
  if (sim.over) endRun(room);
}

function endRun(room) {
  clearInterval(room.timer); room.timer = null;
  const sim = room.sim, over = sim.over;
  for (const x of room.members.values()) {
    const r = over.players[x.pid - 1];
    let reward = {}, levelUp = 0, level = x.char.level;
    if (x.userId && x.char.id && r) {
      try {
        const prof = loadProfile(x.userId), c = prof.chars.find((q) => q.id === x.char.id), before = c ? c.level : 1;
        reward = applyRun(prof, x.char.id, { dungeonId: room.dun, kills: r.kills, coinsPicked: r.coins, timeSec: over.time, cleared: over.cleared && r.kills > 0, rewardMul: r.reward })   // an idle alt does not get the clear bonus || {};
        saveProfile(x.userId, prof);
        level = prof.chars.find((q) => q.id === x.char.id)?.level || before; levelUp = level - before;
        x.char = getChar(x.char.id, x.userId) || x.char;
      } catch (e) { console.error('reward failed', e); }
    }
    send(x, { t: 'end', over: { cleared: over.cleared, time: over.time }, kills: r?.kills || 0, reward, levelUp, level, carry: r?.reward || 1 });
    x.pid = 0;
  }
  room.sim = null; room.state = 'lobby';
  if (room.solo) { for (const x of room.members.values()) x.room = null; rooms.delete(room.code); return; }
  broadcast(room);
}

setInterval(() => {                                   // heartbeat + idle cleanup
  const now = Date.now();
  for (const room of rooms.values()) for (const m of room.members.values()) {
    if (now - m.conn.lastSeen > 70_000) m.conn.close(1001); else m.conn.ping();
  }
}, 20_000).unref();

export const stats = () => ({ rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.members.size, 0) });
export { validName };
