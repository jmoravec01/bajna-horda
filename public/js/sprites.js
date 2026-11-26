// Procedural pixel art: heroes, enemies, items, ground and a tiny 3x5 text font. All sprites are drawn once into small canvases.
import { CLASS, DUNGEON, ARCH, ARM_TYPES } from '../shared/data.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const OUT = [17, 17, 17];

// adds a 1px dark outline around every opaque pixel (the canvas is padded by 1px for it)
function outline(c, col = OUT) {
  const x = c.getContext('2d'), w = c.width, h = c.height, im = x.getImageData(0, 0, w, h), d = im.data, src = new Uint8ClampedArray(d);
  const a = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : src[(j * w + i) * 4 + 3]);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (a(i, j)) continue;
    if (a(i - 1, j) || a(i + 1, j) || a(i, j - 1) || a(i, j + 1)) { const o = (j * w + i) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255; }
  }
  x.putImageData(im, 0, 0);
  return c;
}
export function make(w, h, fn, noOutline) {
  const c = mk(w + 2, h + 2), x = c.getContext('2d');
  x.translate(1, 1); fn(x, w, h);
  return noOutline ? c : outline(c);
}
const rects = (x, list) => { for (const [px, py, w, h, col] of list) { x.fillStyle = col; x.fillRect(px, py, w, h); } };

function fromArt(rows, pal) {
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  return make(w, h, (x) => {
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) { const ch = r[i]; if (ch === '.') continue; x.fillStyle = pal[ch] || '#f0f'; x.fillRect(i, j, 1, 1); } });
  });
}

// ---------- enemies ----------
const ART = {
  slime: ['...aaaa...', '..aaaaaa..', '.aaaaaaaa.', '.aawaawaa.', '.aakaakaa.', 'aaaaaaaaaa', 'abbbbbbbba', '.bbbbbbbb.'],
  bat: ['b..........b', 'bb...aa...bb', 'bbb.aaaa.bbb', 'bbbbaccabbbb', '.bbbaaaabbb.', '..bb.aa.bb..', '...b....b...'],
  skel: ['..aaaa..', '.aaaaaa.', '.acaaca.', '.aaaaaa.', '..akka..', '...aa...', '.aaaaaa.', 'a.abba.a', '..abba..', '..aaaa..', '..a..a..', '.aa..aa.'],
  wolf: ['..........a.a.', '.........aaaaa.', 'aa.....aaaaaack', '.aaaaaaaaaaaaaa', '..aaaaaaaaaaaa.', '..aaaaaaaaaaa..', '..ab.ab..ab.ab.', '..bb.bb..bb.bb.'],
  spider: ['b..b....b..b', '.bbb.aa.bbb.', '..bbaaaabb..', 'bbbaacaacbbb', '..bbaaaabb..', '.bb.aaaa.bb.', 'b..b.aa.b..b'],
  ghost: ['...aaaa...', '..aaaaaa..', '.aaaaaaaa.', '.aakaakaa.', '.aakaakaa.', '.aaaaaaaa.', '.aaabbaaa.', '.aaaaaaaa.', '.aaaaaaaa.', '.aa.aa.aa.', '.a..a..a..'],
  ogre: ['.....bbbbbb.....', '....bbaaaabb....', '...baaaaaaaab...', '...baacaacaab...', '...baaaaaaaab...', '...bawwwwwwab...', '....baaaaaab....', '..bbbaaaaaabbb..', '.bbaabbbbbbaabb.', 'bbaaabaaaabaaabb', 'baaaabaaaabaaaab', 'baaaabaaaabaaaab', '.bbbbbaaaabbbbb.', '....baab.baab...', '....bbb...bbb...', '...bbbb...bbbb..'],
  boar: ['..bb........bb', '.baabbbbbbbbaab', 'baaaaaaaaaaaaaa', 'baaaaaaaaaaaakw', 'baaaaaaaaaaaaaw', '.baaaaaaaaaaaa.', '..bbaabbbbaabb.', '..bb.b....b.bb.'],
  imp: ['b........b', 'bb.aaaa.bb', '.baaaaaab.', '..aacaac..', '..aaaaaa..', '..aawwaa..', '...aaaa...', '..bbaabb..', '.bbaaaabb.', '..aa..aa..', '..bb..bb..'],
};
const enemyCache = new Map();
export function enemySprite(arch, pal) {
  const key = arch + pal.join('');
  let s = enemyCache.get(key);
  if (!s) {
    const p = { a: pal[0], b: pal[1], c: pal[2], w: '#fff', k: '#111' };
    // second frame: shifted down one pixel (a cheap walk bob)
    const f0 = fromArt(ART[arch], p), f1 = mk(f0.width, f0.height + 1);
    f1.getContext('2d').drawImage(f0, 0, 1);
    s = [f0, f1]; enemyCache.set(key, s);
  }
  return s;
}
// radius of an enemy of this dungeon type, as the sim computes it
export function enemyRadius(d, type) {
  if (type >= 6) return ARCH[d.boss.arch].r * (d.boss.scale || 2.6) * d.stages[type - 6].size;
  if (type === 5) return ARCH[d.elite[0]].r * 1.5;
  return ARCH[d.roster[type][0]].r;
}
export function enemyFor(d, type) {
  if (type >= 6) return [d.boss.arch, d.boss.pal];
  if (type === 5) return [d.elite[0], d.elite[1]];
  return [d.roster[type][0], d.roster[type][1]];
}

