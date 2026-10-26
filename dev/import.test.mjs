// 'I already have a plan' (5-25): link rules, building the programme from the
// model's tool input, and the request handler with a fake model, db and fetch.
// node --test "tracker/dev/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../supabase/functions/coach/import-core.js';
import * as F from '../supabase/functions/coach/coach-core.js';

test('exportUrl: only public Google Docs and Sheets, through Google’s export address', () => {
  assert.deepEqual(I.exportUrl('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit?usp=sharing'),
    { url: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=txt', kind: 'doc' });
  assert.deepEqual(I.exportUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=778'),
    { url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=csv&gid=778', kind: 'sheet' });
  for (const bad of ['http://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit', 'https://evil.example/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
    'https://docs.google.com.evil.example/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'not a url', ''])
    assert.equal(I.exportUrl(bad), null, bad);
  assert.equal(I.allowedFinalHost('https://doc-0s-1c-docs.googleusercontent.com/export/x'), true);
  assert.equal(I.allowedFinalHost('https://accounts.google.com/ServiceLogin'), false);
});

const TOOL = {
  name: 'Upper / lower from coach', days_per_week: 4,
  days: [
    { name: 'Upper A', exercises: [
      { name: 'Bench press', library_match: 'barbell bench press', kind: 'weight', sets: 4, reps_min: 6, reps_max: 8, rir: 2, rest_seconds: 180 },
      { name: 'Pull-ups', library_match: null, kind: 'bodyweight', sets: 3, reps_min: 8, reps_max: 8 },
      { name: 'Plank', kind: 'time', sets: 3, seconds: 45 },
      { name: 'Bench press', kind: 'weight', sets: 2, reps_min: 12 }
    ] },
    { name: '', exercises: [{ name: 'Back squat', kind: 'weight', sets: 99, reps_min: 5, reps_max: 3, rir: 9 }] },
    { name: 'Empty', exercises: [] }
  ],
  warnings: ['Percentages of 1RM were kept as sets and reps.']
};

test('buildProgramme: library names win, duplicates renamed, bad numbers clamped, empty days dropped, passes the engine check', () => {
  const r = I.buildProgramme(TOOL, ['Barbell bench press', 'Goblet squat'], { id: 'imp-x', createdAt: '2026-10-26T10:00:00Z' });
  const p = r.programme;
  assert.ok(p);
  assert.equal(p.name, 'Upper / lower from coach');
  assert.equal(p.perWeek, 4);
  assert.deepEqual(p.days.map(d => [d.key, d.name, d.ex.length]), [['d1', 'Upper A', 4], ['d2', 'Day 2', 1]]);
  const [bench, pull, plank, bench2] = p.days[0].ex;
  assert.deepEqual([bench.n, bench.sets, bench.rep, bench.rir, bench.rest, bench.load], ['Barbell bench press', 4, [6, 8], 2, 180, 'kg']);
  assert.deepEqual([pull.n, pull.load, pull.rep, pull.rir], ['Pull-ups', 'bw', [8, 8], 2]);
  assert.deepEqual([plank.kind, plank.note], ['time', '45 s']);
  assert.equal(bench2.n, 'Bench press', 'the unmatched second line keeps its own name (it differs from the library name)');
  const squat = p.days[1].ex[0];
  assert.deepEqual([squat.sets, squat.rep, squat.rir], [3, [5, 5], 2], 'sets 99 → default 3; max below min → min; RIR 9 → default 2');
  assert.deepEqual(r.warnings, ['Percentages of 1RM were kept as sets and reps.']);
  assert.deepEqual(r.unmatched, ['Pull-ups', 'Plank', 'Bench press', 'Back squat']);
  assert.equal(p.source, 'coach'); assert.equal(p.answers, undefined);
});

test('buildProgramme: nothing readable gives no programme and a reason', () => {
  const r = I.buildProgramme({ days: [], warnings: ['This is a shopping list, not a training plan.'] }, [], { id: 'imp-y', createdAt: '2026-10-26T10:00:00Z' });
  assert.equal(r.programme, null);
  assert.deepEqual(r.warnings, ['This is a shopping list, not a training plan.']);
});

const fakeDb = (ok = true) => ({ calls: 0, async importTake() { this.calls++; return ok ? { ok: true } : { ok: false, reason: 'limit_user' }; } });
const fakeModel = (input = TOOL) => ({ bodies: [], async create(body) { this.bodies.push(body); return { status: 200, body: { content: [{ type: 'tool_use', name: 'programme', input }] } }; } });

test('handleImport: pasted text reaches the model with the library; a programme comes back; nothing without input', async () => {
  const db = fakeDb(), model = fakeModel();
  const r = await F.handleImport({ kind: 'import', text: 'Upper A: bench 4x6-8 ...', library: ['Barbell bench press'] }, { db, model, fetch: async () => { throw new Error('no fetch for text'); }, now: () => new Date('2026-10-26T10:00:00Z') });
  assert.equal(r.status, 200);
  assert.equal(r.body.programme.days.length, 2);
  const msg = model.bodies[0];
  assert.equal(msg.tool_choice.name, 'programme');
  assert.match(msg.messages[0].content[0].text, /LIBRARY: Barbell bench press/);
  assert.match(msg.messages[0].content[1].text, /^PLAN \(pasted\):/);
  assert.equal((await F.handleImport({ kind: 'import' }, { db, model, fetch: async () => {} })).status, 400);
});

test('handleImport: the daily cap is checked before the model; bad links and images are refused without a call', async () => {
  const model = fakeModel();
  assert.equal((await F.handleImport({ kind: 'import', text: 'x' }, { db: fakeDb(false), model, fetch: async () => {} })).status, 429);
  assert.equal((await F.handleImport({ kind: 'import', link: 'https://evil.example/plan' }, { db: fakeDb(), model, fetch: async () => {} })).body.error, 'bad_link');
  assert.equal((await F.handleImport({ kind: 'import', image: { media_type: 'image/gif', data: 'AAAA' } }, { db: fakeDb(), model, fetch: async () => {} })).body.error, 'bad_image');
  assert.equal(model.bodies.length, 0);
});

test('handleImport: a private Doc (Google answers with a sign-in page) says so; a public one is read as text', async () => {
  const link = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit';
  const html = async () => ({ ok: true, url: 'https://accounts.google.com/ServiceLogin', headers: new Map([['content-type', 'text/html']]), text: async () => '<html>' });
  assert.equal((await F.handleImport({ kind: 'import', link }, { db: fakeDb(), model: fakeModel(), fetch: html })).body.error, 'link_private');
  const model = fakeModel(), seen = [];
  const ok = async (u) => { seen.push(u); return { ok: true, url: 'https://doc-0s.googleusercontent.com/x', headers: new Map([['content-type', 'text/plain']]), text: async () => 'Day 1: squat 5x5' }; };
  const r = await F.handleImport({ kind: 'import', link }, { db: fakeDb(), model, fetch: ok });
  assert.equal(r.status, 200);
  assert.deepEqual(seen, ['https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=txt']);
  assert.match(model.bodies[0].messages[0].content[1].text, /Day 1: squat 5x5/);
});

test('buildProgramme: an exact library name counts as matched even when the model gave no library_match', () => {
  const r = I.buildProgramme({ days: [{ name: 'Lower', exercises: [{ name: 'romanian deadlift', library_match: null, kind: 'weight', sets: 3, reps_min: 8, reps_max: 10 }] }], warnings: [] }, ['Romanian deadlift'], { id: 'imp-z', createdAt: '2026-10-26T10:00:00Z' });
  assert.equal(r.programme.days[0].ex[0].n, 'Romanian deadlift');
  assert.deepEqual(r.unmatched, []);
});
