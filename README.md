# Ledger — training tracker

**As of:** 2026-09-09

Phone-first training log. Replaces the old localStorage-only Ledger that lost
its data. **The GitHub repo is the source of truth**; the phone holds a cache
and a queue of anything not yet pushed.

Why it is built this way rather than on a hosted database:
[decisions/2026-09-09-training-tracker-architecture.md](../decisions/2026-09-09-training-tracker-architecture.md).

## What it does

- Sessions pre-filled from [programme v2](../training/programme-v2-draft.md) —
  tap a session and the exercises, rep ranges, RIR targets and rest periods are
  already there
- Logs **kg × reps × RIR** for lifts, **seconds** for holds, **kg × metres** for
  carries, rounds for circuits, and a bare count for the pull-up EMOM
- **Load and reps pre-fill from last time. Effort never does** — a pre-filled
  RIR saved untouched is a copy, not an observation, and every rule below reads
  RIR
- **Rest timer** auto-starts when a set is ticked, sized from the programme's
  prescribed rest, and counts up in green once it is over
- **Plate calculator** under every barbell lift — shows what to load per side,
  and says nothing when the load cannot be made from the plates on hand
- **Warm-up sets** — tap the set number to mark one. Warm-ups are excluded from
  every calculation
- **Substitutions recorded as substitutions.** Swap an exercise and the original
  name is kept in `substitutedFor`, so the history does not quietly become
  fiction
- Proposes next week's load per exercise with the rule and the one-line reason,
  and records whether you took it
- Flags a deload, with the evidence that raised it
- Separate **Body** tab for bodyweight on non-training days and the four-weekly
  floor benchmarks from [daily-floor.md](../training/daily-floor.md)
- **Backdating.** The date field at the top of a session can be set to any past
  day, for a session you did but never logged. Changing it also moves the window
  the progression rules read, so a session logged late is progressed against the
  sessions that actually came before it, not after
- Works offline; writes to the repo when signal returns
- Installs to the home screen (PWA)

A normal working set is two taps: the RIR chip, then ✓.

## The progression rules

Double progression against the coach's prescribed rep range, gated on logged
RIR. Rules are evaluated in order and **the first match wins**, which matters
because more than one can be true of the same session.

| # | When | What it proposes |
|---|---|---|
| R6 | Deload week | 65% of working load at the bottom of the range |
| R0 | Fewer working sets logged than prescribed | Hold — the session was cut short |
| R5 | R4 fired on each of the last two evaluations | Down 10%, rebuild from `rep_min` |
| R1 | Every working set at the top of the range, median RIR **at or above** target | +1 increment, back to `rep_min` |
| R1b | Same, but one increment is over 10% of the current load | Add a rep instead of the load |
| R2 | Top of range, median RIR **below** target | Hold — own it first |
| R4 | Two or more sets below `rep_min` | Hold |
| R3 | Anything else | Hold, add a rep to the weakest set |

**R1b is the one worth explaining.** A 2 kg jump on a 10 kg dumbbell is a 20%
increase. Capping increases by a percentage would forbid the only increase the
equipment physically allows and the exercise would silently never progress, so
the guard extends the rep range instead.

Deload sessions are excluded from progression maths, or the deliberately light
numbers poison the next recommendation.

## The deload triggers

The **cadence** rule is the coach's: programme v2 says every 4–6 weeks and
non-negotiable in a deficit. It ships at 5 and is settable. The rest are
autoregulated and can only pull a deload *earlier*.

| Code | Trigger | Severity |
|---|---|---|
| CADENCE | Weeks since the last deload ≥ the setting | Severe |
| D1 | Rolling-3 estimated 1RM down >5% from the trailing six-week best, on two or more main lifts | Severe |
| D2 | Weekly median RIR 1.5 or more below target, on three or more exercises | Severe |
| D3 | 30%+ of logged working sets fell below the rep range | Moderate |
| D4 | Session RPE averaging 9+ across the week | Moderate |
| D5 | Two or fewer of four sessions logged | Informational |
| D6 | Bodyweight down >2% in a week | Moderate, **off during a cut** |

Any one severe trigger, or any two moderate ones in the same week, raises the
flag. **D5 never fires alone** — missing sessions *reduces* accumulated fatigue,
so prescribing a deload for not training is backwards. It is there because
missed sessions usually signal life stress, which is a recovery input, and it
is surfaced as context rather than as evidence.

**D6 is off while the block goal is `cut`** (Settings → Programme), or it fires
every time you deliberately diet.