// ---------- heroes (12x16) ----------
const SKIN = '#f2c38f';
const HERO = {
  krakonos: { hat: [[4, 0, 4, 1, '#5a3a1a'], [3, 1, 6, 2, '#5a3a1a']], extra: [[3, 6, 6, 3, '#dfe8d0']] },
  zbojnik: { hat: [[3, 1, 6, 2, '#222'], [2, 2, 8, 1, '#222'], [8, 0, 1, 2, '#e33']], extra: [[3, 10, 6, 1, '#c9a14a']] },
  perun: { hat: [[3, 1, 6, 2, '#f0d040'], [2, 2, 1, 4, '#f0d040'], [9, 2, 1, 4, '#f0d040']], extra: [[3, 11, 6, 1, '#ff0']] },
  cert: { skin: '#c0392b', hat: [[3, 0, 1, 2, '#222'], [8, 0, 1, 2, '#222'], [3, 2, 6, 1, '#3a1010']], extra: [[10, 12, 2, 1, '#c0392b'], [11, 11, 1, 1, '#c0392b']] },
  bohatyr: { hat: [[3, 1, 6, 2, '#bbb'], [5, 0, 2, 1, '#bbb'], [3, 3, 1, 2, '#bbb'], [8, 3, 1, 2, '#bbb']], extra: [[0, 7, 3, 5, '#8a5a2a'], [1, 8, 1, 3, '#d4a017'], [5, 6, 2, 1, '#7a4a1a']] },
  vedma: { hat: [[3, 1, 6, 3, '#7d3c98'], [2, 3, 1, 5, '#7d3c98'], [9, 3, 1, 5, '#7d3c98']], extra: [[3, 11, 6, 1, '#3a8a3a']] },
  hastrman: { skin: '#5ac08a', hat: [[3, 1, 6, 2, '#1a5a5a'], [4, 0, 4, 1, '#c9a05a']], extra: [[3, 11, 6, 1, '#2a8a8a']] },
  polednice: { hat: [[3, 1, 6, 2, '#ffe060'], [2, 2, 1, 5, '#ffe060'], [9, 2, 1, 5, '#ffe060']], extra: [[3, 11, 6, 1, '#fff']] },
  golem: { skin: '#9a9a86', big: true, hat: [], extra: [[5, 9, 2, 2, '#ee5']] },
  rarasek: { hat: [[3, 1, 6, 2, '#c0392b'], [5, 0, 2, 1, '#c0392b'], [6, -1, 1, 1, '#c0392b']], extra: [[10, 11, 2, 1, '#c0392b'], [11, 10, 1, 1, '#c0392b'], [3, 6, 6, 1, '#7a3a1a']] },
  morana: { hat: [[3, 1, 6, 3, '#fff'], [3, 0, 1, 1, '#aee'], [5, 0, 1, 1, '#aee'], [8, 0, 1, 1, '#aee'], [2, 3, 1, 5, '#fff'], [9, 3, 1, 5, '#fff']], extra: [[3, 11, 6, 1, '#cff']] },
  baba: { hat: [[3, 1, 6, 2, '#bbb'], [2, 3, 1, 3, '#bbb'], [9, 3, 1, 3, '#bbb']], extra: [[6, 5, 2, 1, '#b08060'], [3, 11, 6, 1, '#c9a05a']] },
};
const shade = (hex, k) => '#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');
export const heroSkin = (cls) => HERO[cls].skin || SKIN;
const heroCache = new Map();
export function heroSprite(cls, frame) {
  const key = cls + frame;
  let s = heroCache.get(key);
  if (s) return s;
  const h = HERO[cls], col = CLASS[cls].col, skin = h.skin || SKIN, bob = frame ? 1 : 0;
  s = make(12, 17, (x) => {
    if (h.big) {
      rects(x, [[2, 2 + bob, 8, 6, skin], [1, 8 + bob, 10, 5, shade(skin, 0.85)], [3, 4 + bob, 2, 1, '#ee5'], [7, 4 + bob, 2, 1, '#ee5'], [0, 8 + bob, 1, 4, skin], [11, 8 + bob, 1, 4, skin],
        [2, 13, 3, 3 - (frame ? 1 : 0), shade(skin, 0.7)], [7, 13, 3, 3 - (frame ? 0 : 1), shade(skin, 0.7)]]);
      rects(x, h.extra.map(([a, b, c, d, e]) => [a, b + bob, c, d, e]));
      return;
    }
    rects(x, [[3, 2 + bob, 6, 5, skin], [4, 4 + bob, 1, 1, '#111'], [7, 4 + bob, 1, 1, '#111'], [3, 7 + bob, 6, 5, col], [2, 7 + bob, 1, 4, shade(col, 0.75)], [9, 7 + bob, 1, 4, shade(col, 0.75)],
      [3, 12, 2, 4 - (frame ? 1 : 0), '#3a2a20'], [7, 12, 2, 4 - (frame ? 0 : 1), '#3a2a20']]);
    rects(x, h.hat.map(([a, b, c, d, e]) => [a, b + bob, c, d, e]));
    rects(x, h.extra.map(([a, b, c, d, e]) => [a, b + bob, c, d, e]));
  });
  heroCache.set(key, s);
  return s;
}

