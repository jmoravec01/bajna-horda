// Screens and navigation.
import { CLASSES, CLASS, DUNGEONS, DUNGEON, SLOTS, MAX_EQUIP, MAX_CHARS, ARMS, ARM, ARM_TYPES, MAX_PLUS } from '../shared/data.js';
import { charStats, power, xpNeed, upgradeCost, unlocked, validName, armOf, armDmg, armUpCost } from '../shared/meta.js';
import { t, nm, ds, setLang, getLang, detectLang, errText } from './i18n.js';
import { store, profile, Net, OFFLINE } from './net.js';
import { Run } from './game.js';
import { heroSprite, armSprite, armGlow } from './sprites.js';
import { drawHeld } from './render.js';
import { sfx, music, setMuted, isMuted } from './audio.js';

const $app = document.getElementById('app');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REC = { s1: 100, s2: 190, s3: 300, m1: 130, m2: 230, m3: 340 };      // recommended power
const S = { screen: 'title', run: null, net: null, room: null, pick: 'bohatyr', msg: '' };

const activeChar = () => profile.p?.chars.find((c) => c.id === store.d.active) || profile.p?.chars[0] || null;
// a world is found by three hero faces; the wire code is 3 letters, A..L = the class index
const faces = (code, scale = 4) => [...code].map((ch) => heroCv(CLASSES[ch.charCodeAt(0) - 65].id, scale)).join('');
const heroCv = (cls, scale = 3, arm) => `<canvas class="hero" data-hero="${cls}" data-s="${scale}"${arm ? ` data-arm="${arm[0].id}" data-plus="${arm[1]}"` : ''}></canvas>`;
const armCv = (id, plus, scale = 4) => `<canvas class="armcv" data-armid="${id}" data-plus="${plus}" data-s="${scale}"></canvas>`;
function fillHeroes() {
  for (const c of $app.querySelectorAll('canvas[data-hero]')) {
    const s = heroSprite(c.dataset.hero, 0), k = +c.dataset.s, held = c.dataset.arm, pad = held ? 8 : 0, top = held ? 4 : 0;   // room for the weapon in the hand
    c.width = s.width + pad; c.height = s.height + top; c.style.width = c.width * k + 'px'; c.style.height = c.height * k + 'px';
    const x = c.getContext('2d'); x.drawImage(s, 0, top);
    if (held) drawHeld(x, { s: armSprite(held), plus: +c.dataset.plus }, c.dataset.hero === 'golem' ? 13 : 11, top + 12, 0.45, 0);
  }
  for (const c of $app.querySelectorAll('canvas[data-armid]')) {      // a weapon icon, centred in a 16x16 box; the frame colour shows the upgrade
    const s = armSprite(c.dataset.armid), k = +c.dataset.s;
    c.width = 16; c.height = 16; c.style.width = 16 * k + 'px'; c.style.height = 16 * k + 'px';
    c.getContext('2d').drawImage(s, 8 - Math.round(s.width / 2), 8 - Math.round(s.height / 2));
    c.style.setProperty('--glow', armGlow(+c.dataset.plus) || 'transparent');
  }
}
function view(html, bind) {
  $app.innerHTML = html;
  for (const e of $app.querySelectorAll('[data-w]')) e.style.width = e.dataset.w + '%';
  fillHeroes();
  S.bind = bind;
  bind?.($app);
}
const wbar = (v, max) => `<div class="mini"><i data-w="${Math.min(100, Math.round(v / max * 100))}"></i></div>`;
const go = (name, ...a) => { S.screen = name; sfx('click'); SCREENS[name](...a); };
const topbar = (back) => `<div class="top">${back ? `<button class="icon-btn" data-go="${back}">‹</button>` : '<span></span>'}<span class="who">${profile.user ? esc(profile.user) : (OFFLINE || !profile.user ? 'Host' : '')}</span><span class="coins">${profile.p ? Math.floor(profile.p.coins) : 0} ◆</span><button class="icon-btn" data-act="lang">${t('lang')}</button><button class="icon-btn" data-act="snd">${isMuted() ? '×' : '♪'}</button></div>`;
function wire(root, extra) {
  root.onclick = (e) => {
    const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'lang') { setLang(getLang() === 'cs' ? 'en' : 'cs'); store.d.lang = getLang(); store.save(); return SCREENS[S.screen](...(S.args || [])); }
    if (a === 'snd') { setMuted(!isMuted()); store.d.muted = isMuted(); store.save(); return SCREENS[S.screen](...(S.args || [])); }
    extra?.(e);
  };
}
const note = (s) => { const el = $app.querySelector('.msg'); if (el) el.textContent = s; };

