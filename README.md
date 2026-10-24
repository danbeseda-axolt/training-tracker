# Ledger — training tracker

**As of:** 2026-10-24 (v5, build 5-21: progress-first home, lift pages, no GitHub, 880 exercises; build 5-18: look before you start, back button, exercise picker, welcome page, sign out; build 5-16: a quieter Log tab; build 5-15: the coach chat, built against a fake model; the winter strength plan, account mode beta, onboarding and generated programmes for friends)

## What changed on 2026-10-24 (build 5-21): progress first, no GitHub

From the UX research (projects/ledger-ux-research-2026-10-24.md) and Dan's
answers: estimated max on the cards, GitHub dropped, a bigger exercise list.

- **Home** is this week (N of 4, weekly streak, day dots) and a card per main
  lift: estimated max, a sparkline, change since four weeks back. Start is
  pinned above the tabs; other sessions are one tap away.
- **Lift page**: estimated-max chart with gold dots on new bests, 1M/3M/1Y/All,
  best kg at each rep count, recent sessions. Pure rules in `progress.js`.
- **Session**: each set shows last session's matching set in grey; a PR badge
  when a ticked set beats every earlier estimated max.
- **Three tabs**: Home, History, You. Body and Exercises live under You; the
  coach is a round button.
- **No GitHub**: bodyweight and floor tests go to Supabase (`body_entries`);
  the GitHub card shows only on a phone that already logs to GitHub.
- **Exercises**: about 880 from free-exercise-db (public domain) in
  `data/exercises.json`, loaded on first use; in the Add exercise search and
  browsable under You with instructions.
- **Colours** (5-20): the Broken Compass palette.

## What changed on 2026-10-24 (build 5-18): look before you start

Dan, 2026-10-24: opening a session to check it before training started the
clock; he wanted a Start button, a back button, and an exercise database when
adding exercises.

- **Tapping a session opens a read-only preview**: exercises, targets, notes,
  form links. Nothing is saved until **Start session**. ‹ in the header goes
  back to the Log.
- **⋯ → Add exercise** opens a searchable list: exercises done before, the
  programme's exercises, then the 57-exercise library. A picked library entry
  keeps its kind (time, reps, weight), note and last-time targets. A name not
  on the list is added as new (weight × reps), as before.
- **Welcome page** for signed-out phones: logo, three lines on what the app does,
  **Create an account** and **I already have an account**. Both lead to the same
  email code (the first sign-in creates the account); the words differ, and ‹ goes
  back to the welcome.
- **Sign out** is the first card in Settings when signed in ("Signed in as …").
  A friend who signs out lands on the welcome page.
- **Coach fix:** the question and answer rows now have the same columns. Before,
  PostgREST refused the pair (400, PGRST102), so no chat was ever stored: no
  history for follow-ups and answers gone after a reload. Needs the function
  redeployed.
- `customExercise` takes an optional template and history; the coach
  function's engine copy is updated to match (redeploy the function to pick it up).

## What changed on 2026-10-20 (build 5-16): a quieter Log tab

Dan, 2026-10-20: the home screen is cluttered. Spec:
[ledger-ux-log-declutter.md](../projects/ledger-ux-log-declutter.md). View
only: `deloadCheck`, `blockInfo`, `weekPlan` and the auto-deload on Start
are unchanged; `logview.js` (pure, tested in `dev/logview.test.mjs`) picks
which of their results the Log shows.

- **Deload banner only when Start would start a deload** (the engine's
  `fire`): **Time to deload.** (amber, the reasons in plain words, no code
  pills), or in a scheduled deload week **Deload week.** (info), hidden once
  the week's sessions are done. No banner for no signals, D5 alone, or a
  single moderate signal. The old "Watch" banner is gone.
- **Settings → Programme** (Dan) starts with the block line and a **Fatigue
  check**: every code with its pill, and "Not enough for a deload." / "Deload
  due…" / "Nothing to flag."
- **Block / phase line off the Log.** A one-line note under Start only in
  block weeks 1, 7, 13, 19, 20 and 21.
