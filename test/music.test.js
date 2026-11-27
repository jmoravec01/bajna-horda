import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCORES, compile, midi } from '../public/js/score.js';
import { DUNGEON } from '../shared/data.js';

test('every place has a score, and every voice of it fits its bars exactly', () => {
  for (const id of ['menu', ...Object.keys(DUNGEON)]) {
    const tr = SCORES[id]; assert.ok(tr, id);
    const s = compile(tr);
    assert.equal(s.melLen, s.len, `${id}: melody is ${s.melLen} steps, chords say ${s.len}`);
    assert.ok(!s.drums || s.drums.length === s.bar, `${id}: drum pattern must be one bar`);
    for (const v of s.voices) for (const [t, [[n, l]]] of v.ev) { assert.ok(t >= 0 && t + l <= s.len + 1e-9, `${id} note out of the loop at ${t}`); assert.ok(n > 20 && n < 100, `${id} note ${n} out of range`); }
    assert.ok(s.step > 0.05 && s.step < 0.5, id);
  }
});

test('team dungeons sound richer than single ones', () => {
  const n = (id) => compile(SCORES[id]).voices.length;
  for (const d of Object.keys(DUNGEON)) if (DUNGEON[d].mode === 'multi') assert.ok(n(d) >= 5, d);
  assert.equal(midi('a4'), 69); assert.equal(midi('c#5'), 73);
});
