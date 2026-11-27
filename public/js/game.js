// One run on screen: canvas, joystick, HUD, level-up cards. Single player steps its own Sim; co-op is fed snapshots by the server.
import { Sim, weaponStats } from '../shared/sim.js';
import { DT, DUNGEON, WEAPONS, PASSIVE, WEAPON_IDX } from '../shared/data.js';
import { Scene, render } from './render.js';
import { objSprite, passiveSprite, text } from './sprites.js';
import { sfx, music, roar } from './audio.js';
import { t, nm, dd } from './i18n.js';

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function iconCanvas(kind, id) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16; c.className = 'icon';
  const x = c.getContext('2d');
  const sp = kind === 'w' ? objSprite(WEAPON_IDX[id]) : kind === 'p' ? passiveSprite(id) : null;
  if (sp) x.drawImage(sp, 8 - (sp.width >> 1), 8 - (sp.height >> 1));
  else { x.fillStyle = kind === 'w' ? '#4a6fd4' : '#3aa86a'; x.fillRect(2, 2, 12, 12); x.fillStyle = '#0006'; x.fillRect(2, 12, 12, 2); text(x, id[0], 6, 5, '#fff'); }
  return c;
}

// what an upgrade adds, in words: the change of the next level of a weapon / the per-level bonus of a passive
const fill = (k, n) => t(k).replace('{n}', n);
const pct = (x, y) => Math.round((x / y - 1) * 100);
function weaponGain(id, lvl) {
  const a = weaponStats(id, lvl - 1), b = weaponStats(id, lvl), out = [fill('gain_dmg', pct(b.dmg, a.dmg))];
  if (a.cd > 0 && b.cd < a.cd) out.push(fill('gain_cd', -pct(b.cd, a.cd)));
  if (b.count > a.count) out.push(fill('gain_count', b.count - a.count));
  if (a.area > 0 && b.area > a.area) out.push(fill('gain_area', pct(b.area, a.area)));
  if (b.pierce > a.pierce) out.push(fill('gain_pierce', b.pierce - a.pierce));
  if (a.dur > 0 && b.dur > a.dur) out.push(fill('gain_dur', pct(b.dur, a.dur)));
  return out.join(' · ');
}
function weaponNow(id, lvl) {
  const s = weaponStats(id, lvl), out = [`${t('st_dmg')} ${Math.round(s.dmg)}`];
  if (s.cd > 0) out.push(`${t('st_cd')} ${s.cd.toFixed(1)} s`);
  if (s.count > 1) out.push(`${t('st_count')} ${s.count}`);
  if (s.area > 0) out.push(`${t('st_area')} ${Math.round(s.area)}`);
  if (s.pierce > 0) out.push(`${t('st_pierce')} ${s.pierce}`);
  return out.join(' · ');
}
const passiveTotal = (d, lvl) => d.replace(/\d+/, (n) => +n * lvl);      // '+12 % max HP' at level 3 -> '+36 % max HP'

export class Run {
  // opts: root, mode, dun, players [{id,name,cls}], meId, char (single), net (multi), onEnd(over, stats)
  constructor(o) {
    Object.assign(this, o);
    this.dunData = DUNGEON[this.dun];
    this.scene = new Scene(this.dunData, this.meId, this.players);
    this.dir = [0, 0]; this.keys = new Set(); this.touch = null; this.paused = false; this.ended = false;
    this.lastHud = {}; this.callAt = {}; this.picked = null; this.lastSend = 0; this.sentDir = [9, 9]; this.pp = null; this.acc = 0; this.prevT = 0; this.shown = null;
  }

  start() {
    const r = this.root;
    r.innerHTML = `<div class="play"><canvas class="cv"></canvas>
      <div class="hud"><div class="xpbar"><i></i></div>
        <div class="toprow"><span class="lv"></span><span class="tm"></span><span class="bank"></span><button class="icon-btn pbtn" aria-label="${t('pause')}">II</button></div>
        <div class="prog"><i></i>${this.dunData.stages.map((b, n) => `<u class="b${n + 1}" style="left:${b.at / this.dunData.secs * 100}%"></u>`).join('')}</div>
        <div class="hpbar"><i></i><b></b></div><div class="kills"><span>${t('kills')}</span> <b>0</b></div>${this.dunData.shrines ? '<div class="shr"></div>' : ''}<div class="bossbar"><i></i><b>${t('boss')}</b></div>
        <div class="hint">${this.dunData.shrines ? t('hint_team') : t('hint_move')}</div><div class="toast"></div></div>
      <div class="stick"><div class="knob"></div></div>
      <div class="sheet lvlup" hidden></div><div class="sheet pausebox" hidden></div></div>`;
    this.q = (s) => r.querySelector(s);
    this.cv = this.q('.cv'); this.ctx = this.cv.getContext('2d');
    this.bind(); this.resize();
    music(this.dunData.id);
    if (this.mode === 'single') {
      this.sim = new Sim({ seed: (Math.random() * 2 ** 31) | 0, dungeonId: this.dun, players: [this.char] });
      this.push(this.sim.snapshot(1));
    }
    this.raf = requestAnimationFrame((n) => this.frame(n));
    setTimeout(() => this.q('.hint')?.classList.add('gone'), this.dunData.shrines ? 10000 : 6000);
  }

