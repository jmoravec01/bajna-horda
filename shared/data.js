// Game data: classes, weapons, passives, enemies, dungeons. Pure data, shared by client and server.

export const DT = 1 / 20;            // simulation step (s)
export const MAX_CHARS = 8;          // characters per account
export const MAX_PLAYERS = 6;        // players per room
export const RUN_SECONDS = 480;      // nominal run length
export const BOSS_AT = 390;          // the boss shows up at 6:30
export const MAX_LEVEL = 100;
export const MAX_WEAPONS = 5, MAX_PASSIVES = 5, MAX_ITEM_LVL = 8;

// ---- classes (all from Slavic / Czech folklore) ----
// stats: hp / speed / dmg multipliers; trait fields are read by the sim
export const CLASSES = [
  { id: 'krakonos', cs: 'Krakonoš', en: 'Krakonoš', weapon: 'hul', hp: 1.35, spd: 0.9, dmg: 1, armor: 0.85, col: '#5b8c3a',
    cs_d: 'Pán hor. Tank: −15 % přijatého poškození.', en_d: 'Lord of the mountains. Tank: −15 % damage taken.' },
  { id: 'zbojnik', cs: 'Zbojník', en: 'Outlaw', weapon: 'valaska', hp: 0.85, spd: 1.2, dmg: 1, crit: 0.2, col: '#b5651d',
    cs_d: 'Rychlý a obratný. +20 % rychlost, vyšší šance na krit.', en_d: 'Fast and nimble. +20 % speed, higher crit chance.' },
  { id: 'perun', cs: 'Perun', en: 'Perun', weapon: 'blesk', hp: 1, spd: 1, dmg: 0.9, healAura: 1.5, magnet: 1.3, col: '#4a7fd4',
    cs_d: 'Hromovládce. Léčí spoluhráče v dosahu, větší dosah sběru.', en_d: 'Thunder god. Heals nearby allies, bigger pickup range.' },
  { id: 'cert', cs: 'Čert', en: 'Devil', weapon: 'peklo', hp: 0.75, spd: 1, dmg: 1.25, burn: 0.25, armor: 1.2, col: '#c0392b',
    cs_d: 'Skleněné dělo. +25 % poškození, všechny zásahy pálí, ale bere o 20 % víc.', en_d: 'Glass cannon. +25 % damage, hits burn, takes 20 % more.' },
  { id: 'bohatyr', cs: 'Bohatýr', en: 'Hero', weapon: 'kyj', hp: 1.1, spd: 1, dmg: 1, xp: 1.2, col: '#d4a017',
    cs_d: 'Univerzál. +20 % zkušeností z krystalů.', en_d: 'All-rounder. +20 % XP from gems.' },
  { id: 'vedma', cs: 'Vědma', en: 'Herbwitch', weapon: 'jed', hp: 1, spd: 1, dmg: 0.95, regen: 1, heartLuck: 2, col: '#7d3c98',
    cs_d: 'Léčitelka. Regenerace 1 HP/s, srdíčka padají častěji.', en_d: 'Healer. 1 HP/s regeneration, hearts drop more often.' },
  { id: 'hastrman', cs: 'Hastrman', en: 'Water Goblin', weapon: 'louze', hp: 1, spd: 1, dmg: 0.95, zoneSlow: 0.4, swim: 1.1, col: '#1f8a8a',
    cs_d: 'Vodník. Louže zpomalují o 40 %, ve vodě je rychlejší.', en_d: 'Master of puddles. Puddles slow by 40 %, faster while in water.' },
  { id: 'polednice', cs: 'Polednice', en: 'Noon Witch', weapon: 'poledne', hp: 0.95, spd: 1, dmg: 1, ramp: 1, col: '#e8d44d',
    cs_d: 'Časem sílí: poškození roste až o +60 %, první 2 minuty je slabší.', en_d: 'Grows stronger: damage up to +60 % over the run, weak for the first 2 minutes.' },
  { id: 'golem', cs: 'Golem', en: 'Golem', weapon: 'pest', hp: 1.7, spd: 0.75, dmg: 1, armor: 0.9, knock: 1.5, col: '#8d8d7a',
    cs_d: 'Pražský kolos. Hodně HP, −10 % poškození, pěst odhazuje víc.', en_d: 'Colossus of Prague. Huge HP, −10 % damage taken, stronger knockback.' },
  { id: 'rarasek', cs: 'Rarášek', en: 'Rarášek', weapon: 'cepice', hp: 0.9, spd: 1.05, dmg: 1, dodge: 0.15, coins: 1.3, blink: 1, col: '#e67e22',
    cs_d: 'Šejdíř. 15 % úhyb, +30 % mincí, při zásahu cvakne pryč.', en_d: 'Trickster. 15 % dodge, +30 % coins, blinks away when hit.' },
  { id: 'morana', cs: 'Morana', en: 'Morana', weapon: 'led', hp: 0.95, spd: 1, dmg: 0.85, freeze: 1, col: '#aee1f5',
    cs_d: 'Zima. Každých 10 s zmrazí okolní nepřátele na 2 s.', en_d: 'Winter. Every 10 s freezes nearby enemies for 2 s.' },
  { id: 'baba', cs: 'Bába Jaga', en: 'Baba Yaga', weapon: 'chaloupka', hp: 1, spd: 0.95, dmg: 0.75, extra: 1, col: '#6b4f2a',
    cs_d: 'Přivolává pomocníky. +1 chaloupka, vlastní zbraně slabší.', en_d: 'Summoner. +1 hut, weaker own weapons.' },
];
export const CLASS = Object.fromEntries(CLASSES.map((c) => [c.id, c]));

