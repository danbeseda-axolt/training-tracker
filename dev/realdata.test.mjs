// Reads the real session files from training/log at test time. Nothing from
// them is copied into tracker/, which is published. Skips when the folder is
// absent (for example in the published copy). node --test "tracker/dev/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../engine.js';

const LOG = fileURLToPath(new URL('../../training/log/', import.meta.url));
const has = existsSync(LOG);
const read = f => JSON.parse(readFileSync(path.join(LOG, f), 'utf8'));
const files = has ? readdirSync(LOG).filter(f => /^\d{4}-\d{2}-\d{2}-.+\.json$/.test(f)) : [];
const F08 = '2026-09-08-upper-push.json', F15 = '2026-09-15-lower-a.json', F17 = '2026-09-17-upper-push.json';
const need = t => { if (!has || ![F08, F15, F17].every(f => files.includes(f))) { t.skip('training/log not present'); return false; } return true; };

/* Every key path in a is present in b with a deep-equal value. */
function deepContains(a, b, at = '$') {
  if (a === null || typeof a !== 'object') { assert.deepEqual(b, a, at); return; }
  assert.ok(b && typeof b === 'object', at + ' missing');
  if (Array.isArray(a)) assert.equal(b.length, a.length, at + ' length');
  for (const k of Object.keys(a)) { assert.ok(k in b, at + '.' + k + ' dropped'); deepContains(a[k], b[k], at + '.' + k); }
}

test('only the 17 Sep Upper Push matches the prefill pattern', t => {
  if (!need(t)) return;
  assert.equal(E.isSuspectPrefill(E.migrateSession(read(F17))), true);
  assert.equal(E.isSuspectPrefill(E.migrateSession(read(F08))), false);
  assert.equal(E.isSuspectPrefill(E.migrateSession(read(F15))), false);
});

test('Edit then Save on the real 17 Sep file keeps it unverified and out of the rules', t => {
  if (!need(t)) return;
  const raw = read(F17);
  const { session } = E.finishSession(E.editDraft(raw, 'training/log'), '2026-09-23T10:00:00Z');
  assert.equal(session.unverified, true);
  const aH = E.analysisHistory([read(F08), session], []);
  assert.ok(!aH.some(s => s.date === '2026-09-17'));
  assert.equal(E.lastFor(E.TEMPLATES['upper-push'].ex[0].n, aH, '2026-09-29').date, '2026-09-08');
});

test('migration keeps every original key and value, marks sets legacy, and is idempotent', t => {
  if (!need(t)) return;
  for (const f of files) {
    const raw = read(f), m = E.migrateSession(raw);
    deepContains(raw, m);
    for (const ex of m.exercises) for (const s of ex.sets) assert.equal(s.state, 'legacy', f);
    assert.deepEqual(E.migrateSession(m), m, f);
    assert.equal(m.schemaVersion, undefined, f);
  }
});

test('Bench on 2026-09-29 reads 8 Sep (R2 75 × 5) while 17 Sep is unverified, and RN once it is verified', t => {
  if (!need(t)) return;
  const bench = E.TEMPLATES['upper-push'].ex[0];
  const all = files.map(read);
  const aH = E.analysisHistory(all, []);
  assert.ok(!aH.some(s => s.date === '2026-09-17'));
  const prev = E.lastFor(bench.n, aH, '2026-09-29');
  assert.equal(prev.date, '2026-09-08');
  const a = E.targets(bench, aH, '2026-09-29');
  assert.deepEqual([a.rec.rule, a.rec.kg, a.rec.reps], ['R2', 75, 5]);
  assert.deepEqual(a.target, { kg: 75, reps: 5 });
  const verified = all.map(s => (s.date === '2026-09-17' ? { ...s, verified: true } : s));
  const b = E.targets(bench, E.analysisHistory(verified, []), '2026-09-29');
  assert.deepEqual([b.rec.rule, b.rec.kg, b.rec.reps], ['RN', 75, 5]);
});

test('every real file feeds a new session: planned sets with honest targets', t => {
  if (!need(t)) return;
  const aH = E.analysisHistory(files.map(read), []);
  const up = E.newSession('upper-push', aH, '2026-09-29', '2026-09-29T10:00:00Z');
  const by = Object.fromEntries(up.exercises.map(e => [e.n, e]));
  assert.equal(by['Overhead press'].rec.rule, 'R2', '8 Sep OHP: last set RIR 1 against target 2');
  assert.deepEqual([by['Weighted dip'].rec.rule, by['Weighted dip'].rec.kg], ['R2', 15], '8 Sep dip: top of range, last set RIR 1 against target 2');
  assert.deepEqual(by['Pallof press'].sets[0].target, { band: null, reps: 10 }, 'band never recorded, so ✓ must ask');
  const lo = E.newSession('lower-a', aH, '2026-09-26', '2026-09-26T10:00:00Z');
  const lb = Object.fromEntries(lo.exercises.map(e => [e.n, e]));
  assert.deepEqual(lb['Farmer’s carry'].sets[0].target, { kg: 24, metres: 40 });
  assert.equal(lb['Hanging knee/leg raise'].sets[0].target.kg, 0, 'legacy null kg on a bw+ lift reads as bodyweight');
  assert.ok(!('kg' in lb['Ab wheel rollout'].sets[0]));
  for (const ex of [...up.exercises, ...lo.exercises]) for (const s of ex.sets) assert.equal(s.state, 'planned');
});

test('history lists all three, the week of 2026-09-22 shows nothing done, and e1rm ignores unrated sets', t => {
  if (!need(t)) return;
  const all = files.map(read);
  assert.equal(E.mergedHistory(all, []).length, files.length);
  const plan = E.weekPlan(E.mergedHistory(all, []), '2026-09-23');
  assert.ok(plan.every(p => p.state !== 'done' && p.state !== 'unverified'));
  const b17 = E.migrateSession(read(F17)).exercises[0];
  assert.equal(E.sessionE1rm(b17), null, 'no RIR, no estimate');
  const b08 = E.migrateSession(read(F08)).exercises[0];
  assert.ok(Math.abs(E.sessionE1rm(b08) - 91.25) < 1e-9, 'best set is 75 × 5 @1.5');
});

test('editing the real 8 Sep file and saving it untouched changes no set and keeps its path', t => {
  if (!need(t)) return;
  const raw = read(F08);
  const d = { ...E.migrateSession(raw), editing: true, originPath: 'training/log/' + F08, origDate: raw.date, origKey: raw.key };
  const { session } = E.finishSession(d, '2026-09-23T10:00:00Z');
  assert.equal(session.exercises.length, raw.exercises.length);
  session.exercises.forEach((ex, i) => {
    assert.equal(ex.sets.length, raw.exercises[i].sets.length);
    ex.sets.forEach((s, j) => deepContains(raw.exercises[i].sets[j], s));
  });
  assert.deepEqual(session.decisions, raw.decisions);
  assert.equal(E.planSave(d, session, [raw], [], 'training/log', 'x').session.file, 'training/log/' + F08);
});
