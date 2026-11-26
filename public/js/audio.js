// Tiny Web Audio synth: sound effects and a looping chiptune. Unlocks on every gesture until the context runs (iOS needs that).
let ctx = null, master = null, musicGain = null, muted = false, want = null, timer = null, step = 0;
const last = {};

function ensure() {
  if (ctx) return ctx;
  try { navigator.audioSession && (navigator.audioSession.type = 'playback'); } catch { /* old browser */ }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
  return ctx;
}
function unlock() {
  const c = ensure(); if (!c) return;
  if (c.state !== 'running') c.resume();
  const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
  if (c.state === 'running' && want) startMusic();
}
for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, unlock, { capture: true });

function tone(freq, dur, type = 'square', vol = 0.2, slide = 0, delay = 0, dest) {
  const c = ctx; if (!c || c.state !== 'running') return;
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2, hp = 800) {
  const c = ctx; if (!c || c.state !== 'running') return;
  const n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = b; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start();
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

// two-voice loop: bass + lead, a little different per track
const TRACKS = {
  menu: { bpm: 96, bass: [110, 0, 110, 0, 131, 0, 98, 0], lead: [440, 0, 523, 0, 494, 0, 392, 0, 440, 0, 523, 659, 587, 0, 494, 0] },
  battle: { bpm: 132, bass: [98, 98, 0, 98, 117, 0, 110, 110], lead: [392, 0, 466, 392, 0, 523, 466, 0, 392, 0, 349, 0, 392, 466, 523, 0] },
};
function tick() {
  const t = TRACKS[want]; if (!t || !ctx || ctx.state !== 'running') return;
  const b = t.bass[step % t.bass.length], l = t.lead[step % t.lead.length];
  if (b) { tone(b, 0.22, 'triangle', 0.5, 0, 0, musicGain); tone(b * 2, 0.12, 'square', 0.12, 0, 0, musicGain); }
  if (l) tone(l, 0.16, 'square', 0.3, 0, 0, musicGain);
  step++;
}
function startMusic() { clearInterval(timer); step = 0; const t = TRACKS[want]; if (t) timer = setInterval(tick, 60000 / t.bpm / 2); }
export function music(name) { if (name === want) return; want = name; clearInterval(timer); if (ctx && ctx.state === 'running' && name) startMusic(); }
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; }
export const isMuted = () => muted;