// ---- weapons ----
// kind: proj | orbit | pulse | chain | boomerang | bomb | zone | turret
// dmg/cd/count/area/speed/dur are level-1 values; see weaponStats() for the per-level scaling
export const WEAPONS = [
  { id: 'hul', kind: 'orbit', cs: 'Hůl', en: 'Staff', dmg: 7, cd: 0, count: 2, area: 24, speed: 2.6, grow: ['count'], d_cs: 'Rotující hůl kolem tebe.', d_en: 'A staff spinning around you.' },
  { id: 'valaska', kind: 'proj', cs: 'Valaška', en: 'Hatchet', dmg: 9, cd: 0.9, count: 1, speed: 120, dur: 1.4, pierce: 1, area: 4, grow: ['count', 'pierce'], d_cs: 'Hází valašky na nejbližší nepřátele.', d_en: 'Throws hatchets at the nearest enemies.' },
  { id: 'blesk', kind: 'chain', cs: 'Blesk', en: 'Lightning', dmg: 11, cd: 1.5, count: 3, area: 70, grow: ['count'], d_cs: 'Řetězový blesk skáče mezi nepřáteli.', d_en: 'Chain lightning jumps between enemies.' },
  { id: 'peklo', kind: 'bomb', cs: 'Pekelná bomba', en: 'Hell bomb', dmg: 20, cd: 2.2, count: 1, area: 24, dur: 0.7, burn: 0.3, grow: ['count', 'area'], d_cs: 'Bomba exploduje a podpálí.', d_en: 'A bomb that explodes and ignites.' },
  { id: 'kyj', kind: 'pulse', cs: 'Kyj', en: 'Club', dmg: 14, cd: 1.8, area: 34, knock: 14, grow: ['area'], d_cs: 'Ráz do okolí odhodí nepřátele.', d_en: 'A shockwave that knocks enemies back.' },
  { id: 'jed', kind: 'zone', cs: 'Jedový oblak', en: 'Poison cloud', dmg: 4, cd: 3.5, count: 1, area: 22, dur: 4, tick: 0.5, grow: ['count', 'area'], d_cs: 'Oblak jedu zůstává na zemi.', d_en: 'A cloud of poison lingers on the ground.' },
  { id: 'louze', kind: 'zone', cs: 'Vodní louže', en: 'Puddle', dmg: 2, cd: 4, count: 1, area: 26, dur: 5, tick: 0.5, slow: 0.25, grow: ['count', 'area'], d_cs: 'Louže zpomaluje nepřátele.', d_en: 'A puddle that slows enemies.' },
  { id: 'poledne', kind: 'pulse', cs: 'Polední kruh', en: 'Noon ring', dmg: 8, cd: 1.1, area: 40, knock: 0, grow: ['area'], d_cs: 'Pálivý kruh kolem tebe.', d_en: 'A scorching ring around you.' },
  { id: 'pest', kind: 'pulse', cs: 'Kamenná pěst', en: 'Stone fist', dmg: 22, cd: 2.4, area: 26, knock: 26, grow: ['area'], d_cs: 'Těžký úder, který odhazuje.', d_en: 'A heavy hit that knocks enemies away.' },
  { id: 'cepice', kind: 'boomerang', cs: 'Kouzelná čepice', en: 'Magic cap', dmg: 8, cd: 1.6, count: 1, speed: 95, dur: 1.6, area: 6, grow: ['count'], d_cs: 'Čepice letí a vrací se.', d_en: 'A cap that flies out and comes back.' },
  { id: 'led', kind: 'proj', cs: 'Ledová tříšť', en: 'Ice shards', dmg: 6, cd: 1.0, count: 2, speed: 110, dur: 1.2, pierce: 0, area: 4, slow: 0.5, grow: ['count'], d_cs: 'Střepy ledu zpomalují.', d_en: 'Ice shards that slow enemies.' },
  { id: 'chaloupka', kind: 'turret', cs: 'Chaloupka', en: 'Hut', dmg: 8, cd: 6, count: 1, speed: 100, dur: 10, rate: 1.3, area: 8, grow: ['count', 'dur'], d_cs: 'Chaloupka na kuřích nožkách střílí na nepřátele.', d_en: 'A hut on chicken legs shooting enemies.' },
];
export const WEAPON = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export const WEAPON_IDX = Object.fromEntries(WEAPONS.map((w, i) => [w.id, i]));