  bind() {
    const play = this.q('.play'), stick = this.q('.stick'), knob = this.q('.knob');
    this.on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); (this.offs ||= []).push(() => el.removeEventListener(ev, fn, opt)); };
    this.on(play, 'pointerdown', (e) => {
      if (e.target.closest('button, .sheet')) return;
      this.touch = { id: e.pointerId, x: e.clientX, y: e.clientY }; play.setPointerCapture(e.pointerId);
      const b = play.getBoundingClientRect(); stick.style.transform = `translate(${e.clientX - b.left - 36}px, ${e.clientY - b.top - 36}px)`; stick.classList.add('on'); knob.style.transform = 'translate(0,0)';
    });
    this.on(play, 'pointermove', (e) => {
      if (!this.touch || e.pointerId !== this.touch.id) return;
      let dx = (e.clientX - this.touch.x) / 34, dy = (e.clientY - this.touch.y) / 34; const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.dir = l < 0.12 ? [0, 0] : [dx, dy]; knob.style.transform = `translate(${dx * 24}px, ${dy * 24}px)`;
    });
    const up = (e) => { if (this.touch && e.pointerId === this.touch.id) { this.touch = null; this.dir = [0, 0]; stick.classList.remove('on'); } };
    this.on(play, 'pointerup', up); this.on(play, 'pointercancel', up);
    this.on(window, 'keydown', (e) => { if (e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key.toLowerCase(); if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) { this.keys.add(k); e.preventDefault(); } if (k === 'escape') this.togglePause(); });
    this.on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    this.on(window, 'blur', () => { this.keys.clear(); this.dir = [0, 0]; });
    this.on(window, 'resize', () => this.resize());
    this.on(this.q('.pbtn'), 'click', () => { sfx('click'); this.togglePause(); });
    this.on(this.q('.lvlup'), 'click', (e) => { const c = e.target.closest('[data-i]'); if (c) this.pick(+c.dataset.i); });
    this.on(this.q('.pausebox'), 'click', (e) => { const a = e.target.closest('[data-act]')?.dataset.act; if (a === 'resume') this.togglePause(); if (a === 'quit') this.quit(); });
  }

  resize() {
    const cw = Math.min(window.innerWidth, 500), s = Math.max(2, Math.round(cw / 190));
    const W = Math.floor(cw / s), H = Math.min(480, Math.floor(window.innerHeight / s));
    this.W = this.cv.width = W; this.H = this.cv.height = H; this.s = s;
    this.cv.style.width = W * s + 'px'; this.cv.style.height = H * s + 'px';
    this.ctx.imageSmoothingEnabled = false;
  }

  curDir() {
    const k = this.keys; if (!k.size) return this.dir;
    const dx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0), dy = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l];
  }

  togglePause() {
    if (this.ended) return;
    this.paused = !this.paused;
    const b = this.q('.pausebox');
    b.hidden = !this.paused;
    if (this.paused) {
      b.innerHTML = `<h2>${this.mode === 'single' ? t('pause') : t('menu')}</h2><div class="items">${this.itemRows(this.scene.cur?.me)}</div><button class="btn" data-act="resume">${t('resume')}</button><button class="btn danger" data-act="quit">${t('quit')}</button>`;
      for (const e of b.querySelectorAll('.ic')) e.append(iconCanvas(e.dataset.k, e.dataset.id));
    }
  }
  // the upgrades picked so far, with what each one adds (shown in the pause menu, not on the play field)
  itemRows(m) {
    if (!m) return '';
    const row = (k, id, name, lvl, desc, now) => `<div class="irow"><span class="ic" data-k="${k}" data-id="${esc(id)}"></span><span class="it2"><b>${esc(name)}</b> <small>Lv ${lvl}</small><span>${esc(desc)}</span>${now ? `<em>${esc(now)}</em>` : ''}</span></div>`;
    const rows = m.w.map(([wix, lvl]) => { const w = WEAPONS[wix]; return row('w', w.id, nm(w), lvl, dd(w), weaponNow(w.id, lvl)); })
      .concat(Object.entries(m.ps).map(([id, lvl]) => { const p = PASSIVE[id], d = dd(p); return row('p', id, nm(p), lvl, passiveTotal(d, lvl), ''); }));
    return rows.join('') || `<p>${t('no_upgrades')}</p>`;
  }
  quit() { this.finishRun(null); }

  // ---- loop ----
  frame(now) {
    if (this.ended) return;
    const dt = Math.min(0.1, (now - (this.prevT || now)) / 1000); this.prevT = now;
    const dir = this.curDir();
    if (this.mode === 'single') {
      if (!this.paused) {
        const me = this.sim.players[0];
        this.acc += dt;
        while (this.acc >= DT) {
          this.acc -= DT;
          if (me.pending.length) { this.acc = 0; break; }
          this.sim.setInput(1, dir[0], dir[1]); this.sim.step(); this.push(this.sim.snapshot(1), now);
          if (this.sim.over) { this.finishRun(this.sim.over); return; }
        }
      }
    } else {
      this.sendInput(dir, now);
      this.predict(dir, dt, now);
    }
    render(this.ctx, this.W, this.H, this.scene, now, dir[0] || dir[1] ? 1 : 0);
    this.raf = requestAnimationFrame((n) => this.frame(n));
  }

  sendInput(dir, now) {
    const dx = Math.round(dir[0] * 20) / 20, dy = Math.round(dir[1] * 20) / 20;
    if (dx !== this.sentDir[0] || dy !== this.sentDir[1] || now - this.lastSend > 400) { this.net.send({ t: 'in', dx, dy }); this.sentDir = [dx, dy]; this.lastSend = now; }
  }
  predict(dir, dt, now) {
    const c = this.scene.cur; if (!c) return;
    const me = c.p.find((p) => p[0] === this.meId); if (!me) return;
    const spd = c.me.spd, dead = me[5];
    if (!this.pp) this.pp = [me[1], me[2]];
    const lat = this.net.rtt / 2000 + (now - this.scene.tCur) / 1000;
    const tx = me[1] + (dead ? 0 : dir[0] * spd * lat), ty = me[2] + (dead ? 0 : dir[1] * spd * lat);
    if (!dead) { this.pp[0] += dir[0] * spd * dt; this.pp[1] += dir[1] * spd * dt; }
    const k = Math.min(1, 7 * dt);
    if (Math.hypot(tx - this.pp[0], ty - this.pp[1]) > 50) { this.pp[0] = tx; this.pp[1] = ty; } else { this.pp[0] += (tx - this.pp[0]) * k; this.pp[1] += (ty - this.pp[1]) * k; }
    this.scene.predicted = this.pp; this.scene.camOverride = this.pp;
  }

  push(snap, now = performance.now()) {            // from the sim (single) or the server (co-op)
    this.scene.push(snap, now);
    this.events(snap); this.updateHud(snap); this.bossCalls(snap, now);
  }

  events(snap) {
    for (const v of snap.v) {
      switch (v[0]) {
        case 'h': sfx('hit'); break; case 'd': sfx(v[3] ? 'boom' : 'kill'); break; case 'g': sfx('gem'); break; case '$': sfx('coin'); break; case '+': sfx('heart'); break;
        case 'L': case 'C': sfx('level'); break; case 'u': sfx('hurt'); break; case 'x': sfx('die'); break;
        case 'B': { const n = this.dunData.stages.length, k = v[1] || n; sfx('boss'); this.callAt[k] = performance.now(); roar(this.dunData.boss.designs[k - 1], k < n); this.bossName = this.dunData.boss.names[k - 1]; this.toast(`${t('boss')} ${k}/${n} · ${this.bossName}`); break; }
        case 'S': sfx(v[2] ? 'level' : 'boss'); this.toast(`${t(v[2] ? 'shrine_on' : 'shrine_lost')} · ${snap.sh.filter((h) => h[3]).length}/${snap.sh.length}`); break;
        case 'b': sfx('boom'); break; case 'c': sfx('zap'); break; case 'r': case 'M': sfx('pulse'); break;
      }
    }
  }
  // a boss calls out now and then, louder the closer it is and from the side it is on, so you can tell which one is near without looking
  bossCalls(snap, now) {
    const me = snap.p.find((p) => p[0] === this.meId) || snap.p[0], n = this.dunData.stages.length;
    for (const e of snap.e) {
      if (e[1] < 6 || !me) continue;
      const k = e[1] - 5, last = this.callAt[k] || 0; if (now - last < (k < n ? 7000 : 5500)) continue;
      const dx = e[2] - me[1], dy = e[3] - me[2], dist = Math.hypot(dx, dy);
      this.callAt[k] = now; roar(this.dunData.boss.designs[k - 1], k < n, Math.max(0.12, 0.6 - dist / 400), Math.max(-1, Math.min(1, dx / 90)));
    }
  }
  toast(s) { const e = this.q('.toast'); if (!e || !s) return; e.textContent = s; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); }

  updateHud(snap) {
    const me = snap.p.find((p) => p[0] === this.meId) || snap.p[0], m = snap.me, L = this.lastHud;
    const set = (k, el, v, fn) => { if (L[k] !== v) { L[k] = v; fn(this.q(el), v); } };
    set('xp', '.xpbar i', Math.round(m.xp / m.need * 100), (e, v) => { e.style.width = v + '%'; });
    set('lv', '.lv', m.level, (e, v) => { e.textContent = `${t('level')} ${v}`; });
    set('tm', '.tm', Math.floor(snap.T), (e, v) => { e.textContent = fmtTime(v); });
    set('bank', '.bank', m.coins, (e, v) => { e.textContent = `${v} ◆`; });
    set('kills', '.kills b', m.kills, (e, v) => { e.textContent = v; });
    set('pg', '.prog i', Math.min(100, Math.round(snap.T / this.dunData.secs * 200) / 2), (e, v) => { e.style.width = v + '%'; });
    set('pgb', '.prog', Math.floor(snap.T), (e, T) => { e.querySelectorAll('u').forEach((u, n) => u.classList.toggle('done', T >= this.dunData.stages[n].at)); });
    set('hp', '.hpbar i', Math.round(me[3] / me[4] * 100), (e, v) => { e.style.width = v + '%'; });
    set('hpt', '.hpbar b', me[3] + '/' + me[4], (e, v) => { e.textContent = v; });
    set('boss', '.bossbar', m.boss, (e, v) => { e.classList.toggle('on', v > 0); e.querySelector('i').style.width = v + '%'; });
    set('shield', '.bossbar', `${!!m.shield}${this.bossName}`, (e) => { e.classList.toggle('shield', !!m.shield); e.querySelector('b').textContent = m.shield ? t('shield') : this.bossName || t('boss'); });
    if (snap.sh) set('shr', '.shr', snap.sh.filter((h) => h[3]).length, (e, v) => { e.textContent = `⚑ ${v}/${snap.sh.length}`; });
    if (m.dead && snap.p.length > 1) this.toast(t('revive'));
    this.levelCards(m);
  }

  levelCards(m) {
    const box = this.q('.lvlup'), key = m.ch ? JSON.stringify(m.ch) : null;
    if (!key || key === this.picked) { box.hidden = true; this.shown = null; return; }
    if (this.shown === key) return;
    this.shown = key; box.hidden = false; box.classList.toggle('mp', this.mode === 'multi');
    const cards = m.ch.map(([k, id, lvl], i) => {
      let name, desc, lv;
      if (k === 'w') { const w = WEAPONS[WEAPON_IDX[id]]; name = nm(w); desc = lvl > 1 ? weaponGain(id, lvl) : `${dd(w)} (${weaponNow(id, 1)})`; lv = lvl; }
      else if (k === 'p') { const p = PASSIVE[id], d = dd(p); name = nm(p); desc = lvl > 1 ? `${d} (${t('total')} ${passiveTotal(d, lvl)})` : d; lv = lvl; }
      else { name = t('heal'); desc = t('heal_d'); lv = 0; }
      return `<button class="card" data-i="${i}"><span class="ic" data-k="${k === 'h' ? 'p' : k}" data-id="${k === 'h' ? 'srdce' : esc(id)}"></span><span class="ct"><b>${esc(name)}</b><small>${lv === 1 ? t('new') : lv ? 'Lv ' + lv : ''}</small></span><span class="cd">${esc(desc)}</span></button>`;
    }).join('');
    box.innerHTML = `<h2>${t('levelup')}</h2><p>${t('choose')}</p>${cards}`;
    for (const s of box.querySelectorAll('.ic')) s.append(iconCanvas(s.dataset.k, s.dataset.id));
  }
  pick(i) {
    const key = this.shown; if (!key) return;
    sfx('click');
    if (this.mode === 'single') { this.sim.choose(1, i); this.push(this.sim.snapshot(1)); }
    else { this.net.send({ t: 'pick', i }); this.picked = key; this.q('.lvlup').hidden = true; this.shown = null; }
  }

  finishRun(over) {
    if (this.ended) return;
    this.ended = true; cancelAnimationFrame(this.raf);
    for (const off of this.offs || []) off();
    const c = this.scene.cur, m = c?.me;
    this.onEnd(over, { kills: m?.kills || 0, coinsPicked: Math.floor(m?.coins || 0), timeSec: Math.floor(over ? over.time : (c?.T || 0)), cleared: !!over?.cleared });
  }
  destroy() { this.ended = true; cancelAnimationFrame(this.raf); for (const off of this.offs || []) off(); this.offs = []; }
}
