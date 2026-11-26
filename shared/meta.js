// Meta progression: character stats, levels, equipment, run rewards. Pure functions shared by the server and the offline (guest) store.
import { CLASS, DUNGEON, DUNGEONS, MAX_CHARS, MAX_LEVEL, MAX_EQUIP, SLOTS } from './data.js';

export const newChar = (id, name, cls) => ({ id, name, cls, level: 1, xp: 0, equip: { weapon: 1, armor: 1, ring: 1, boots: 1 } });
export const newProfile = () => ({ coins: 0, chars: [], progress: { single: 1, multi: 1 } });

export const validName = (s) => typeof s === 'string' && /^[\p{L}\p{N} _.-]{2,16}$/u.test(s.trim());
export const xpNeed = (level) => Math.round(60 + 30 * Math.pow(level - 1, 1.25));
export const upgradeCost = (lvl) => Math.round(25 * Math.pow(lvl, 1.4));

export function power(c) {
  const e = c.equip;
  return 100 + 10 * (c.level - 1) + 5 * (e.weapon + e.armor + e.ring + e.boots - 4);
}

// multipliers from character level + equipment (the class traits are applied in the sim)
export function charStats(c) {
  const e = c.equip, L = c.level - 1;
  return {
    hp: (1 + 0.03 * L) * (1 + 0.05 * (e.armor - 1)),
    dmg: (1 + 0.04 * L) * (1 + 0.04 * (e.weapon - 1)) * (1 + 0.02 * (e.ring - 1)),
    spd: 1 + 0.015 * (e.boots - 1),
    cd: 1 - 0.01 * (e.boots - 1),
    magnet: 1 + 0.03 * (e.ring - 1),
  };
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
