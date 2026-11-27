import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../shared/sim.js';
import { LEGEND_OF, CLASSES, DUNGEON, DUNGEONS, WEAPONS, ARCH, DT, BOSS_STAGES, ARMS, ARM, ARM_TIERS, MAX_PLUS, starterOf } from '../shared/data.js';
import { newChar, power, charStats, applyRun, upgradeEquip, armError, armSell, armOf, armDmg, armUpCost, fixArms, createChar, newProfile, xpNeed, runReward, validName, unlocked } from '../shared/meta.js';
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
  sim.tick = 20 * 301; for (let i = 0; i < 3; i++) sim.step();          // a late start spawns the three bosses one after another
  const boss = sim.enemies.find((e) => e.boss && e.stage === 2); assert.ok(boss);
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
  p.coins = 10; assert.equal(upgradeEquip(p, c.id, 'armor'), 'poor');
  p.coins = 1000; assert.equal(upgradeEquip(p, c.id, 'armor'), null); assert.equal(c.equip.armor, 2);
  assert.equal(upgradeEquip(p, c.id, 'weapon'), 'bad');
  assert.equal(upgradeEquip(p, c.id, 'bogus'), 'bad');
  assert.ok(validName('Hráč 1') && !validName('x') && !validName('<b>'));
  assert.ok(xpNeed(50) > xpNeed(10));
});

test('armory: 48 shop weapons + 7 legendary, unique ids, buy / equip / upgrade to +9, stronger weapon = stronger hero', () => {
  assert.equal(ARMS.length, 55); assert.equal(new Set(ARMS.map((w) => w.id)).size, 55); assert.equal(ARMS.filter((w) => !w.legend).length, 48);
  assert.ok(CLASSES.every((k) => ARM[starterOf(k.id)]?.tier === 1));                  // every class has a tier-1 starter
  assert.equal(new Set(CLASSES.map((k) => starterOf(k.id))).size, CLASSES.length);   // and no two share one
  assert.equal(starterOf('krakonos'), 'hammer1');                                     // the tank is not given a wooden staff
  const p = newProfile(); createChar(p, 'Kuba', 'perun', 1); const c = p.chars[0];
  assert.deepEqual([c.held, c.arms], ['axe1', { axe1: 0 }]);
  p.coins = 1e6; c.level = 50;
  assert.equal(armError(p, 1, 'buy', 'sword4'), null); assert.equal(armError(p, 1, 'buy', 'sword4'), 'owned');
  const before = charStats(c).dmg, pw = power(c);
  assert.equal(armError(p, 1, 'equip', 'sword4'), null); assert.equal(c.held, 'sword4');
  assert.ok(charStats(c).dmg > before * 1.5 && power(c) > pw);
  for (let i = 0; i < MAX_PLUS; i++) assert.equal(armError(p, 1, 'up', 'sword4'), null);
  assert.equal(armError(p, 1, 'up', 'sword4'), 'max'); assert.equal(c.arms.sword4, MAX_PLUS);
  const [w, plus] = armOf(c); assert.ok(Math.abs(armDmg(w, plus) - w.dmg * 1.45) < 1e-9);
  assert.ok(armUpCost(w, 8) > armUpCost(w, 0));
  c.level = 1; assert.equal(armError(p, 1, 'buy', 'axe2'), 'level');
  p.coins = 0; c.level = 50; assert.equal(armError(p, 1, 'buy', 'axe2'), 'poor');
  const old = { equip: { weapon: 5, armor: 2, ring: 1, boots: 1 }, level: 1 }; fixArms(old);   // legacy numeric weapon level
  assert.deepEqual([old.held, old.arms, 'weapon' in old.equip], ['staff1', { staff1: 4 }, false]);
  const tank = { cls: 'krakonos', equip: {}, level: 3, arms: { staff1: 5, sword2: 1 }, held: 'staff1' }; fixArms(tank);   // pre-class-starter character: staff becomes the class weapon, +5 kept
  assert.deepEqual([tank.held, tank.arms], ['hammer1', { hammer1: 5, sword2: 1 }]); fixArms(tank); assert.deepEqual(tank.arms, { hammer1: 5, sword2: 1 });
  assert.ok(ARM_TIERS.every((t, i) => !i || t.dmg > ARM_TIERS[i - 1].dmg));
});

test('magnet: pulls only xp gems and coins, never chests (upgrades) or hearts', () => {
  const sim = new Sim({ seed: 9, dungeonId: 's1', players: [ch('bohatyr')] });
  const p = sim.players[0]; p.passives.magnet = 5; sim.recalc(p);
  sim.drop(p.x + 20, p.y, 6, 1); sim.drop(p.x, p.y + 20, 4, 1); sim.drop(p.x - 20, p.y, 3, 5); sim.drop(p.x, p.y - 20, 0, 1);   // all inside the pickup radius
  sim.drop(p.x + 8, p.y, 5, 1);                                                                                                      // a magnet item, within touching distance
  sim.drop(p.x + 150, p.y + 150, 3, 5); sim.drop(p.x - 150, p.y + 150, 6, 1);                                                          // far coin and far chest
  for (let i = 0; i < 100; i++) { sim.setInput(1, 0, 0); sim.step(); }
  assert.ok(p.coins >= 10, 'both coins were pulled in, even the far one'); assert.equal(p.pending.length, 0);
  assert.deepEqual(sim.picks.map((g) => g.tier).sort(), [4, 6, 6]);       // heart and both chests are still lying there
});

