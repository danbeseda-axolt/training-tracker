# Ledger — training tracker

**As of:** 2026-10-04 (v5, build 5-6: the winter strength plan)

Phone-first training log, built to be used one-handed in the gym. **The GitHub
repo is the source of truth**; the phone holds a cache and a queue of anything
not yet pushed.

Why it is built this way rather than on a hosted database:
[decisions/2026-09-09-training-tracker-architecture.md](../decisions/2026-09-09-training-tracker-architecture.md).
Why v5 stopped pre-filling weights:
[decisions/2026-09-23-ledger-v5-confirmed-targets.md](../decisions/2026-09-23-ledger-v5-confirmed-targets.md).

## What changed in v5, and why

The first three weeks of real data showed the app could not tell a lifted set
from an untouched suggestion. The 2026-09-17 Upper Push was saved 11 seconds
after it was started, every set equal to the prefill, no RIR anywhere, and all
five decisions recorded as "accepted". v4 turned any prefilled number into an
observation when Finish was pressed.

v5 separates the two. A set is **planned** (a target, shown grey) until Dan
confirms it, and only confirmed sets count for anything. The logging screen
was rebuilt around that one tap.

## What changed on 2026-10-04 (build 5-6): the winter strength plan

The tracker moved from the Programme v2 rotation (Upper Push, Lower B, Upper
Pull, Lower A, plus a daily floor) to the **20-week, four-day block that starts
Monday 2026-10-05**. No file format change: `schemaVersion` stays 5 and every
file already logged reads and edits as before. The plan itself is in the
training notes; this section is what the app does with it.

### The four sessions

