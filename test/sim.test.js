import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../shared/sim.js';
import { CLASSES, DUNGEON, DUNGEONS, WEAPONS, ARCH, DT } from '../shared/data.js';
import { newChar, power, charStats, applyRun, upgradeEquip, createChar, newProfile, xpNeed, runReward, validName, unlocked } from '../shared/meta.js';
import { runBot } from '../tools/bot.js';

const ch = (cls, level = 1) => ({ ...newChar(1, 't', cls), level });

test('every class and every weapon runs without throwing (all dungeons)', () => {
  for (const d of [...DUNGEONS.single, ...DUNGEONS.multi]) for (const c of CLASSES) {
    const sim = new Sim({ seed: 3, dungeonId: d.id, players: [ch(c.id)] });
    for (let i = 0; i < 20 * 30 && !sim.over; i++) { sim.setInput(1, Math.cos(i / 40), Math.sin(i / 40)); while (sim.players[0].pending.length) sim.choose(1, 0); sim.step(); }
  }
});

test('all weapons can be held and fire (kinds covered)', () => {
  const sim = new Sim({ seed: 5, dungeonId: 's1', players: [ch('bohatyr')] });
  const p = sim.players[0]; p.weapons = WEAPONS.slice(0, 5).map((w) => ({ id: w.id, lvl: 8, cd: 0, ang: 0 }));
  for (let i = 0; i < 20 * 60; i++) sim.step();
  assert.ok(p.dmgDone > 0);
  p.weapons = WEAPONS.slice(5, 10).map((w) => ({ id: w.id, lvl: 8, cd: 0, ang: 0 }));
  for (let i = 0; i < 20 * 60; i++) sim.step();
  p.weapons = WEAPONS.slice(10).map((w) => ({ id: w.id, lvl: 8, cd: 0, ang: 0 }));
  for (let i = 0; i < 20 * 30; i++) sim.step();
  assert.ok(sim.snapshot(1).me.w.length === 2);
});

test('the sim is deterministic: same seed + inputs = same state', () => {
  const run = () => {
    const sim = new Sim({ seed: 42, dungeonId: 's2', players: [ch('perun', 5), ch('golem', 9)] });
    for (let i = 0; i < 20 * 90; i++) { sim.setInput(1, Math.sin(i / 30), Math.cos(i / 50)); sim.setInput(2, Math.cos(i / 30), 0.3); for (const p of sim.players) while (p.pending.length) sim.choose(p.id, 1); sim.step(); }
    return JSON.stringify([sim.players.map((p) => [p.x, p.y, p.hp, p.kills, p.level]), sim.enemies.length, sim.picks.length]);
  };
  assert.equal(run(), run());
});

test('difficulty scales with the strongest player in the group, not the weakest', () => {
  const low = new Sim({ seed: 1, dungeonId: 'm1', players: [ch('bohatyr', 1), ch('bohatyr', 20)] });
  const solo = new Sim({ seed: 1, dungeonId: 'm1', players: [ch('bohatyr', 1)] });
  const lvl20 = new Sim({ seed: 1, dungeonId: 'm1', players: [ch('bohatyr', 20)] });
  assert.ok(low.eMul > solo.eMul * 1.4, 'level 1 + level 20 is much harder for the level 1 than solo');
  assert.ok(low.eMul > lvl20.eMul, 'a group is harder than the strong player alone');
  assert.ok(low.players[0].reward > 1.3 && low.players[0].reward > low.players[1].reward, 'the carried player earns a bigger bonus');
  assert.ok(power(ch('bohatyr', 100)) > power(ch('bohatyr', 20)));
});

test('co-op: a downed player is revived by standing next to him', () => {
  const sim = new Sim({ seed: 9, dungeonId: 'm1', players: [ch('bohatyr'), ch('bohatyr')] });
  const [a, b] = sim.players; a.dead = true; a.hp = 0; a.x = b.x = 0; a.y = b.y = 0;
  for (let i = 0; i < 20 * 4; i++) sim.step();
  assert.equal(a.dead, false); assert.ok(a.hp > 0);
});

