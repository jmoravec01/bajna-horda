// Deterministic game simulation. One Sim = one run (1..6 players). The same file runs in the browser (single player)
// and on the server (co-op). Everything random goes through this.rnd(), never Math.random().
import { DT, ARCH, CLASS, WEAPON, WEAPON_IDX, WEAPONS, PASSIVES, DUNGEON, MAX_WEAPONS, MAX_PASSIVES, MAX_ITEM_LVL, BOSS_STAGES, PACE } from './data.js';
import { charStats, power } from './meta.js';

export const CULL = 270;            // entities farther than this from a player are not sent to him
const BASE_SPEED = 52, BASE_HP = 100, PICKUP_R = 26, TOUCH_R = 10, CELL = 24;
const PERSONAL = new Set(['L', 'u', 'x', 'g', '$', '+', 'M', 'C', 'm', 'v']);   // events only the owner needs
const HARD_END = 480;               // seconds; the last boss has three minutes, then the run fails

export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r1 = (v) => Math.round(v * 10) / 10;
const lvlNeed = (l) => Math.round(7 + 5 * Math.pow(l - 1, 1.15));

// per-level weapon numbers (level 1..8)
export function weaponStats(id, L, extra = 0) {
  const d = WEAPON[id], k = L - 1, g = (n) => d.grow.includes(n);
  return {
    dmg: d.dmg * 1.5 * (1 + 0.28 * k),
    cd: d.cd * Math.pow(0.95, k),
    count: (d.count || 1) + (g('count') ? Math.floor(k / 2) : 0) + (d.kind === 'turret' ? extra : 0),
    area: (d.area || 0) * (g('area') || d.kind === 'orbit' ? 1 + 0.08 * k : 1),
    pierce: (d.pierce || 0) + (g('pierce') ? Math.floor(k / 3) : 0),
    dur: (d.dur || 0) * (g('dur') ? 1 + 0.1 * k : 1),
    speed: d.speed || 0, knock: d.knock || 0, slow: d.slow || 0, burn: d.burn || 0, tick: d.tick || 0, rate: d.rate || 0,
  };
}

export class Sim {
  constructor({ seed = 1, dungeonId, players }) {
    this.rnd = mulberry32(seed);
    this.dun = DUNGEON[dungeonId];
    this.tick = 0; this.nid = 1;
    this.players = []; this.enemies = []; this.objs = []; this.ebul = []; this.picks = [];
    this.ev = []; this.over = null; this.spawnAcc = 0; this.eliteDone = 0; this.bossN = 0;
    this.grid = new Map();
    for (const [i, c] of players.entries()) this.players.push(this.makePlayer(i + 1, c));
    const n = this.players.length, top = Math.max(...this.players.map((p) => p.power));
    this.threat = top * (1 + 0.25 * (n - 1));
    this.eMul = Math.pow(this.threat / 100, 0.5);
    this.dMul = Math.sqrt(this.eMul);
    this.cMul = Math.pow(this.threat / 100, 0.25) * (1 + 0.7 * (n - 1));
    for (const [i, p] of this.players.entries()) {
      p.reward = Math.min(4, Math.max(1, this.eMul / Math.pow(p.power / 100, 0.5)));
      if (n > 1) { const a = i / n * 6.283; p.x = Math.cos(a) * 12; p.y = Math.sin(a) * 12; }
    }
  }

  makePlayer(id, c) {
    const cl = CLASS[c.cls], st = charStats(c);
    const p = { id, name: c.name, cls: c.cls, cl, st, power: power(c), x: 0, y: 0, dx: 0, dy: 0, face: 1, hp: 0, maxHp: 0, spd: 0,
      inv: 0, dead: false, rev: 0, level: 1, xp: 0, kills: 0, coins: 0, weapons: [], passives: {}, pending: [], blinkCd: 0, freezeCd: 6, regenAcc: 0, lastHurt: -9, dmgDone: 0 };
    p.weapons.push({ id: cl.weapon, lvl: 1, cd: 0.4, ang: 0 });
    this.recalc(p); p.hp = p.maxHp;
    return p;
  }

  pl(p, name) { return p.passives[name] || 0; }
  recalc(p) {
    const hpFrac = p.maxHp ? p.hp / p.maxHp : 1;
    p.maxHp = Math.round(BASE_HP * p.cl.hp * p.st.hp * (1 + 0.12 * this.pl(p, 'srdce')));
    p.spd = BASE_SPEED * p.cl.spd * p.st.spd * (1 + 0.06 * this.pl(p, 'boty'));
    p.hp = Math.max(1, Math.round(p.maxHp * hpFrac));
  }