- **Dan's week as rows:** Start on two lines ("Start Day 2" / "Heavy bench +
  deadlift · Thu"), then **This week · N of 4 done** over the other block days
  with a day pill, ✓ on done ones (Builder: done days stay as rows), "· check"
  on an unverified one, never "missed". "Ask the coach about this week ›"
  under the rows (hidden while the week-done card shows). Then **Other**:
  Skill day and Custom, one line each. The "Not yet this week" sentence and
  the Skill day sub-line are gone.
- **Upload banner only after an upload failed** (or offline with something
  held); while uploading, the header pill says so.
- **Friends:** only the deload rule and the upload-banner rule change.

## What changed on 2026-10-19 (build 5-15): the coach chat (not live yet)

Spec: [ledger-chat-spec.md](../projects/ledger-chat-spec.md) (data, limits,
errors) and [ledger-ux-chat.md](../projects/ledger-ux-chat.md) (screens, copy).
Dan, 2026-10-19: *"A chat I could ask directly in the app, my trainer, about
what he thinks about stuff."* So this build has **free chat (C1) and the week
review (W1) together**, on one Edge Function. Builder's answers to the docs'
open questions: caps 20 a person a day and 200 for everyone; pain answers and
notes do go to the model (the first-run card says so); the coach answers in
the language of the question (the week review: English, unless the person's
recent messages are Czech); **no Monday card** for last week; History's
"What should I take from this session?" is in.

**Who sees it.** Only someone signed in to an account: friends, and Dan when
his GitHub phone is also signed in. **Dan's GitHub phone signed out sees
nothing new**: four tabs, no card, no button, no network call. A friend's
phone whose sign-in expired keeps the tab, with "Sign in again to use the
coach".

**What is on screen**
- **Coach tab** (Log · Coach · History · (Body) · Settings). First run: the
  disclosure card (Anthropic gets the log, notes including pain, the
  programme and the messages; Dan can see the database; delete any time; not
  a physio), "OK, got it" stored in the account (`profiles.settings.coachChat`,
  copy version `COPY_V` in `coach.js`), so a second phone doesn't ask.
- Empty: up to 4 suggested questions from the person's own log (`suggestions`
  in `coach.js`: this week or last week's review, the main lift done most in
  8 weeks, next session / "why is today's weight lower?", deload or RIR), and
  a composer (1,000 characters, counter from 900, Enter sends).
- Thread: oldest first with date dividers, opened at the top of the latest
  answer; "From N weeks, M sessions." under each answer; "In Ledger:" paths in
  their own block; follow-up chips under the latest answer only. A pain answer
  (`safety`) gets the fixed banner and the 155 footer, which come from code
  (`SAFETY`, the same words in the function and the app), never from the AI.
- Loading ("Reading your log…" → "Coach is thinking…" → "Still working…"),
  offline (read only, nothing queued, text kept), errors with Try again,
  "N messages left today" from 3, the limit banner, "coach is off".
- **Log:** once the week's planned sessions are all saved, a card "Week
  done: 3 of 3 ✓" with **How was my week?** (Dan: "all four lifts"); Not now
  hides it for the week; afterwards "Read your week review ›". The save that
  completes the week toasts "Saved. Week done: 3 of 3." "Ask the coach about
  this week ›" sits in the on-track card (Dan: under "Not yet this week").
- **History:** "What should I take from this session?" on lift sessions in
  the account (disabled with a reason when not uploaded, offline or at the
  limit). **Session ⋯ → Ask the coach.**
- **Settings → Coach:** message count and **Delete my chat** (confirm). It
  removes every chat row of the user; the usage counter is untouched.

**How it works.** The app (`cloud.askCoach`) flushes the account queue, then
POSTs `{question, kind: 'chat'|'week_review', week?, scope?: {session}}` to
`/functions/v1/coach` with the user's token, 60 s timeout. The function
(`supabase/functions/coach/`) takes one from the cap (`chat_take()`), reads
the profile, the last 8 weeks of sessions and the last 10 messages from 14
days **as the user** (their JWT + the publishable key; no service-role key
anywhere), builds a compact text context with the engine (targets and rule
codes for the next session, deload flags, e1RM, pinch count, the sessions with
notes wrapped as data), calls Claude Sonnet 5.5 (`claude-sonnet-5-5`, adaptive
thinking at low effort, `max_tokens` 2,500, server-side refusal fallback,
prompt caching on the frozen system prompt and on the context), stores the
question and the answer, and returns `{answer, safety, weeks, sessions,
remaining, …}`. A week already reviewed returns the stored review, free.
One retry on 429/529/5xx; then "busy". Errors the app tells apart: 401
signed_out, 413 too_long, 429 limit, 503 off (no key, a refused key, or
`COACH_OFF=1`), 502 busy, 504 timeout.

