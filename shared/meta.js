// Meta progression: character stats, levels, equipment, run rewards. Pure functions shared by the server and the offline (guest) store.
import { CLASS, DUNGEON, DUNGEONS, MAX_CHARS, MAX_LEVEL, MAX_EQUIP, SLOTS, ARM, STARTER, MAX_PLUS } from './data.js';

export const newChar = (id, name, cls) => ({ id, name, cls, level: 1, xp: 0, equip: { armor: 1, ring: 1, boots: 1 }, arms: { [STARTER]: 0 }, held: STARTER });
export const newProfile = () => ({ coins: 0, chars: [], progress: { single: 1, multi: 1 } });

export const validName = (s) => typeof s === 'string' && /^[\p{L}\p{N} _.-]{2,16}$/u.test(s.trim());
export const xpNeed = (level) => Math.round(60 + 30 * Math.pow(level - 1, 1.25));
export const upgradeCost = (lvl) => Math.round(25 * Math.pow(lvl, 1.4));

// ---- armory: the held weapon and its +0..+9 upgrade ----
const armById = (id) => (typeof id === 'string' && Object.hasOwn(ARM, id) ? ARM[id] : null);   // own keys only: no '__proto__' lookups
// legacy characters (a numeric equip.weapon level, no arms yet) get the starter weapon at +(level-1)
export function fixArms(c) {
  if (!c.arms || typeof c.arms !== 'object') c.arms = { [STARTER]: Math.min(MAX_PLUS, Math.max(0, (c.equip?.weapon || 1) - 1)) };
  if (c.equip && 'weapon' in c.equip) delete c.equip.weapon;
  if (!armById(c.held) || !Object.hasOwn(c.arms, c.held)) c.held = Object.hasOwn(c.arms, STARTER) ? STARTER : Object.keys(c.arms).find((k) => armById(k)) || STARTER;
  return c;
}
export const armOf = (c) => { const w = armById(c.held) && Object.hasOwn(c.arms || {}, c.held) ? ARM[c.held] : ARM[STARTER]; return [w, Object.hasOwn(c.arms || {}, w.id) ? c.arms[w.id] : 0]; };
export const armDmg = (w, plus) => w.dmg * (1 + 0.05 * plus);
export const armUpCost = (w, plus) => Math.round(18 * w.tier * Math.pow(plus + 1, 1.5));
// a sale pays a quarter of the shop price plus 30 % of what was spent on upgrades: a bad rate on purpose
export const armSell = (w, plus) => Math.round(0.25 * w.price + 0.3 * Array.from({ length: plus }, (_, k) => armUpCost(w, k)).reduce((a, b) => a + b, 0));
export function armError(profile, charId, op, id) {      // buy | up | equip | sell; returns an error string or null and applies the change
  const c = profile.chars.find((x) => x.id === charId), w = armById(id);
  if (!c || !w) return 'bad';
  fixArms(c);
  const has = Object.hasOwn(c.arms, id);
  if (op === 'buy') {
    if (has) return 'owned';
    if (w.legend) return 'bad';                // a legendary weapon only drops from a chest
    if (c.level < w.need) return 'level';
    if (profile.coins < w.price) return 'poor';
    profile.coins -= w.price; c.arms[id] = 0; return null;
  }
  if (!has) return 'bad';
  if (op === 'equip') { c.held = id; return null; }
  if (op === 'sell') {                           // not the one in the hand, not the free starter
    if (c.held === id || id === STARTER) return 'held';
    profile.coins += armSell(w, c.arms[id]); delete c.arms[id]; return null;
  }
  if (op === 'up') {
    const plus = c.arms[id];
    if (plus >= MAX_PLUS) return 'max';
    const cost = armUpCost(w, plus);
    if (profile.coins < cost) return 'poor';
    profile.coins -= cost; c.arms[id] = plus + 1; return null;
  }
  return 'bad';
}

export function power(c) {
  const e = c.equip, [w, plus] = armOf(c);
  return 100 + 10 * (c.level - 1) + 5 * (e.armor + e.ring + e.boots - 3) + Math.round(5 * (armDmg(w, plus) - 1) / 0.04);
}

// multipliers from character level + equipment (the class traits are applied in the sim)
export function charStats(c) {
  const e = c.equip, L = c.level - 1, [w, plus] = armOf(c);
  const st = {
    hp: (1 + 0.03 * L) * (1 + 0.05 * (e.armor - 1)),
    dmg: (1 + 0.04 * L) * armDmg(w, plus) * (1 + 0.02 * (e.ring - 1)),
    spd: 1 + 0.015 * (e.boots - 1),
    cd: 1 - 0.01 * (e.boots - 1),
    magnet: 1 + 0.03 * (e.ring - 1),
  };
  const v = w.perkVal * (1 + plus / MAX_PLUS);          // the weapon's perk grows with the upgrade
  if (w.perk === 'hp') st.hp *= 1 + v; else if (w.perk === 'spd') st.spd *= 1 + v / 2; else if (w.perk === 'cd') st.cd *= 1 - v; else if (w.perk === 'magnet') st.magnet *= 1 + 3 * v;
  return st;
}

// what a finished run pays (rewardMul > 1 for players carried by stronger friends)
export function runReward({ timeSec, kills, coinsPicked, cleared, dungeonId, rewardMul = 1 }) {
  const d = DUNGEON[dungeonId], half = cleared ? 1 : 0.5;
  const xp = Math.floor((timeSec * 0.4 + kills * 0.6 + (cleared ? 250 : 0)) * d.xp * rewardMul * half);
  const coins = Math.floor((coinsPicked + kills * 0.1 + (cleared ? 60 : 0)) * d.xp * rewardMul * half);
  return { xp, coins };
}

export function addXp(c, xp) {
  c.xp += xp;
  while (c.level < MAX_LEVEL && c.xp >= xpNeed(c.level)) { c.xp -= xpNeed(c.level); c.level++; }
  if (c.level >= MAX_LEVEL) c.xp = 0;
}

export const unlocked = (profile, d) => d.mode === 'single' || d.mode === 'multi' ? DUNGEONS[d.mode].indexOf(d) < profile.progress[d.mode] : false;

// applies a finished run to the profile; returns the reward
export function applyRun(profile, charId, r) {
  const c = profile.chars.find((x) => x.id === charId);
  if (!c) return null;
  const d = DUNGEON[r.dungeonId], rew = runReward(r);
  addXp(c, rew.xp);
  profile.coins += rew.coins;
  if (r.cleared) {
    const i = DUNGEONS[d.mode].indexOf(d);
    if (i + 1 >= profile.progress[d.mode] && i + 1 < DUNGEONS[d.mode].length) profile.progress[d.mode] = i + 2;
  }
  return rew;
}

export function upgradeEquip(profile, charId, slot) {
  const c = profile.chars.find((x) => x.id === charId);
  if (!c || !SLOTS.includes(slot)) return 'bad';
  const lvl = c.equip[slot];
  if (lvl >= MAX_EQUIP) return 'max';
  const cost = upgradeCost(lvl);
  if (profile.coins < cost) return 'poor';
  profile.coins -= cost; c.equip[slot] = lvl + 1;
  return null;
}

export function createChar(profile, name, cls, id) {
  if (!validName(name)) return 'name';
  if (typeof cls !== 'string' || !Object.hasOwn(CLASS, cls)) return 'class';
  if (profile.chars.length >= MAX_CHARS) return 'full';
  profile.chars.push(newChar(id, name.trim(), cls));
  return null;
}