export const PASSIVES = [
  { id: 'srdce', cs: 'Srdce', en: 'Heart', d_cs: '+12 % max HP', d_en: '+12 % max HP' },
  { id: 'boty', cs: 'Boty', en: 'Boots', d_cs: '+6 % rychlost', d_en: '+6 % speed' },
  { id: 'sila', cs: 'Síla', en: 'Might', d_cs: '+10 % poškození', d_en: '+10 % damage' },
  { id: 'spech', cs: 'Spěch', en: 'Haste', d_cs: '−6 % čekání zbraní', d_en: '−6 % weapon cooldown' },
  { id: 'magnet', cs: 'Magnet', en: 'Magnet', d_cs: '+25 % dosah sběru', d_en: '+25 % pickup range' },
  { id: 'moudrost', cs: 'Moudrost', en: 'Wisdom', d_cs: '+10 % zkušeností', d_en: '+10 % XP' },
];
export const PASSIVE = Object.fromEntries(PASSIVES.map((p) => [p.id, p]));

// ---- enemies ----
// archetypes: base stats + behaviour. beh: chase | zig | shoot | dash | ghost
export const ARCH = {
  slime:  { hp: 8,  dmg: 6,  spd: 22, r: 5, xp: 1, beh: 'chase' },
  bat:    { hp: 5,  dmg: 5,  spd: 40, r: 4, xp: 1, beh: 'zig' },
  skel:   { hp: 14, dmg: 8,  spd: 26, r: 5, xp: 2, beh: 'chase' },
  wolf:   { hp: 12, dmg: 9,  spd: 42, r: 5, xp: 2, beh: 'chase' },
  spider: { hp: 10, dmg: 7,  spd: 28, r: 5, xp: 2, beh: 'shoot' },
  ghost:  { hp: 16, dmg: 10, spd: 24, r: 5, xp: 3, beh: 'ghost' },
  ogre:   { hp: 60, dmg: 16, spd: 17, r: 9, xp: 8, beh: 'chase' },
  boar:   { hp: 26, dmg: 14, spd: 24, r: 7, xp: 5, beh: 'dash' },
  imp:    { hp: 9,  dmg: 8,  spd: 33, r: 5, xp: 2, beh: 'shoot' },
};