- `supabase/functions/coach/coach-core.js`: everything, pure with the
  database, model and clock injected (`makeCoach`, `buildContext`,
  `handleHttp`). `index.ts` is the Deno wrapper.
- `supabase/functions/_shared/engine.js`: a **byte-for-byte copy** of
  `engine.js` (the test fails when they differ: after any engine change,
  `cp tracker/engine.js tracker/supabase/functions/_shared/engine.js`).
- `supabase/migrations/20261019_ledger_chat.sql`: `chat_messages` (RLS: own
  rows, read/insert/delete, no update), `chat_usage` + `chat_take()` (the
  caps live in SQL; a refused take is not counted; security definer, with the
  reason in the file), one review per user per week (unique index). A
  two-user verification script is at the bottom, commented.
- `coach.js` (app): suggestions, follow-ups, the week card rule, answer
  formatting (escaped; bold, line breaks, bullets only), copy.
- Tests: `dev/coach-fn.test.mjs` (fake model, fake database: context from
  invented rows, caps 20/200 and delete-doesn't-reset, safety by keyword and
  by the model's `[SAFETY]` mark, injection in notes, one review a week,
  error paths, every DB call as the user) and `dev/coach-app.test.mjs`.

**QA round 1 (2026-10-19), still build 5-15:**
- **Invite-only.** `coach_access` (one row per person, added by Builder in
  SQL; no grant lets a user add themselves). `chat_take()` returns a `reason`
  (`no_access`, `limit_user`, `limit_all`) and counts nothing without access.
  The app checks the row when the tab opens and shows "The coach is
  invite-only for now. Ask Dan to switch it on for you."; no card, link or
  History button then.
- **Cost bounded per message:** the context holds at most 8 weeks and 40
  sessions, 12 exercises a session, 24,000 characters (oldest sessions
  dropped first, and the context says "N older sessions left out").
- **The week review can't be used up mid-week:** the function answers 409
  `week_not_done` for this week until its planned sessions are saved
  (`perWeek`, 4 on the coach plan); last week any time. Mid-week the chip is
  the plain question "How is my week going so far?".
- **Safety detection** (`painWords` in `coach-core.js`, QA round 2):
  negations removed first ("no pain", "pain-free", "bez bolesti"); clear
  symptom words always count (pain, hurt, bolí, Schmerz, chest tightness,
  spasm, cramp/křeč, numb, tingling, swollen, dizzy, "gave way", unstable,
  headache…); ambiguous words (pulled, tore, popped, tweaked, strained,
  "killing me") only within 3 words of a body part and never before a number,
  and "sore"/"tight" only on a joint, the back or the chest. So "I pulled 140
  kg" and "DOMS: legs sore" are training, "I pulled a hamstring" is not.
  From the data: a review (of a week or one session) is a safety answer when
  its sessions had a flare-up or a pain note; a chat only when the question
  names a body area that flared up in the last 14 days, and then the turn
  tells the model why. Other recent flare-ups are listed in the context as
  facts, and the model marks the answer itself ([SAFETY]) when it touches one.
- **Pinches:** the context never states a total (the number before the app
  is on the phone); it gives the weeks shown as a minimum, and the prompt
  forbids guessing a total.
- **Names are wrapped as data** like notes (`«…»`). History fed to the model
  is only rows the function stored (`meta.src = 'fn'`, a model and token
  counts); rows can't be dated into the future. A user forging such rows by
  hand only steers their own coach.
- **Time:** 50 s for the whole request; a retry only with 20 s left.
- **"Off" clears** after a minute or on the next tab opening; a gateway error
  without the function's own code reads "busy", not "off".
