// Health data from the phone (build 5-22). Pure rules in health.js.
// node --test "tracker/dev/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../health.js';
import * as E from '../engine.js';

const TZ = 'Europe/Prague';

test('localDay uses the time zone: 23:30 UTC on the 24th is the 25th in Prague (summer time)', () => {
  assert.equal(H.localDay('2026-10-24T23:30:00Z', TZ), '2026-10-25');
  assert.equal(H.localDay('nonsense', TZ), null);
});

test('asleepMinutes: stages without awake and in-bed time; a plain sample by its value unless marked awake', () => {
  assert.equal(H.asleepMinutes({ value: 480, stages: [{ stage: 'light', durationMinutes: 200 }, { stage: 'deep', durationMinutes: 90 }, { stage: 'rem', durationMinutes: 100 }, { stage: 'awake', durationMinutes: 30 }, { stage: 'inBed', durationMinutes: 60 }] }), 390);
  assert.equal(H.asleepMinutes({ value: 420 }), 420);
  assert.equal(H.asleepMinutes({ value: 30, sleepState: 'awake' }), 0);
});

test('dailyRows: sleep on the morning it ends, averages per day, last weight of the day, impossible values dropped', () => {
  const rows = H.dailyRows({
    sleep: [{ value: 400, startDate: '2026-10-23T21:30:00Z', endDate: '2026-10-24T05:10:00Z' }],
    restingHeartRate: [{ value: 56, startDate: '2026-10-24T06:00:00Z' }, { value: 58, startDate: '2026-10-24T18:00:00Z' }, { value: 900, startDate: '2026-10-24T19:00:00Z' }],
    heartRateVariability: [{ value: 41, startDate: '2026-10-24T03:00:00Z' }],
    steps: [{ value: 8000, startDate: '2026-10-23T22:00:00Z' }],
    weight: [{ value: 82.4, startDate: '2026-10-24T05:00:00Z' }, { value: 81.9, startDate: '2026-10-24T20:00:00Z' }]
  }, TZ);
  assert.deepEqual(rows, [{ day: '2026-10-24', sleep_min: 400, resting_hr: 57, hrv_ms: 41, steps: 8000, weight_kg: 81.9 }]);
});

test('recovery: usual level from the 28 days before the last week; flags only on a pattern', () => {
  const rows = [];
  for (let i = 34; i >= 0; i--) {
    const day = E.addDays('2026-10-25', -i);
    const recent = i < 7;
    rows.push({ day, sleep_min: recent && i < 3 && i !== 1 ? 330 : 450, resting_hr: recent ? 60 : 54, hrv_ms: recent ? 34 : 45, steps: 9000, weight_kg: 82 });
  }
  const r = H.recovery(rows, '2026-10-25', E.addDays);
  assert.equal(r.lastNight, 330);
  assert.equal(r.rhrUsual, 54); assert.equal(r.rhr7, 60);
  assert.deepEqual(r.flags, ['short-sleep', 'rhr-high', 'hrv-low']);
  const calm = H.recovery(rows.map(x => ({ ...x, sleep_min: 450, resting_hr: 54, hrv_ms: 45 })), '2026-10-25', E.addDays);
  assert.deepEqual(calm.flags, []);
  assert.equal(H.recovery([], '2026-10-25', E.addDays).lastNight, null);
});

test('hm formats minutes', () => {
  assert.equal(H.hm(400), '6 h 40');
  assert.equal(H.hm(null), '—');
});

test('advice: lighter on a pattern with the numbers; a single short night is only a note; nothing otherwise', () => {
  const mk = (sleeps) => sleeps.map((m, i) => ({ day: E.addDays('2026-10-26', -i), sleep_min: m, resting_hr: null, hrv_ms: null, steps: null, weight_kg: null }));
  const a = H.advice(mk([330, 450, 340, 450, 450]), '2026-10-26', E.addDays);
  assert.equal(a.level, 'lighter');
  assert.deepEqual(a.why, ['Short sleep: 5 h 30, 7 h 30, 5 h 40 in the last three nights.']);
  assert.deepEqual(H.advice(mk([320, 450, 450]), '2026-10-26', E.addDays), { level: 'note', why: ['Short night: 5 h 20. Fine to train; end a set when form breaks.'] });
  assert.equal(H.advice(mk([450, 450, 450]), '2026-10-26', E.addDays), null);
  assert.equal(H.advice([], '2026-10-26', E.addDays), null);
});