// ---------- held weapons: 12 kinds x 4 tiers (blade up, pivot = the grip) ----------
// art letters: b blade/head, e edge/highlight, g guard/fitting, h handle, k grip end, j gem (a fitting on tiers 1-2)
const ARM_ART = {
  sword: { pv: [2.5, 9.5], art: ['..e..', '..e..', '.ebb.', '.ebb.', '.ebb.', '.ebb.', '.ebb.', '.ebb.', 'ggjgg', '..h..', '..h..', '..k..'] },
  dagger: { pv: [2.5, 5.5], art: ['..e..', '.ebb.', '.ebb.', '.ebb.', 'ggjgg', '..h..', '..k..'] },
  axe: { pv: [5.5, 8.5], art: ['..bbbh.', '.bbbeh.', 'bbbbeh.', '.bbeeh.', '..bb.h.', '.....j.', '.....h.', '.....h.', '.....h.', '.....h.', '.....k.'] },
  hammer: { pv: [3, 8.5], art: ['gggggg', 'gbbebg', 'gbbebg', 'gggggg', '..hh..', '..hh..', '..hj..', '..hh..', '..hh..', '..hh..', '..kk..'] },
  mace: { pv: [2.5, 7.5], art: ['..g..', '.gbg.', 'gbjbg', '.gbg.', '..g..', '..h..', '..h..', '..h..', '..h..', '..h..', '..k..'] },
  spear: { pv: [2.5, 9.5], art: ['..e..', '.ebb.', '.ebb.', '..b..', '.ggg.', '..h..', '..h..', '..j..', '..h..', '..h..', '..h..', '..h..', '..h..', '..k..'] },
  staff: { pv: [2.5, 8.5], art: ['.ggg.', 'gjjjg', 'gjjjg', '.ggg.', '..h..', '..h..', '..h..', '..h..', '..h..', '..h..', '..h..', '..k..'] },
  wand: { pv: [1.5, 5.5], art: ['.j.', 'jej', '.j.', '.h.', '.h.', '.h.', '.h.', '.k.'] },
  scythe: { pv: [6.5, 8.5], art: ['..eeebh.', '.ebb..h.', 'eb....h.', 'b.....h.', '......h.', '......g.', '......h.', '......h.', '......h.', '......h.', '......h.', '......k.'] },
  club: { pv: [2.5, 7.5], art: ['.bbb.', 'bbebb', 'bgegb', 'bbebb', '.bbb.', '..h..', '..h..', '..h..', '..h..', '..h..', '..k..'] },
  bow: { pv: [0.5, 4.5], art: ['..hhe', '.h..e', 'h...e', 'h...e', 'g...e', 'h...e', 'h...e', '.h..e', '..hhe'] },
  flail: { pv: [2.5, 11.5], art: ['..g..', '.gbg.', 'gbjbg', '.gbg.', '..g..', '..e..', '.e...', '..e..', '.e...', '..e..', '..h..', '..h..', '..h..', '..k..'] },
};
const ARM_METAL = [
  { b: '#8d949a', e: '#cfd5da', g: '#6b4a2a', h: '#8a5a2a', k: '#3a2a1a', j: '#6b4a2a' },
  { b: '#b8c4d0', e: '#eaf2fa', g: '#c9a05a', h: '#6b4420', k: '#2a1a10', j: '#c9a05a' },
  { b: '#d6dce4', e: '#ffffff', g: '#e8b830', h: '#7a2a2a', k: '#3a1010', j: '#e03030' },
  { b: '#7ad8f0', e: '#e8feff', g: '#b070f0', h: '#2a2a5a', k: '#10102a', j: '#ff5adf' },
  { b: '#ffcf3a', e: '#fff6c0', g: '#d8281e', h: '#5a1010', k: '#2a0606', j: '#6cf0ff' },      // legendary
];
const ARM_WOOD = [
  { b: '#a0702e', e: '#c99a54', g: '#6b4a2a', h: '#8a5a2a', k: '#4a3018', j: '#c9a05a' },
  { b: '#7a4a22', e: '#a06a38', g: '#8d949a', h: '#6b4420', k: '#2a1a10', j: '#8d949a' },
  { b: '#4a2a14', e: '#7a5030', g: '#e8b830', h: '#7a2a2a', k: '#3a1010', j: '#e03030' },
  { b: '#4a3a8a', e: '#8a70e0', g: '#7ad8f0', h: '#2a2a5a', k: '#10102a', j: '#ff5adf' },
  { b: '#ffcf3a', e: '#fff6c0', g: '#d8281e', h: '#5a1010', k: '#2a0606', j: '#6cf0ff' },      // legendary
];
const armCache = new Map();
export function armSprite(id) {                 // id like 'sword3' = type + tier
  let s = armCache.get(id);
  if (s) return s;
  const type = id.slice(0, -1), tier = +id.slice(-1), a = ARM_ART[type];
  if (!a) return null;
  const mat = ARM_TYPES[type].mat === 'wood' ? ARM_WOOD : ARM_METAL;
  s = fromArt(a.art, mat[tier - 1]);
  s.px = a.pv[0] + 1; s.py = a.pv[1] + 1;      // +1: the outline pad
  armCache.set(id, s);
  return s;
}
// upgrade glow: +3..+5 green, +6..+8 blue, +9 gold
export const armGlow = (plus) => plus >= 9 ? '#ffd23f' : plus >= 6 ? '#6cf' : plus >= 3 ? '#7dff7d' : null;