- **First-run flag** is written with `settings_merge(patch)` (one statement,
  `settings || patch`). `pushProgramme` still reads and rewrites the whole
  settings object (its newer-copy-wins check needs the read), so a programme
  save racing the first-run "OK" can still drop `coachChat`; the cost is the
  first-run card showing once more.

**Not built (on purpose or deferred):** the Monday "last week" card (Builder:
dropped); the "account has 3 of your 14 sessions" banner for Dan (UX 4.11:
needs a count query; the held-sessions banner is there); the eval set of ~20
cases (spec build step 3; runs with the live model, step 4); streaming.

### Deploy (Builder; nothing here is applied or deployed yet)

1. **Migration.** Run `supabase/migrations/20261019_ledger_chat.sql` with the
   verification block (uncommented) in one transaction ending in `rollback`;
   check each `expect`. Then apply it as migration `ledger_r2_chat` and run
   the security advisor (expect only the intended definer function). Then
   switch the coach on per person:
   `insert into public.coach_access (user_id) values ('<auth user id>');`
2. **Function, fake model first.** Deploy `supabase/functions/coach/`
   (`index.ts`, `coach-core.js`) together with `supabase/functions/_shared/engine.js`
   as function `coach` (`supabase functions deploy coach`, or the dashboard /
   MCP deploy with all three files; import path `../_shared/engine.js`).
   `verify_jwt` on (default). Set the secret `COACH_MODEL=fake`, sign in on a
   test phone, ask: the canned "(test reply)" comes back, two rows appear in
   `chat_messages`, `chat_usage` counts 1. If the browser's CORS preflight is
   refused by the gateway, redeploy with `verify_jwt = false`: the function
   then rejects a call without a valid user token itself (chat_take fails).
3. **Live model**, only after the x-chat-test result and Dan's tasks below:
   remove `COACH_MODEL`, check one answer, run the eval once.
4. **App:** deploy `tracker/` as usual (build 5-15). It is safe before the
   function exists: the Coach tab then shows "The coach is busy" on a send.
   Kill switch at any time: secret `COACH_OFF=1` ("The coach is off for now").

### Dan's tasks (only Dan)

1. **Anthropic API key** (console.anthropic.com, billing on, one key named
   e.g. `ledger-coach`).
2. **Put it in yourself**: Supabase dashboard → Edge Functions → Secrets →
   `ANTHROPIC_API_KEY`. Prefer the dashboard to `supabase secrets set
   ANTHROPIC_API_KEY=…`, which leaves the key in shell history. Never paste it
   into a chat, a file or this repo.
3. **Monthly spend limit** in the Anthropic console (suggested $20), with an
   email alert below it. That is the real fuse: the caps allow ~6,000
   messages a month (~$150) at worst.
4. Your history in the account (Settings → Account → Copy my history), and
   `programme_key = 'coach'` on your profiles row, or the coach sees an empty
   log.

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

## What changed on 2026-10-11 (builds 5-12, 5-13): QA fixes to onboarding

Nothing changes for Dan's GitHub phone (checked against build 5-9 with a
frozen fixture from invented sessions, `dev/fixtures/coach-plan-5-9.json`).

- **One person's programme never reaches another.** Signing out forgets the
  programme, the coach flag, half-answered questions and a pending code
  (`PER_USER` in `cloud.js`); so does a different account taking the phone
  over. The cached programme records whose it is (`programmeOwner`): it is
  never shown to, or sent for, anyone else. If the account has no programme,
  the phone's copy is dropped unless it is this user's own unsent change.
  The coach flag is re-read from `programme_key` on every pull.
- **Two phones:** a programme carries `updatedAt`; the newer one wins, and a
  phone's older unsent change gives way to a newer one in the account
  instead of overwriting it.
- **Signed out with no programme** shows the start page, never the questions
  (`entryScreen` in `programme.js`, the one rule for which screen shows).
- **A stored programme that fails its own answers** (an exercise no longer in
  the library, one hard on a joint the person said hurts, unreadable
  answers) is not run: “Set it up again”, plus Sign out. A network failure
  keeps Try again (plus Sign out). A programme with no answers or slot info
  (coach or hand-written) runs, but offers no Swap and no library.