// ---- dungeons ----
// roster: [arch, palette[main, dark, accent], appears-at-seconds, weight]; the last two entries are the elite and the boss
const dun = (o) => o;
export const DUNGEONS = {
  single: [
    dun({ id: 's1', mode: 'single', cs: 'Louka', en: 'Meadow', diff: 1.0, xp: 1, bg: ['#3d7a3a', '#356d33', '#4f8f45', '#2d5e2b'], deco: 'grass',
      roster: [['slime', ['#6fd45a', '#2c7a22', '#fff'], 0, 6], ['bat', ['#8b5a3c', '#4a2c18', '#e33'], 40, 3], ['wolf', ['#8a8f99', '#4a4f59', '#ee5'], 100, 3], ['boar', ['#7a4a2a', '#3a2010', '#fff'], 190, 2], ['ogre', ['#6a9a5a', '#2d4a24', '#ee5'], 280, 1]],
      elite: ['ogre', ['#c05a3a', '#5a2a1a', '#ff0']], boss: { arch: 'ogre', pal: ['#d4a017', '#6b4a05', '#f33'], name_cs: 'Lesní obr', name_en: 'Forest Giant', hp: 1800 } }),
    dun({ id: 's2', mode: 'single', cs: 'Krypta', en: 'Crypt', diff: 1.6, xp: 1.3, bg: ['#3a3548', '#322d40', '#46405a', '#2a2636'], deco: 'bones',
      roster: [['skel', ['#e8e4d0', '#8a8670', '#e33'], 0, 6], ['bat', ['#5a4a7a', '#2a2040', '#8ef'], 30, 3], ['ghost', ['#b8d8f0', '#5a7a9a', '#fff'], 90, 3], ['spider', ['#4a3a4a', '#1a101a', '#e3e'], 170, 2], ['ogre', ['#8a7a9a', '#3a2a4a', '#8ef'], 270, 1]],
      elite: ['ogre', ['#6a6a8a', '#2a2a4a', '#ff0']], boss: { arch: 'skel', pal: ['#c8b8f0', '#4a3a7a', '#f3f'], name_cs: 'Kostěný kníže', name_en: 'Bone Prince', hp: 2600, scale: 3 } }),
    dun({ id: 's3', mode: 'single', cs: 'Sopka', en: 'Volcano', diff: 2.4, xp: 1.7, bg: ['#4a2a22', '#3e2019', '#5c3328', '#2e1812'], deco: 'lava',
      roster: [['imp', ['#e8502a', '#7a1a0a', '#ff0'], 0, 6], ['bat', ['#8a2a1a', '#3a0a05', '#fa0'], 30, 3], ['wolf', ['#3a2a2a', '#150a0a', '#f80'], 90, 3], ['boar', ['#b03a1a', '#4a1008', '#fd0'], 170, 2], ['ogre', ['#5a3a3a', '#1a0f0f', '#f60'], 260, 1]],
      elite: ['ogre', ['#e8502a', '#5a1005', '#ff0']], boss: { arch: 'ogre', pal: ['#f0a020', '#7a2005', '#fff'], name_cs: 'Ohnivý Golem', name_en: 'Fire Golem', hp: 3600, scale: 2.6 } }),
  ],
  multi: [
    dun({ id: 'm1', mode: 'multi', cs: 'Jeskyně', en: 'Cave', diff: 1.3, xp: 1.2, bg: ['#4a4038', '#3e362f', '#574c42', '#2f2a25'], deco: 'rocks',
      roster: [['slime', ['#c8a050', '#6a4a1a', '#fff'], 0, 6], ['bat', ['#6a5a7a', '#2a2038', '#f66'], 20, 4], ['spider', ['#3a3a3a', '#111', '#f33'], 70, 3], ['wolf', ['#7a6a5a', '#3a2f26', '#ee5'], 140, 3], ['ogre', ['#8a7a6a', '#3a2a1a', '#ee5'], 240, 1.5]],
      elite: ['ogre', ['#7a5a3a', '#2a1a0a', '#ff0']], boss: { arch: 'spider', pal: ['#2a2a2a', '#000', '#f33'], name_cs: 'Jeskynní matka', name_en: 'Cave Mother', hp: 3200, scale: 3.4 } }),
    dun({ id: 'm2', mode: 'multi', cs: 'Bažina', en: 'Swamp', diff: 1.9, xp: 1.5, bg: ['#3a4a2e', '#324027', '#465a37', '#2a3820'], deco: 'reeds',
      roster: [['slime', ['#7a9a3a', '#2a4a10', '#ff0'], 0, 6], ['ghost', ['#a0e0a0', '#4a8a5a', '#fff'], 30, 3], ['spider', ['#4a6a3a', '#1a2a10', '#ee3'], 80, 3], ['boar', ['#5a6a3a', '#2a3a1a', '#fff'], 150, 2.5], ['ogre', ['#4a6a4a', '#1a2a1a', '#ee5'], 250, 1.5]],
      elite: ['ogre', ['#3a8a6a', '#0a3a2a', '#ff0']], boss: { arch: 'slime', pal: ['#5ad07a', '#106a2a', '#f33'], name_cs: 'Bahenní král', name_en: 'Bog King', hp: 4200, scale: 3.6 } }),
    dun({ id: 'm3', mode: 'multi', cs: 'Ledovec', en: 'Glacier', diff: 2.7, xp: 2, bg: ['#a8c8d8', '#9abccc', '#b8d6e4', '#88aabb'], deco: 'ice',
      roster: [['imp', ['#6ac8f0', '#1a5a8a', '#fff'], 0, 6], ['wolf', ['#e8f0f8', '#8aa0b0', '#38f'], 25, 4], ['ghost', ['#d0e8ff', '#7a9ac0', '#fff'], 80, 3], ['boar', ['#b8d0e0', '#5a7a90', '#fff'], 150, 2.5], ['ogre', ['#9ac0d8', '#3a5a78', '#fff'], 240, 1.5]],
      elite: ['ogre', ['#6aa0d8', '#1a3a6a', '#ff0']], boss: { arch: 'ogre', pal: ['#ffffff', '#5a8ab0', '#38f'], name_cs: 'Zimní královna', name_en: 'Winter Queen', hp: 5200, scale: 2.8 } }),
  ],
};
export const DUNGEON = Object.fromEntries([...DUNGEONS.single, ...DUNGEONS.multi].map((d) => [d.id, d]));

// ---- equipment ----
export const SLOTS = ['weapon', 'armor', 'ring', 'boots'];
export const MAX_EQUIP = 20;