The prescription — 65% of working load, bottom of the rep range, one week,
resume at 95% — is a proposal, not the coach's. The programme fixes the cadence
and says nothing about the dose. Change it in the `DELOAD` object in
`index.html` if he does.

**Set RPE and session RPE are different measurements** and are stored in
different fields. Per-set effort is RIR, which is what the programme speaks in.
`sessionRpe` is the whole session on the Borg CR10 scale, and only D4 reads it.

## Where the data goes

One JSON file per session, into **`danbeseda-axolt/dan-brain`** at
`training/log/YYYY-MM-DD-<session>.json`. Bodyweight and floor benchmarks go
into `training/log/bw-YYYY-MM.json`, one file per month rather than one per
weigh-in — a year of daily entries is 12 files, not 365.

That's deliberate: the log lands inside the knowledge base, so the trainer
context reads actual sessions instead of asking for a CSV export. No export
step, no triage.

Logging the same session twice on one day updates that day's file rather than
creating a second one. Editing or deleting a past session pushes a new commit;
git keeps every earlier version, so a bad edit is recoverable.

Each session file carries the decision log: what each rule proposed, what you
actually did, and whether that counts as accepted or overridden. That is the
only honest signal that a threshold is wrong. Nothing retunes itself — if R1 is
being overridden a third of the time, the fix is to change the threshold by
hand with the evidence in front of you.

## Setup

### 1. Create a token — you do this, not me

GitHub → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token.

- **Repository access:** Only select repositories → `dan-brain`
- **Permissions:** Repository permissions → **Contents: Read and write**
- **Expiration:** set one. 90 days is sensible; you'll rotate it.

Nothing else. That token can touch one repo's files and nothing else on your
account.

**Paste it into the app's Settings screen on your phone. Never paste it into a
chat with me, or anywhere else.** If the phone is lost or the token leaks,
revoke it on that same GitHub page and generate a new one — that's the whole
recovery procedure.

### 2. Host it

The app is static — one HTML file plus a manifest and service worker. It has no
secrets in it, so the code can be public even though the data repo is private.

**Option A — GitHub Pages (free, needs a public repo for the code).** Create a
new public repo, e.g. `ledger`, push the contents of this folder to it, then
Settings → Pages → deploy from `main` / root. You get
`https://danbeseda-axolt.github.io/ledger/`.

**Option B — Netlify Drop or Cloudflare Pages.** Drag this folder onto
[app.netlify.com/drop](https://app.netlify.com/drop). Instant URL, no repo, no
build.

**Option C — GitHub Pages directly from `dan-brain`.** Only works if the account
has a paid plan (Pages on private repos is a paid feature). Simplest if you have
it.

A service worker needs HTTPS, so all three work but opening `index.html` as a
local file will not give you offline mode.

### 3. Add to home screen

Open the URL on the phone → Share → **Add to Home Screen**. It then launches
full-screen like an app.

### 4. First run

Settings → fill in owner / repo / branch / path → paste the token → **Test**.
It reports whether the token actually has write access, so you find out now
rather than at the end of a session.

Then set the block goal to **cut** and the deload cadence to **5** weeks.

## Why this can't lose your data the way the old one did

- Every keystroke saves to the phone immediately, so a crash mid-session costs
  nothing
- "Finish" pushes to GitHub; if that fails the session sits in a queue with a
  visible badge and retries when you next open the app or regain signal
- The queue is never cleared until the push confirms
- Once pushed it's in git — versioned, on GitHub's servers, and readable by
  anything that can read the repo
- An edit is a new commit, never an overwrite of the only copy
- Settings → Export JSON gives you an offline copy on demand

The only thing a lost phone can now lose is a session logged offline and never
synced.

## Adding or changing exercises

Templates live in the `TEMPLATES` object at the top of the `<script>` in
`index.html`. Edit and redeploy. You can also add a one-off exercise from
inside a session without touching the code.

Per exercise: `kind` controls the input fields — `weight` (kg/reps/RIR), `reps`
(a bare count), `time` (seconds), `distance` (kg/metres), `rounds`. `rep` is the
prescribed range, `rir` the target, `inc` the smallest useful load jump, `rest`
the prescribed rest in seconds, `bar` the bar weight (which turns on the plate
calculator), and `key: true` marks a main lift for deload trigger D1.

**When the coach writes block 3, the templates are the thing to update**, and
the rules read the numbers from there rather than having them baked in.

## Updating the app

The service worker is network-first for the app shell, so a redeploy is picked
up the next time you open it online. If a change ever seems stuck, bump
`VERSION` in `sw.js`.