- **Questions:** a double tap no longer skips a question; a missing answer at
  build time goes back to that question; the build-error screen has “Back
  to the questions”. Typing the code offline retries once when the signal
  is back.
- **5-13:** a re-take keeps a swap to any exercise that fits, not only the
  first six on the swap sheet; “Set up again” after a failed check opens the
  questions with the old answers and keeps the old swaps where they fit;
  signing out with an unsent programme change says it will be lost; the
  frozen fixture's history is fully invented.
- **Generator** (library 2026-10-11, 57 exercises): a fallback into a
  pattern stops at `PAIN_RULES.fallbackMaxOnDay` slots of it per day, and only
  slots that survive the time trim use up an exercise for the week.

## What changed on 2026-10-11 (build 5-11): onboarding for friends

Spec: [ledger-ux-onboarding.md](../projects/ledger-ux-onboarding.md). Why:
[decision 2026-10-11](../decisions/2026-10-11-ledger-onboarding-generator.md).
**Dan's phone does not change**: none of this renders when storage is
`github`, or on an account marked as the coach's (below), even if a
programme is cached. Every rule below is for friends only.

- **Start page** (signed out, nothing on the phone, no GitHub, no session in
  progress): email → 8-digit code (the project's Supabase OTP length) that submits itself on the eighth digit
  (paste with a space works), 60 s resend countdown, and a code sent under an
  hour ago reopens the code screen after a reload. The Settings sign-in card
  stays for Dan.
- **After sign-in** the account's profile is read ("Loading your
  programme…"). A programme there → Log. None → the **five questions** (days,
  where, experience, pain, minutes; dumbbells and home add pull-up bar / bands
  chips). Every answer is saved on the phone at once, so a reload resumes.
  A failed load says so and offers Try again; it never falls through to the
  questions.
- **The generator** is `programme.js` (pure, imports nothing, the library is
  passed in): `generate(answers, library)` follows the rules in the header of
  `library.js` in their order, including the pain fallbacks, the RIR floors,
  time trimming and the light day. START_EASY is not applied. Slots nothing
  fits are dropped and shown on Your programme (“Upper A has 6 exercises, not
  7: …”), naming kit only when it would fill the slot.
- **Your programme**: days with the next one open, Swap on every exercise
  (sheet: the current exercise, then what fits the slot, ▶ form link, Undo),
  “Your pick” on swapped rows, a RIR explanation, Browse all exercises. The
  first time, a bottom bar starts today's session.
- **Exercise library**: grouped, “Fits you” or “All”. In All, an exercise
  that does not fit shows why and cannot be swapped in.
- **Log** for friends: Start today's session (the next day in rotation),
  “N of perWeek this week” with a 4-week strip, other days below. Body tab and
  floor/stretching are hidden. ⋯ → Swap opens the library sheet, for today only.
- **Settings** for friends: Account, Programme (view, library, re-take with a
  confirm; re-take keeps swaps that still fit and restarts the rotation), Data.
- **RIR in words** (friends' sessions only): ⓘ, the reps-left row, the set
  sheet and the finish sheet use “how many more good reps”.
- **Storage:** the programme and the answers (pain included, Builder's
  decision) are in `profiles.settings.programme`, cached on the phone.
- **Dan's account on a new phone:** set `programme_key = 'coach'` on his
  profiles row (no programme JSON). Sign-in then skips the questions and runs
  the coach programme, as it does today; add GitHub in Settings as before.

## What changed on 2026-10-11 (build 5-10): the programme as data (engine only)

Nothing on screen changes and Dan's plan runs exactly as before (checked
byte-for-byte against build 5-9 over the real log). Groundwork for S2: the
engine can run a **programme supplied per user** instead of `TEMPLATES`.

- **Shape** (`normaliseProgramme` in `engine.js`): `{ v: 1, id, name, source:
  'coach'|'generated', perWeek, deloadEvery (weeks or null), days: [{ key, name,
  ex: [...same schema as TEMPLATES...] }], answers?, createdAt }`. The block-only
  flags (`cal`, `heavy`, `topRir`, `single`, `wk1`, `hold`) are stripped: a
  programme has no block, phases, week-1 ramp or weekdays, and progresses by
  the plain rules (double progression on rep range + RIR; first time ✓ asks
  for numbers or uses `seed`).
