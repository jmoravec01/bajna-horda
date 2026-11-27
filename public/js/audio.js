import { SCORES, compile, freq } from './score.js';
// Tiny Web Audio synth: sound effects and a looping chiptune. Unlocks on every gesture until the context runs (iOS needs that).
let ctx = null, master = null, musicGain = null, muted = false, want = null, timer = null;
const last = {};

function ensure() {
  if (ctx) return ctx;
  try { navigator.audioSession && (navigator.audioSession.type = 'playback'); } catch { /* old browser */ }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  ctx.onstatechange = () => { if (ctx.state === 'running' && want && !song) startMusic(); };   // the first tap resumes the context: start the music then
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
  return ctx;
}
function unlock() {
  const c = ensure(); if (!c) return;
  if (c.state !== 'running') c.resume();
  const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
  if (c.state === 'running' && want && !song) startMusic();     // never restart a tune that is already playing
}
for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, unlock, { capture: true });

function tone(freq, dur, type = 'square', vol = 0.2, slide = 0, delay = 0, dest) {
  const c = ctx; if (!c || c.state !== 'running') return;
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2, hp = 800, dest, delay = 0) {
  const c = ctx; if (!c || c.state !== 'running') return;
  const n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = b; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(dest || master); s.start(ctx.currentTime + delay);
}
const SFX = {
  hit: () => tone(220, 0.05, 'square', 0.07, -80),
  kill: () => noise(0.08, 0.08, 600),
  gem: () => tone(880, 0.06, 'triangle', 0.12, 400),
  coin: () => { tone(1200, 0.05, 'square', 0.1); tone(1600, 0.08, 'square', 0.1, 0, 0.05); },
  heart: () => tone(500, 0.2, 'triangle', 0.2, 500),
  level: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, 'square', 0.14, 0, i * 0.08)),
  hurt: () => { tone(160, 0.18, 'sawtooth', 0.2, -100); noise(0.1, 0.12, 300); },
  die: () => tone(300, 0.6, 'sawtooth', 0.22, -250),
  boss: () => { tone(90, 0.8, 'sawtooth', 0.3, -30); tone(70, 0.9, 'square', 0.2, -20, 0.1); },
  boom: () => { noise(0.3, 0.2, 80); tone(120, 0.25, 'sawtooth', 0.15, -80); },
  zap: () => { noise(0.1, 0.12, 2000); tone(1500, 0.08, 'square', 0.08, -900); },
  pulse: () => tone(200, 0.12, 'sine', 0.2, 200),
  click: () => tone(660, 0.04, 'square', 0.1),
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.18, 'square', 0.15, 0, i * 0.1)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, 0, i * 0.15)),
};
export function sfx(name) {
  const now = performance.now();
  if (last[name] && now - last[name] < (name === 'hit' ? 70 : name === 'kill' ? 50 : 30)) return;
  last[name] = now; SFX[name]?.();
}

// music: each place plays its own score (score.js), scheduled a little ahead on the audio clock so the timing does not drift
let song = null, pos = 0, nextT = 0, tempo = 1;
function note(f, dur, type, vol, delay, sus, det) {
  const c = ctx, t = c.currentTime + delay, g = c.createGain(), n = det ? 2 : 1;
  g.connect(musicGain);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol / (det ? 1.4 : 1), t + 0.008);
  if (sus) g.gain.setValueAtTime(vol, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  for (let i = 0; i < n; i++) { const o = c.createOscillator(); o.type = type; o.frequency.value = f; if (det) o.detune.value = i ? det : -det; o.connect(g); o.start(t); o.stop(t + dur + 0.03); }
}
function drum(ch, d) {
  if (ch === 'k') tone(150, 0.14, 'sine', 0.6, -110, d, musicGain);
  else if (ch === 's') { noise(0.1, 0.25, 1500, musicGain, d); tone(190, 0.08, 'triangle', 0.2, -60, d, musicGain); }
  else if (ch === 'h') noise(0.03, 0.1, 7000, musicGain, d);
}
function pump() {
  if (!song || !ctx || ctx.state !== 'running') return;
  if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05;       // the tab slept: skip ahead instead of rushing
  while (nextT < ctx.currentTime + 0.3) {
    const d = nextT - ctx.currentTime;
    for (const v of song.voices) for (const [m, l] of v.ev.get(pos) || []) note(freq(m), l * song.step, v.w, v.vol, d, v.sus, v.det);
    if (song.drums) drum(song.drums[pos % song.drums.length], d);
    pos = (pos + 1) % song.len; nextT += song.step / tempo;
  }
}
function startMusic() { clearInterval(timer); song = compile(SCORES[want] || SCORES.menu); pos = 0; nextT = ctx.currentTime + 0.08; pump(); timer = setInterval(pump, 80); }
export function setTempo(x) { tempo = x; }   // 1 = written speed; the game speeds the tune up with every boss
export function music(name) { if (name === want) return; want = name; tempo = 1; clearInterval(timer); song = null; if (ctx && ctx.state === 'running' && name) startMusic(); }
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; }
export const isMuted = () => muted;