test('three bosses at 1:00, 3:00 and 5:00, each tougher; only the last one clears the dungeon', () => {
  const sim = new Sim({ seed: 4, dungeonId: 's1', players: [ch('golem', 30)] });
  const hp = [], seen = [];
  for (const [i, at] of BOSS_STAGES.map((b) => b.at).entries()) {
    sim.tick = Math.round(at * 20) + 1; sim.step();
    const b = sim.enemies.find((e) => e.boss && e.stage === i); assert.ok(b, 'boss ' + i);
    assert.ok(!sim.enemies.some((e) => e.boss && e.stage === i + 1), 'the next one is not there yet');
    hp.push(b.maxHp); seen.push(b.type);
    if (i < 2) { sim.hurtEnemy(b, 1e9, sim.players[0]); assert.equal(sim.over, null); assert.ok(sim.picks.some((g) => g.tier === 6), 'a chest'); }
  }
  assert.ok(hp[0] < hp[1] && hp[1] < hp[2]); assert.deepEqual(seen, [6, 7, 8]);
  assert.ok(sim.snapshot(1).me.boss > 0);
});

test('no run is longer than HARD_END and the pacing keeps getting harder', () => {
  const a = new Sim({ seed: 3, dungeonId: 's1', players: [ch('bohatyr', 10)] });
  a.tick = 20 * 30; a.step(); const early = a.spawn([a.players[0]], 0, false).maxHp;
  a.tick = 20 * 280; a.step(); const late = a.spawn([a.players[0]], 0, false).maxHp;
  assert.ok(late > early * 2.5);
  a.tick = 20 * 481; a.step(); assert.equal(a.over?.cleared, false);
});

test('merchant: a sale pays a bad rate, the held and the starter weapon stay, a legendary weapon cannot be bought', () => {
  const p = newProfile(); createChar(p, 'Kuba', 'perun', 1); const c = p.chars[0]; c.level = 50; p.coins = 1e6;
  assert.deepEqual(Object.keys(LEGEND_OF).sort(), Object.keys(DUNGEON).sort());          // every dungeon has its own legendary weapon
  assert.ok(Object.values(LEGEND_OF).every((id) => ARM[id].legend && ARM[id].dmg > ARM.sword4.dmg));
  assert.equal(armError(p, 1, 'buy', LEGEND_OF.s1), 'bad');
  assert.equal(armError(p, 1, 'buy', 'axe2'), null); assert.equal(armError(p, 1, 'up', 'axe2'), null);
  const paid = armSell(ARM.axe2, 1); assert.ok(paid < ARM.axe2.price / 2 && paid >= ARM.axe2.price / 4);
  const coins = p.coins; assert.equal(armError(p, 1, 'sell', 'axe2'), null); assert.equal(p.coins, coins + paid); assert.equal(c.arms.axe2, undefined);
  assert.equal(armError(p, 1, 'sell', 'axe2'), 'bad');
  assert.equal(armError(p, 1, 'sell', 'axe1'), 'held');
  armError(p, 1, 'buy', 'axe2'); armError(p, 1, 'equip', 'axe2'); assert.equal(armError(p, 1, 'sell', 'axe2'), 'held');
});

test('team dungeons: 10-minute runs with three shielded bosses, the raid is a multiplayer dungeon that is much harder', () => {
  for (const d of DUNGEONS.multi) { assert.equal(d.secs, 600); assert.ok(d.shrines >= 3); assert.equal(d.stages.length, 3); assert.equal(d.stages[2].at, 540); }
  for (const d of DUNGEONS.single) { assert.equal(d.secs, 300); assert.equal(d.shrines, 0); }
  const raid = DUNGEON.r1; assert.ok(raid.raid && raid.shrines === 4 && raid.diff > 1.5 * DUNGEON.m3.diff && raid.spawn > DUNGEON.m3.spawn);
  assert.equal(DUNGEONS.multi.at(-1), raid);                                                  // opens after the last ordinary one
});

test('every boss has its own Czech first name, three per dungeon', () => {
  const all = Object.values(DUNGEON).flatMap((d) => { assert.equal(d.boss.names.length, d.stages.length); return d.boss.names; });
  assert.equal(new Set(all).size, 21); assert.ok(all.every((n) => /^\p{Lu}\p{L}+$/u.test(n)));
});

test('every boss has its own animal design', async () => {
  const { BOSS_DESIGNS } = { BOSS_DESIGNS: [...(await import('node:fs')).readFileSync(new URL('../public/js/bosses.js', import.meta.url), 'utf8').matchAll(/^  (\w+): \[\[/gm)].map((m) => m[1]) };
  const all = Object.values(DUNGEON).flatMap((d) => d.boss.designs);
  assert.equal(all.length, 21); assert.equal(new Set(all).size, 21);
  for (const id of all) assert.ok(BOSS_DESIGNS.includes(id), id);
});

test('gems and coins that land together fuse into one pickup with the same total', () => {
  const sim = new Sim({ seed: 5, dungeonId: 's1', players: [ch('bohatyr')] });
  sim.picks = [];
  sim.drop(100, 100, 0, 1); sim.drop(103, 101, 0, 1); sim.drop(101, 99, 0, 1); sim.drop(300, 300, 0, 1); sim.drop(100, 100, 3, 1); sim.drop(100, 100, 4, 0);
  assert.equal(sim.picks.length, 4);
  assert.equal(sim.picks[0].v, 3); assert.equal(sim.picks[0].tier, 1);
  assert.equal(sim.picks.reduce((n, g) => n + (g.tier <= 2 ? g.v : 0), 0), 4);
});