- **Engine calls** take it as an optional last argument: `newSession(…, prog)`,
  `retarget(d, history, prog)`, `tplOf(ex, key, prog)`, `deloadCheck(…, prog)`.
  Without it, Dan's path. `programmeWeek(prog, list, today)` gives the next
  session (the day after the last one done from this programme, in rotation)
  and this week's count against `perWeek`.
- **Session files** stay `schemaVersion: 5`. A programme session is keyed
  `g-<day key>` (file `2026-10-20-g-upper-a.json`) and carries `programmeId`;
  never `blockWeek`/`phase`. The prefix keeps a day from resolving to one of
  Dan's templates. History renders from the file alone; last time is by
  exercise name, across programmes.
- **Deloads** for a programme: no scheduled block weeks; a cadence only if
  `deloadEvery` is set; D1 reads its `key` lifts, D5 its `perWeek`.
- **Storage:** `profiles.settings.programme` (+ `programme_key` = its id), no
  migration. `cloud.js`: `setProgramme` (cached in `S.programme` at once,
  `S.programmeDirty` until the server confirms), `pushProgramme` (reads the
  row, keeps other settings keys, upserts), `pullProgramme`, `syncProgramme`.
  Not wired to any screen yet.

## What changed on 2026-10-10 (build 5-9): gym-floor fixes

Dan, 2026-10-10: the rest timer was too small to read mid-workout; he wanted a
form video for every exercise and a note on every exercise.

- **Rest timer** is 44 px (was 24) and the bar is 84 px tall; the copy on the
  set sheet is 22 px. Checked at 360 px wide: no overflow.
- **ⓘ → "Watch form on YouTube"** on every exercise. It is a YouTube search
  for the exercise name, not a curated video: it covers swaps and never goes
  dead. Curated links (spec S6) can replace it per exercise later.
- **Exercise note** moved out of ⓘ onto the card: "+ Note" in the footer, and a
  saved note shows as a line on the card (tap to edit). Same `note` field in
  the session file, so nothing changes in storage.

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
conventional deadlift (for a trap bar or RDL use ⋯ → Swap). The new incline curl is
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
19–20). Settings → Programme shows "Block week N of 20 · Base (weeks 1–6). Next
deload: week 6, from 9 Nov."; the Log tab shows a one-line note under Start only
in the weeks the kind of work changes (1, 7, 13, 19, 20, and 21 when the block is
over). A session started in
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

## Account (Supabase) — beta

**As of 2026-10-07.** Opt-in, for release 1 (stories S1, S4 and the import
half of S7 in [ledger-r1-spec.md](../projects/ledger-r1-spec.md)). Nothing
changes unless you sign in: GitHub stays the default.

- **Sign in:** Settings → Account → email → **Send code** → type the code from
  the email → **Sign in**. A code, not a link, so it works in the home-screen
  app. The access token refreshes itself; the refresh token keeps you signed
  in for weeks.
- **What is sent:** once signed in, every saved, edited, verified or deleted
  session is also queued for the `sessions` table (one row per session, keyed
  by the file name, so a retry or a second import updates the row instead of
  adding one). Bodyweight and floor benchmarks are not sent.
- **Where the log lives is a fixed mode per phone** (`storage` in the saved
  state), shown on the Account card. It is never inferred from whether a token
  happens to be there, so clearing an expired token cannot move sessions.
  - **`github`** (Dan): set the first time GitHub settings are valid on the
    phone, or for any state saved before the mode existed that holds GitHub
    data. GitHub queue and History work exactly as before; a blank token just
    holds the queue. The account is a copy that never changes what History
    shows. Once the account has been used, changes are held for it even while
    signed out, so a delete or verify replaces the held copy.
  - **`account`** (a friend): set by a sign-in on a phone where GitHub was
    never set up. Every change goes to the account (held while signed out),
    History → Reload reads from it, and anything left in the GitHub queue from
    before the first sign-in moves to the account queue. Moving never drops a
    session because a same-named copy is there: the newer `savedAt` is kept,
    and nobody else's copy is touched.
  - **One way only: account → github.** When GitHub settings become valid on
    an `account` phone (for example Dan reinstalling: signed in first, token
    pasted after), the phone becomes `github` and says "GitHub is set up. From
    now on sessions go to GitHub and your account keeps a copy." Everything
    the account held for its owner is set aside and, after the next successful
    GitHub pull, goes to the GitHub queue when GitHub has no copy or an older
    one (a deletion only when GitHub has the file). A failed pull keeps it set
    aside for the next one. `github` never becomes `account`.
  - Before either (a fresh phone), the Log tab says "Not saved anywhere yet.
    Sign in under Settings → Account to keep your sessions." 
