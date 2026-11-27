// Music scores: only the notes (melody + chords) of famous public-domain tunes, one per place. audio.js plays what compile() builds from them.
// Melody notation: space-separated "c#5:3" = note name, octave, optional length in steps ("-" is a rest); a token without length lasts `u` steps.
// A step is 1/spq of a quarter note (4 = a sixteenth, 3 = a triplet eighth); a bar has `bar` steps and one chord.
export const SCORES = {
  // menu: Mozart, Eine kleine Nachtmusik
  menu: { bpm: 104, u: 4, w: { lead: 'square' }, bass: 2, chords: 'G G D7 G',
    lead: 'g4:4 d4:2 g4:2 d4:2 g4:2 d4:2 g4:2  b4:4 d5:12  c5:4 a4:2 c5:2 a4:2 c5:2 a4:2 c5:2  d5:4 c5:2 b4:2 a4:4 g4:4' },
  // Louka / Meadow: Beethoven, Ode to Joy
  s1: { bpm: 112, u: 4, lo: 12, w: { lead: 'square', bass: 'triangle' }, bass: 4, drums: 'k...h...k...h...', chords: 'C G C G C G C C',
    lead: 'e4 e4 f4 g4  g4 f4 e4 d4  c4 c4 d4 e4  e4:6 d4:2 d4:8  e4 e4 f4 g4  g4 f4 e4 d4  c4 c4 d4 e4  d4:6 c4:2 c4:8' },
  // Krypta / Crypt: Beethoven, Moonlight Sonata (the triplets)
  s2: { bpm: 54, spq: 3, bar: 12, u: 12, w: { lead: 'sine', arp: 'triangle', bass: 'triangle', pad: 'sine' }, chorus: 6, bass: 1, pad: true, arp: { p: [2, 3, 4], e: 1 }, chords: 'C#m B A G#7 C#m F#m G#7 C#m',
    lead: 'g#4:12 f#4:9 g#4:3 e4:12 f#4:6 d#4:6  c#5:9 b4:3 a4:6 c#5:6 d#5:6 c5:6 c#5:12' },
  // Sopka / Volcano: Beethoven, Symphony No. 5
  s3: { bpm: 150, u: 2, w: { lead: 'sawtooth', bass: 'triangle' }, bass: 4, drums: 'k.hhs.h.k.hks.h.', chords: 'Cm G7 Cm Fm Eb Fm Cm G7',
    lead: '-:2 g4:2 g4:2 g4:2 eb4:8  -:2 f4:2 f4:2 f4:2 d4:8  -:2 g4:2 g4:2 g4:2 eb5:8  -:2 ab4:2 ab4:2 ab4:2 f4:8  -:2 bb4:2 bb4:2 bb4:2 g4:8  -:2 ab4:2 ab4:2 ab4:2 f4:8  -:2 g4:2 g4:2 g4:2 eb4:8  -:2 f4:2 f4:2 f4:2 d4:8' },
  // Jeskyně / Cave (team): Grieg, In the Hall of the Mountain King
  m1: { bpm: 126, u: 2, harm: -12, chorus: 6, w: { lead: 'square', harm: 'sawtooth', bass: 'triangle', arp: 'square', pad: 'triangle' }, bass: 8, pad: true, arp: { p: [0, 1, 2, 1], e: 2 },
    drums: 'k.hhs.h.k.hks.h.', chords: 'Bm Bdim Bm Bm Bdim Bm Bm Bm',
    lead: 'b3:2 c#4:2 d4:2 e4:2 f#4:2 d4:2 f#4:4  f4:2 c#4:2 f4:4 e4:2 c4:2 e4:4  eb4:2 b3:2 eb4:4 d4:2 b3:2 d4:4  b4:2 c#5:2 d5:2 e5:2 f#5:2 d5:2 f#5:4  f5:2 c#5:2 f5:4 e5:2 c5:2 e5:4  eb5:2 b4:2 eb5:4 d5:2 b4:2 d5:4  b4:2 c#5:2 d5:2 e5:2 f#5:2 d5:2 f#5:2 b5:2  b5:2 f#5:2 d5:2 f#5:2 b4:8' },
  // Bažina / Swamp (team): Greensleeves (6/8)
  m2: { bpm: 132, bar: 12, u: 2, harm: -12, chorus: 7, w: { lead: 'triangle', harm: 'sine', bass: 'triangle', arp: 'sine', pad: 'sine' }, bass: 2, pad: true, arp: { p: [0, 1, 2], e: 2 },
    drums: 'k.h.h.s.h.h.', chords: 'Am G Am E Em G Am E',
    lead: 'c5:4 d5:2 e5:3 f5:1 e5:2  d5:4 b4:2 g4:3 a4:1 b4:2  c5:4 a4:2 a4:3 g#4:1 a4:2  b4:4 g#4:2 e4:4 a4:2  g5:6 f#5:2 e5:4  d5:4 b4:2 g4:3 a4:1 b4:2  c5:4 a4:2 a4:3 g#4:1 a4:2  b4:4 g#4:2 e4:4 a4:2' },
  // Ledovec / Glacier (team): Beethoven, Für Elise
  m3: { bpm: 132, bar: 12, u: 1, harm: 12, chorus: 5, w: { lead: 'triangle', harm: 'sine', bass: 'triangle', arp: 'sine', pad: 'sine' }, bass: 2, pad: true, arp: { p: [0, 1, 2, 3, 2, 1], e: 2 },
    drums: 'k.....h.....', chords: 'Am E Am Am Am E Am Am',
    lead: 'e5 d#5 e5 d#5 e5 b4 d5 c5 a4:2 -:2  c4 e4 a4 b4:3 e4 g#4 b4 c5:3  e5 d#5 e5 d#5 e5 b4 d5 c5 a4:2 -:2  c4 e4 a4 b4:3 e4 c5 b4 a4:3  e5 d#5 e5 d#5 e5 b4 d5 c5 a4:2 -:2  c4 e4 a4 b4:3 e4 g#4 b4 c5:3  e5 d#5 e5 d#5 e5 b4 d5 c5 a4:2 -:2  c4 e4 a4 b4:3 e4 c5 b4 a4:3' },
  // Navia / the raid (team): Bach, Toccata and Fugue in D minor
  r1: { bpm: 104, u: 2, lo: -12, harm: -12, chorus: 9, w: { lead: 'square', harm: 'sawtooth', bass: 'sawtooth', arp: 'square', pad: 'sawtooth' }, bass: 4, pad: true, arp: { p: [0, 1, 2, 1, 2, 1, 0, 1], e: 2 },
    drums: 'k.hhs.hkk.hks.hh', chords: 'Dm Dm Dm Dm Dm A7',
    lead: 'a5:2 g5:2 a5:12  -:2 g5:2 f5:2 e5:2 d5:2 c#5:2 d5:4  a4:2 g4:2 a4:12  -:2 g4:2 f4:2 e4:2 d4:2 c#4:2 d4:4  a5:2 g5:2 f5:2 e5:2 d5:2 c#5:2 d5:2 e5:2  f5:2 e5:2 d5:2 c#5:2 d5:4 a4:4' },
};

