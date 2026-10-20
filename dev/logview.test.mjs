// What the Log tab shows (build 5-16, projects/ledger-ux-log-declutter.md).
// Pure rules in logview.js; engine results are invented here or computed by
// the real engine from invented sessions. node --test "tracker/dev/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../logview.js';
import * as E from '../engine.js';

const code = (c, sev, t = c + ' text') => ({ c, sev, t });
const fire = codes => ({ codes, fire: codes.some(x => x.sev === 'severe') || codes.filter(x => x.sev === 'mod').length >= 2 });

test('deload banner: hidden for no codes, D5 alone, and one moderate code (with or without D5)', () => {
  assert.equal(V.deloadBanner(fire([])), null);
  assert.equal(V.deloadBanner(fire([code('D5', 'info')])), null);
  for (const c of ['D3', 'D4', 'D6']) {
    assert.equal(V.deloadBanner(fire([code(c, 'mod')])), null, c);
    assert.equal(V.deloadBanner(fire([code(c, 'mod'), code('D5', 'info')])), null, c + ' + D5');
  }
});

test('deload banner: "Time to deload." for each severe code and for two moderates, with only the reasons that made it fire', () => {
  for (const c of ['D1', 'D2', 'CADENCE']) {
    const b = V.deloadBanner(fire([code(c, 'severe', 'why ' + c), code('D3', 'mod'), code('D5', 'info')]));
    assert.deepEqual(b, { kind: 'due', reasons: ['why ' + c] }, c);
  }
  assert.deepEqual(V.deloadBanner(fire([code('D3', 'mod', 'a'), code('D4', 'mod', 'b'), code('D5', 'info', 'c')])), { kind: 'due', reasons: ['a', 'b'] });
  assert.deepEqual(V.deloadBanner(fire([code('D4', 'mod', 'a'), code('D6', 'mod', 'b')])), { kind: 'due', reasons: ['a', 'b'] });
  const copy = V.deloadCopy(65);
  assert.equal(copy.due, '<b>Time to deload.</b> Sessions start lighter while this shows: 65% of working load, at the bottom of each rep range.');
  assert.doesNotMatch(copy.due, /⋯|Deload session/, 'no instruction the app already carries out');
});

test('deload banner: a scheduled deload week is the info banner only, whatever else fired, and goes once the week is done', () => {
  const dc = fire([code('BLOCK', 'severe'), code('D1', 'severe'), code('D5', 'info')]);
  assert.deepEqual(V.deloadBanner(dc), { kind: 'week', reasons: [] });
  assert.deepEqual(V.deloadBanner(dc, { weekDone: false }), { kind: 'week', reasons: [] });
  assert.equal(V.deloadBanner(dc, { weekDone: true }), null);
  assert.equal(V.deloadCopy(65).week, '<b>Deload week.</b> Every session this week starts lighter: 65% of working load, half the accessory sets, RIR 3–4. It should feel easy.');
});

test('the banner and Start agree: banner exactly when the engine fires (real engine, invented weeks)', () => {
  const W = (kg, reps, rir) => ({ kg, reps, rir, state: 'done', warmup: false });
  const s = (date, key, ex) => ({ schemaVersion: 5, date, key, name: key, exercises: ex, decisions: [], savedAt: date + 'T18:00:00Z' });
  /* Block week 3, one session (D5 only): no banner. */
  const h1 = [s('2026-10-20', 'd1', [{ n: 'Bench press (volume)', kind: 'weight', tplRir: 2, rep: [8, 8], sets: [W(50, 8, 2)] }])];
  const r1 = E.deloadCheck(h1, [], E.DEFAULTS.settings, '2026-10-22');
  assert.equal(r1.fire, false);
  assert.equal(V.deloadBanner(r1), null);
  /* Block week 6 (9 Nov): scheduled. */
  const r6 = E.deloadCheck(h1, [], E.DEFAULTS.settings, '2026-11-10');
  assert.equal(r6.fire, true);
  assert.equal(V.deloadBanner(r6).kind, 'week');
});