Fixed order, the next one on the next free day. The Log tab offers one big
button (today's, else the earliest not yet done this week) and the rest as rows.

| Key | Session | Day | Contents |
|---|---|---|---|
| `d1` | Day 1 — Squat + bench volume | Tue | squat (volume) 3×8, bench (volume) 3×8, chin-up, DB row, hammer curl, seated compression lift-offs |
| `d2` | Day 2 — Heavy bench + deadlift | Thu | bench (heavy) 3×5, conventional deadlift 3×5 at RIR 2+, weighted dip, overhead triceps extension, hip thrust, L-sit tuck-to-extend |
| `d3` | Day 3 — Heavy squat + press | Sat | squat 3×5, overhead press, pull-up grease-the-groove, Bulgarian split squat, curl + pushdown superset, hanging raise |
| `d4` | Day 4 — Pull-ups, DB bench, rows, arms | Sun | pull-up EMOM 10×3, DB bench, row 4×10, incline curl, triceps, dead hang (+ a strict max-rep pull-up test in week 1 only) |
| `skill` | Skill day (optional) | Fri or Mon | compression/L-sit, handstand, flexibility incl. pancake; a non-lift, like the old floor |

The squat and bench exist twice, so each keeps its own history: **(volume)** on
Day 1, the old names (`Bench press (heavy)`, `High-bar back squat`) on the heavy
days. The deadlift slot keeps the name `Trap-bar / conventional DL` so history carries over, and is a
conventional deadlift (back confirmed OK on 2026-10-06; for a trap bar or RDL use ⋯ → Swap). The new incline curl is
`Seated incline curl`, so the old `Incline DB curl` alias (a preacher curl)
is untouched.

### The pre-session block

Every lift opens with about 10 minutes of routines, as the first exercises of
the session: couch stretch 60 s per side and a deep squat hold (all days); on
Days 1–3 ankle knee-to-wall, adductor rocks and the hip flexor ladder at
*practice* rung; on Day 4 wrist prep, wall handstand, L-sit and the ladder as
working sets. Each is tagged `routine: pre-core | pre-lower | pre-upper`, has no
progression rule, makes no decision and never counts as a lift. Unticked ones
are answered at Finish like any set. Hard compression sits after the lifts as
each day's finisher.

### Block week, phases and the week-1 ramp

`BLOCK` and `PHASES` in `engine.js` give block week and phase from the date
(week 1 = 2026-10-05; phase 1 weeks 1–6, 2 weeks 7–12, 3 weeks 13–18, 4 weeks
19–20). The Log tab shows "Block week N of 20 · phase …". A session started in
the block carries the optional `blockWeek` and `phase`.

- **Week 1 is a calibration ramp.** The first block session of each main lift
  (both squats, both benches, the deadlift slot, overhead press) is **one top
  set at RIR 2** with **no kg target**: ✓ opens the sheet, the target line says
  "Ramp to one top set of 5 · no kg target", and warm-ups work as usual. September's
  weights are shown only as last time. Next session carries the top set as the
  start weight (rule **RC**, no increase). A lift not done in week 1 is a ramp
  the first time it turns up.
- **Heavy days** (bench, squat, deadlift slot): phase 1 is 3×5 at RIR 2, +2.5 kg
  when every set is clean. Phase 2 is 3×4: one top set at RIR 1 and two back-offs
  at −7% (deadlift slot stays at RIR 2). Phase 3 is 3×3, back-offs −10%. The first
  session of a phase keeps the top weight at the new reps (rule **RP**). With
  back-offs, only the **top set** is judged, so the RIR chip is asked after the
  top set, not the last.
- **Phase 4 (test)**: heavy lifts show no kg target again (`cal: test`): triples
  in week 19, a single on bench and squat in week 20 (the deadlift stays a
  triple). Volume days run half their sets in week 20.
- **Volume days** (Days 1 and 4) keep the double-progression rules unchanged in
  every phase.

### Legacy sessions

The four Programme v2 templates and `floor` stay in `TEMPLATES` marked
`legacy: true`, so History, Edit, last-time lookups and the decision log keep
working for the seven files logged 2026-09-08 to 09-27. They are **never
offered** as a new session (the Log tab skips them) and History tags them
"old plan". A legacy-key session dated **before 2026-10-05** counts for its own
earlier weeks; one dated **in or after the block** is real data (last time,
e1RM) but is not one of the block's four lifts: it never ticks off a new day
and is left out of the weekly attendance count. The old routines (squat block,
length A/B, ladder, handstand, L-sit, 5-minute) stay in ⋯ → Add floor or
stretching. The Daily floor week (`FLOOR_WEEK`, `floorFor`) is gone.

## How a session works

- **Start.** The Log tab offers one big button: today's session if it is due,
  otherwise the earliest one not yet done this week. Other sessions are rows
  below it.
- **One exercise at a time.** The exercise in hand is open; finished ones
  collapse to one line (`Bench 75×5 ×4 @2 ✓`) and the next opens at the top of
  the screen. Tap any collapsed line to open it.
- **Every set is a row with a target.** Tap **✓** and the set is recorded
  exactly as shown, with the time. That is one tap per normal set.
- **The next set's ✓ is also in the bottom bar**, in thumb reach: a green
  button reading e.g. `Bench press (heavy) · set 2 of 4 / 75 kg × 5 ✓`. It
  always means the first unticked set of the exercise in hand. When that set
  has nothing to copy it reads "Enter the numbers" and opens the sheet.
- **First time an exercise is done**, most have no target and ✓ opens the
  sheet. A few have a starting point (`seed` in the templates): bodyweight for
  dips, chin-ups, back extensions and hanging raises, 6 reps for the ab wheel,
  and 85 kg for the deadlift, the bottom of the programme's rebuild range.
- **+ Warm-up** (on a barbell or dumbbell exercise before its first working
  set) adds a warm-up row above the working sets, with a ramp target (50 / 70
  / 85% of the working weight, never below the bar; 8 / 5 / 3 reps). Its ✓
  records a warm-up, never a working set. Unticked warm-ups are simply dropped.
- **Tap the numbers to change them.** A sheet opens with − / + buttons (the
  exercise's increment), a number pad that accepts a comma, RIR chips, a
  warm-up toggle and Delete set. **Save ✓** confirms the set. If the weight or
  reps differ from the target, the later sets of that exercise take the new
  values as their target, so the next ✓ records what was actually lifted.
- **After the last set of an exercise**, a chip row asks "Last set: reps
  left?" (0 1 2 3 4+). One tap. Only the last set's RIR drives progression, so
  it is asked once per exercise, not after every set. Earlier sets can be rated
  in the sheet.
- **All as shown ✓** confirms every remaining set of an exercise at its target
  (for logging afterwards), with a 6-second undo. Sets with no target cannot
  be confirmed this way.
- **Only the last set's RIR is asked for.** That is a deliberate trade: one
  tap per exercise instead of one per set. Bench's "whole session RIR 3+" rule
  therefore usually reads the last set only, unless earlier sets are rated in
  the sheet.
- **A ✓ never invents data.** If a set has no target (a first session, a band
  colour never recorded), ✓ opens the sheet instead.
- **The bottom bar** holds the next set's ✓, the rest timer (starts on ✓,
  +30s, tap to stop; shows session time when idle) and **Finish**. It is
  always on screen. While the set sheet is open, it shows the rest countdown
  too.
- **The screen stays on** during a session (Screen Wake Lock), so the timer is
  visible and vibrates once when the rest is over. Settings can turn this off.
- **⋯ in the header**: change date, deload session, add exercise, History,
  Body, Settings, discard. **⋯ on an exercise**: swap, add set, delete (with a
  5-second undo). **ⓘ** shows the programme note, last time, the rule and
  why, the plate breakdown, and the exercise note.
- **An unfinished session older than 12 hours** gets a banner: Finish it, or
  Discard. An edit of a saved session never does.
- **Editing a saved session** (History → Edit): sets from the file show a
  pale ✓; tapping it opens the set to change, it never un-ticks it, so Finish
  can't drop or re-date a saved set. Changing the date re-targets only sets
  still to be ticked; the rules shown at the time, and `logMode`, are kept.

### Finishing

**Finish** opens a summary; nothing is saved until **Save session**.

- The date (changeable), sets ticked, one line per exercise with the last-set
  RIR and last time, and a button per exercise with no RIR. Tapping one opens
  the reps-left chips for its last set; one chip rates it and returns here.
- If sets are still unticked, Save waits for an answer: **I did them as shown**
  or **I didn't do them**.
- Optional one-tap questions: session RPE (5–10) and "Anything flare up?"
  (None / Low back / Other; Low back asks tight or one-sided pinch, then side).
  A pinch shows where it falls: the ones logged in the app plus the number
  before the app from Settings ("One-sided low-back pinches before the app",
  kept on the phone only so no health history ships in this public code). The
  third on record means a physiotherapist before the next hinge session. While
  that setting is empty, the sheet says so and still shows the rule.
- An optional note.

Bodyweight is no longer asked in a session. It lives on the Body tab.

### Pre-session block, Skill day and stretching

- **A prescribed hold is one tap**, like a lift at its target: ✓ on the couch
  stretch records 60 s. Per-side work is one set per side, so "30 s per side"
  is 2 sets.
- **Skill holds have no fixed dose** (the ladder, L-sit, handstand). The
  first time, ✓ asks for the seconds. After that the target is last time's
  typical hold, so a steady day is one tap and a better one is a change in the
  sheet. Put the ladder rung or the L-sit variation in the note.
- **Skill day** (Log tab, optional, 30–40 min, no lifting) holds compression and
  L-sit, handstand, and flexibility (pancake, frog, couch stretch, hamstring
  hinge). **⋯ → Add floor or stretching**, in any session, adds the whole Skill
  day or any single block (including the old floor blocks) to the end of it.
  After lifting is fine; the sheet says not to do it before.

Skill, floor and custom sessions never count toward the week's four lifts or a
deload, and routine work inside a lift session makes no decisions.

### History

Every session, newest first, with pills for `pending` (not yet on GitHub),
`live` / `retro`, `deload` and **`unverified: excluded`**. Tap a row for the
sets, notes, flare-ups and decisions, and **Edit** / **Delete**. A suspect
session (the 17 Sep pattern) also offers **It happened as recorded**, which
writes `verified: true` to the file so the rules read it. Editing a suspect
session does not confirm it: the saved edit carries `unverified: true`.

## What a v5 session file adds

Every file the app writes has **`schemaVersion: 5`**. Full field meanings are
in [training/log/README.md](../training/log/README.md); the ones that matter
for progression and planning:

- **`state`** on each set: `done` (confirmed by Dan) or, when the app reads a
  pre-v5 file, `legacy`. `planned` sets are never written. Each done set has
  `doneAt` (when it was confirmed) and `via` (`tick`, `sheet` or `bulk`).
- **`logMode`**: `live` (ticked set by set during the session) or `retro`
  (entered afterwards). Retro sessions deserve less weight.
- **`symptoms`**: `null` = not asked or skipped, `[]` = none, else a list of
  `{area, type, side}`. The low-back pinch is what the injury rule counts.
- **`sleepH`**: reserved for hours slept, not collected yet.
- **`decisions`**: what each rule proposed and whether it was `accepted`,
  `overridden`, `bulk-accepted`, `no-rec` or `not-done`.
- **`verified`** / **`unverified`**: see History above.

## What each input shape records

| Shape | Exercises | What a set stores |
|---|---|---|
| `weight`, load `kg` | Bench, OHP, squat, DL, RDL, curls, rows, hip thrust, triceps, split squat | kg, reps, RIR |
| `weight`, load `bw+` | Weighted dip, chin-up, back extension, hanging raise | **added** kg (0 = bodyweight, shown `BW`, `BW+15`), reps, RIR |
| `weight`, load `bw` | Ab wheel | reps, RIR; no kg at all |
| `band` | Pallof press | band colours (`red+green`), reps, RIR; never kg |
| `distance` | Farmer's (40 m), suitcase (30 m) | kg, metres; the target fills both |
| `reps` | Pull-up EMOM, compression lift-offs, grease-the-groove | a count |
| `time`, `rounds` | holds, McGill | seconds, rounds |

## The progression rules

Double progression against the coach's rep range, gated on the RIR of the
**last rated working set** (the hardest one on straight sets). Only confirmed
sets (and sets from pre-v5 files) are read; warm-ups never are. Evaluated in
this order, **first match wins**:

| # | When | What it proposes |
|---|---|---|
| RC | The last session was the week-1 ramp | The top set's weight for the template reps in every set, no increase |
| RP | A heavy lift's first session in a new phase | Same top weight at the phase's reps; back-offs follow |
| R6 | Deload session | 65% at the bottom of the range. Bands: same band. `bw`: reps only. `bw+`: 65% of the added load. Carries: 65% load, same distance |
| R0 | Fewer working sets than prescribed | Hold, top of the range |
| R5 | R4 on each of the last two evaluations (kg and bw+ only) | Down 10%, from the bottom of the range |
| RN | Every set at the top, **no RIR logged** | Hold. Log the last set's RIR to unlock progression |
| hold | Legacy bench only ("hold, don't chase"); removed from the new plan | +1 increment only when every rated set is RIR 3+ and the last is 3+; otherwise R2 |
| R1 | Every set at the top, last-set RIR **at or above** target | +1 increment, back to the bottom |
| R1b | Same, `kg` load, one increment is over 10% of the load | Add a rep instead, at most two past the top; once every set is two past, R1 |
| R1v | Same, `bw` load | Make the variation harder |
| B1 | Same, band | One band heavier |
| R2 | Top of the range, last-set RIR **below** target | Hold |
| B2 | Band, anything else | Same band, one more rep on the weakest set |
| R4 | Two or more sets below the range | Hold at the bottom |
| R3 | Anything else | Hold, one more rep on the weakest set |

Why the changes from v4:

- **No RIR is not RIR 0.** v4 read a missing RIR as 0, so the unrated 17 Sep
  bench looked like a strength loss and parked lifts at R2 for the wrong
  reason. Now it gives RN, and e1RM is not estimated from an unrated set.
- **Bench holds.** Programme v2: add load only when a whole session lands at
  RIR 3–4. v4 added load at RIR 2.
- **R1b is capped** at two reps past the top. v4 prescribed dips at 15 × 9,
  outside 6–8, and would have kept adding reps forever. It no longer applies
  to `bw+` lifts: the moved load includes bodyweight, so one increment is
  always under 10%.
- **Bands and bodyweight lifts** never get a kg recommendation. v4 told Pallof
  "0 kg" and ab wheel "+2.5 kg".
- **R5's window** now ignores sessions dated after the one being planned, and
  exercises that were not done.

Deload sessions are excluded from progression. Floor and custom sessions never
count toward the week, the deload cadence, or a deload.

## Deloads

**Scheduled, by block week: 6, 12 and 18** (starts 2026-11-09, 2026-12-21,
2027-02-01). In those weeks the check carries a severe `BLOCK` code, so **all
four sessions start as deloads** (the date decides, not what was logged):
65% of working load at the bottom of the range, **half the accessory sets**
(main lifts keep all theirs; the pre-session block is unchanged), no back-offs,
RIR 3–4. The weeks-since-deload **cadence is not used from 2026-10-05**: it still
applies to dates before the block (it was due in the week of 2026-10-12, which
would have been a spurious deload) and the Settings field "Deload every N weeks"
now only governs that. After week 20 nothing is scheduled (March is unscheduled).
⋯ → **Deload session** still switches any session to a deload by hand; it
re-targets at 65% but does not halve the sets. Deload sessions are never "last
time", so the week after reads the last normal session.

The other triggers can only pull a deload earlier:

| Code | Trigger | Severity |
|---|---|---|
| BLOCK | Block week 6, 12 or 18 | Severe |
| CADENCE | Before the block only: weeks since the last deload ≥ the setting | Severe |
| D1 | Rolling-3 e1RM down >5% from the six-week best, on two or more main lifts | Severe |
| D2 | Weekly median RIR 1.5 or more below target, on three or more exercises | Severe |
| D3 | 30%+ of working sets below the rep range | Moderate |
| D4 | Session RPE averaging 9+ across the week | Moderate |
| D5 | Two or fewer of four sessions logged | Informational |
| D6 | Bodyweight down >2% in a week | Moderate, **off only on the `cut` setting** |

One severe or two moderate in the same week raises the flag. D5 never fires
alone: missing sessions reduces fatigue. **Settings → Block goal is now
`strength` (a small surplus), so D6 is on.** A phone that still holds the old
`cut` is switched to `strength` once, on first load of this build; after that the
setting is Dan's. The dose (65%) is a proposal, not the coach's; it lives in
`DELOAD` in `engine.js`.

**Known gaps.** `DELOAD.resumePct` (95%) is not applied: the session after a
deload recommends from the last normal session at 100%, which is what the plan
wants, so the constant is unused. A manual ⋯ → Deload session does not halve
accessory sets (a scheduled one does). The plan's "a week with fewer than 3
sessions does not progress" is not enforced: loads move on by the last session
of each lift. The old "only the session started while the flag shows" gap
is closed for scheduled weeks and remains only for the other triggers.

## Where the data goes

One JSON file per session in **`danbeseda-axolt/dan-brain`** at
`training/log/YYYY-MM-DD-<session>.json`. A second session of the same template
on the same day gets `-2`, `-3`, rather than overwriting the first. Bodyweight
and floor benchmarks go into `training/log/bw-YYYY-MM.json`, one file per
month. Field meanings, including every v5 field, are in
[training/log/README.md](../training/log/README.md).

Editing a session pushes a new commit to the same file; if the edit changes the
date or session, the old file is marked deleted (queued ahead of the new
version; if that one push fails it is retried, so both can briefly coexist on
GitHub). If the original never reached GitHub, the queued copy is simply
replaced and no deleted marker is written. Git keeps every earlier version.

Each file carries the decision log: what each rule proposed, what was done, and
whether that counts as accepted, overridden, bulk-accepted (confirmed with "as
shown", so no real choice) or not-done. Override rate per rule is the signal
that a threshold is wrong. Nothing retunes itself.

## Why this can't lose your data

- Every tap saves to the phone immediately.
- "Save session" queues the file; the queue is pushed now and retried on the
  next open or when signal returns.
- A queued file is removed only after GitHub confirms that exact push (200 or
  201). One upload runs at a time. A newer version of the same file replaces an
  older one that has not started uploading.
- On first run the app asks the browser to keep its storage (Settings shows
  "persistent" or "best-effort").
- The app reads `ledger_v5`. Only on the first run after the upgrade, when
  `ledger_v5` does not exist yet, does it migrate `ledger_v4` or `ledger_v3`,
  which it never overwrites. After that the old keys are a frozen snapshot of
  upgrade day: if `ledger_v5` ever becomes unreadable, the app keeps only the
  GitHub settings from them (never their old queue or draft, which could
  re-push stale files), reloads the log from GitHub, and shows a banner.
- Anything unreadable (a whole blob, or just a malformed session in
  progress) is copied aside as `ledger_corrupt_<key>_<time>` first, and the
  rest of the state is kept.
- History → Reload and uploads never overlap: a reload waits for an upload
  in progress and vice versa, so a session pushed during a reload can't drop
  out of History.
- Settings → Export JSON gives an offline copy on demand, including any
  `ledger_corrupt_*` copies.

The only thing a lost phone can lose is a session logged offline and never
synced.

## Setup

### 1. Create a token — you do this, not me

GitHub → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token.

- **Repository access:** Only select repositories → `dan-brain`
- **Permissions:** Repository permissions → **Contents: Read and write**
- **Expiration:** set one. 90 days is sensible.

**Paste it into the app's Settings screen on your phone. Never paste it into a
chat with me, or anywhere else.** If the phone is lost or the token leaks,
revoke it on that same GitHub page and generate a new one.

### 2. Hosting

The app is static: `index.html`, two modules (`engine.js`, `sync.js`), a
manifest, an icon and a service worker. No secrets in it, so the code is public
while the data repo stays private.

It is served by GitHub Pages at
**https://danbeseda-axolt.github.io/training-tracker/**, from the public repo
`danbeseda-axolt/training-tracker`. To deploy a change:

```
git subtree push --prefix tracker https://github.com/danbeseda-axolt/training-tracker.git main
```

### 3. Add to home screen

Open the URL on the phone → menu → **Add to Home screen**. It then launches
full-screen like an app.

### 4. First run

Settings → owner / repo / branch / path → paste the token → **Test**. It
reports whether the token actually has write access.

Then, under Programme, fill in **One-sided low-back pinches before the app**
(the count from the injury record). It stays on the phone and is what the
finish sheet adds a newly logged pinch to.

## Changing the app

- **Templates** live in `TEMPLATES` at the top of `engine.js`. Per exercise:
  `kind`, `load` (`kg` / `bw+` / `bw`), `rep`, `rir`, `inc`, `rest`, `bar`
  (turns on the plate breakdown), `key` (main lift: D1, keeps its sets in a
  deload), `hold` (legacy bench), `dist` (carries) and `seed` (first-ever target,
  used only with no history). The winter plan adds `cal` (week-1 ramp), `heavy`
  (phase-driven reps and back-offs), `topRir`, `single` (week-20 single), `wk1`
  (week 1 only); per template `pre` (`lower` / `upper` pre-session block),
  `volume` and `legacy`. The block start, phases and deload weeks are `BLOCK`
  and `PHASES`; the pre-session block is `PRE_BLOCK` and the Skill day
  `SKILL_DAY`, both built from `ROUTINES`. Exercise names are the key to
  history: a renamed lift loses its last time unless it gets an `ALIASES` entry.
- **The rules** are in `engine.js`: pure functions, no page, no network.
- **The screen** is `index.html`: CSS and one `<script type="module">`.
- **Sync** is `sync.js`.
- **After any change, bump `VERSION` in `sw.js` and the `?v=` on the two
  imports in `index.html` together.** The service worker caches the modules at
  those exact URLs, so a page can never run with a module from another build.

### Tests

```
node --test "tracker/dev/*.test.mjs"
```

Plain Node (tested on v25), no npm, no install. Do not add a `package.json`
under `tracker/`. The tests cover every rule, the deload cadence, migration of
old files and old phone storage, confirming and finishing a session, file
paths, the sync queue against a fake GitHub, the service worker's file list,
one regression test per bug found in the 2026-09-23 review
(`dev/regressions.test.mjs`),
the winter plan (`dev/plan.test.mjs`: templates, legacy keys, phases, week-1
ramp, deload weeks, the pre-session block), and the real session files in
`training/log` (read at test time, never copied into `tracker/`, which is
public).

Local preview: `node tracker/dev/serve.js`, then http://localhost:8099. A second
checker running at the same time should use its own origin (`PORT=8100 node
tracker/dev/serve.js`): each origin has its own localStorage, so two checkers
on one port overwrite each other's test data.