// ---------- passive icons (14x14-ish) ----------
const PASSIVE_ART = {
  srdce: { pal: { r: '#e33', w: '#fcc' }, art: ['.rr...rr.', 'rrrr.rrrr', 'rwrrrrrrr', 'rrrrrrrrr', '.rrrrrrr.', '..rrrrr..', '...rrr...', '....r....'] },
  boty: { pal: { b: '#c9742a', w: '#e8a050', k: '#4a2a10' }, art: ['..bbbb...', '..bbbb...', '..bwbb...', '..bbbb...', '..bbbb...', '.bbbbbbb.', 'bbbbbbbbb', 'kkkkkkkkk'] },
  sila: { pal: { y: '#f2c38f', o: '#d89a60', c: '#c0392b' }, art: ['..yyyyy..', '.yyyyyyy.', 'yyoyoyoyy', 'yyyyyyyyy', 'yyyyyyyyy', '.yyyyyyy.', '.ccccccc.', '.ccccccc.'] },
  spech: { pal: { f: '#b0743a', c: '#cff', s: '#ffd23f' }, art: ['fffffff', 'fcccccf', '.fcscf.', '..fsf..', '...f...', '..fsf..', '.fsssf.', 'fsssssf', 'fffffff'] },
  magnet: { pal: { r: '#e33', b: '#38f', w: '#eee' }, art: ['www...www', 'rrr...bbb', 'rrr...bbb', 'rrr...bbb', 'rrrr.bbbb', '.rrrbbbb.', '..rrbbb..', '...rbb...'] },
  moudrost: { pal: { b: '#5a3aa8', w: '#f4ecd8', k: '#a09070' }, art: ['.bbbbb.bbbbb.', 'bwwwwwbwwwwwb', 'bwkkwwbwwkkwb', 'bwwwwwbwwwwwb', 'bwkkkwbwkkwwb', 'bwwwwwbwwwwwb', '.bbbbbbbbbbb.'] },
};
const passCache = new Map();
export function passiveSprite(id) {
  let s = passCache.get(id);
  if (!s && PASSIVE_ART[id]) { s = fromArt(PASSIVE_ART[id].art, PASSIVE_ART[id].pal); passCache.set(id, s); }
  return s;
}