  setInput(id, dx, dy) {
    const p = this.players[id - 1];
    if (!p || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    p.dx = dx; p.dy = dy;
  }

  // ---------- helpers ----------
  dmgMul(p) {
    let m = p.st.dmg * p.cl.dmg * (1 + 0.1 * this.pl(p, 'sila'));
    if (p.cl.ramp) { const s = this.tick * DT; m *= s < 120 ? 0.7 : 0.7 + 0.9 * Math.min(1, (s - 120) / 360); }
    return m;
  }
  cdMul(p) { return Math.max(0.4, p.st.cd * (1 - 0.06 * this.pl(p, 'spech'))); }
  critChance(p) { return 0.05 + (p.cl.crit || 0); }

  gridBuild() {
    const g = this.grid;
    for (const a of g.values()) a.length = 0;
    for (const e of this.enemies) {
      const k = (Math.floor(e.x / CELL) + 4096) * 8192 + Math.floor(e.y / CELL) + 4096;
      let a = g.get(k); if (!a) { a = []; g.set(k, a); }
      a.push(e);
    }
    if (g.size > 2000) { for (const [k, a] of g) if (!a.length) g.delete(k); }
  }
  near(x, y, r, fn) {
    const c0 = Math.floor((x - r - 12) / CELL), c1 = Math.floor((x + r + 12) / CELL), d0 = Math.floor((y - r - 12) / CELL), d1 = Math.floor((y + r + 12) / CELL);
    for (let cx = c0; cx <= c1; cx++) for (let cy = d0; cy <= d1; cy++) {
      const a = this.grid.get((cx + 4096) * 8192 + cy + 4096);
      if (a) for (const e of a) if (!e.dead) { const dx = e.x - x, dy = e.y - y, rr = r + e.r; if (dx * dx + dy * dy <= rr * rr) fn(e); }
    }
  }
  nearest(x, y, maxR, k, skip) {
    const out = [];
    for (const e of this.enemies) {
      if (e.dead || (skip && skip.includes(e))) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d > maxR * maxR) continue;
      let i = out.length; out.push({ e, d });
      while (i > 0 && out[i - 1].d > d) { out[i] = out[i - 1]; i--; }
      out[i] = { e, d };
      if (out.length > k) out.pop();
    }
    return out.map((o) => o.e);
  }
  emit(...a) { if (this.ev.length < 200) this.ev.push(a); }

  // ---------- damage ----------
  hurtEnemy(e, dmg, p, quiet) {
    if (e.dead) return;
    if (p && !quiet) {
      if (this.rnd() < this.critChance(p)) { dmg *= 2; this.emit('k', r1(e.x), r1(e.y)); }
      if (p.cl.burn) this.burn(e, dmg * p.cl.burn, 2, p);
    }
    e.hp -= dmg; e.flash = 2;
    if (p) p.dmgDone += dmg;
    if (!quiet) this.emit('h', r1(e.x), r1(e.y));
    if (e.hp <= 0) this.kill(e, p);
  }
  burn(e, dps, secs, p) { e.burnDps = Math.max(e.burnDps || 0, dps); e.burnUntil = this.tick * DT + secs; e.burnOwner = p; }
  slow(e, f, secs) { if (e.boss) f *= 0.4; e.slowF = Math.max(e.slowUntil > this.tick * DT ? e.slowF : 0, f); e.slowUntil = this.tick * DT + secs; }
  knock(e, fromX, fromY, amt) {
    if (e.boss || !amt) return;
    const dx = e.x - fromX, dy = e.y - fromY, l = Math.hypot(dx, dy) || 1;
    e.kx += dx / l * amt * (e.big ? 0.4 : 1) * 6; e.ky += dy / l * amt * (e.big ? 0.4 : 1) * 6;
  }
  kill(e, p) {
    e.dead = true;
    this.emit('d', r1(e.x), r1(e.y), e.boss ? 2 : e.elite ? 1 : 0);
    if (p) p.kills++;
    if (e.boss) {
      if (e.stage === BOSS_STAGES.length - 1) { this.finish(true); return; }          // the last boss clears the dungeon
      this.drop(e.x, e.y, 6, 0); for (let i = 0; i < 4; i++) this.drop(e.x + Math.cos(i * 1.6) * 8, e.y + Math.sin(i * 1.6) * 8, 3, 5);     // the others pay with a chest and coins
      return;
    }
    const owner = p || this.players[0];
    const xp = e.xp * (1 + 0.15 * Math.min(4, this.tick * DT * PACE / 120));
    this.drop(e.x, e.y, xp < 3 ? 0 : xp < 8 ? 1 : 2, xp);
    if (e.elite) { this.drop(e.x + 4, e.y, 6, 0); return; }
    const r = this.rnd();
    if (r < 0.10) this.drop(e.x + 3, e.y + 3, 3, 1);
    else if (r < 0.10 + 0.012 * (owner.cl.heartLuck || 1)) this.drop(e.x, e.y, 4, 0);
    else if (r < 0.125 + 0.012 * (owner.cl.heartLuck || 1)) this.drop(e.x, e.y, 5, 0);
  }
  drop(x, y, tier, v) {
    // xp gems and coins that land next to one of the last few drops fuse into it (same xp in total, fewer sprites and events)
    if (tier <= 3) {
      for (let i = this.picks.length - 1; i >= 0 && i >= this.picks.length - 40; i--) {
        const g = this.picks[i];
        if (g.mag || g.tier > 3 || (g.tier === 3) !== (tier === 3) || (g.x - x) ** 2 + (g.y - y) ** 2 >= 49) continue;
        g.v += v; if (g.tier < 3) g.tier = g.v < 3 ? 0 : g.v < 8 ? 1 : 2;
        return;
      }
    }
    this.picks.push({ id: this.nid++, tier, x, y, v, mag: false });
  }

