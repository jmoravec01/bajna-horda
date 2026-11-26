// Game data: classes, weapons, passives, enemies, dungeons. Pure data, shared by client and server.

export const DT = 1 / 20;            // simulation step (s)
export const MAX_CHARS = 8;          // characters per account
export const MAX_PLAYERS = 6;        // players per room
export const RUN_SECONDS = 300;      // a run is 5 minutes
export const PACE = 1.1;             // the difficulty curves were tuned for 8 minutes: the difficulty clock runs a little faster than the wall clock (bot runs: 1.6 was far too hard)
// three bosses, each harder than the last; killing the last one clears the dungeon. hp/dmg multiply the dungeon boss, size scales its sprite
export const BOSS_STAGES = [
  { at: 60,  hp: 0.05, dmg: 0.5,  size: 0.6, ring: 6,  minions: 2, every: 12 },
  { at: 180, hp: 0.25, dmg: 0.7,  size: 0.8, ring: 9,  minions: 4, every: 10 },
  { at: 300, hp: 0.7,  dmg: 1,    size: 1,   ring: 14, minions: 6, every: 8 },
];
// every boss has its own Czech first name, from old ones (Bořivoj) to new ones (Jakub), in the order a player meets them
// team runs (multiplayer and the raid) last 10 minutes: bosses at 2:00, 5:30 and 9:00, and each one is shielded until enough shrines are held
export const TEAM_SECONDS = 600;
export const TEAM_STAGES = [
  { at: 120, hp: 0.10, dmg: 0.5, size: 0.6, ring: 8,  minions: 3, every: 12 },
  { at: 330, hp: 0.40, dmg: 0.7, size: 0.8, ring: 11, minions: 5, every: 10 },
  { at: 540, hp: 1.00, dmg: 1,   size: 1,   ring: 16, minions: 8, every: 8 },
];
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
// team dungeons (mode 'multi') get 10-minute runs, shrines to hold and a pace of their own; single ones keep the 5-minute defaults
const dun = (o) => (o.mode === 'multi' ? { secs: TEAM_SECONDS, stages: TEAM_STAGES, shrines: 3, pace: 0.9, spawn: 1.2, ...o } : { secs: RUN_SECONDS, stages: BOSS_STAGES, shrines: 0, pace: PACE, spawn: 1, ...o });
export const DUNGEONS = {
  single: [
    dun({ id: 's1', mode: 'single', cs: 'Louka', en: 'Meadow', diff: 1.0, xp: 1, bg: ['#3d7a3a', '#356d33', '#4f8f45', '#2d5e2b'], deco: 'grass',
      roster: [['slime', ['#6fd45a', '#2c7a22', '#fff'], 0, 6], ['bat', ['#8b5a3c', '#4a2c18', '#e33'], 40, 3], ['wolf', ['#8a8f99', '#4a4f59', '#ee5'], 100, 3], ['boar', ['#7a4a2a', '#3a2010', '#fff'], 190, 2], ['ogre', ['#6a9a5a', '#2d4a24', '#ee5'], 280, 1]],
      elite: ['ogre', ['#c05a3a', '#5a2a1a', '#ff0']], boss: { arch: 'ogre', pal: ['#d4a017', '#6b4a05', '#f33'], names: ['Bořivoj', 'Spytihněv', 'Vratislav'], hp: 1800 } }),
    dun({ id: 's2', mode: 'single', cs: 'Krypta', en: 'Crypt', diff: 1.35, xp: 1.3, bg: ['#3a3548', '#322d40', '#46405a', '#2a2636'], deco: 'bones',
      roster: [['skel', ['#e8e4d0', '#8a8670', '#e33'], 0, 6], ['bat', ['#5a4a7a', '#2a2040', '#8ef'], 30, 3], ['ghost', ['#b8d8f0', '#5a7a9a', '#fff'], 90, 3], ['spider', ['#4a3a4a', '#1a101a', '#e3e'], 170, 2], ['ogre', ['#8a7a9a', '#3a2a4a', '#8ef'], 270, 1]],
      elite: ['ogre', ['#6a6a8a', '#2a2a4a', '#ff0']], boss: { arch: 'skel', pal: ['#c8b8f0', '#4a3a7a', '#f3f'], names: ['Soběslav', 'Ctibor', 'Vladislav'], hp: 2600, scale: 3 } }),
    dun({ id: 's3', mode: 'single', cs: 'Sopka', en: 'Volcano', diff: 1.8, xp: 1.7, bg: ['#4a2a22', '#3e2019', '#5c3328', '#2e1812'], deco: 'lava',
      roster: [['imp', ['#e8502a', '#7a1a0a', '#ff0'], 0, 6], ['bat', ['#8a2a1a', '#3a0a05', '#fa0'], 30, 3], ['wolf', ['#3a2a2a', '#150a0a', '#f80'], 90, 3], ['boar', ['#b03a1a', '#4a1008', '#fd0'], 170, 2], ['ogre', ['#5a3a3a', '#1a0f0f', '#f60'], 260, 1]],
      elite: ['ogre', ['#e8502a', '#5a1005', '#ff0']], boss: { arch: 'ogre', pal: ['#f0a020', '#7a2005', '#fff'], names: ['Bohuslav', 'Václav', 'Jindřich'], hp: 3600, scale: 2.6 } }),
  ],
  multi: [
    dun({ id: 'm1', mode: 'multi', cs: 'Jeskyně', en: 'Cave', diff: 1.2, xp: 1.2, bg: ['#4a4038', '#3e362f', '#574c42', '#2f2a25'], deco: 'rocks',
      roster: [['slime', ['#c8a050', '#6a4a1a', '#fff'], 0, 6], ['bat', ['#6a5a7a', '#2a2038', '#f66'], 20, 4], ['spider', ['#3a3a3a', '#111', '#f33'], 70, 3], ['wolf', ['#7a6a5a', '#3a2f26', '#ee5'], 140, 3], ['ogre', ['#8a7a6a', '#3a2a1a', '#ee5'], 240, 1.5]],
      elite: ['ogre', ['#7a5a3a', '#2a1a0a', '#ff0']], boss: { arch: 'spider', pal: ['#7a6a8a', '#2a1a3a', '#f33'], names: ['Vojtěch', 'Jaroslav', 'Josef'], hp: 3200, scale: 3.4 } }),
    dun({ id: 'm2', mode: 'multi', cs: 'Bažina', en: 'Swamp', diff: 1.5, xp: 1.5, bg: ['#3a4a2e', '#324027', '#465a37', '#2a3820'], deco: 'reeds',
      roster: [['slime', ['#7a9a3a', '#2a4a10', '#ff0'], 0, 6], ['ghost', ['#a0e0a0', '#4a8a5a', '#fff'], 30, 3], ['spider', ['#4a6a3a', '#1a2a10', '#ee3'], 80, 3], ['boar', ['#5a6a3a', '#2a3a1a', '#fff'], 150, 2.5], ['ogre', ['#4a6a4a', '#1a2a1a', '#ee5'], 250, 1.5]],
      elite: ['ogre', ['#3a8a6a', '#0a3a2a', '#ff0']], boss: { arch: 'slime', pal: ['#5ad07a', '#106a2a', '#f33'], names: ['František', 'Antonín', 'Karel'], hp: 4200, scale: 3.6 } }),
    dun({ id: 'm3', mode: 'multi', cs: 'Ledovec', en: 'Glacier', diff: 1.9, xp: 2, bg: ['#a8c8d8', '#9abccc', '#b8d6e4', '#88aabb'], deco: 'ice',
      roster: [['imp', ['#6ac8f0', '#1a5a8a', '#fff'], 0, 6], ['wolf', ['#e8f0f8', '#8aa0b0', '#38f'], 25, 4], ['ghost', ['#d0e8ff', '#7a9ac0', '#fff'], 80, 3], ['boar', ['#b8d0e0', '#5a7a90', '#fff'], 150, 2.5], ['ogre', ['#9ac0d8', '#3a5a78', '#fff'], 240, 1.5]],
      elite: ['ogre', ['#6aa0d8', '#1a3a6a', '#ff0']], boss: { arch: 'ogre', pal: ['#ffffff', '#5a8ab0', '#38f'], names: ['Emil', 'Jiří', 'Pavel'], hp: 5200, scale: 2.8 } }),
    // the raid: shaped like a multiplayer dungeon, several times harder (stronger enemies, faster waves, four shrines); open once Glacier is cleared
    dun({ id: 'r1', mode: 'multi', raid: true, cs: 'Navia', en: 'Navia', diff: 3.2, xp: 4, spawn: 1.45, pace: 1.0, shrines: 4, bg: ['#2a1f3a', '#241a32', '#34274a', '#1a1226'], deco: 'bones',
      roster: [['ghost', ['#c8a8ff', '#5a3a8a', '#fff'], 0, 5], ['imp', ['#9a3ad8', '#3a0a5a', '#ff0'], 0, 4], ['wolf', ['#3a2a4a', '#0e0816', '#f3f'], 40, 3], ['spider', ['#5a2a6a', '#1a0a22', '#f6f'], 90, 3], ['boar', ['#4a2a5a', '#160a1e', '#fff'], 150, 2.5], ['ogre', ['#6a3a8a', '#1e0a2e', '#fd0'], 220, 1.5]],
      elite: ['ogre', ['#8a3ac8', '#2a0a44', '#ff0']], boss: { arch: 'ogre', pal: ['#b020f0', '#2a0640', '#ff3'], names: ['Martin', 'Tomáš', 'Jakub'], hp: 9000, scale: 3.4 } }),
  ],
};
export const DUNGEON = Object.fromEntries([...DUNGEONS.single, ...DUNGEONS.multi].map((d) => [d.id, d]));

