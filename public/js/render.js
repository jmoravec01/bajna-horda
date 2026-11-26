// Scene: interpolates between two snapshots. Renderer: draws one frame onto the small pixel canvas.
import { DUNGEON, ARCH, CLASS } from '../shared/data.js';
import { heroSprite, enemySprite, enemyRadius, enemyFor, objSprite, pickSprite, bulletSprite, ground, text, textWidth } from './sprites.js';

export class Scene {
  constructor(dun, meId, players) {
    this.dun = dun; this.meId = meId; this.players = players;     // players: [{id, name, cls}]
    this.cur = null; this.prev = null; this.pm = { e: new Map(), o: new Map(), p: new Map() };
    this.tCur = 0; this.interval = 100; this.fx = []; this.cam = [0, 0];
  }
  push(snap, now) {
    if (this.cur) {
      this.interval = Math.min(250, Math.max(40, this.interval * 0.8 + (now - this.tCur) * 0.2));
      this.pm.e = new Map(this.cur.e.map((a) => [a[0], a])); this.pm.o = new Map(this.cur.o.map((a) => [a[0], a])); this.pm.p = new Map(this.cur.p.map((a) => [a[0], a]));
    }
    this.prev = this.cur; this.cur = snap; this.tCur = now;
    for (const v of snap.v) this.addFx(v, now);
  }
  alpha(now) { return Math.min(1.1, Math.max(0, (now - this.tCur) / this.interval)); }
  addFx(v, now) {
    const k = v[0];
    if (k === 'h') this.fx.push({ k, x: v[1], y: v[2], t: now, d: 110 });
    else if (k === 'k') this.fx.push({ k, x: v[1], y: v[2], t: now, d: 260 });
    else if (k === 'd') this.fx.push({ k, x: v[1], y: v[2], t: now, d: v[3] ? 600 : 300, big: v[3] });
    else if (k === 'r') this.fx.push({ k, x: v[1], y: v[2], r: v[3], w: v[4], t: now, d: 260 });
    else if (k === 'b') this.fx.push({ k, x: v[1], y: v[2], r: v[3], t: now, d: 320 });
    else if (k === 'c') this.fx.push({ k, pts: v[1], t: now, d: 160 });
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
const tintCache = new Map();
function tinted(c, col) {
  let m = tintCache.get(c); if (!m) tintCache.set(c, m = new Map());
  let t = m.get(col);
  if (!t) {
    t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0); x.globalCompositeOperation = 'source-atop'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
    m.set(col, t);
  }
  return t;
}
function disc(x, cx, cy, r, col, alpha = 1) {
  x.fillStyle = col; x.globalAlpha = alpha;
  for (let j = -r; j <= r; j++) { const hw = Math.floor(Math.sqrt(r * r - j * j)); x.fillRect(cx - hw, cy + j, hw * 2 + 1, 1); }
  x.globalAlpha = 1;
}
function ring(x, cx, cy, r, col, alpha = 1) {
  x.fillStyle = col; x.globalAlpha = alpha;
  const n = Math.max(12, Math.round(r * 5));
  for (let i = 0; i < n; i++) { const a = i / n * 6.2832; x.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1); }
  x.globalAlpha = 1;
}
function line(x, x0, y0, x1, y1, col) {
  x.fillStyle = col; x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
  for (let n = 0; n < 400; n++) { x.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
}
const RING_COL = { 4: '#f5a142', 7: '#ffe060', 8: '#cfcfcf', 5: '#f0a', 6: '#aee' };

export function render(ctx, W, H, sc, now, lastDir) {
  const c = sc.cur;
  if (!c) { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H); return; }
  const a = Math.min(1, sc.alpha(now)), d = sc.dun;
  const me = c.p.find((p) => p[0] === sc.meId) || c.p[0];
  const pme = sc.pm.p.get(me[0]) || me;
  const cx = sc.camOverride ? sc.camOverride[0] : lerp(pme[1], me[1], a), cy = sc.camOverride ? sc.camOverride[1] : lerp(pme[2], me[2], a);
  const camX = Math.round(cx - W / 2), camY = Math.round(cy - H / 2);
  const gp = ground(ctx, d);
  ctx.save();
  ctx.fillStyle = gp; ctx.translate(-((camX % gp.size) + gp.size) % gp.size, -((camY % gp.size) + gp.size) % gp.size);
  ctx.fillRect(0, 0, W + gp.size, H + gp.size);
  ctx.restore();
  const sx = (x) => Math.round(x - camX), sy = (y) => Math.round(y - camY);
  const vis = (x, y, m = 20) => x > camX - m && x < camX + W + m && y > camY - m && y < camY + H + m;

  // zones under everything
  for (const o of c.o) if (o[1] === 5 || o[1] === 6) {
    const p0 = sc.pm.o.get(o[0]) || o, x = lerp(p0[2], o[2], a), y = lerp(p0[3], o[3], a);
    if (!vis(x, y, o[5])) continue;
    const col = o[1] === 5 ? '#6ad04a' : '#4aa8e8', px = sx(x), py = sy(y), r = Math.round(o[5]);
    disc(ctx, px, py, r, col, 0.28); ring(ctx, px, py, r, col, 0.7);
    for (let i = 0; i < 5; i++) { const t = (now / 700 + i * 0.37 + o[0]) % 1, bx = px + Math.round(Math.sin(i * 2.4 + o[0]) * r * 0.6), by = py + Math.round(Math.cos(i * 1.7) * r * 0.5 - t * 8); ctx.fillStyle = col; ctx.globalAlpha = 1 - t; ctx.fillRect(bx, by, 2, 2); ctx.globalAlpha = 1; }
  }
  // pickups
  for (const g of c.g) {
    if (!vis(g[2], g[3])) continue;
    const s = pickSprite(g[1]), bob = Math.round(Math.sin(now / 250 + g[0]) * 1);
    ctx.drawImage(s, sx(g[2]) - (s.width >> 1), sy(g[3]) - (s.height >> 1) + bob);
  }

  // sortable things: enemies + players
  const list = [];
  for (const e of c.e) {
    const p0 = sc.pm.e.get(e[0]) || e, x = lerp(p0[2], e[2], a), y = lerp(p0[3], e[3], a);
    if (vis(x, y, 30)) list.push([y, 0, e, x, y, e[2] - p0[2]]);
  }
  for (const p of c.p) {
    const p0 = sc.pm.p.get(p[0]) || p;
    let x = lerp(p0[1], p[1], a), y = lerp(p0[2], p[2], a);
    if (p[0] === sc.meId && sc.predicted) { x = sc.predicted[0]; y = sc.predicted[1]; }
    list.push([y, 1, p, x, y, 0]);
  }
  list.sort((u, v) => u[0] - v[0]);
  for (const [, kind, e, x, y, dxm] of list) {
    if (kind === 0) {
      const [arch, pal] = enemyFor(d, e[1]), fr = enemySprite(arch, pal), spr = fr[(Math.floor(now / 220) + e[0]) & 1], r = enemyRadius(d, e[1]);
      const k = r / ARCH[arch].r, w = Math.round(spr.width * k), h = Math.round(spr.height * k);
      const px = sx(x), py = sy(y);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(px - (w >> 1) + 1, py + (h >> 1) - 1, w - 2, 2);
      let img = spr; const fl = e[5];
      if (fl & 1) img = tinted(spr, '#ffffff'); else if (fl & 2) img = tinted(spr, '#9fe8ff'); else if ((fl & 4) && (now / 120 | 0) % 2) img = tinted(spr, '#ff8a30');
      ctx.save();
      ctx.translate(px, py - (h >> 1));
      if (dxm < -0.05) ctx.scale(-1, 1);
      if (arch === 'ghost') ctx.globalAlpha = 0.75;
      ctx.drawImage(img, -(w >> 1), -(h >> 1), w, h);
      ctx.restore();
      if (e[1] === 5 || e[1] === 6) { const bw = Math.max(14, w); ctx.fillStyle = '#000'; ctx.fillRect(px - (bw >> 1) - 1, py - h - 4, bw + 2, 4); ctx.fillStyle = e[1] === 6 ? '#e33' : '#f90'; ctx.fillRect(px - (bw >> 1), py - h - 3, Math.round(bw * e[4] / 100), 2); }
    } else {
      const pl = sc.players.find((q) => q.id === e[0]) || { cls: 'bohatyr', name: '?' };
      const moving = e[0] === sc.meId ? lastDir : 1, fr = (moving && !e[5]) ? (Math.floor(now / 140) & 1) : 0, spr = heroSprite(pl.cls, fr);
      const px = sx(x), py = sy(y);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(px - 5, py + 7, 10, 2);
      if (e[7] && (now / 90 | 0) % 3 === 0) continue;                  // invulnerability flicker
      ctx.save(); ctx.translate(px, py - 1);
      if (e[6] < 0) ctx.scale(-1, 1);
      if (e[5]) { ctx.globalAlpha = 0.45; ctx.rotate(Math.PI / 2); ctx.drawImage(spr, -(spr.width >> 1), -(spr.height >> 1) + 2); }
      else ctx.drawImage(spr, -(spr.width >> 1), -(spr.height >> 1));
      ctx.restore();
      if (e[5] && e[8] > 0) { ctx.fillStyle = '#000'; ctx.fillRect(px - 8, py - 12, 16, 3); ctx.fillStyle = '#7f7'; ctx.fillRect(px - 7, py - 11, Math.round(14 * Math.min(1, e[8] / 3)), 1); }
      if (sc.players.length > 1) { const nm = pl.name.slice(0, 8), w = textWidth(nm); text(ctx, nm, px - (w >> 1), py - 16, e[0] === sc.meId ? '#fe7' : '#fff'); }
      if (e[0] !== sc.meId && !e[5]) { ctx.fillStyle = '#000'; ctx.fillRect(px - 7, py - 11, 14, 2); ctx.fillStyle = '#e44'; ctx.fillRect(px - 7, py - 11, Math.round(14 * e[3] / e[4]), 2); }
    }
  }

  // weapon objects
  for (const o of c.o) {
    if (o[1] === 5 || o[1] === 6) continue;
    const p0 = sc.pm.o.get(o[0]) || o, x = lerp(p0[2], o[2], a), y = lerp(p0[3], o[3], a);
    if (!vis(x, y)) continue;
    const s = objSprite(o[1]);
    if (!s) continue;
    const px = sx(x), py = sy(y);
    if (o[1] === 11) { ctx.drawImage(s, px - (s.width >> 1), py - (s.height >> 1) + Math.round(Math.sin(now / 150 + o[0]) * 1)); continue; }
    ctx.save(); ctx.translate(px, py);
    ctx.rotate(o[1] === 0 ? o[4] + Math.PI / 2 : o[1] === 9 ? o[4] : o[4] + (o[1] === 1 ? Math.PI * 0.5 + now / 60 : Math.PI / 2));
    ctx.drawImage(s, -(s.width >> 1), -(s.height >> 1));
    ctx.restore();
  }
  // enemy bullets
  const bs = bulletSprite();
  for (const b of c.b) if (vis(b[1], b[2])) ctx.drawImage(bs, sx(b[1]) - 2, sy(b[2]) - 2);

  // effects
  sc.fx = sc.fx.filter((f) => now - f.t < f.d);
  for (const f of sc.fx) {
    const t = (now - f.t) / f.d;
    switch (f.k) {
      case 'h': { const x = sx(f.x), y = sy(f.y); ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); break; }
      case 'k': { const x = sx(f.x), y = sy(f.y - t * 8); ctx.fillStyle = '#ffd23f'; ctx.fillRect(x - 2, y, 5, 1); ctx.fillRect(x, y - 2, 1, 5); break; }
      case 'd': { const x = sx(f.x), y = sy(f.y), n = f.big ? 12 : 4; ctx.fillStyle = f.big ? '#ffd23f' : '#ddd'; ctx.globalAlpha = 1 - t; for (let i = 0; i < n; i++) { const an = i / n * 6.28 + 0.5, r = t * (f.big ? 26 : 9); ctx.fillRect(Math.round(x + Math.cos(an) * r), Math.round(y + Math.sin(an) * r), 2, 2); } ctx.globalAlpha = 1; break; }
      case 'r': ring(ctx, sx(f.x), sy(f.y), Math.round(f.r * Math.min(1, t * 2.2)), RING_COL[f.w] || '#fff', 1 - t); break;
      case 'b': { const r = Math.round(f.r * (0.4 + t * 0.6)); disc(ctx, sx(f.x), sy(f.y), r, t < 0.4 ? '#ffe08a' : '#ff6a1a', 0.75 * (1 - t)); ring(ctx, sx(f.x), sy(f.y), r, '#ff3a10', 1 - t); break; }
      case 'c': { const p = f.pts; for (let i = 2; i < p.length; i += 2) { const mx = (p[i - 2] + p[i]) / 2 + ((i * 7) % 5 - 2), my = (p[i - 1] + p[i + 1]) / 2 + ((i * 3) % 5 - 2); line(ctx, sx(p[i - 2]), sy(p[i - 1]), sx(mx), sy(my), '#fff6a0'); line(ctx, sx(mx), sy(my), sx(p[i]), sy(p[i + 1]), '#8ad0ff'); } break; }
    }
  }
  return [cx, cy];
}