  hurtPlayer(p, dmg, fromX, fromY) {
    if (p.dead || p.inv > 0) return;
    if (p.cl.dodge && this.rnd() < p.cl.dodge) { p.inv = 0.2; this.emit('m', p.id); return; }
    if (p.cl.blink && p.blinkCd <= 0) {
      p.blinkCd = 8; p.inv = 1;
      const a = Math.atan2(p.y - fromY, p.x - fromX);
      p.x += Math.cos(a) * 30; p.y += Math.sin(a) * 30;
      this.emit('r', r1(p.x), r1(p.y), 14, 5); return;
    }
    dmg *= (p.cl.armor || 1);
    p.hp -= dmg; p.inv = 0.5; p.lastHurt = this.tick * DT;
    this.emit('u', p.id);
    if (p.hp <= 0) { p.hp = 0; p.dead = true; p.rev = 0; this.emit('x', p.id); }
  }

  // ---------- main step ----------
  step() {
    if (this.over) return;
    this.tick++; this.ev.length = 0;
    const T = this.tick * DT;
    const alive = this.players.filter((p) => !p.dead);
    if (!alive.length) { this.finish(false); return; }

    // players
    for (const p of this.players) {
      p.inv = Math.max(0, p.inv - DT); p.blinkCd = Math.max(0, p.blinkCd - DT);
      if (p.dead) {
        if (this.players.length > 1 && !p.gone) {
          const helper = alive.find((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 18 * 18);
          p.rev = helper ? p.rev + DT : Math.max(0, p.rev - DT);
          if (p.rev >= 3) { p.dead = false; p.hp = Math.ceil(p.maxHp / 2); p.inv = 2; p.rev = 0; this.emit('v', p.id); }
        }
        continue;
      }
      let sp = p.spd;
      if (p.cl.swim && this.objs.some((o) => o.kind === 'z' && o.owner === p && o.wid === 'louze' && (o.x - p.x) ** 2 + (o.y - p.y) ** 2 < o.r * o.r)) sp *= p.cl.swim;
      p.x += p.dx * sp * DT; p.y += p.dy * sp * DT;
      if (p.dx) p.face = p.dx > 0 ? 1 : -1;
      if (p.cl.regen) p.hp = Math.min(p.maxHp, p.hp + p.cl.regen * DT);
      if (p.cl.healAura) for (const q of alive) if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 70 * 70) q.hp = Math.min(q.maxHp, q.hp + p.cl.healAura * DT * (q === p ? 0.4 : 1));
      if (p.cl.freeze && (p.freezeCd -= DT) <= 0) {
        p.freezeCd = 10; this.emit('r', r1(p.x), r1(p.y), 60, 6);
        for (const e of this.enemies) if (!e.dead && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < (60 + e.r) ** 2) { e.freezeUntil = T + (e.boss ? 0.8 : 2); }
      }
    }

    this.objs = this.objs.filter((o) => !o.dummy);   // orbit blades are rebuilt every step
    this.director(T, alive);
    this.gridBuild();
    this.updateEnemies(T, alive);
    for (const p of this.players) if (!p.dead) this.fire(p, T);
    this.updateObjs(T);
    this.updatePicks(alive);
    this.enemies = this.enemies.filter((e) => !e.dead);
    if (!this.over && T >= HARD_END) this.finish(false);
  }

  finish(cleared) {
    this.over = { cleared, time: this.tick * DT, players: this.players.map((p) => ({ id: p.id, kills: p.kills, coins: p.coins, reward: p.reward, dead: p.dead })) };
  }

