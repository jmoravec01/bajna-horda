// Balance matrix: bots play every class through each dungeon at a typical power. Prints clear rates.
import { CLASSES } from '../shared/data.js';
import { runBot, geared } from './bot.js';

const mk = (cls, lvl, i = 1) => geared(cls, lvl, i);
// single player only: the team dungeons (shrines, 10 minutes) are balanced by the Rust balance test
const SCEN = [
  ['s1 lvl1', 's1', [1]], ['s2 lvl8', 's2', [8]], ['s3 lvl18', 's3', [18]],
];
const seeds = Number(process.argv[2] || 2), only = process.argv[3];
for (const [label, dun, lvls] of SCEN) {
  if (only && !label.startsWith(only)) continue;
  let win = 0, n = 0, t = 0; const lose = {};
  for (const cls of CLASSES) for (let s = 1; s <= seeds; s++) {
    const chars = lvls.map((l, i) => mk(CLASSES[(CLASSES.indexOf(cls) + i * 3) % 12].id, l, i + 1));
    const sim = runBot({ dungeonId: dun, chars, seed: s });
    n++; t += sim.over.time; if (sim.over.cleared) win++; else lose[Math.round(sim.over.time / 60)] = (lose[Math.round(sim.over.time / 60)] || 0) + 1;
  }
  console.log(label.padEnd(16), `clear ${Math.round(win / n * 100)}%  avg time ${Math.round(t / n)}s  deaths by minute`, JSON.stringify(lose));
}
