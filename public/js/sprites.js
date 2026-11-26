// Procedural pixel art: heroes, enemies, items, ground and a tiny 3x5 text font. All sprites are drawn once into small canvases.
import { CLASS, DUNGEON, ARCH } from '../shared/data.js';

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
function make(w, h, fn, noOutline) {
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
  if (type === 6) return ARCH[d.boss.arch].r * (d.boss.scale || 2.6);
  if (type === 5) return ARCH[d.elite[0]].r * 1.5;
  return ARCH[d.roster[type][0]].r;
}
export function enemyFor(d, type) {
  if (type === 6) return [d.boss.arch, d.boss.pal];
  if (type === 5) return [d.elite[0], d.elite[1]];
  return [d.roster[type][0], d.roster[type][1]];
}

// ---------- heroes (12x16) ----------
const SKIN = '#f2c38f';
const HERO = {
  krakonos: { hat: [[4, 0, 4, 1, '#5a3a1a'], [3, 1, 6, 2, '#5a3a1a']], extra: [[3, 6, 6, 3, '#dfe8d0'], [10, 3, 1, 12, '#8a5a2a'], [9, 2, 3, 1, '#4a9a3a']] },
  zbojnik: { hat: [[3, 1, 6, 2, '#222'], [2, 2, 8, 1, '#222'], [8, 0, 1, 2, '#e33']], extra: [[3, 10, 6, 1, '#c9a14a'], [10, 6, 1, 6, '#8a5a2a'], [9, 5, 3, 2, '#bbb']] },
  perun: { hat: [[3, 1, 6, 2, '#f0d040'], [2, 2, 1, 4, '#f0d040'], [9, 2, 1, 4, '#f0d040']], extra: [[10, 5, 1, 2, '#ff0'], [9, 7, 2, 1, '#ff0'], [10, 8, 1, 2, '#ff0']] },
  cert: { skin: '#c0392b', hat: [[3, 0, 1, 2, '#222'], [8, 0, 1, 2, '#222'], [3, 2, 6, 1, '#3a1010']], extra: [[10, 4, 1, 10, '#888'], [9, 3, 3, 1, '#888'], [10, 12, 2, 1, '#c0392b'], [11, 11, 1, 1, '#c0392b']] },
  bohatyr: { hat: [[3, 1, 6, 2, '#bbb'], [5, 0, 2, 1, '#bbb'], [3, 3, 1, 2, '#bbb'], [8, 3, 1, 2, '#bbb']], extra: [[0, 7, 3, 5, '#8a5a2a'], [1, 8, 1, 3, '#d4a017'], [5, 6, 2, 1, '#7a4a1a']] },
  vedma: { hat: [[3, 1, 6, 3, '#7d3c98'], [2, 3, 1, 5, '#7d3c98'], [9, 3, 1, 5, '#7d3c98']], extra: [[10, 8, 2, 3, '#3a8a3a'], [11, 7, 1, 1, '#e3e']] },
  hastrman: { skin: '#5ac08a', hat: [[3, 1, 6, 2, '#1a5a5a'], [4, 0, 4, 1, '#c9a05a']], extra: [[10, 5, 1, 2, '#6cf'], [10, 8, 2, 3, '#6cf'], [3, 11, 6, 1, '#2a8a8a']] },
  polednice: { hat: [[3, 1, 6, 2, '#ffe060'], [2, 2, 1, 5, '#ffe060'], [9, 2, 1, 5, '#ffe060']], extra: [[10, 5, 1, 5, '#888'], [9, 4, 2, 1, '#ddd'], [3, 11, 6, 1, '#fff']] },
  golem: { skin: '#9a9a86', big: true, hat: [], extra: [[5, 9, 2, 2, '#ee5']] },
  rarasek: { hat: [[3, 1, 6, 2, '#c0392b'], [5, 0, 2, 1, '#c0392b'], [6, -1, 1, 1, '#c0392b']], extra: [[10, 11, 2, 1, '#c0392b'], [11, 10, 1, 1, '#c0392b'], [3, 6, 6, 1, '#7a3a1a']] },
  morana: { hat: [[3, 1, 6, 3, '#fff'], [3, 0, 1, 1, '#aee'], [5, 0, 1, 1, '#aee'], [8, 0, 1, 1, '#aee'], [2, 3, 1, 5, '#fff'], [9, 3, 1, 5, '#fff']], extra: [[10, 4, 1, 9, '#9cf'], [9, 3, 3, 1, '#cff']] },
  baba: { hat: [[3, 1, 6, 2, '#bbb'], [2, 3, 1, 3, '#bbb'], [9, 3, 1, 3, '#bbb']], extra: [[6, 5, 2, 1, '#b08060'], [10, 2, 1, 12, '#8a5a2a'], [9, 13, 3, 2, '#c9a05a']] },
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