// ---------- weapons, items ----------
const objCache = new Map();
const O = {
  2: () => make(7, 10, (x) => rects(x, [[3, 0, 3, 2, '#ffe94a'], [2, 2, 3, 2, '#ffe94a'], [1, 4, 5, 2, '#ffe94a'], [3, 6, 2, 2, '#ffe94a'], [2, 8, 2, 2, '#ffe94a']])),   // lightning icon
  4: () => make(5, 11, (x) => rects(x, [[1, 0, 3, 3, '#8a5a2a'], [0, 1, 5, 2, '#6b4420'], [2, 3, 1, 8, '#a0702e']])),             // club icon
  5: () => make(10, 7, (x) => rects(x, [[1, 2, 4, 4, '#7ee05a'], [4, 0, 4, 5, '#5ec040'], [6, 3, 4, 4, '#7ee05a'], [3, 4, 4, 3, '#5ec040']])), // poison cloud icon
  6: () => make(7, 9, (x) => rects(x, [[3, 0, 1, 2, '#6cf'], [2, 2, 3, 2, '#6cf'], [1, 4, 5, 4, '#4aa8e8'], [2, 8, 3, 1, '#4aa8e8'], [2, 5, 1, 1, '#cff']])),   // puddle icon
  7: () => make(11, 11, (x) => rects(x, [[4, 0, 3, 1, '#ffe060'], [2, 1, 2, 1, '#ffe060'], [7, 1, 2, 1, '#ffe060'], [1, 2, 1, 2, '#ffe060'], [9, 2, 1, 2, '#ffe060'], [0, 4, 1, 3, '#ffe060'], [10, 4, 1, 3, '#ffe060'], [1, 7, 1, 2, '#ffe060'], [9, 7, 1, 2, '#ffe060'], [2, 9, 2, 1, '#ffe060'], [7, 9, 2, 1, '#ffe060'], [4, 10, 3, 1, '#ffe060'], [4, 4, 3, 3, '#ffb020']])), // noon ring icon
  8: () => make(9, 9, (x) => rects(x, [[1, 2, 7, 6, '#9a9a86'], [2, 0, 5, 3, '#b0b09c'], [1, 7, 2, 2, '#6a6a5a'], [6, 7, 2, 2, '#6a6a5a'], [3, 4, 3, 1, '#6a6a5a']])), // fist icon
  0: () => make(3, 11, (x) => rects(x, [[1, 0, 1, 11, '#8a5a2a'], [0, 0, 3, 2, '#c9a05a']])),           // staff
  1: () => make(7, 7, (x) => rects(x, [[3, 0, 1, 7, '#8a5a2a'], [0, 0, 4, 3, '#ccd'], [1, 1, 2, 1, '#fff']])), // hatchet
  3: () => make(6, 6, (x) => rects(x, [[1, 1, 4, 4, '#222'], [0, 2, 6, 2, '#222'], [2, 2, 1, 1, '#777'], [4, 0, 1, 1, '#fd0'], [5, 0, 1, 1, '#f60']])), // bomb
  9: () => make(6, 5, (x) => rects(x, [[1, 1, 4, 3, '#c0392b'], [0, 4, 6, 1, '#7a1a10'], [2, 0, 2, 1, '#c0392b']])), // cap
  10: () => make(5, 5, (x) => rects(x, [[2, 0, 1, 5, '#cff'], [1, 1, 3, 3, '#8de'], [2, 2, 1, 1, '#fff']])),   // ice shard
  11: () => make(14, 13, (x) => rects(x, [[1, 0, 12, 2, '#a0522d'], [2, 2, 10, 6, '#c9a05a'], [4, 3, 2, 2, '#fd0'], [8, 3, 2, 2, '#fd0'], [6, 6, 2, 2, '#5a3a1a'], [3, 8, 1, 4, '#e8c030'], [10, 8, 1, 4, '#e8c030'], [2, 12, 3, 1, '#e8c030'], [9, 12, 3, 1, '#e8c030']])), // hut
};
export function objSprite(wix) {
  let s = objCache.get(wix);
  if (!s && O[wix]) { s = O[wix](); objCache.set(wix, s); }
  return s;
}
const pickCache = [];
const P = [
  () => make(3, 4, (x) => rects(x, [[1, 0, 1, 4, '#4fc3f7'], [0, 1, 3, 2, '#4fc3f7']])),
  () => make(4, 5, (x) => rects(x, [[1, 0, 2, 5, '#66e07a'], [0, 1, 4, 3, '#66e07a'], [1, 1, 1, 1, '#d8ffe0']])),
  () => make(5, 6, (x) => rects(x, [[2, 0, 1, 6, '#c77dff'], [1, 1, 3, 4, '#c77dff'], [0, 2, 5, 2, '#c77dff'], [1, 2, 1, 1, '#f0d8ff']])),
  () => make(5, 5, (x) => rects(x, [[1, 0, 3, 5, '#ffd23f'], [0, 1, 5, 3, '#ffd23f'], [2, 1, 1, 3, '#b8860b']])),
  () => make(7, 6, (x) => rects(x, [[0, 0, 3, 3, '#e33'], [4, 0, 3, 3, '#e33'], [1, 2, 5, 2, '#e33'], [2, 4, 3, 1, '#e33'], [3, 5, 1, 1, '#e33'], [1, 1, 1, 1, '#fcc']])),
  () => make(7, 7, (x) => rects(x, [[0, 0, 2, 5, '#bbb'], [5, 0, 2, 5, '#bbb'], [0, 5, 7, 2, '#bbb'], [0, 0, 2, 2, '#e33'], [5, 0, 2, 2, '#38f']])),
  () => make(9, 8, (x) => rects(x, [[0, 2, 9, 6, '#8a5a2a'], [0, 0, 9, 3, '#a0702e'], [4, 3, 1, 3, '#ffd23f'], [3, 3, 3, 1, '#ffd23f']])),
];
export function pickSprite(tier) { return pickCache[tier] || (pickCache[tier] = P[tier]()); }
export const bulletSprite = () => pickCache.b || (pickCache.b = make(3, 3, (x) => rects(x, [[0, 1, 3, 1, '#ff5a3a'], [1, 0, 1, 3, '#ff5a3a'], [1, 1, 1, 1, '#ffe08a']])));

