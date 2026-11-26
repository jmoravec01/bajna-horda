// Server API + WebSocket client + local (guest) profile. Everything the UI needs to talk to a profile lives here.
import { newProfile, createChar, upgradeEquip, applyRun, armError, fixArms } from '../shared/meta.js';

const META = document.querySelector('meta[name="horde-api"]')?.content || '';
export const OFFLINE = META === 'none';
const BASE = OFFLINE ? '' : (META || location.origin + location.pathname.replace(/[^/]*$/, ''));   // always ends with "/"
const KEY = 'bajnahorda.v1';

export const store = {
  d: { lang: null, muted: false, token: null, user: null, guest: null, active: null },
  load() { try { Object.assign(this.d, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* private mode */ } return this; },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch { /* ignore */ } },
};

async function call(method, path, body) {
  const h = { 'Content-Type': 'application/json' };
  if (store.d.token) h.Authorization = 'Bearer ' + store.d.token;
  let r;
  try { r = await fetch(BASE + 'api/' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('offline'); }
  let j = {}; try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new Error(j.error || 'http' + r.status);
  return j;
}

// ---- profile service: one interface for an account (server) and a guest (this browser) ----
export const profile = {
  p: null, room: null, user: null,
  get isGuest() { return !store.d.token; },
  async load() {
    if (store.d.token) {
      try { const j = await call('GET', 'me'); this.p = j.profile; this.room = j.room; this.user = j.user; return true; }
      catch (e) { if (e.message === 'unauthorized') { store.d.token = null; store.d.user = null; store.save(); } else throw e; }
    }
    if (store.d.guest) { store.d.guest.chars.forEach(fixArms); this.p = store.d.guest; this.user = null; this.room = null; return true; }
    return false;
  },
  startGuest() { store.d.guest = store.d.guest || newProfile(); store.save(); this.p = store.d.guest; this.user = null; },
  async auth(kind, name, pass) {
    const j = await call('POST', kind, { name, pass });
    store.d.token = j.token; store.d.user = j.user; store.save();
    this.p = j.profile; this.room = j.room; this.user = j.user;
  },
  async logout() { try { if (store.d.token) await call('POST', 'logout'); } catch { /* ignore */ } store.d.token = null; store.d.user = null; store.d.active = null; store.save(); this.p = null; this.room = null; this.user = null; },
  async create(name, cls) {
    if (this.isGuest) { const err = createChar(this.p, name, cls, Date.now() % 1e9); if (err) throw new Error(err); store.save(); return; }
    const j = await call('POST', 'chars', { name, cls }); this.p = j.profile;
  },
  async remove(id) {
    if (this.isGuest) { this.p.chars = this.p.chars.filter((c) => c.id !== id); store.save(); return; }
    this.p = (await call('POST', 'chars/delete', { id })).profile;
  },
  async upgrade(charId, slot) {
    if (this.isGuest) { const err = upgradeEquip(this.p, charId, slot); if (err) throw new Error(err); store.save(); return; }
    this.p = (await call('POST', 'upgrade', { charId, slot })).profile;
  },
  async arm(charId, op, id) {                    // buy | up | equip a held weapon
    if (this.isGuest) { const err = armError(this.p, charId, op, id); if (err) throw new Error(err); store.save(); return; }
    this.p = (await call('POST', 'arm', { charId, op, id })).profile;
  },
  async bag(charId, op, i) {                    // take | sell | sellall on the bag of spare weapons (accounts only)
    this.p = (await call('POST', 'bag', { charId, op, i })).profile;
  },
  // guests only: their progress lives in this browser. Signed-in runs are simulated and paid out by the server.
  runFinishLocal(charId, r) {
    const before = this.p.chars.find((c) => c.id === charId)?.level || 1;
    const rew = applyRun(this.p, charId, r); store.save();
    return { reward: rew, levelUp: this.p.chars.find((c) => c.id === charId).level - before };
  },
};

// ---- co-op connection ----
export class Net {
  constructor(handlers) { this.h = handlers; this.ws = null; this.rtt = 80; this.open = false; }
  connect(opts) {
    const url = new URL(BASE + 'ws', location.href); url.protocol = url.protocol.replace('http', 'ws');
    if (store.d.token) url.searchParams.set('token', store.d.token);
    else { url.searchParams.set('nick', opts.nick); url.searchParams.set('cls', opts.cls); }
    if (opts.char) url.searchParams.set('char', opts.char);
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { this.open = true; this.send(opts.solo ? { t: 'solo', dun: opts.solo } : opts.code ? { t: 'join', code: opts.code } : { t: 'open' }); this.ping(); };
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'pong') { this.rtt = this.rtt * 0.7 + (performance.now() - m.n) * 0.3; return; }
      this.h.msg?.(m);
    };
    this.ws.onclose = () => { this.open = false; clearInterval(this.pt); this.h.close?.(); };
    this.ws.onerror = () => {};
  }
  ping() { clearInterval(this.pt); this.pt = setInterval(() => this.send({ t: 'ping', n: performance.now() }), 2000); }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { clearInterval(this.pt); try { this.ws?.close(); } catch { /* ignore */ } this.ws = null; this.open = false; }
}