- **Copy my history to my account** (S7) pushes every session on the phone.
  Safe to run twice. It reports how many were copied and how many are held.
- **Same queue guarantees as GitHub:** a write counts only on 200 / 201 / 204,
  one upload at a time, each item removed only after its own success, and a
  queued newer version replaces an older one not yet on its way.
- **One owner per phone.** The first account signed in owns what the phone
  holds, and each queued item records whose it is. Signed in as anyone else,
  only that person's own new sessions upload; the owner's stay held, and
  nothing is pulled or copied. The card says why. An empty phone adopts the
  new account. An item is never sent without a user id; it is held instead.
- **Signing out** clears the tokens only. A refresh still in flight cannot
  sign you back in. History and anything not yet sent
  stay on the phone and go up after the next sign-in. If the server refuses a
  refresh, the app signs out the same way. No signal is not a sign-out.
- **Privacy:** row-level security in the database (migration in
  `supabase/migrations/`) means each user reads and writes only their own rows.
  The tokens live in this phone's storage, like the GitHub token, and are not
  in Export JSON (token fields inside raw `ledger_corrupt_*` copies are
  blanked too). Deletes also filter on `user_id` as a second guard.
- **Needs, in the Supabase dashboard:** the email template (Authentication →
  Emails → Magic Link) must contain `{{ .Token }}`, or no code is emailed.
  Supabase's built-in email sends only a few emails an hour and only to the
  project team, so friends need a real email sender first.

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

### Where the code lives (rule, 2026-10-07)

**`dan-brain/tracker/` is the only place the app's code is changed.** The
public repo `danbeseda-axolt/training-tracker` is a published copy and is only
ever updated by the deploy step below. On 2026-10-07 the public repo was found
four commits ahead (the winter plan, edited there directly), and a deploy from
here would have rolled it back. Never commit to the public repo by hand.

### 2. Hosting

The app is static: `index.html`, seven modules (`engine.js`, `sync.js`,
`cloud.js`, `library.js`, `programme.js`, `coach.js`, `logview.js`), a manifest, an icon and a service worker. No secrets in it (the
Supabase URL and publishable key in `cloud.js` are public by design), so the
code is public while the data repo stays private.

It is served by GitHub Pages at
**https://danbeseda-axolt.github.io/training-tracker/**, from the public repo
`danbeseda-axolt/training-tracker`. To deploy a change:

The two repos' histories are unrelated, so `git subtree push` is refused.
Deploy by copying the folder onto a fresh clone of the public repo and
committing there:

```
git clone https://github.com/danbeseda-axolt/training-tracker.git /tmp/tt
cd /tmp/tt && git ls-files -z | xargs -0 rm -f && cp -a <path>/dan-brain/tracker/. . && cd -
cd /tmp/tt && git add -A && git commit -m "Deploy: <what changed>" && git push origin main
```

Before copying, check the public repo has nothing dan-brain lacks
(`diff -r` against the last deployed tree).

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
- **Sync** is `sync.js`; **account mode** is `cloud.js`.
- **After any change, bump `VERSION` in `sw.js` and the `?v=` on the seven
  imports in `index.html` together.** The service worker caches the modules at
  those exact URLs, so a page can never run with a module from another build.

### Tests

```
node --test "tracker/dev/*.test.mjs"
```

Plain Node (tested on v25), no npm, no install. Do not add a `package.json`
under `tracker/`. The tests cover every rule, the deload cadence, migration of
old files and old phone storage, confirming and finishing a session, file
paths, the sync queue against a fake GitHub, account mode against a fake
Supabase (`dev/cloud.test.mjs`), the service worker's file list,
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