  // ---------- enemy spawning ----------
  director(T, alive) {
    const d = this.dun, n = this.players.length;
    const Tp = T * PACE;                                   // difficulty clock
    // elites at 2:00 and 4:00; bosses at 1:00, 3:00 and 5:00
    if (this.eliteDone < 2 && T >= 120 + this.eliteDone * 120) { this.eliteDone++; this.spawn(alive, 5, true); }
    const st = BOSS_STAGES[this.bossN];
    if (st && T >= st.at) { this.spawn(alive, 6 + this.bossN, true); this.bossN++; this.emit('B', this.bossN); }
    const ramp = Math.min(Tp, 480) / 60;
    let rate = (0.7 + 0.9 * ramp) * this.cMul * (this.enemies.some((e) => e.boss && !e.dead) ? 0.5 : 1);
    const cap = Math.round((60 + 22 * ramp) * (1 + 0.5 * (n - 1)));
    this.spawnAcc += rate * DT;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.enemies.length >= cap) continue;
      let tot = 0; const avail = [];
      for (const [i, r] of d.roster.entries()) if (Tp >= r[2]) { avail.push(i); tot += d.roster[i][3] * (i === avail.length - 1 && 1); }
      let x = this.rnd() * tot, idx = avail[0];
      for (const i of avail) { x -= d.roster[i][3]; if (x <= 0) { idx = i; break; } }
      const group = ARCH[d.roster[idx][0]].beh === 'zig' ? 3 + Math.floor(this.rnd() * 3) : 1;
      for (let g = 0; g < group; g++) this.spawn(alive, idx, false);
    }
  }

  spawn(alive, idx, special) {
    const d = this.dun, T = this.tick * DT;
    const target = alive[Math.floor(this.rnd() * alive.length)];
    const a = this.rnd() * 6.283, dist = 235 + this.rnd() * 20;
    let arch, pal, hpBase, scale = 1, elite = false, boss = false;
    const bst = BOSS_STAGES[idx - 6];
    if (idx >= 6) { arch = ARCH[d.boss.arch]; pal = d.boss.pal; hpBase = d.boss.hp * bst.hp; scale = (d.boss.scale || 2.6) * bst.size; boss = true; }
    else if (idx === 5) { arch = ARCH[d.elite[0]]; pal = d.elite[1]; hpBase = arch.hp * 8; scale = 1.5; elite = true; }
    else { arch = ARCH[d.roster[idx][0]]; hpBase = arch.hp; }
    const Tp = T * PACE, tsHp = 1 + Tp / 60 * 0.6, tsDmg = 1 + Tp / 60 * 0.12;
    const hp = hpBase * (boss ? 1 : tsHp) * this.eMul * d.diff;
    const e = { id: this.nid++, type: idx, arch, beh: arch.beh, x: target.x + Math.cos(a) * dist, y: target.y + Math.sin(a) * dist,
      hp, maxHp: hp, dmg: arch.dmg * (boss ? 1.3 * bst.dmg : 1) * tsDmg * this.dMul * Math.sqrt(d.diff), spd: arch.spd * (boss ? 0.8 : 1) * (1 + this.rnd() * 0.12), r: arch.r * scale, xp: arch.xp * (elite ? 6 : 1),
      kx: 0, ky: 0, t: this.rnd() * 3, dead: false, flash: 0, slowUntil: 0, slowF: 0, freezeUntil: 0, hm: null, boss, elite, big: arch.r * scale >= 8, st: 0, dashX: 0, dashY: 0 };
    if (boss) { e.beh = 'boss'; e.bt = 3; e.bs = bst.every; e.xp = 0; e.stage = idx - 6; }
    this.enemies.push(e);
    return e;
  }

  updateEnemies(T, alive) {
    const odd = this.tick & 1;
    for (const e of this.enemies) {
      if (e.dead) continue;
      // status effects
      if (e.burnUntil > T) { e.hp -= e.burnDps * DT; if (e.hp <= 0) { this.kill(e, e.burnOwner); continue; } }
      e.flash = Math.max(0, e.flash - 1);
      // knockback
      if (e.kx || e.ky) { e.x += e.kx * DT; e.y += e.ky * DT; e.kx *= 0.8; e.ky *= 0.8; if (Math.abs(e.kx) + Math.abs(e.ky) < 1) { e.kx = 0; e.ky = 0; } }
      if (e.freezeUntil > T) continue;
      // nearest living player
      let tp = alive[0], bd = Infinity;
      for (const p of alive) { const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2; if (d < bd) { bd = d; tp = p; } }
      const dist = Math.sqrt(bd) || 1, ux = (tp.x - e.x) / dist, uy = (tp.y - e.y) / dist;
      if (dist > 340 && !e.boss) { const a = this.rnd() * 6.283; e.x = tp.x + Math.cos(a) * 245; e.y = tp.y + Math.sin(a) * 245; continue; }
      let sp = e.spd * (e.slowUntil > T ? 1 - e.slowF : 1), mx = ux, my = uy;
      e.t += DT;
      switch (e.beh) {
        case 'zig': { const w = Math.sin(e.t * 5) * 0.8; mx = ux - uy * w; my = uy + ux * w; break; }
        case 'shoot':
          if (dist < 75) { sp = 0; if ((e.st -= DT) <= 0) { e.st = 2.2; this.ebul.push({ id: this.nid++, x: e.x, y: e.y, vx: ux * 52, vy: uy * 52, dmg: e.dmg, life: 4 }); } } break;
        case 'dash':
          if (e.st > 0) { e.st -= DT; if (e.st > 0.6) sp = 0; else { mx = e.dashX; my = e.dashY; sp *= 3.2; } }
          else if (dist < 90 && e.t % 4 < DT) { e.st = 1.1; e.dashX = ux; e.dashY = uy; }
          break;
        case 'boss': this.bossAI(e, T, tp, ux, uy, dist); sp = e.spd * (e.slowUntil > T ? 1 - e.slowF * 0.4 : 1); break;
      }
      e.x += mx * sp * DT; e.y += my * sp * DT;
      // light separation (half of the enemies each step)
      if ((e.id & 1) === odd && !e.boss) {
        let sx = 0, sy = 0;
        this.near(e.x, e.y, 0, (o) => { if (o === e) return; const dx = e.x - o.x, dy = e.y - o.y, d2 = dx * dx + dy * dy, rr = (e.r + o.r) * 0.9; if (d2 < rr * rr && d2 > 0.01) { const d = Math.sqrt(d2); sx += dx / d * (rr - d); sy += dy / d * (rr - d); } });
        e.x += sx * 0.35; e.y += sy * 0.35;
      }
      // contact damage
      for (const p of alive) {
        const rr = e.r + 4;
        if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < rr * rr) this.hurtPlayer(p, e.dmg, e.x, e.y);
      }
    }
    // enemy bullets
    for (const b of this.ebul) {
      b.x += b.vx * DT; b.y += b.vy * DT; b.life -= DT;
      for (const p of alive) if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < 36) { this.hurtPlayer(p, b.dmg, b.x, b.y); b.life = 0; break; }
    }
    this.ebul = this.ebul.filter((b) => b.life > 0);
  }

  bossAI(e, T, tp, ux, uy, dist) {
    const st = BOSS_STAGES[e.stage], enrage = e.stage === BOSS_STAGES.length - 1 && T > st.at + 60 ? 1.5 : 1;   // the last boss gets angry after a minute
    if ((e.bt -= DT) <= 0) {            // ring of bullets
      e.bt = 3 / enrage; const n = st.ring, off = this.rnd() * 6.283;
      for (let i = 0; i < n; i++) { const a = off + i / n * 6.283; this.ebul.push({ id: this.nid++, x: e.x, y: e.y, vx: Math.cos(a) * 45, vy: Math.sin(a) * 45, dmg: e.dmg * 0.6, life: 5 }); }
    }
    if ((e.bs -= DT) <= 0) {            // minions
      e.bs = st.every / enrage;
      for (let i = 0; i < st.minions; i++) { const m = this.spawn([tp], Math.min(1, this.dun.roster.length - 1), false); m.x = e.x + Math.cos(i) * 20; m.y = e.y + Math.sin(i) * 20; }
    }
    if (dist < 12) e.spd = 0; else e.spd = ARCH[this.dun.boss.arch].spd * 0.8;
  }

  // ---------- weapons ----------
  fire(p, T) {
    const dm = this.dmgMul(p), cm = this.cdMul(p);
    for (const [wi, w] of p.weapons.entries()) {
      const d = WEAPON[w.id], st = weaponStats(w.id, w.lvl, p.cl.extra || 0), wix = WEAPON_IDX[w.id];
      const dmg = st.dmg * dm;
      if (d.kind === 'orbit') { this.orbit(p, w, st, wi, wix, dmg, T); continue; }
      if ((w.cd -= DT) > 0) continue;
      const cd = st.cd * cm;
      switch (d.kind) {
        case 'proj': {
          const ts = this.nearest(p.x, p.y, 140, st.count);
          if (!ts.length) { w.cd = 0; break; }
          for (let i = 0; i < st.count; i++) {
            const t = ts[i % ts.length], a = Math.atan2(t.y - p.y, t.x - p.x) + (i >= ts.length ? (i - ts.length + 1) * 0.25 : 0);
            this.objs.push({ id: this.nid++, kind: 'p', wid: w.id, wix, x: p.x, y: p.y, vx: Math.cos(a) * st.speed, vy: Math.sin(a) * st.speed, ang: a, r: st.area, dmg, pierce: st.pierce, life: st.dur, owner: p, hit: [], slow: st.slow });
          }
          w.cd = cd; break;
        }
        case 'boomerang': {
          const ts = this.nearest(p.x, p.y, 150, st.count);
          if (!ts.length) { w.cd = 0; break; }
          for (let i = 0; i < st.count; i++) {
            const t = ts[i % ts.length], a = Math.atan2(t.y - p.y, t.x - p.x) + (i >= ts.length ? 0.5 * i : 0);
            this.objs.push({ id: this.nid++, kind: 'b', wid: w.id, wix, x: p.x, y: p.y, vx: Math.cos(a) * st.speed, vy: Math.sin(a) * st.speed, ang: 0, r: st.area, dmg, life: st.dur, max: st.dur, owner: p, hm: new Map() });
          }
          w.cd = cd; break;
        }
        case 'pulse': {
          let any = false;
          this.near(p.x, p.y, st.area + 6, (e) => { any = true; });
          if (!any) { w.cd = 0; break; }
          this.near(p.x, p.y, st.area, (e) => { this.hurtEnemy(e, dmg, p); this.knock(e, p.x, p.y, st.knock * (p.cl.knock || 1)); });
          this.emit('r', r1(p.x), r1(p.y), r1(st.area), wix);
          w.cd = cd; break;
        }
        case 'chain': {
          const first = this.nearest(p.x, p.y, 100, 1)[0];
          if (!first) { w.cd = 0; break; }
          const hit = [], pts = [r1(p.x), r1(p.y)]; let cur = first, dd = dmg;
          for (let i = 0; i < st.count && cur; i++) {
            hit.push(cur); this.hurtEnemy(cur, dd, p); pts.push(r1(cur.x), r1(cur.y)); dd *= 0.85;
            cur = this.nearest(cur.x, cur.y, st.area, 1, hit)[0];
          }
          this.emit('c', pts); w.cd = cd; break;
        }
        case 'bomb': {
          const ts = this.nearest(p.x, p.y, 130, 6);
          if (!ts.length) { w.cd = 0; break; }
          for (let i = 0; i < st.count; i++) {
            const t = ts[Math.floor(this.rnd() * ts.length)];
            this.objs.push({ id: this.nid++, kind: 'x', wid: w.id, wix, x: p.x, y: p.y, sx: p.x, sy: p.y, tx: t.x, ty: t.y, t: st.dur, dur: st.dur, r: st.area, dmg, burn: st.burn, owner: p });
          }
          w.cd = cd; break;
        }
        case 'zone': {
          const ts = this.nearest(p.x, p.y, 130, Math.max(3, st.count));
          if (!ts.length) { w.cd = 0; break; }
          for (let i = 0; i < st.count; i++) {
            const t = ts[i % ts.length];
            this.objs.push({ id: this.nid++, kind: 'z', wid: w.id, wix, x: t.x, y: t.y, r: st.area, life: st.dur, tick: 0, every: st.tick, dmg, slow: Math.max(st.slow, p.cl.zoneSlow && w.id === 'louze' ? p.cl.zoneSlow : 0), owner: p });
          }
          w.cd = cd; break;
        }
        case 'turret': {
          const mine = this.objs.filter((o) => o.kind === 't' && o.owner === p).length;
          if (mine >= st.count) { w.cd = 0; break; }
          const a = this.rnd() * 6.283;
          this.objs.push({ id: this.nid++, kind: 't', wid: w.id, wix, x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16, r: 7, life: st.dur, cd: 0.3, rate: st.rate * cm, dmg, speed: st.speed, owner: p });
          w.cd = cd; break;
        }
      }
      if (w.cd > 0) this.emit('a', r1(p.x), r1(p.y), p.id, wix);   // the weapon fired: the client animates the swing/throw/cast
    }
  }

  orbit(p, w, st, wi, wix, dmg, T) {
    const rev0 = Math.floor(w.ang / 6.2832);
    w.ang += st.speed * DT;
    if (Math.floor(w.ang / 6.2832) !== rev0) this.emit('a', r1(p.x), r1(p.y), p.id, wix);   // once per revolution
    const R = 26 + st.area * 0.3;
    for (let i = 0; i < st.count; i++) {
      const a = w.ang + i / st.count * 6.283, bx = p.x + Math.cos(a) * R, by = p.y + Math.sin(a) * R;
      this.objs.push({ id: -(p.id * 100 + wi * 10 + i), kind: 'o', wix, x: bx, y: by, ang: a, r: 6, dummy: true });
      this.near(bx, by, 6, (e) => {
        if (!e.hm) e.hm = new Map();
        const key = p.id * 10 + wi;
        if ((e.hm.get(key) || 0) > T) return;
        e.hm.set(key, T + 0.45);
        this.hurtEnemy(e, dmg, p); this.knock(e, p.x, p.y, 4);
      });
    }
  }

  updateObjs(T) {
    const keep = [];
    for (const o of this.objs) {
      if (o.dummy) { keep.push(o); continue; }
      let live = true;
      switch (o.kind) {
        case 'p':
          o.x += o.vx * DT; o.y += o.vy * DT; o.life -= DT;
          this.near(o.x, o.y, o.r, (e) => {
            if (!live || o.hit.includes(e)) return;
            o.hit.push(e); this.hurtEnemy(e, o.dmg, o.owner); if (o.slow) this.slow(e, o.slow, 1.5);
            if (o.pierce-- <= 0) live = false;
          });
          if (o.life <= 0) live = false; break;
        case 'b': {
          o.life -= DT;
          const back = o.life < o.max / 2;
          if (back) { const dx = o.owner.x - o.x, dy = o.owner.y - o.y, l = Math.hypot(dx, dy) || 1, sp = Math.hypot(o.vx, o.vy); o.vx = dx / l * sp * 1.1; o.vy = dy / l * sp * 1.1; if (l < 6) live = false; }
          o.x += o.vx * DT; o.y += o.vy * DT; o.ang += 0.6;
          this.near(o.x, o.y, o.r, (e) => { if ((o.hm.get(e) || 0) > T) return; o.hm.set(e, T + 0.4); this.hurtEnemy(e, o.dmg, o.owner); });
          if (o.life <= -0.5) live = false; break;
        }
        case 'x': {
          o.t -= DT; const k = 1 - Math.max(0, o.t) / o.dur;
          o.x = o.sx + (o.tx - o.sx) * k; o.y = o.sy + (o.ty - o.sy) * k;
          if (o.t <= 0) {
            live = false; this.emit('b', r1(o.x), r1(o.y), o.r);
            this.near(o.x, o.y, o.r, (e) => { this.hurtEnemy(e, o.dmg, o.owner); if (o.burn) this.burn(e, o.dmg * o.burn, 3, o.owner); });
          } break;
        }
        case 'z':
          o.life -= DT; o.tick -= DT;
          if (o.tick <= 0) { o.tick = o.every; this.near(o.x, o.y, o.r, (e) => { this.hurtEnemy(e, o.dmg, o.owner, true); if (o.slow) this.slow(e, o.slow, 0.8); }); }
          if (o.life <= 0) live = false; break;
        case 't': {
          o.life -= DT;
          const hx = o.owner.x - o.x, hy = o.owner.y - o.y, hd = Math.hypot(hx, hy);
          if (hd > 40) { o.x += hx / hd * 40 * DT; o.y += hy / hd * 40 * DT; }
          if ((o.cd -= DT) <= 0) {
            const t = this.nearest(o.x, o.y, 110, 1)[0];
            if (t) {
              const a = Math.atan2(t.y - o.y, t.x - o.x); o.cd = 1 / Math.max(0.2, o.rate);
              this.objs.push({ id: this.nid++, kind: 'p', wid: o.wid, wix: o.wix, x: o.x, y: o.y, vx: Math.cos(a) * o.speed, vy: Math.sin(a) * o.speed, ang: a, r: 3, dmg: o.dmg, pierce: 0, life: 1.2, owner: o.owner, hit: [], tiny: true });
            } else o.cd = 0.2;
          }
          if (o.life <= 0) live = false; break;
        }
      }
      if (live) keep.push(o);
    }
    this.objs = keep;
  }

  // ---------- pickups, levels ----------
  updatePicks(alive) {
    const keep = [];
    for (const g of this.picks) {
      let taken = false, best = null, bd = Infinity;
      for (const p of alive) {
        // only xp gems and coins (tiers 0-3) are pulled in; hearts, magnets and chests (upgrades) must be walked over
        const d2 = (p.x - g.x) ** 2 + (p.y - g.y) ** 2, rad = g.tier <= 3 ? PICKUP_R * p.st.magnet * (p.cl.magnet || 1) * (1 + 0.25 * this.pl(p, 'magnet')) : TOUCH_R;
        if (d2 < bd) { bd = d2; best = p; }
        if (g.mag || d2 < rad * rad) { g.mag = true; best = p; bd = d2; break; }
      }
      if (best && g.mag) {
        const d = Math.sqrt(bd) || 1, sp = 140 * DT;
        g.x += (best.x - g.x) / d * Math.min(sp, d); g.y += (best.y - g.y) / d * Math.min(sp, d);
        if (d < 5) { this.take(best, g, alive); taken = true; }
      }
      if (!taken) keep.push(g);
    }
    this.picks = keep;
    if (this.picks.length > 400) this.picks.splice(0, this.picks.length - 400);
  }
  take(p, g, alive) {
    switch (g.tier) {
      case 0: case 1: case 2: {
        this.addXp(p, g.v);
        for (const q of alive) if (q !== p && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 150 * 150) this.addXp(q, g.v * 0.5);
        this.emit('g', p.id); break;
      }
      case 3: p.coins += g.v * (p.cl.coins || 1); this.emit('$', p.id); break;
      case 4: p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.25); this.emit('+', p.id); break;
      case 5: for (const o of this.picks) if (o.tier <= 3) o.mag = true; this.emit('M', p.id); break;
      case 6: p.coins += 15; p.pending.push(this.choices(p)); this.emit('C', p.id); break;
    }
  }
  addXp(p, v) {
    p.xp += v * (p.cl.xp || 1) * (1 + 0.1 * this.pl(p, 'moudrost'));
    while (p.xp >= lvlNeed(p.level)) { p.xp -= lvlNeed(p.level); p.level++; p.pending.push(this.choices(p)); this.emit('L', p.id); }
  }
  choices(p) {
    const pool = [];
    for (const w of p.weapons) if (w.lvl < MAX_ITEM_LVL) pool.push(['w', w.id, w.lvl + 1]);
    if (p.weapons.length < MAX_WEAPONS) for (const w of WEAPONS) if (!p.weapons.some((x) => x.id === w.id)) pool.push(['w', w.id, 1]);
    for (const [id, l] of Object.entries(p.passives)) if (l < MAX_ITEM_LVL) pool.push(['p', id, l + 1]);
    if (Object.keys(p.passives).length < MAX_PASSIVES) for (const q of PASSIVES) if (!p.passives[q.id]) pool.push(['p', q.id, 1]);
    const out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(this.rnd() * pool.length), 1)[0]);
    if (!out.length) out.push(['h', 'heal', 0]);
    return out;
  }
  choose(id, i) {
    const p = this.players[id - 1];
    if (!p || !p.pending.length) return false;
    const c = p.pending[0][i | 0];
    if (!c) return false;
    p.pending.shift();
    if (c[0] === 'w') { const w = p.weapons.find((x) => x.id === c[1]); if (w) w.lvl = c[2]; else p.weapons.push({ id: c[1], lvl: 1, cd: 0.3, ang: 0 }); }
    else if (c[0] === 'p') { p.passives[c[1]] = c[2]; this.recalc(p); }
    else p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.5);
    return true;
  }

  // ---------- view for one player ----------
  snapshot(pid, evs = this.ev) {
    const me = this.players[pid - 1], R2 = CULL * CULL;
    const near = (x, y) => (x - me.x) ** 2 + (y - me.y) ** 2 < R2;
    const s = {
      k: this.tick, T: r1(this.tick * DT),
      p: this.players.map((p) => [p.id, r1(p.x), r1(p.y), Math.ceil(p.hp), p.maxHp, p.dead ? 1 : 0, p.face, p.inv > 0 ? 1 : 0, r1(p.rev)]),
      e: [], o: [], b: [], g: [], v: evs.filter((v) => PERSONAL.has(v[0]) ? v[1] === pid : v[0] === 'B' ? true : v[0] === 'c' ? near(v[1][0], v[1][1]) : near(v[1], v[2])),
    };
    for (const e of this.enemies) if (!e.dead && near(e.x, e.y)) s.e.push([e.id, e.type, r1(e.x), r1(e.y), e.maxHp ? Math.max(1, Math.round(e.hp / e.maxHp * 100)) : 100, (e.flash ? 1 : 0) | (e.freezeUntil > this.tick * DT ? 2 : 0) | (e.burnUntil > this.tick * DT ? 4 : 0) | (e.slowUntil > this.tick * DT ? 8 : 0)]);
    for (const o of this.objs) if (near(o.x, o.y)) s.o.push([o.id, o.wix, r1(o.x), r1(o.y), r1(o.ang || 0), r1(o.r), o.kind === 'z' ? Math.round(o.life * 10) / 10 : 0]);
    for (const b of this.ebul) if (near(b.x, b.y)) s.b.push([b.id, r1(b.x), r1(b.y)]);
    for (const g of this.picks) if (near(g.x, g.y)) s.g.push([g.id, g.tier, r1(g.x), r1(g.y)]);
    s.me = { xp: Math.floor(me.xp), need: lvlNeed(me.level), level: me.level, coins: Math.floor(me.coins), kills: me.kills, spd: r1(me.spd), pend: me.pending.length, ch: me.pending[0] || null,
      w: me.weapons.map((w) => [WEAPON_IDX[w.id], w.lvl]), ps: me.passives, dead: me.dead, boss: ((b) => (b ? Math.max(1, Math.round(b.hp / b.maxHp * 100)) : 0))(this.enemies.find((e) => e.boss && !e.dead)) };
    if (this.over) s.over = this.over;
    return s;
  }
}

export const playerLevelNeed = lvlNeed;