test('fatigue check in Settings lists every code with a verdict', () => {
  assert.deepEqual(V.fatigueCheck(fire([])), { items: [], verdict: 'Nothing to flag.' });
  assert.equal(V.fatigueCheck(fire([code('D3', 'mod'), code('D5', 'info')])).verdict, 'Not enough for a deload.');
  assert.equal(V.fatigueCheck(fire([code('D3', 'mod'), code('D5', 'info')])).items.length, 2);
  assert.equal(V.fatigueCheck(fire([code('D1', 'severe')])).verdict, 'Deload due: the next session starts lighter.');
});

test('phase note under Start: only in block weeks 1, 7, 13, 19, 20 and 21', () => {
  const shown = [];
  for (let w = 1; w <= 24; w++) {
    const info = E.blockInfo(E.addDays(E.BLOCK.start, (w - 1) * 7 + 2));
    assert.equal(info.week, w);
    if (V.phaseNote(info)) shown.push(w);
  }
  assert.deepEqual(shown, [1, 7, 13, 19, 20, 21]);
  assert.equal(V.phaseNote(E.blockInfo('2026-11-17')), 'New phase: Build. Heavy lifts are now one top set and two lighter back-offs, 3×4.');
  assert.equal(V.phaseNote(E.blockInfo('2026-11-10')), '', 'a deload week has its banner instead');
  assert.equal(V.phaseNote(null), '', 'before the block');
});

test('Settings block line: week, phase, next deload; deload week; after the last deload; after the block', () => {
  const line = d => V.blockSummary(E.blockInfo(d), E.BLOCK, E.PHASES, E.addDays, E.niceDate);
  assert.equal(line('2026-10-20'), 'Block week 3 of 20 · Base (weeks 1–6). Next deload: week 6, from 9 Nov.');
  assert.equal(line('2026-11-10'), 'Block week 6 of 20 · Base (weeks 1–6) · deload week.');
  assert.equal(line('2026-11-17'), 'Block week 7 of 20 · Build (weeks 7–12). Next deload: week 12, from 21 Dec.');
  assert.equal(line('2027-02-09'), 'Block week 19 of 20 · Test (weeks 19–20).');
  assert.equal(line('2027-02-23'), 'The 20-week block is over.');
  assert.equal(line('2026-10-01'), 'The winter block starts Mon 5 Oct.');
});

test('week rows: the other block days in plan order with ✓ / day / check pills, never "missed"; the heading counts done', () => {
  const plan = [
    { key: 'd1', name: 'Day 1 — Squat + bench volume', day: 'Tue', state: 'done' },
    { key: 'd2', name: 'Day 2 — Heavy bench + deadlift', day: 'Thu', state: 'missed' },
    { key: 'd3', name: 'Day 3 — Heavy squat + press', day: 'Sat', state: 'unverified' },
    { key: 'd4', name: 'Day 4 — Pull-ups, DB bench, rows, arms', day: 'Sun', state: 'upcoming' }];
  assert.deepEqual(V.weekRows(plan, 'd2').map(r => [r.key, r.pill.cls, r.pill.text]), [['d1', 'ok', '✓ Tue'], ['d3', 'warn', 'Sat · check'], ['d4', '', 'Sun']]);
  assert.equal(V.weekRows(plan, null).length, 4, 'week done: all four are rows');
  assert.equal(V.weekHeading(plan), 'This week · 1 of 4 done');
  assert.ok(!JSON.stringify(V.weekRows(plan, 'd4')).includes('missed'));
});

test('upload banner: only after a failed upload, or offline with something held', () => {
  const q = o => V.showQueueBanner({ github: 0, account: 0, githubBad: false, accountBad: false, online: true, ...o });
  assert.equal(q({ account: 1 }), false, 'just uploading: the header pill says so');
  assert.equal(q({ account: 1, accountBad: true }), true);
  assert.equal(q({ github: 2, githubBad: true }), true);
  assert.equal(q({ github: 2, accountBad: true }), false, 'a failed account upload says nothing about the GitHub queue');
  assert.equal(q({ github: 1, online: false }), true);
  assert.equal(q({ githubBad: true, accountBad: true }), false, 'nothing held');
});