test('boss kill clears the run; all players dead fails it', () => {
  const sim = new Sim({ seed: 2, dungeonId: 's1', players: [ch('golem', 30)] });
  sim.tick = 20 * 395; sim.step();
  const boss = sim.enemies.find((e) => e.boss); assert.ok(boss);
  sim.hurtEnemy(boss, 1e9, sim.players[0]);
  assert.equal(sim.over.cleared, true);
  const s2 = new Sim({ seed: 2, dungeonId: 's1', players: [ch('bohatyr')] });
  s2.players[0].dead = true; s2.step();
  assert.equal(s2.over.cleared, false);
});

test('bad inputs are ignored', () => {
  const sim = new Sim({ seed: 1, dungeonId: 's1', players: [ch('bohatyr')] });
  sim.setInput(1, NaN, 1); sim.setInput(1, Infinity, 0); sim.setInput(7, 1, 1); sim.setInput(1, 1e9, 1e9);
  const p = sim.players[0]; assert.ok(Math.hypot(p.dx, p.dy) <= 1.0001);
  assert.equal(sim.choose(1, 0), false); assert.equal(sim.choose(9, 0), false);
});

test('snapshots only carry what is near and stay small', () => {
  const sim = new Sim({ seed: 11, dungeonId: 's1', players: [ch('bohatyr')] });
  for (let i = 0; i < 20 * 120; i++) { sim.setInput(1, 1, 0); while (sim.players[0].pending.length) sim.choose(1, 0); sim.step(); }
  const s = sim.snapshot(1);
  assert.ok(JSON.stringify(s).length < 20000, 'snapshot ' + JSON.stringify(s).length);
  for (const e of s.e) assert.ok(Math.hypot(e[2] - sim.players[0].x, e[3] - sim.players[0].y) < 271);
});

test('the bot clears the first dungeon at level 1 (sanity of the balance)', () => {
  let wins = 0;
  for (const seed of [1, 2, 3, 4]) if (runBot({ dungeonId: 's1', chars: [ch('bohatyr')], seed }).over.cleared) wins++;
  assert.ok(wins >= 2, 'wins ' + wins);
});

test('meta: rewards, levels, unlocks, equipment, character limits', () => {
  const p = newProfile();
  assert.equal(createChar(p, 'a', 'bohatyr', 1), 'name');
  assert.equal(createChar(p, 'Ok', 'constructor', 1), 'class');
  for (let i = 0; i < 8; i++) assert.equal(createChar(p, 'Hero' + i, 'perun', i + 1), null);
  assert.equal(createChar(p, 'Nine', 'perun', 9), 'full');
  const c = p.chars[0];
  const rew = applyRun(p, c.id, { dungeonId: 's1', kills: 400, coinsPicked: 50, timeSec: 450, cleared: true });
  assert.ok(rew.xp > 300 && rew.coins > 100);
  assert.equal(p.progress.single, 2); assert.ok(unlocked(p, DUNGEONS.single[1])); assert.ok(!unlocked(p, DUNGEONS.single[2]));
  const failed = runReward({ timeSec: 100, kills: 50, coinsPicked: 10, cleared: false, dungeonId: 's1' }), won = runReward({ timeSec: 100, kills: 50, coinsPicked: 10, cleared: true, dungeonId: 's1' });
  assert.ok(failed.xp < won.xp);
  p.coins = 10; assert.equal(upgradeEquip(p, c.id, 'weapon'), 'poor');
  p.coins = 1000; assert.equal(upgradeEquip(p, c.id, 'weapon'), null); assert.equal(c.equip.weapon, 2);
  assert.equal(upgradeEquip(p, c.id, 'bogus'), 'bad');
  assert.ok(validName('Hráč 1') && !validName('x') && !validName('<b>'));
  assert.ok(xpNeed(50) > xpNeed(10));
});