// every boss has its own voice: [oscillator steps [freq, dur, wave, vol, slide, delay]..., noise [dur, vol, highpass, delay]]. Small (mid-run) bosses sound higher and lighter than the last one.
const VOICE = {
  fox: { t: [[900, .08, 'square', .2, -300, 0], [1100, .08, 'square', .2, -400, .12], [1300, .14, 'square', .2, -600, .24]] },
  boar: { t: [[110, .2, 'sawtooth', .3, -30, 0], [90, .25, 'sawtooth', .3, -20, .22]], n: [.15, .1, 300, 0] },
  tur: { t: [[70, .8, 'sawtooth', .35, 25, 0], [75, .8, 'square', .2, 0, .02]], n: [.5, .1, 200, 0] },
  havran: { t: [[700, .1, 'sawtooth', .2, -200, 0], [650, .1, 'sawtooth', .2, -200, .14], [600, .16, 'sawtooth', .2, -250, .28]], n: [.4, .06, 1500, 0] },
  zmije: { n: [.8, .2, 3000, 0] },
  kun: { t: [[420, .15, 'sawtooth', .22, 500, 0], [900, .45, 'sawtooth', .2, -500, .15], [200, .5, 'sine', .15, 0, 0]] },
  mlok: { t: [[300, .45, 'sawtooth', .1, -100, 0]], n: [.55, .2, 1500, 0] },
  kohout: { t: [[600, .1, 'square', .2, 0, 0], [800, .1, 'square', .2, 0, .12], [700, .1, 'square', .2, 0, .24], [900, .38, 'square', .2, -300, .36]] },
  zarptak: { t: [[1200, .5, 'sine', .2, 800, 0], [1800, .45, 'triangle', .15, -800, .3]], n: [.5, .08, 3000, .1] },
  netopyr: { t: [[2400, .05, 'sine', .14, 500, 0], [2600, .05, 'sine', .14, 500, .08], [2800, .05, 'sine', .14, 500, .16], [3000, .08, 'sine', .14, 400, .24]] },
  rys: { t: [[500, .45, 'sawtooth', .2, 300, 0], [450, .3, 'sawtooth', .15, 200, .02]] },
  medved: { t: [[85, .9, 'sawtooth', .35, -20, 0], [130, .9, 'square', .15, -60, 0]], n: [.8, .12, 150, 0] },
  zaba: { t: [[180, .08, 'square', .25, 60, 0], [220, .08, 'square', .25, 0, .1], [170, .16, 'square', .25, -30, .2]] },
  vydra: { t: [[1400, .06, 'triangle', .2, 300, 0], [1600, .06, 'triangle', .2, 300, .1], [1800, .1, 'triangle', .2, 200, .2]] },
  stika: { t: [[300, .1, 'sine', .3, 400, 0], [400, .1, 'sine', .3, 400, .12], [500, .1, 'sine', .3, 400, .24], [250, .2, 'sine', .3, 300, .36]] },
  hranostaj: { t: [0, 1, 2, 3, 4, 5].map((i) => [2000 + (i % 2) * 300, .04, 'square', .12, 0, i * .07]) },
  vlk: { t: [[300, 1.1, 'sine', .28, 260, 0], [305, 1.1, 'triangle', .12, 260, 0]] },
  mamut: { t: [[220, .9, 'sawtooth', .3, 120, 0], [330, .9, 'square', .15, 100, 0]], n: [.5, .06, 600, .1] },
  kocour: { t: [[500, .3, 'triangle', .25, 300, 0], [800, .38, 'triangle', .25, -400, .28]] },
  sova: { t: [[330, .25, 'sine', .35, -40, 0], [300, .45, 'sine', .35, -40, .4]] },
  drak: { t: [[60, 1.1, 'sawtooth', .4, 40, 0], [120, 1.1, 'sawtooth', .25, -60, .05]], n: [1, .18, 200, .1] },
};
// vol 0..1 (distance), pan -1..1, semi: a smaller boss (higher, lighter)
export function roar(design, semi = false, vol = 1, pan = 0) {
  const c = ctx, v = VOICE[design]; if (!c || c.state !== 'running' || !v) return;
  const bus = c.createGain(); bus.gain.value = vol * (semi ? 0.75 : 1);
  let out = bus; if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; bus.connect(p); out = p; }
  out.connect(master); setTimeout(() => bus.disconnect(), 2500);
  const m = semi ? 1.35 : 1;
  for (const [f, d, w, g, sl, dl] of v.t || []) tone(f * m, d, w, g, sl * m, dl, bus);
  if (v.n) noise(v.n[0], v.n[1], v.n[2] * m, bus, v.n[3]);
}