const SCREENS = {
  title() {
    music('menu'); S.args = [];
    const parade = ['krakonos', 'zbojnik', 'perun', 'cert', 'vedma', 'baba'].map((c) => heroCv(c, 4)).join('');
    view(`<div class="screen title"><div class="top"><span></span><span></span><span></span><button class="icon-btn" data-act="lang">${t('lang')}</button><button class="icon-btn" data-act="snd">${isMuted() ? '×' : '♪'}</button></div>
      <h1 class="logo">BÁJNÁ<br>HORDA</h1><p class="sub">${t('sub')}</p><div class="parade">${parade}</div>
      ${OFFLINE ? `<p class="note">${t('offline_note')}</p>` : `<form class="auth" autocomplete="on"><input name="nick" maxlength="16" placeholder="${t('nick')}" autocomplete="username" required><input name="pass" type="password" placeholder="${t('pass')}" autocomplete="current-password" minlength="6" required>
        <div class="row"><button class="btn" data-act="login" type="submit">${t('login')}</button><button class="btn alt" data-act="register" type="button">${t('register')}</button></div></form>`}
      <p class="msg"></p><button class="btn ghost" data-act="guest">${t('guest')}</button><p class="note">${t('guest_note')}</p></div>`, (root) => {
      const form = root.querySelector('form');
      const auth = async (kind) => {
        const f = new FormData(form), name = String(f.get('nick') || '').trim(), pass = String(f.get('pass') || '');
        if (!validName(name)) return note(t('err_name'));
        if (pass.length < 6) return note(t('err_pass'));
        try { note(t('saving')); await profile.auth(kind, name, pass); store.d.active = null; afterLogin(); } catch (e) { note(errText(e)); }
      };
      if (form) { form.onsubmit = (e) => { e.preventDefault(); auth('login'); }; root.querySelector('[data-act=register]').onclick = () => auth('register'); }
      wire(root, (e) => { if (e.target.closest('[data-act=guest]')) { profile.startGuest(); afterLogin(); } });
    });
  },

  home() {
    music('menu'); S.args = [];
    const c = activeChar();
    const card = c ? charCard(c, true) : `<div class="card empty">${t('no_char')}</div>`;
    view(`<div class="screen home">${topbar()}${card}
      <button class="btn big" data-go="single" ${c ? '' : 'disabled'}>${t('single')}</button>
      <button class="btn big alt" data-go="multi" ${c && !OFFLINE ? '' : 'disabled'}>${t('multi')}</button>
      <button class="btn big ghost" data-go="chars">${t('chars')} (${profile.p.chars.length}/${MAX_CHARS})</button>
      <button class="btn ghost small" data-act="logout">${t('logout')}</button></div>`, (root) => wire(root, async (e) => {
      if (e.target.closest('[data-act=logout]')) { await profile.logout(); go('title'); }
    }));
  },

  chars() {
    S.args = []; const p = profile.p, c = activeChar();
    const list = p.chars.map((x) => `<button class="tile ${c && x.id === c.id ? 'sel' : ''}" data-id="${x.id}">${heroCv(x.cls, 3)}<b>${esc(x.name)}</b><small>${t('level')} ${x.level}</small></button>`).join('');
    const aw = c ? armOf(c) : null;
    const weaponRow = c ? `<div class="eq">${armCv(aw[0].id, aw[1], 3)}<span class="en"><b>${esc(nm(aw[0]))} +${aw[1]}</b><small>${t('weapon')} · ${t('dmg_mul')} ×${armDmg(aw[0], aw[1]).toFixed(2)}</small></span><button class="btn small" data-go="arms">${t('armory')}</button></div>` : '';
    const eq = c ? weaponRow + SLOTS.map((s) => {
      const lvl = c.equip[s], cost = upgradeCost(lvl);
      return `<div class="eq"><span class="en"><b>${t(s)}</b><small>${t(s + '_d')}</small></span><span class="lvl">${lvl}/${MAX_EQUIP}</span>${lvl >= MAX_EQUIP ? `<span class="maxed">${t('maxed')}</span>` : `<button class="btn small" data-up="${s}" ${p.coins >= cost ? '' : 'disabled'}>${cost} ◆</button>`}</div>`;
    }).join('') : '';
    view(`<div class="screen chars">${topbar('home')}<h2>${t('slots')} ${p.chars.length}/${MAX_CHARS}</h2><div class="tiles">${list}${p.chars.length < MAX_CHARS ? `<button class="tile add" data-go="create">+<small>${t('newchar')}</small></button>` : ''}</div>
      ${c ? `${charCard(c, false)}<div class="eqs">${eq}</div><p class="msg"></p><button class="btn danger small" data-act="del">${t('del')}</button>` : `<p>${t('no_char')}</p>`}</div>`, (root) => wire(root, async (e) => {
      const tile = e.target.closest('.tile[data-id]'); if (tile) { store.d.active = +tile.dataset.id; store.save(); sfx('click'); return SCREENS.chars(); }
      const up = e.target.closest('[data-up]'); if (up) { try { await profile.upgrade(c.id, up.dataset.up); sfx('level'); SCREENS.chars(); } catch (er) { note(errText(er)); } return; }
      if (e.target.closest('[data-act=del]') && confirm(t('confirm_del'))) { try { await profile.remove(c.id); store.d.active = null; SCREENS.chars(); } catch (er) { note(errText(er)); } }
    }));
  },

  arms() {
    S.args = []; const p = profile.p, c = activeChar(); if (!c) return go('chars');
    const sel = ARM[S.armSel] || armOf(c)[0], has = c.arms[sel.id] !== undefined, plus = c.arms[sel.id] ?? 0, held = armOf(c)[0].id === sel.id;
    const pr = (w, pl) => { const v = w.perkVal * (1 + pl / MAX_PLUS), k = { hp: 1, spd: 0.5, cd: 1, magnet: 3 }[w.perk]; return w.perk ? `+${(v * k * 100).toFixed(1).replace('.0', '')} % ${t('perk_' + w.perk)}` : t('perk_none'); };
    const cost = armUpCost(sel, plus);
    const action = !has ? (c.level < sel.need ? `<button class="btn" disabled>${t('need_lvl')} ${sel.need}</button>` : `<button class="btn" data-op="buy" ${p.coins >= sel.price ? '' : 'disabled'}>${t('buy')} · ${sel.price} ◆</button>`)
      : `${plus >= MAX_PLUS ? `<span class="maxed">${t('maxed')}</span>` : `<button class="btn" data-op="up" ${p.coins >= cost ? '' : 'disabled'}>${t('upgrade')} +${plus + 1} · ${cost} ◆</button>`}${held ? `<span class="maxed">${t('held')}</span>` : `<button class="btn alt" data-op="equip">${t('equip')}</button>`}`;
    const grid = Object.keys(ARM_TYPES).map((ty) => `<div class="armrow"><span class="ty">${t('type_' + ty)}</span>${ARMS.filter((w) => w.type === ty).map((w) => {
      const o = c.arms[w.id]; return `<button class="atile ${w.id === sel.id ? 'sel' : ''} ${o === undefined ? 'locked' : ''} t${w.tier}" data-arm="${w.id}">${armCv(w.id, o ?? 0, 3)}<b>${o === undefined ? (c.level < w.need ? '🔒' : '') : '+' + o}</b>${armOf(c)[0].id === w.id ? '<i>✓</i>' : ''}</button>`; }).join('')}</div>`).join('');
    view(`<div class="screen arms">${topbar('chars')}<h2>${t('armory')}</h2>
      <div class="card armdetail t${sel.tier}">${armCv(sel.id, plus, 6)}<div class="info"><b>${esc(nm(sel))}${has ? ` +${plus}` : ''}</b><small>${t('type_' + sel.type)} · ${t('t' + sel.tier)}</small>
        <small>${t('dmg_mul')} ×${armDmg(sel, plus).toFixed(2)}${plus < MAX_PLUS && has ? ` → ×${armDmg(sel, plus + 1).toFixed(2)}` : ''}</small><small>${pr(sel, plus)}</small><small>${t('level')} ${sel.need}+</small></div></div>
      <div class="acts">${action}</div><p class="msg"></p><div class="armgrid">${grid}</div></div>`, (root) => wire(root, async (e) => {
      const tile = e.target.closest('[data-arm]'); if (tile) { S.armSel = tile.dataset.arm; sfx('click'); return SCREENS.arms(); }
      const op = e.target.closest('[data-op]')?.dataset.op; if (!op) return;
      try { await profile.arm(c.id, op, sel.id); sfx(op === 'up' ? 'level' : 'click'); SCREENS.arms(); } catch (er) { note(errText(er)); }
    }));
  },

  create() {
    S.args = [];
    const tiles = CLASSES.map((c) => `<button class="tile ${c.id === S.pick ? 'sel' : ''}" data-cls="${c.id}">${heroCv(c.id, 3)}<b>${esc(nm(c))}</b></button>`).join('');
    const cl = CLASS[S.pick];
    view(`<div class="screen create">${topbar('chars')}<h2>${t('newchar')}</h2><input id="cname" maxlength="16" placeholder="${t('name')}" value="${esc(S.cname || '')}">
      <p class="sub">${t('pick_class')}</p><div class="tiles">${tiles}</div><div class="card desc"><b>${esc(nm(cl))}</b><p>${esc(ds(cl))}</p></div>
      <p class="msg"></p><button class="btn big" data-act="make">${t('create')}</button></div>`, (root) => wire(root, async (e) => {
      S.cname = root.querySelector('#cname').value;
      const tile = e.target.closest('[data-cls]'); if (tile) { S.pick = tile.dataset.cls; sfx('click'); return SCREENS.create(); }
      if (e.target.closest('[data-act=make]')) {
        if (!validName(S.cname)) return note(t('err_name'));
        try { await profile.create(S.cname.trim(), S.pick); const ch = profile.p.chars[profile.p.chars.length - 1]; store.d.active = ch.id; store.save(); S.cname = ''; const h = location.hash.match(/^#\/room\/([A-Za-z0-9]+)/); if (h && !OFFLINE) joinRoom(h[1].toUpperCase()); else go('chars'); } catch (er) { note(errText(er)); }
      }
    }));
  },

  single() {
    S.args = []; const c = activeChar(), pw = power(c);
    const cards = DUNGEONS.single.map((d, i) => {
      const open = unlocked(profile.p, d);
      return `<button class="dun ${open ? '' : 'lock'}" data-d="${d.id}" ${open ? '' : 'disabled'}><b>${esc(nm(d))}</b><small>${open ? `${t('recommended')}: ${REC[d.id]}` : t('locked')}</small><span class="bg bg-${d.deco}"></span></button>`;
    }).join('');
    view(`<div class="screen single">${topbar('home')}<h2>${t('single')}: ${t('dungeons')}</h2>${charCard(c, true)}<div class="duns">${cards}</div><p class="msg">${esc(S.msg)}</p></div>`, (root) => wire(root, (e) => {
      const d = e.target.closest('[data-d]'); if (d) { S.msg = ''; startSingle(d.dataset.d); }
    }));
  },

  multi() {
    S.args = []; S.combo ||= []; const c = activeChar();
    view(`<div class="screen multi">${topbar('home')}<h2>${t('multi')}</h2>${charCard(c, true)}
      ${profile.room ? `<button class="btn big" data-act="mine">${t('myroom')}</button>` : `<p class="note">${t('guest_mp')}</p>`}
      <h3>${t('join')}</h3><p class="note">${t('faces_pick')}</p>
      <div class="slots">${[0, 1, 2].map((i) => `<button class="slot" data-slot="${i}">${S.combo[i] != null ? heroCv(CLASSES[S.combo[i]].id, 4) : '?'}</button>`).join('')}</div>
      <div class="picker">${CLASSES.map((c, i) => `<button class="face" data-face="${i}">${heroCv(c.id, 3)}</button>`).join('')}</div>
      <p class="msg">${esc(S.msg)}</p></div>`, (root) => wire(root, (e) => {
      S.msg = '';
      if (e.target.closest('[data-act=mine]')) { S.combo = []; joinRoom(''); return; }
      const f = e.target.closest('[data-face]'), sl = e.target.closest('[data-slot]');
      if (sl) { S.combo.splice(+sl.dataset.slot); sfx('click'); return SCREENS.multi(); }
      if (f && S.combo.length < 3) {
        S.combo.push(+f.dataset.face); sfx('click');
        if (S.combo.length === 3) { const code = S.combo.map((i) => String.fromCharCode(65 + i)).join(''); S.combo = []; return joinRoom(code); }
        SCREENS.multi();
      }
    }));
  },

  connecting() { view(`<div class="screen center"><p class="sub">${t('connecting')}</p><button class="btn ghost" data-act="cancel">${t('back')}</button></div>`, (r) => wire(r, (e) => {
    if (!e.target.closest('[data-act=cancel]')) return;   // the root keeps this handler once the run replaces the screen: ignore every other click
    const solo = S.solo, n = S.net; S.net = null; S.solo = false; n?.close(); go(solo ? 'single' : 'multi');
  })); },

  lobby() {
    S.args = []; const r = S.room, me = r.members.find((m) => m.id === r.you), host = r.hostId === r.you, c = activeChar();
    const members = r.members.map((m) => `<div class="mem">${heroCv(m.cls, 3)}<span><b>${esc(m.name)}</b>${m.id === r.hostId ? ` <small>${t('host')}</small>` : ''}<small>${t('level')} ${m.level} · ${t('power')} ${m.power}</small></span></div>`).join('');
    const duns = DUNGEONS.multi.map((d, i) => { const open = i < r.unlocked; return `<button class="dun mini ${r.dun === d.id ? 'sel' : ''} ${open ? '' : 'lock'}" data-d="${d.id}" ${host && open ? '' : 'disabled'}><b>${esc(nm(d))}</b><small>${open ? REC[d.id] : '×'}</small></button>`; }).join('');
    const chars = !profile.isGuest && profile.p.chars.length > 1 ? `<select id="chsel">${profile.p.chars.map((x) => `<option value="${x.id}" ${me && x.id === me.charId ? 'selected' : ''}>${esc(x.name)} · ${t('level')} ${x.level}</option>`).join('')}</select>` : '';
    const link = location.origin + location.pathname + '#/room/' + r.code;
    view(`<div class="screen lobby"><div class="top"><button class="icon-btn" data-act="leave">‹</button><span class="who">${t('room_of')} ${esc(r.hostName)}</span><span class="coins">${profile.p ? Math.floor(profile.p.coins) : 0} ◆</span><button class="icon-btn" data-act="snd">${isMuted() ? '×' : '♪'}</button></div>
      <div class="card"><p class="note">${t('invite')}</p><div class="faces">${faces(r.code, 5)}</div><button class="btn small" data-act="copy">${t('copy')}</button></div>
      <h3>${t('players')} ${r.members.length}/6</h3><div class="mems">${members}</div>${chars ? `<label class="lab">${t('mychar')}${chars}</label>` : ''}
      <h3>${t('pick_dun')}</h3><div class="duns row3">${duns}</div>
      ${host ? `<button class="btn big" data-act="go">${t('start')}</button>` : `<p class="note">${t('waiting')}</p>`}${profile.isGuest ? `<p class="note">${t('guest_mp')}</p>` : ''}</div>`, (root) => wire(root, (e) => {
      const d = e.target.closest('[data-d]'); if (d) { S.net.send({ t: 'dun', dun: d.dataset.d }); sfx('click'); }
      if (e.target.closest('[data-act=go]')) S.net.send({ t: 'start' });
      if (e.target.closest('[data-act=leave]')) leaveRoom();
      if (e.target.closest('[data-act=copy]')) { navigator.clipboard?.writeText(link).catch(() => {}); e.target.closest('button').textContent = t('copied'); }
    }));
    const sel = $app.querySelector('#chsel'); if (sel) sel.onchange = () => { store.d.active = +sel.value; store.save(); S.net.send({ t: 'char', id: +sel.value }); };
  },

  result(res) {
    S.args = [res];
    const rw = res.reward || {};
    view(`<div class="screen result"><h1 class="${res.cleared ? 'win' : 'lose'}">${res.cleared ? t('win') : t('lose')}</h1>
      <div class="card stats"><div><span>${t('time')}</span><b>${Math.floor(res.time / 60)}:${String(Math.floor(res.time % 60)).padStart(2, '0')}</b></div><div><span>${t('kills')}</span><b>${res.kills ?? 0}</b></div>
      <div><span>${t('coins')}</span><b>+${rw.coins ?? 0} ◆</b></div><div><span>${t('xp')}</span><b>+${rw.xp ?? 0}</b></div>
      ${res.carry > 1.05 ? `<div><span>${t('carry')}</span><b>×${res.carry.toFixed(1)}</b></div>` : ''}${res.levelUp > 0 ? `<div class="up"><span>${t('lvlup')}</span><b>${res.level}</b></div>` : ''}</div>
      <button class="btn big" data-act="back">${t('back')}</button></div>`, (root) => wire(root, (e) => {
      if (!e.target.closest('[data-act=back]')) return;
      if (res.multi && S.net?.open) { S.room ? go('lobby') : go('home'); } else go(res.multi ? 'multi' : 'home');
    }));
    music('menu'); sfx(res.cleared ? 'win' : 'lose');
  },
};

function charCard(c, compact) {
  const cl = CLASS[c.cls], st = charStats(c), pw = power(c);
  return `<div class="card char">${heroCv(c.cls, 4, armOf(c))}<div class="info"><b>${esc(c.name)}</b><small>${esc(nm(cl))} · ${t('level')} ${c.level}</small>${wbar(c.xp, xpNeed(c.level))}
    ${compact ? '' : `<small>${esc(ds(cl))}</small>`}<small>${t('power')} ${pw} · HP ${Math.round(100 * cl.hp * st.hp)} · ${t('weapon')} ${Math.round(cl.dmg * st.dmg * 100)} %</small></div></div>`;
}

// ---------- flows ----------
async function afterLogin() {
  const hash = location.hash.match(/^#\/room\/([A-Za-z0-9]+)/);
  if (!profile.p.chars.length) { go('create'); return; }
  if (!activeChar()) store.d.active = profile.p.chars[0].id;
  if (hash && !OFFLINE) return joinRoom(hash[1].toUpperCase());
  go('home');
}

async function startSingle(dunId) {
  const c = activeChar();
  if (!profile.isGuest && !OFFLINE) return startSolo(dunId);
  // guest / offline: the run is simulated here and the result stays in this browser
  S.run = new Run({ root: $app, mode: 'single', dun: dunId, players: [{ id: 1, name: c.name, cls: c.cls, arm: armOf(c)[0].id, plus: armOf(c)[1] }], meId: 1, char: { ...c }, onEnd: (over, st) => {
    S.run = null;
    const j = profile.runFinishLocal(c.id, { dungeonId: dunId, kills: st.kills, coinsPicked: st.coinsPicked, timeSec: st.timeSec, cleared: st.cleared });
    go('result', { cleared: st.cleared, time: st.timeSec, kills: st.kills, reward: j.reward, levelUp: j.levelUp, level: activeChar().level });
  } });
  S.run.start();
}

// signed-in single player: a private one-player room on the server, which runs the sim and pays out (nothing the client reports counts)
function startSolo(dunId) {
  const c = activeChar();
  leaveRoom(true); S.solo = true; go('connecting');
  S.net = new Net({
    msg: onNet,
    close: () => { if (S.run) { S.run.destroy(); S.run = null; } if (S.net) { S.net = null; S.solo = false; S.msg = t('lost'); go('single'); } },
  });
  S.net.connect({ solo: dunId, char: c.id, nick: c.name, cls: c.cls });
}

function joinRoom(code) {
  const c = activeChar();
  if (!c) return go('create');
  leaveRoom(true); S.solo = false;
  go('connecting');
  S.net = new Net({
    msg: onNet,
    close: () => { if (S.run) { S.run.destroy(); S.run = null; } if (S.net) { S.net = null; S.room = null; S.msg = t('lost'); go('multi'); } },
  });
  S.net.connect({ code, char: profile.isGuest ? 0 : c.id, nick: c.name, cls: c.cls });
}
function leaveRoom(quiet) {
  const n = S.net; S.net = null; S.room = null;
  if (S.run) { S.run.destroy(); S.run = null; }
  n?.close();
  if (!quiet) { location.hash = ''; go('multi'); }
}

function onNet(m) {
  switch (m.t) {
    case 'room': S.room = m; if (!S.run && S.screen !== 'result') go('lobby'); break;
    case 'err': { const k = { not_found: 'not_found', in_run: 'in_run', full: 'full_room', busy: 'busy', need_char: 'need_char', need_account: 'need_account', full_world: 'full_world' }[m.code]; S.msg = t(k || 'err_x'); const solo = S.solo; S.solo = false; leaveRoom(true); go(solo ? 'single' : 'multi'); break; }
    case 'start': {
      const c = activeChar();
      S.run = new Run({ root: $app, mode: 'multi', dun: m.dun, players: m.players, meId: m.you, net: S.net, onEnd: () => (S.solo ? S.net?.send({ t: 'leave' }) : leaveRoom()) });   // solo: the server answers a leave with the result
      S.run.start(); break;
    }
    case 's': S.run?.push(m.s, performance.now()); break;
    case 'end': {
      const run = S.run; S.run = null; run?.destroy();
      const solo = S.solo; if (solo) { const n = S.net; S.net = null; S.solo = false; n?.close(); }
      profile.load().catch(() => {}).finally(() => go('result', { multi: !solo, cleared: m.over.cleared, time: m.over.time, kills: m.kills, reward: m.reward, levelUp: m.levelUp || 0, level: m.level, carry: m.carry }));
      break;
    }
  }
}

// ---------- boot ----------
async function boot() {
  store.load(); setLang(store.d.lang || detectLang()); setMuted(!!store.d.muted);
  try { if (await profile.load()) { return afterLogin(); } } catch { /* server down: fall through to the title screen */ }
  go('title');
}
window.__horde = S;   // QA handle
boot();