// ---- equipment ----
export const SLOTS = ['armor', 'ring', 'boots'];      // the weapon slot is the armory below
export const MAX_EQUIP = 20;

// ---- held weapons (the armory): 12 kinds x 4 tiers = 48. Each character owns some, holds one, and upgrades each to +9 ----
export const MAX_PLUS = 9;
// type: dmg factor, perk stat (hp | spd | cd | magnet | null), mat = what the blade is made of (sprite palette)
export const ARM_TYPES = {
  sword:  { dmg: 1.04, perk: 'hp',     mat: 'metal' },  dagger: { dmg: 1.00, perk: 'spd',    mat: 'metal' },
  axe:    { dmg: 1.10, perk: null,     mat: 'metal' },  hammer: { dmg: 1.10, perk: 'hp',     mat: 'metal' },
  mace:   { dmg: 1.06, perk: 'magnet', mat: 'metal' },  spear:  { dmg: 1.02, perk: 'magnet', mat: 'metal' },
  staff:  { dmg: 1.00, perk: 'cd',     mat: 'wood' },   wand:   { dmg: 1.00, perk: 'cd',     mat: 'wood' },
  scythe: { dmg: 1.08, perk: 'magnet', mat: 'metal' },  club:   { dmg: 1.06, perk: 'hp',     mat: 'wood' },
  bow:    { dmg: 1.02, perk: 'spd',    mat: 'wood' },   flail:  { dmg: 1.04, perk: 'spd',    mat: 'metal' },
};
// tier: base damage, character level needed, price (coins), perk strength
export const ARM_TIERS = [
  { dmg: 1.00, need: 1,  price: 120,  perk: 0.02 },
  { dmg: 1.20, need: 8,  price: 600,  perk: 0.035 },
  { dmg: 1.45, need: 20, price: 2200, perk: 0.05 },
  { dmg: 1.75, need: 40, price: 6000, perk: 0.07 },
];
const ARM_NAMES = {      // [cs, en] for tiers 1..4
  sword:  [['Rezavý meč', 'Rusty Sword'], ['Ocelový meč', 'Steel Sword'], ['Meč bohatýra', "Hero's Blade"], ['Svatovítův meč', "Svantevit's Blade"]],
  dagger: [['Kuchyňský nůž', 'Kitchen Knife'], ['Zbojnická dýka', "Brigand's Dagger"], ['Stříbrný stylet', 'Silver Stiletto'], ['Dýka Černoboha', "Chernobog's Dagger"]],
  axe:    [['Sekyrka', 'Hatchet'], ['Valaška', 'Valaška'], ['Bradatice', 'Bearded Axe'], ['Perunova sekera', "Perun's Axe"]],
  hammer: [['Kovářské kladivo', "Smith's Hammer"], ['Perlík', 'War Pick'], ['Bitevní kladivo', 'Battle Hammer'], ['Svarožího kladivo', "Svarog's Hammer"]],
  mace:   [['Dřevěná bulava', 'Wooden Mace'], ['Železná bulava', 'Iron Mace'], ['Ostnatá bulava', 'Spiked Mace'], ['Hetmanská bulava', "Hetman's Mace"]],
  spear:  [['Vidle', 'Pitchfork'], ['Kopí', 'Spear'], ['Partyzána', 'Partisan'], ['Čertův trojzubec', "Devil's Trident"]],
  staff:  [['Dřevěná hůl', 'Wooden Staff'], ['Poutnická hůl', "Pilgrim's Staff"], ['Krakonošova hůl', "Krakonos' Staff"], ['Mořanina hůl', "Morana's Staff"]],
  wand:   [['Lískový proutek', 'Hazel Twig'], ['Kouzelná hůlka', 'Magic Wand'], ['Čarodějná hůlka', "Witch's Wand"], ['Hůlka Živy', "Živa's Wand"]],
  scythe: [['Srp', 'Sickle'], ['Kosa', 'Scythe'], ['Kosa polednice', "Noon Witch's Scythe"], ['Kosa Smrtky', "Death's Scythe"]],
  club:   [['Dřevěný kyj', 'Wooden Cudgel'], ['Okovaný kyj', 'Studded Cudgel'], ['Dubový kyj', 'Oak Cudgel'], ['Obrův kyj', "Giant's Club"]],
  bow:    [['Jednoduchý luk', 'Simple Bow'], ['Lovecký luk', 'Hunting Bow'], ['Tisový luk', 'Yew Bow'], ['Zlatý luk', 'Golden Bow']],
  flail:  [['Hrubý cep', "Thresher's Flail"], ['Bojový cep', 'War Flail'], ['Husitský řemdih', 'Hussite Flail'], ['Hromový cep', 'Thunder Flail']],
};
export const ARMS = Object.entries(ARM_NAMES).flatMap(([type, names]) => names.map(([cs, en], i) => {
  const T = ARM_TIERS[i], Y = ARM_TYPES[type];
  return { id: type + (i + 1), type, tier: i + 1, cs, en, dmg: T.dmg * Y.dmg, perk: Y.perk, perkVal: T.perk, need: T.need, price: T.price };
}));
// ---- legendary weapons: one per dungeon, found only in that dungeon's end chest (never in the armory shop). id = type + '5' ----
// [dungeon, type, damage, perk strength, price (a sale pays a quarter), cs, en]
const LEGENDS = [
  ['s1', 'club',   2.05, 0.09, 6000,  'Palice Lesního obra', "Forest Giant's Club"],
  ['s2', 'sword',  2.10, 0.09, 6500,  'Meč Kostěného knížete', "Bone Prince's Sword"],
  ['s3', 'hammer', 2.15, 0.09, 7000,  'Kladivo Ohnivého Golema', "Fire Golem's Hammer"],
  ['m1', 'spear',  2.25, 0.11, 9000,  'Žihadlo Jeskynní matky', "Cave Mother's Stinger"],
  ['m2', 'wand',   2.30, 0.11, 9500,  'Hůlka Bahenního krále', "Bog King's Wand"],
  ['m3', 'bow',    2.35, 0.11, 10000, 'Luk Zimní královny', "Winter Queen's Bow"],
  ['r1', 'scythe', 2.90, 0.14, 15000, 'Kosa Černoboha', "Chernobog's Scythe"],
];
for (const [dun, type, dmg, perkVal, price, cs, en] of LEGENDS) ARMS.push({ id: type + '5', type, tier: 5, legend: dun, cs, en, dmg, perk: ARM_TYPES[type].perk, perkVal, need: 1, price });
export const ARM = Object.fromEntries(ARMS.map((w) => [w.id, w]));
export const LEGEND_OF = Object.fromEntries(ARMS.filter((w) => w.legend).map((w) => [w.legend, w.id]));
export const STARTER = 'staff1';          // every character starts with it (free)
