// Writes server-rs/data.json from shared/data.js so the Rust server and the browser share one set of numbers.
import { writeFileSync } from 'node:fs';
import * as D from '../shared/data.js';
const out = {
  consts: { DT: D.DT, MAX_CHARS: D.MAX_CHARS, MAX_PLAYERS: D.MAX_PLAYERS, RUN_SECONDS: D.RUN_SECONDS, MAX_LEVEL: D.MAX_LEVEL, MAX_WEAPONS: D.MAX_WEAPONS, MAX_PASSIVES: D.MAX_PASSIVES, MAX_ITEM_LVL: D.MAX_ITEM_LVL, MAX_EQUIP: D.MAX_EQUIP, MAX_PLUS: D.MAX_PLUS, TEAM_SECONDS: D.TEAM_SECONDS },
  classes: D.CLASSES.map(({ cs_d, en_d, cs, en, col, ...c }) => c),
  weapons: D.WEAPONS.map(({ d_cs, d_en, cs, en, ...w }) => w),
  passives: D.PASSIVES.map((p) => p.id),
  arch: D.ARCH,
  dungeons: [...D.DUNGEONS.single, ...D.DUNGEONS.multi].map((d) => ({ id: d.id, mode: d.mode, diff: d.diff, xp: d.xp, secs: d.secs, shrines: d.shrines, pace: d.pace, spawn: d.spawn, hit: d.hit, raid: !!d.raid, stages: d.stages === D.BOSS_STAGES ? 'single' : 'team',
    roster: d.roster.map(([arch, , at, weight]) => ({ arch, at, weight })), elite: d.elite[0], boss: { arch: d.boss.arch, hp: d.boss.hp, scale: d.boss.scale ?? 2.6 } })),
  boss_stages: { single: D.BOSS_STAGES, team: D.TEAM_STAGES },
  legend_of: D.LEGEND_OF,
  slots: D.SLOTS,
  arms: D.ARMS.map((w) => ({ id: w.id, tier: w.tier, dmg: w.dmg, perk: w.perk, perk_val: w.perkVal, need: w.need, price: w.price, legend: w.legend ?? null })),
};
writeFileSync(new URL('../server-rs/data.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('server-rs/data.json written');
