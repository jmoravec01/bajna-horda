// Bot that plays a run headless: flees from enemies, collects gems, picks upgrades. Used for balance checks and tests.
import { Sim } from '../shared/sim.js';
import { DT, CLASSES } from '../shared/data.js';
import { newChar } from '../shared/meta.js';

export function botStep(sim, p) {
  if (p.dead) { sim.setInput(p.id, 0, 0); return; }
  while (p.pending.length) sim.choose(p.id, 0);
  let fx = 0, fy = 0;
  for (const e of sim.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y, d2 = dx * dx + dy * dy, R = 60 + e.r;
    if (d2 < R * R && d2 > 0.01) { const d = Math.sqrt(d2), w = (R - d) / R; fx += dx / d * w * w * (e.boss ? 2 : 1); fy += dy / d * w * w * (e.boss ? 2 : 1); }
  }
  for (const b of sim.ebul) { const dx = p.x - b.x, dy = p.y - b.y, d2 = dx * dx + dy * dy; if (d2 < 900 && d2 > 0.01) { const d = Math.sqrt(d2); fx += dx / d * 0.8; fy += dy / d * 0.8; } }
  let best = null, bd = 1e9;
  for (const g of sim.picks) { const d = (g.x - p.x) ** 2 + (g.y - p.y) ** 2; if (d < bd && d < 90 * 90) { bd = d; best = g; } }
  if (best && Math.hypot(fx, fy) < 0.6) { const d = Math.sqrt(bd) || 1; fx += (best.x - p.x) / d * 0.7; fy += (best.y - p.y) / d * 0.7; }
  if (Math.hypot(fx, fy) < 0.05) { const a = sim.tick * 0.02 + p.id; fx = Math.cos(a) * 0.3; fy = Math.sin(a) * 0.3; }
  sim.setInput(p.id, fx, fy);
}

export function runBot({ dungeonId, chars, seed = 1, maxSec = 900 }) {
  const sim = new Sim({ seed, dungeonId, players: chars });
  while (!sim.over && sim.tick * DT < maxSec) { for (const p of sim.players) botStep(sim, p); sim.step(); }
  return sim;
}

if (process.argv[1] && process.argv[1].endsWith('bot.js')) {
  const [dun = 's1', lvl = '1', cls = 'bohatyr'] = process.argv.slice(2);
  const t0 = Date.now();
  const list = cls === 'all' ? CLASSES.map((c) => c.id) : cls.split(',');
  for (const c of list) {
    const ch = newChar(1, 'bot', c); ch.level = +lvl;
    const lv = +lvl; for (const k of Object.keys(ch.equip)) ch.equip[k] = Math.min(20, 1 + Math.floor(lv / 6));
    const sim = runBot({ dungeonId: dun, chars: [ch] });
    const p = sim.players[0];
    console.log(c.padEnd(10), 'cleared', sim.over.cleared, 'time', Math.round(sim.over.time), 'lvl', p.level, 'kills', p.kills, 'hp', Math.round(p.hp) + '/' + p.maxHp, 'weapons', p.weapons.map((w) => w.id + w.lvl).join(','));
  }
  console.log('ms', Date.now() - t0);
}
