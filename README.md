# Ledger — training tracker

**As of:** 2026-08-30

Phone-first training log. Replaces the old localStorage-only Ledger that lost
its data. **The GitHub repo is the source of truth**; the phone holds a cache
and a queue of anything not yet pushed.

## What it does

- Sessions pre-filled from [programme v2](../training/programme-v2-draft.md) —
  tap a session, the exercises are already there
- Logs **kg × reps × RIR** for lifts, **seconds** for holds, **kg × metres** for
  carries, and rounds for circuits
- Notes per exercise and per session
- Shows last session's numbers inline, with a double-progression suggestion
  (top of rep range at RIR at-or-above target → +2.5 kg)
- Flags a deload when a main lift sits at the same load three sessions running
- Works offline; writes to the repo when signal returns
- Installs to the home screen (PWA)

## Where the data goes

One JSON file per session, into **`danbeseda-axolt/dan-brain`** at
`training/log/YYYY-MM-DD-<session>.json`.

That's deliberate: the log lands inside the knowledge base, so the trainer
context reads actual sessions instead of asking for a CSV export. No export
step, no triage.

Logging the same session twice on one day updates that day's file rather than
creating a second one.

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

## Why this can't lose your data the way the old one did

- Every keystroke saves to the phone immediately, so a crash mid-session costs
  nothing
- "Finish" pushes to GitHub; if that fails the session sits in a queue with a
  visible badge and retries when you next open the app or regain signal
- The queue is never cleared until the push confirms
- Once pushed it's in git — versioned, on GitHub's servers, and readable by
  anything that can read the repo
- Settings → Export JSON gives you an offline copy on demand

The only thing a lost phone can now lose is a session logged offline and never
synced.

## Adding or changing exercises

Templates live in the `TEMPLATES` object at the top of the `<script>` in
`index.html`. Edit and redeploy. You can also add a one-off exercise from
inside a session without touching the code.

`kind` controls the input fields: `weight` (kg/reps/RIR), `time` (seconds),
`distance` (kg/metres), `rounds`.

## Updating the app

The service worker is network-first for the app shell, so a redeploy is picked
up the next time you open it online. If a change ever seems stuck, bump
`VERSION` in `sw.js`.