// ---------- ground ----------
const groundCache = new Map();
export function ground(ctx, d) {
  let p = groundCache.get(d.id);
  if (p) return p;
  const S = 128, c = mk(S, S), x = c.getContext('2d');
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const [base, dark, light, deep] = d.bg;
  x.fillStyle = base; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 700; i++) { x.fillStyle = [dark, light, deep][Math.floor(rnd() * 3)]; x.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), 1 + (rnd() < 0.3 ? 1 : 0), 1); }
  const deco = {
    grass: (px, py) => { x.fillStyle = '#5fae52'; x.fillRect(px, py, 1, 3); x.fillRect(px + 2, py + 1, 1, 2); x.fillStyle = '#2d5e2b'; x.fillRect(px + 1, py + 2, 1, 1); },
    bones: (px, py) => { x.fillStyle = '#cfcab8'; x.fillRect(px, py, 5, 1); x.fillRect(px - 1, py - 1, 1, 3); x.fillRect(px + 5, py - 1, 1, 3); },
    lava: (px, py) => { x.fillStyle = '#e8601a'; x.fillRect(px, py, 4, 1); x.fillRect(px + 3, py + 1, 3, 1); x.fillStyle = '#ffb030'; x.fillRect(px + 1, py, 2, 1); },
    rocks: (px, py) => { x.fillStyle = '#6a6058'; x.fillRect(px, py, 4, 3); x.fillStyle = '#847a70'; x.fillRect(px, py, 4, 1); },
    reeds: (px, py) => { x.fillStyle = '#6a8a3a'; x.fillRect(px, py, 1, 5); x.fillRect(px + 2, py + 1, 1, 4); x.fillStyle = '#8a6a3a'; x.fillRect(px, py - 1, 1, 2); },
    ice: (px, py) => { x.fillStyle = '#e8f6ff'; x.fillRect(px, py, 1, 4); x.fillRect(px - 1, py + 1, 3, 1); },
  }[d.deco];
  for (let i = 0; i < 26; i++) deco(4 + Math.floor(rnd() * (S - 10)), 4 + Math.floor(rnd() * (S - 10)));
  p = ctx.createPattern(c, 'repeat'); p.size = S;
  groundCache.set(d.id, p);
  return p;
}

// ---------- 3x5 text ----------
const GL = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110', '-': '000000111000000', '.': '000000000000010', '!': '010010010000010',
};
export function text(ctx, str, x, y, col = '#fff') {
  const s = String(str).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  let cx = x;
  for (const ch of s) {
    const g = GL[ch];
    if (g) { ctx.fillStyle = '#000'; for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3) + 1, y + ((i / 3) | 0) + 1, 1, 1); ctx.fillStyle = col; for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3), y + ((i / 3) | 0), 1, 1); }
    cx += 4;
  }
}
export const textWidth = (s) => String(s).length * 4 - 1;
