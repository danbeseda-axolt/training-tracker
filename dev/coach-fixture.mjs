// What the engine decides for Dan's coach plan, from an INVENTED history (no
// real session data: tracker/ is public). Shared by the frozen fixture
// (fixtures/coach-plan-5-9.json, written once by the build 5-9 engine, commit
// 5aede14) and the test that checks today's engine still gives exactly that.
// Regenerate only on purpose: node tracker/dev/coach-fixture.mjs <engine.js> <out.json>

const W = (kg, reps, rir) => ({ kg, reps, rir, warmup: false, state: 'done', doneAt: '2026-10-01T10:00:00Z', via: 'tick', target: null });
const X = (n, sets, more = {}) => ({ n, kind: 'weight', load: 'kg', targetSets: sets.length, sets, ...more });
const S5 = (date, key, exercises, more = {}) => ({ schemaVersion: 5, date, key, name: key, isDeload: false, exercises, decisions: [], savedAt: date + 'T18:00:00Z', ...more });

/* Invented (dates, weights and efforts are made up, not anyone's log): a
   legacy-plan fortnight with a deload before the block, then week-1 ramps
   and a week-2 session, so the fixture still covers R1, R3, RC, the phase-2
   back-offs, the block deload week and the week plan. */
export const HISTORY = [
  S5('2026-09-21', 'upper-push', [X('Bench press (heavy)', [W(52.5, 5, 3), W(52.5, 5, 3), W(52.5, 5, 3), W(52.5, 5, 3)]), X('Overhead press', [W(30, 8, 2), W(30, 8, 2), W(30, 7, 1)])]),
  S5('2026-09-23', 'lower-a', [X('High-bar back squat', [W(62.5, 5, 2), W(62.5, 5, 2), W(62.5, 5, 2), W(62.5, 4, 1)]), X('Bulgarian split squat', [W(8, 8, 2), W(8, 8, 2), W(8, 8, 2)])]),
  S5('2026-09-25', 'lower-b', [X('Trap-bar / conventional DL', [W(110, 5, 3), W(110, 5, 3), W(110, 5, 3)])], { isDeload: true }),
  S5('2026-10-07', 'd1', [X('High-bar back squat (volume)', [W(57.5, 8, 2)], { cal: 'ramp' }), X('Bench press (volume)', [W(47.5, 8, 2)], { cal: 'ramp' }),
    X('Chin-up', [W(0, 8, 2), W(0, 8, 2), W(0, 8, 2)], { load: 'bw+' }), X('Hammer curl', [W(10, 10, 1), W(10, 10, 1), W(10, 9, 0)])]),
  S5('2026-10-09', 'd2', [X('Bench press (heavy)', [W(57.5, 5, 2)], { cal: 'ramp' }), X('Trap-bar / conventional DL', [W(125, 5, 2)], { cal: 'ramp' }),
    X('Weighted dip', [W(2.5, 8, 2), W(2.5, 8, 2), W(2.5, 8, 3)], { load: 'bw+' })], { sessionRpe: 7 }),
  S5('2026-10-14', 'd1', [X('High-bar back squat (volume)', [W(57.5, 8, 2), W(57.5, 8, 2), W(57.5, 8, 2)]), X('Bench press (volume)', [W(47.5, 8, 2), W(47.5, 8, 1), W(47.5, 7, 1)])])
].sort((a, b) => (a.date < b.date ? 1 : -1));

export const DATES = ['2026-09-30', '2026-10-10', '2026-10-15', '2026-11-10', '2026-11-18', '2027-02-16'];
export const KEYS = ['d1', 'd2', 'd3', 'd4', 'skill', 'upper-push'];

/* The decisions, not the whole objects: names, set counts, targets, rules,
   ramp / back-off flags, block fields, deload codes and the week plan. */
/** @param {any} E an engine module */
export function project(E) {
  const out = {};
  for (const date of DATES) {
    const H = HISTORY.filter(h => h.date < date);
    const r = out[date] = {};
    r.plan = E.weekPlan(H, date).map(p => [p.key, p.date, p.state]);
    r.next = E.nextTemplate(E.weekPlan(H, date));
    const dc = E.deloadCheck(H, [], E.DEFAULTS.settings, date);
    r.deload = [dc.fire, dc.codes.map(c => c.c)];
    r.week = E.sessionsInWeek(H, E.weekOf(date)).length;
    for (const k of KEYS) for (const dl of [false, true]) {
      const s = E.newSession(k, H, date, date + 'T09:00:00Z', dl);
      const moved = E.retarget(E.clone({ ...s, date: E.addDays(date, -1) }), H);
      r[k + (dl ? '/deload' : '')] = {
        bw: s.blockWeek ?? null, ph: s.phase ?? null, dl: s.isDeload,
        ex: s.exercises.map(e => [e.n, e.sets.length, e.sets.map(x => x.target), e.rec ? [e.rec.rule, e.rec.kg ?? null, e.rec.reps ?? null] : null, e.cal ?? null, e.backoff ?? null, e.routine ?? null]),
        moved: moved.exercises.map(e => [e.rec ? e.rec.rule : null, e.sets[0] ? e.sets[0].target : null])
      };
    }
  }
  return out;
}

/* Writes the fixture from a given engine file (dev only). */
if (process.argv[1] && process.argv[1].endsWith('coach-fixture.mjs') && process.argv[2]) {
  const { pathToFileURL } = await import('node:url');
  const { writeFileSync } = await import('node:fs');
  const E = await import(pathToFileURL(process.argv[2]).href);
  writeFileSync(process.argv[3], JSON.stringify(project(E)) + '\n');
  console.log('wrote', process.argv[3]);
}