const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function midi(name) {
  const m = /^([a-g])(#|b)?(\d)$/.exec(name); if (!m) throw new Error('bad note ' + name);
  return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const freq = (m) => 440 * 2 ** ((m - 69) / 12);

export function melody(str, u) {
  const ev = []; let t = 0;
  for (const tok of str.trim().split(/\s+/)) {
    const [n, l] = tok.split(':'), len = l ? +l : u;
    if (n !== '-') ev.push([t, midi(n), len]);
    t += len;
  }
  return { ev, len: t };
}
const TRIAD = { '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], 7: [0, 4, 7, 10] };
export function chord(name) {
  const m = /^([A-G])(#|b)?(m|dim|7)?$/.exec(name); if (!m) throw new Error('bad chord ' + name);
  return { pc: (PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12, iv: TRIAD[m[3] || ''] };
}
const low = (pc) => (pc >= 7 ? pc - 12 : pc);

// -> { len (steps), step (seconds), voices: [{ w, vol, det, sus, ev: Map(step -> [[midi, steps]]) }], drums: 'k.hs…' (one bar), melLen }
export function compile(tr) {
  const bar = tr.bar || 16, cs = tr.chords.split(/\s+/).map(chord), len = cs.length * bar, w = tr.w || {};
  const mel = melody(tr.lead, tr.u || 4), voices = [];
  const add = (name, def, vol, ev, o = {}) => voices.push({ w: w[name] || def, vol, ev: ev.reduce((m, [t, n, l]) => m.set(t, [...(m.get(t) || []), [n, l]]), new Map()), ...o });
  const lead = mel.ev.map(([t, n, l]) => [t, n + (tr.lo || 0), l]);
  add('lead', 'square', 0.3, lead, { det: tr.chorus });
  if (tr.harm) add('harm', 'sawtooth', 0.1, lead.map(([t, n, l]) => [t, n + tr.harm, l]), { det: tr.chorus });
  const bass = [];
  cs.forEach((c, b) => { const n = tr.bass || 2, r = 36 + c.pc + (c.pc < 5 ? 12 : 0); for (let i = 0; i < n; i++) bass.push([b * bar + i * (bar / n), r + (n >= 2 && i % 2 ? 7 : 0), bar / n]); });
  add('bass', 'triangle', 0.5, bass);
  if (tr.pad) add('pad', 'triangle', 0.05, cs.flatMap((c, b) => c.iv.map((i) => [b * bar, 60 + low(c.pc) + i, bar])), { sus: true });
  if (tr.arp) {
    const arp = [];
    cs.forEach((c, b) => { for (let k = 0; k * tr.arp.e < bar; k++) { const i = tr.arp.p[k % tr.arp.p.length], n = c.iv.length; arp.push([b * bar + k * tr.arp.e, 48 + low(c.pc) + c.iv[i % n] + 12 * Math.floor(i / n), tr.arp.e]); } });
    add('arp', 'triangle', 0.1, arp);
  }
  return { len, step: 60 / tr.bpm / (tr.spq || 4), voices, drums: tr.drums || '', melLen: mel.len, bar };
}
