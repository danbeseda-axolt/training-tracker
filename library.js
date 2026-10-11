// @ts-check
/* Ledger starter-programme library. Pure data plus two trivial helpers; the
   generator lives elsewhere. Generic content only: this folder is public.

   As of 2026-10-11.

   THE FIVE ANSWERS
     days    2 | 3 | 4 | 5
     place   'gym' | 'db' (dumbbells + bench) | 'home' (bodyweight)
     level   'new' | 'some' (under 2 years) | 'exp'     -> LEVELS gives 1 | 2 | 3
     pain    any of 'back' | 'knees' | 'shoulders', or none
     minutes 45 | 60 | 75
   Optional extra (ask only on db / home): has = { bar, bands }, both default
   false there. On 'gym' all of bar, bands, step are true. 'step' (sturdy chair
   or box) and a loaded backpack are assumed everywhere.

   SELECTION RULES (deterministic; implement exactly in this order)
   1. Day list = SPLITS[days]. Each day is a list of slots, already in priority
      order (first = most important).
   2. Eligible exercises for a slot's pattern:
        equip includes place; every item in `needs` is in has;
        level <= LEVELS[level]; no pain flag in `avoid`;
        if `roles` is set, the slot's role is in it.
      PAIN_RULES.preferFirst reorders the candidates (step 4).
   3. If eligible is empty: use PAIN_RULES.fallback[pattern] (a pattern) when
      pain is set or the pattern has no equipment option; re-run step 2 with
      the new pattern, role unchanged. If still empty, or the role is
      'accessory' (PAIN_RULES.fallbackRoles), DROP the slot (never fill a gap
      with something unsuitable). A slot created by fallback must not repeat an
      exercise already on that day (take the next candidate, else drop it).
      Example: no vertical pull for a home user without a bar becomes a row.
      PAIN_RULES.fallbackMaxOnDay caps this (see there): no overhead press
      becomes a chest-press variant, never a row; no vertical pull becomes a row
      only while the day has fewer than 2 rows.
   4. Order candidates: ids in PAIN_RULES.preferFirst[pain][pattern] (for each
      selected pain, in the order the user's pains are listed) come first, then
      PICK_ORDER[pattern][level] order. PICK_ORDER lists are also the swap-list
      order: the picker shows all eligible candidates in that order.
   5. Assign across the whole week, not day by day: all 'main' slots first, then
      'secondary', then 'accessory', each in SPLITS order.
        main slots of the same pattern REPEAT the same exercise (progression
        needs the same name and history; novices need the practice).
        secondary and accessory take the first candidate not already used this
        week; if all are used, reuse the first. (So a hinge secondary on one
        day differs from the hinge main on another when an alternative exists.)
   6. Dose = DOSE[role][level]. Apply PAIN_RULES.rirFloor: rir = max(dose rir,
      floor) for the affected patterns. kind 'time' / 'distance' / 'reps' /
      'band' use sets from DOSE and the exercise's own rep (or dist / seed);
      rir applies to 'weight' and 'band' only. Exercise `rest` overrides DOSE rest.
   7. Trim for time with TIME (slots are kept in order until the budget is
      spent; dropped slots from step 3 do not count).
   8. 'light' days (day 5) take one set off every slot, minimum 2.

   Exercise `id` is a stable key; `n` is the display name and, as in the rest of
   the app, the key to history: do not rename once shipped.
   `form` is a YouTube SEARCH link (see report: no individual video could be
   verified as from a named coach). Swap in a watch URL per exercise later. */

export const LEVELS = { new: 1, some: 2, exp: 3 };
export const PLACES = ['gym', 'db', 'home'];
export const PAIN_FLAGS = ['back', 'knees', 'shoulders'];

const ALL = ['gym', 'db', 'home'];
const WT = ['gym', 'db'];
/** @param {string} q */
const yt = q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' form tutorial');

/* ------------------------------------------------------------ patterns */
export const PATTERNS = {
  squat:  { label: 'Squat (knees and hips bend, upright body)' },
  hinge:  { label: 'Hip hinge (bend at the hips, back flat)' },
  lunge:  { label: 'Single-leg (lunges and split squats)' },
  hpush:  { label: 'Push forward (chest)' },
  vpush:  { label: 'Push overhead (shoulders)' },
  hpull:  { label: 'Row (pull toward you)' },
  vpull:  { label: 'Pull down or up (back and lats)' },
  biceps: { label: 'Biceps' },
  triceps:{ label: 'Triceps' },
  core:   { label: 'Core (stay braced, resist movement)' },
  carry:  { label: 'Carry (walk holding weight)' },
  calves: { label: 'Calves' }
};

/* ------------------------------------------------------------ exercises
   equip: places it works in. needs: extra kit ('bar' pull-up bar, 'bands',
   'step' chair or box). level: 1 beginner .. 3 advanced. avoid: pain flags it
   is unsuitable for. roles: optional, limits where it may be used. */
export const EXERCISES = [
  /* ---- squat */
  { id: 'goblet-squat', n: 'Goblet squat', pattern: 'squat', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2, form: yt('goblet squat'),
    note: 'Hold one dumbbell at your chest. Sit down between your heels, chest up, then stand.',
    why: 'Easiest squat to learn; the weight keeps you upright.' },
  { id: 'box-squat', n: 'Box squat (to a chair)', pattern: 'squat', equip: ALL, needs: ['step'], level: 1, avoid: [],
    kind: 'weight', load: 'bw', rep: [10, 15], seed: { reps: 8 }, form: yt('box squat to chair bodyweight'),
    note: 'Sit back until you lightly touch a chair, then stand up. Slow down, no dropping onto it.',
    why: 'No equipment, a set depth, and easy on cranky knees.' },
  { id: 'leg-press', n: 'Leg press', pattern: 'squat', equip: ['gym'], needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 5, form: yt('leg press'),
    note: 'Feet shoulder-width, lower until knees are about 90 degrees, back flat on the pad.',
    why: 'Machine holds you steady, so you can push the legs hard safely.' },
  { id: 'back-squat', n: 'Barbell back squat', pattern: 'squat', equip: ['gym'], needs: [], level: 2, avoid: ['back', 'knees'],
    kind: 'weight', inc: 2.5, bar: 20, key: true, form: yt('barbell back squat'),
    note: 'Bar on your upper back, brace like you are about to be pushed, sit down and drive up. Use the safety bars.',
    why: 'The classic strength lift; needs a few weeks of practice first.' },

  /* ---- hinge */
  { id: 'glute-bridge', n: 'Glute bridge', pattern: 'hinge', equip: ALL, needs: [], level: 1, avoid: [],
    kind: 'weight', load: 'bw', rep: [10, 15], seed: { reps: 10 }, form: yt('glute bridge'),
    note: 'Lie on your back, knees bent. Push your hips up until your body is a straight line, squeeze, lower.',
    why: 'Zero-risk hip exercise for the back and a good first hinge.' },
  { id: 'single-leg-glute-bridge', n: 'Single-leg glute bridge', pattern: 'hinge', equip: ALL, needs: [], level: 2, avoid: [],
    kind: 'weight', load: 'bw', rep: [8, 12], seed: { reps: 6 }, form: yt('single leg glute bridge'),
    note: 'Like the glute bridge on one leg, other knee pulled in. Keep your hips level.',
    why: 'Harder bodyweight version when two legs get easy.' },
  { id: 'db-hip-thrust', n: 'Dumbbell hip thrust', pattern: 'hinge', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2, rep: [8, 12], form: yt('dumbbell hip thrust bench'),
    note: 'Upper back on a bench, dumbbell on your hips. Drive up, ribs down, squeeze the glutes at the top.',
    why: 'Loads the glutes without loading the lower back.' },
  { id: 'db-rdl', n: 'Dumbbell Romanian deadlift', pattern: 'hinge', equip: WT, needs: [], level: 1, avoid: ['back'],
    kind: 'weight', inc: 2, form: yt('dumbbell romanian deadlift'),
    note: 'Soft knees. Push your hips back, dumbbells slide down your legs, back flat. Stand by squeezing the glutes.',
    why: 'Teaches the hinge with light weight you can control.' },
  { id: 'deadlift', n: 'Deadlift', pattern: 'hinge', equip: ['gym'], needs: [], level: 3, avoid: ['back'],
    kind: 'weight', inc: 2.5, bar: 20, key: true, rep: [5, 8], form: yt('conventional deadlift'),
    note: 'Bar over mid-foot, back flat, push the floor away. Film one set from the side.',
    why: 'Biggest total-body lift; worth it only once the hinge is solid.' },

  /* ---- lunge / single leg */
  { id: 'reverse-lunge', n: 'Reverse lunge', pattern: 'lunge', equip: ALL, needs: [], level: 1, avoid: [],
    kind: 'weight', load: 'bw+', inc: 2, rep: [8, 12], seed: { kg: 0, reps: 8 }, form: yt('reverse lunge'),
    note: 'Step back, lower the back knee toward the floor, push through the front heel. Per leg. Short steps are fine.',
    why: 'Stepping back is the kinder lunge for knees.' },
  { id: 'split-squat', n: 'Split squat', pattern: 'lunge', equip: ALL, needs: [], level: 1, avoid: ['knees'],
    kind: 'weight', load: 'bw+', inc: 2, rep: [8, 12], seed: { kg: 0, reps: 8 }, form: yt('split squat'),
    note: 'Feet staggered and fixed. Lower straight down, front foot flat, then up. Per leg.',
    why: 'Steady single-leg work without the balance of a walking lunge.' },
  { id: 'step-up', n: 'Step-up', pattern: 'lunge', equip: ALL, needs: ['step'], level: 1, avoid: ['knees'],
    kind: 'weight', load: 'bw+', inc: 2, rep: [8, 12], seed: { kg: 0, reps: 8 }, form: yt('dumbbell step up'),
    note: 'Whole foot on a knee-high step. Stand up using that leg only, lower slowly. Per leg.',
    why: 'Everyday-strength move; one leg does the work.' },
  { id: 'bulgarian-split-squat', n: 'Bulgarian split squat', pattern: 'lunge', equip: ALL, needs: ['step'], level: 2, avoid: ['knees'],
    kind: 'weight', load: 'bw+', inc: 2, rep: [8, 12], seed: { kg: 0, reps: 8 }, form: yt('bulgarian split squat'),
    note: 'Back foot on a bench or chair. Lower straight down on the front leg. Per leg. Start with bodyweight.',
    why: 'Hard, effective leg builder once split squats are easy.' },

  /* ---- horizontal push */
  { id: 'incline-pushup', n: 'Incline push-up', pattern: 'hpush', equip: ALL, needs: ['step'], level: 1, avoid: [],
    kind: 'weight', load: 'bw', rep: [8, 15], seed: { reps: 8 }, form: yt('incline push up'),
    note: 'Hands on a bench or sturdy table, body in one straight line. Chest to the edge, press away. Lower the surface to make it harder.',
    why: 'A push-up you can actually finish with good form.' },
  { id: 'pushup', n: 'Push-up', pattern: 'hpush', equip: ALL, needs: [], level: 2, avoid: [],
    kind: 'weight', load: 'bw', rep: [6, 15], seed: { reps: 6 }, form: yt('push up'),
    note: 'Hands under shoulders, body straight, elbows about 45 degrees from your sides. Chest to the floor.',
    why: 'Bodyweight standard; no kit needed.' },
  { id: 'chest-press-machine', n: 'Chest press machine', pattern: 'hpush', equip: ['gym'], needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2.5, form: yt('chest press machine'),
    note: 'Seat so the handles are at mid-chest. Press out, do not lock hard, lower slowly.',
    why: 'Fixed path: the easiest way to learn pressing.' },
  { id: 'db-bench-press', n: 'Dumbbell bench press', pattern: 'hpush', equip: WT, needs: [], level: 1, avoid: ['shoulders'],
    kind: 'weight', inc: 2, rep: [8, 12], form: yt('dumbbell bench press'),
    note: 'Per hand. Lie on the bench, shoulder blades pinched, lower to chest level and press up.',
    why: 'Classic chest builder; each arm works on its own.' },
  { id: 'neutral-grip-db-press', n: 'Neutral-grip dumbbell press', pattern: 'hpush', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2, rep: [8, 12], form: yt('neutral grip dumbbell bench press'),
    note: 'Per hand. Palms face each other, elbows close to your sides. Lower to chest, press up.',
    why: 'Friendlier on the shoulders than the standard grip.' },
  { id: 'barbell-bench', n: 'Barbell bench press', pattern: 'hpush', equip: ['gym'], needs: [], level: 2, avoid: ['shoulders'],
    kind: 'weight', inc: 2.5, bar: 20, key: true, rep: [5, 8], form: yt('barbell bench press'),
    note: 'Shoulder blades pinched, feet planted, lower to mid-chest and press. Use a spotter or safety arms.',
    why: 'The standard heavy chest lift.' },

  /* Added 2026-10-11: shoulder-tolerant pressing so push and pull stay balanced
     when overhead work is ruled out. Judgement calls, not medical advice. */
  { id: 'db-floor-press', n: 'Dumbbell floor press', pattern: 'hpush', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2, rep: [8, 12], form: yt('dumbbell floor press'),
    note: 'Per hand. Lie on the floor, palms facing each other if that feels better. Lower until your upper arms touch the floor, pause, press up.',
    why: 'The floor stops the stretch at the bottom, which most sore shoulders like.' },
  { id: 'squeeze-press', n: 'Dumbbell squeeze press', pattern: 'hpush', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2, rep: [10, 15], form: yt('dumbbell squeeze press'),
    note: 'Lie on the bench or floor, press two dumbbells together over your chest and keep squeezing them the whole set. Lower to chest, press up. Light weight.',
    why: 'Elbows stay in and the shoulders stay calm; a light chest burner.' },
  { id: 'pushup-on-handles', n: 'Push-up on dumbbells or handles', pattern: 'hpush', equip: ALL, needs: [], level: 2, avoid: [],
    kind: 'weight', load: 'bw', rep: [6, 15], seed: { reps: 6 }, form: yt('push up on dumbbells neutral grip'),
    note: 'Hands on two sturdy dumbbells (hex ones) or handles, palms facing each other, elbows close to your sides. Body straight, chest down between your hands.',
    why: 'Neutral wrists and tucked elbows are easier on the shoulders than a flat-hand push-up.' },

  /* ---- vertical push
     No shoulder-safe overhead press is offered for db or home. Landmine press
     (gym, level 2) is the only one; everything else keeps the flag in `avoid`.
     A half-kneeling single-arm press was left out on purpose: it is still an
     overhead press. */
  { id: 'seated-db-press', n: 'Seated dumbbell shoulder press', pattern: 'vpush', equip: WT, needs: [], level: 1, avoid: ['shoulders'],
    kind: 'weight', inc: 2, rep: [8, 12], form: yt('seated dumbbell shoulder press'),
    note: 'Per hand. Back against the bench, press straight up over your shoulders, lower to ear level.',
    why: 'Back support makes it easy to stay tidy.' },
  { id: 'pike-pushup', n: 'Pike push-up', pattern: 'vpush', equip: ALL, needs: [], level: 1, avoid: ['shoulders'],
    kind: 'weight', load: 'bw', rep: [6, 12], seed: { reps: 5 }, form: yt('pike push up'),
    note: 'Hips high in an upside-down V. Bend your elbows to bring your head toward the floor, press back. Hands on a chair makes it easier.',
    why: 'Overhead press with no equipment.' },
  { id: 'landmine-press', n: 'Landmine press', pattern: 'vpush', equip: ['gym'], needs: [], level: 2, avoid: [],
    kind: 'weight', inc: 2.5, rep: [8, 12], form: yt('landmine press'),
    note: 'Bar end wedged in a corner. Press it up and forward at an angle, one arm at a time.',
    why: 'An angled press that most sore shoulders tolerate.' },
  { id: 'overhead-press', n: 'Barbell overhead press', pattern: 'vpush', equip: ['gym'], needs: [], level: 3, avoid: ['shoulders'],
    kind: 'weight', inc: 2.5, bar: 20, key: true, rep: [5, 8], form: yt('barbell overhead press'),
    note: 'Standing, glutes tight, ribs down. Press straight up, head moves through at the end.',
    why: 'Strong, simple shoulder lift for experienced lifters.' },

  /* ---- horizontal pull */
  { id: 'seated-cable-row', n: 'Seated cable row', pattern: 'hpull', equip: ['gym'], needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2.5, rep: [8, 12], form: yt('seated cable row'),
    note: 'Sit tall, pull the handle to your belly, squeeze the shoulder blades, return slowly.',
    why: 'Seated and supported: the back is spared.' },
  { id: 'chest-supported-db-row', n: 'Chest-supported dumbbell row', pattern: 'hpull', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2, rep: [8, 12], form: yt('chest supported dumbbell row incline bench'),
    note: 'Per hand. Lie chest-down on an incline bench, pull the dumbbells to your ribs, lower slowly.',
    why: 'The bench holds your torso, so only the back works.' },
  { id: 'db-row', n: 'One-arm dumbbell row', pattern: 'hpull', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2, rep: [8, 12], form: yt('one arm dumbbell row'),
    note: 'Per side. One hand and one knee on the bench, back flat, pull the dumbbell to your hip.',
    why: 'Simple, supported, easy to progress.' },
  { id: 'inverted-row', n: 'Inverted row', pattern: 'hpull', equip: ALL, needs: ['bar'], level: 2, avoid: [],
    kind: 'weight', load: 'bw', rep: [6, 12], seed: { reps: 6 }, form: yt('inverted row'),
    note: 'Hang under a low bar or sturdy table, body straight, pull your chest to it. Feet closer to the bar = easier.',
    why: 'The best bodyweight row if you have a bar or a strong table.' },
  { id: 'band-row', n: 'Band row', pattern: 'hpull', equip: ALL, needs: ['bands'], level: 1, avoid: [],
    kind: 'band', rep: [10, 15], form: yt('resistance band seated row'),
    note: 'Loop the band around your feet or a door anchor. Pull to your belly, squeeze, return slowly.',
    why: 'A row you can do anywhere with a band.' },
  { id: 'backpack-row', n: 'One-arm backpack row', pattern: 'hpull', equip: ['home'], needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 1, rep: [8, 12], form: yt('one arm row with backpack'),
    note: 'Per side. Hand and knee on a chair or bed, backpack loaded with books, pull it to your hip. Log the bag weight.',
    why: 'A row with no gym kit, loaded with a backpack.' },
  { id: 'prone-y-raise', n: 'Prone Y raise', pattern: 'hpull', equip: ALL, needs: [], level: 1, avoid: [], roles: ['secondary', 'accessory'],
    kind: 'reps', rep: [10, 15], seed: { reps: 10 }, form: yt('prone y raise'),
    note: 'Lie face-down, arms overhead in a Y. Lift your arms a little off the floor, chest stays down, lower slowly.',
    why: 'Gentle upper-back work with no kit; a filler when there is nothing to pull.' },

  /* ---- vertical pull */
  { id: 'lat-pulldown', n: 'Lat pulldown', pattern: 'vpull', equip: ['gym'], needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2.5, rep: [8, 12], form: yt('lat pulldown'),
    note: 'Pull the bar to your upper chest (never behind your neck), elbows down and back, return slowly.',
    why: 'Lets you build toward pull-ups at any strength.' },
  { id: 'negative-chin-up', n: 'Slow lowering chin-up', pattern: 'vpull', equip: ALL, needs: ['bar'], level: 1, avoid: [],
    kind: 'reps', rep: [3, 6], seed: { reps: 3 }, form: yt('negative chin up'),
    note: 'Step or jump to the top of a chin-up, then lower yourself for 4 to 5 seconds. Each rep is one slow lowering.',
    why: 'The classic way to earn your first chin-up.' },
  { id: 'chin-up', n: 'Chin-up', pattern: 'vpull', equip: ALL, needs: ['bar'], level: 2, avoid: [],
    kind: 'weight', load: 'bw+', inc: 2.5, rep: [4, 8], seed: { kg: 0, reps: 4 }, form: yt('chin up'),
    note: 'Palms toward you, hang with straight arms, pull until your chin clears the bar, lower under control. Added kg, 0 = bodyweight.',
    why: 'Strongest bodyweight pull; add weight when it gets easy.' },
  { id: 'band-pulldown', n: 'Band pulldown', pattern: 'vpull', equip: ALL, needs: ['bands'], level: 1, avoid: [],
    kind: 'band', rep: [10, 15], form: yt('resistance band lat pulldown'),
    note: 'Anchor the band high (door top). Kneel, pull the band to your chest, elbows down, return slowly.',
    why: 'A pulldown anywhere with only a band.' },
  { id: 'db-pullover', n: 'Dumbbell pullover', pattern: 'vpull', equip: WT, needs: [], level: 1, avoid: ['shoulders'], roles: ['secondary', 'accessory'],
    kind: 'weight', inc: 2, rep: [10, 15], form: yt('dumbbell pullover'),
    note: 'Lie across a bench, one dumbbell held over your chest with both hands. Lower it back past your head with soft elbows, then pull it up.',
    why: 'The only lat work with just dumbbells and no bar.' },

  /* ---- biceps */
  { id: 'db-curl', n: 'Dumbbell curl', pattern: 'biceps', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2, rep: [10, 15], form: yt('dumbbell bicep curl'),
    note: 'Per hand. Elbows at your sides, curl up, lower slowly. No swinging.',
    why: 'The basic biceps move.' },
  { id: 'hammer-curl', n: 'Hammer curl', pattern: 'biceps', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2, rep: [10, 15], form: yt('hammer curl'),
    note: 'Per hand. Palms face each other the whole way. Elbows pinned, curl, lower slowly.',
    why: 'Easier on the wrists and works the forearm too.' },
  { id: 'incline-db-curl', n: 'Incline dumbbell curl', pattern: 'biceps', equip: WT, needs: [], level: 2, avoid: ['shoulders'],
    kind: 'weight', inc: 2, rep: [10, 15], form: yt('incline dumbbell curl'),
    note: 'Per hand. Lean back on an incline bench, arms hanging. Curl without moving your elbows forward.',
    why: 'Stretches the biceps; a good second curl once the basic one stalls.' },
  { id: 'band-curl', n: 'Band curl', pattern: 'biceps', equip: ALL, needs: ['bands'], level: 1, avoid: [],
    kind: 'band', rep: [12, 20], form: yt('resistance band bicep curl'),
    note: 'Stand on the band, elbows at your sides, curl to your shoulders, lower slowly.',
    why: 'Biceps work with only a band.' },

  /* ---- triceps */
  { id: 'triceps-pushdown', n: 'Triceps pushdown', pattern: 'triceps', equip: ['gym'], needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 2.5, rep: [10, 15], form: yt('triceps cable pushdown'),
    note: 'Elbows tucked at your sides, push the handle down until your arms are straight, return slowly.',
    why: 'Simple, joint-friendly triceps work.' },
  { id: 'overhead-db-extension', n: 'Overhead dumbbell triceps extension', pattern: 'triceps', equip: WT, needs: [], level: 1, avoid: ['shoulders'],
    kind: 'weight', inc: 2, rep: [10, 15], form: yt('overhead dumbbell triceps extension'),
    note: 'One dumbbell in both hands overhead. Bend the elbows to lower it behind your head, straighten. Keep elbows pointing forward.',
    why: 'Works the biggest triceps muscle with one dumbbell.' },
  { id: 'db-kickback', n: 'Dumbbell triceps kickback', pattern: 'triceps', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'weight', inc: 1, rep: [12, 15], form: yt('dumbbell triceps kickback'),
    note: 'Per arm. Hand and knee on a bench, upper arm held against your side. Straighten the elbow, squeeze, lower slowly. Light weight.',
    why: 'Elbow-only movement; the arm stays by your side, not overhead.' },
  { id: 'db-skull-crusher', n: 'Dumbbell skull crusher', pattern: 'triceps', equip: WT, needs: [], level: 2, avoid: [],
    kind: 'weight', inc: 2, rep: [10, 15], form: yt('dumbbell skull crusher'),
    note: 'Lie on a bench, dumbbells over your chest with arms straight. Bend only at the elbows to lower them beside your head, then straighten. Stop if your elbows complain.',
    why: 'Strong triceps work with the arms in front of you, not overhead.' },
  { id: 'bench-dip', n: 'Bench dip', pattern: 'triceps', equip: ALL, needs: ['step'], level: 1, avoid: ['shoulders'],
    kind: 'weight', load: 'bw', rep: [8, 15], seed: { reps: 8 }, form: yt('bench dips'),
    note: 'Hands on a chair behind you, feet out in front. Lower until elbows are about 90 degrees, press up. Bend knees to make it easier.',
    why: 'Bodyweight triceps; the knees-bent version is a good start.' },
  { id: 'band-pushdown', n: 'Band pushdown', pattern: 'triceps', equip: ALL, needs: ['bands'], level: 1, avoid: [],
    kind: 'band', rep: [12, 20], form: yt('resistance band triceps pushdown'),
    note: 'Anchor the band high. Elbows at your sides, push down until your arms are straight, return slowly.',
    why: 'Triceps work with only a band.' },

  /* ---- core (kind reps/time: no kg) */
  { id: 'dead-bug', n: 'Dead bug', pattern: 'core', equip: ALL, needs: [], level: 1, avoid: [],
    kind: 'reps', rep: [8, 12], seed: { reps: 8 }, form: yt('dead bug exercise'),
    note: 'On your back, lower back pressed into the floor. Extend opposite arm and leg slowly, return. Count both sides as one rep.',
    why: 'Teaches you to brace; very low risk for the back.' },
  { id: 'bird-dog', n: 'Bird dog', pattern: 'core', equip: ALL, needs: [], level: 1, avoid: [],
    kind: 'reps', rep: [8, 12], seed: { reps: 8 }, form: yt('bird dog exercise'),
    note: 'On hands and knees, reach opposite arm and leg out, hold 2 seconds, return. Hips stay level.',
    why: 'Back-friendly core and balance work.' },
  { id: 'plank', n: 'Plank', pattern: 'core', equip: ALL, needs: [], level: 1, avoid: [],
    kind: 'time', rest: 45, seed: { seconds: 20 }, form: yt('plank'),
    note: 'Forearms down, body one straight line, glutes and abs tight. Stop when your hips sag, not when it burns.',
    why: 'Holds the whole trunk still.' },
  { id: 'side-plank', n: 'Side plank', pattern: 'core', equip: ALL, needs: [], level: 1, avoid: ['shoulders'],
    kind: 'time', rest: 45, seed: { seconds: 15 }, form: yt('side plank'),
    note: 'Per side. Forearm under your shoulder, hips lifted in a straight line. Knees bent is fine to start.',
    why: 'Builds the side-trunk strength that protects the back.' },
  { id: 'pallof-press', n: 'Pallof press', pattern: 'core', equip: ALL, needs: ['bands'], level: 2, avoid: [],
    kind: 'band', rep: [10, 12], form: yt('pallof press'),
    note: 'Per side. Band anchored at chest height beside you. Press your hands straight out and resist the band twisting you.',
    why: 'Anti-rotation core work; harder than it looks.' },
  { id: 'hanging-knee-raise', n: 'Hanging knee raise', pattern: 'core', equip: ALL, needs: ['bar'], level: 2, avoid: ['shoulders'],
    kind: 'weight', load: 'bw+', inc: 2, rep: [8, 12], seed: { kg: 0, reps: 6 }, form: yt('hanging knee raise'),
    note: 'Hang from a bar, lift your knees toward your chest slowly without swinging, lower with control.',
    why: 'Stronger abs and a grip workout.' },

  /* ---- carry */
  { id: 'farmers-carry', n: 'Farmer carry', pattern: 'carry', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'distance', dist: 30, rest: 90, form: yt('farmers carry'),
    note: 'A dumbbell in each hand, 30 m. Stand tall, shoulders back, small steps. Put them down when your grip or posture goes.',
    why: 'Grip, trunk and posture in one go.' },
  { id: 'suitcase-carry', n: 'Suitcase carry', pattern: 'carry', equip: WT, needs: [], level: 1, avoid: [],
    kind: 'distance', dist: 30, rest: 90, form: yt('suitcase carry'),
    note: 'One dumbbell in one hand, 30 m, per side. Do not lean; stay tall.',
    why: 'Trains your trunk to resist leaning; kind to the back.' },

  /* ---- calves */
  { id: 'standing-calf-raise', n: 'Standing calf raise', pattern: 'calves', equip: ALL, needs: [], level: 1, avoid: [],
    kind: 'weight', load: 'bw+', inc: 2, rep: [12, 20], rest: 60, seed: { kg: 0, reps: 12 }, form: yt('standing calf raise'),
    note: 'Toes on the edge of a step. Rise as high as you can, pause, lower slowly past flat. Hold a dumbbell to progress. Added kg, 0 = bodyweight.',
    why: 'Simple lower-leg strength; needs no kit.' }
];

/* ------------------------------------------------------------ PICK_ORDER
   Default and swap-list order by pattern and level. Each list contains every
   exercise of the pattern up to that level; the generator filters it. */
export const PICK_ORDER = {
  squat:  { new:  ['goblet-squat', 'box-squat', 'leg-press'],
            some: ['leg-press', 'goblet-squat', 'back-squat', 'box-squat'],
            exp:  ['back-squat', 'leg-press', 'goblet-squat', 'box-squat'] },
  hinge:  { new:  ['db-rdl', 'db-hip-thrust', 'glute-bridge'],
            some: ['db-rdl', 'db-hip-thrust', 'single-leg-glute-bridge', 'glute-bridge'],
            exp:  ['deadlift', 'db-rdl', 'db-hip-thrust', 'single-leg-glute-bridge', 'glute-bridge'] },
  lunge:  { new:  ['reverse-lunge', 'split-squat', 'step-up'],
            some: ['split-squat', 'reverse-lunge', 'step-up', 'bulgarian-split-squat'],
            exp:  ['bulgarian-split-squat', 'split-squat', 'reverse-lunge', 'step-up'] },
  hpush:  { new:  ['chest-press-machine', 'db-bench-press', 'neutral-grip-db-press', 'incline-pushup', 'db-floor-press', 'squeeze-press'],
            some: ['db-bench-press', 'chest-press-machine', 'neutral-grip-db-press', 'pushup', 'incline-pushup', 'barbell-bench', 'db-floor-press', 'squeeze-press', 'pushup-on-handles'],
            exp: ['barbell-bench', 'db-bench-press', 'chest-press-machine', 'neutral-grip-db-press', 'pushup', 'incline-pushup', 'db-floor-press', 'squeeze-press', 'pushup-on-handles'] },
  vpush:  { new:  ['seated-db-press', 'pike-pushup'],
            some: ['seated-db-press', 'landmine-press', 'pike-pushup'],
            exp:  ['overhead-press', 'seated-db-press', 'landmine-press', 'pike-pushup'] },
  hpull:  { new:  ['seated-cable-row', 'chest-supported-db-row', 'db-row', 'band-row', 'backpack-row', 'prone-y-raise'],
            some: ['seated-cable-row', 'db-row', 'chest-supported-db-row', 'inverted-row', 'band-row', 'backpack-row', 'prone-y-raise'],
            exp:  ['db-row', 'seated-cable-row', 'chest-supported-db-row', 'inverted-row', 'band-row', 'backpack-row', 'prone-y-raise'] },
  vpull:  { new:  ['lat-pulldown', 'negative-chin-up', 'band-pulldown', 'db-pullover'],
            some: ['lat-pulldown', 'chin-up', 'negative-chin-up', 'band-pulldown', 'db-pullover'],
            exp:  ['chin-up', 'lat-pulldown', 'negative-chin-up', 'band-pulldown', 'db-pullover'] },
  biceps: { new:  ['db-curl', 'hammer-curl', 'band-curl'],
            some: ['db-curl', 'hammer-curl', 'incline-db-curl', 'band-curl'],
            exp:  ['incline-db-curl', 'hammer-curl', 'db-curl', 'band-curl'] },
  triceps:{ new:  ['triceps-pushdown', 'overhead-db-extension', 'band-pushdown', 'bench-dip', 'db-kickback'],
            some: ['triceps-pushdown', 'overhead-db-extension', 'band-pushdown', 'bench-dip', 'db-kickback', 'db-skull-crusher'],
            exp:  ['overhead-db-extension', 'triceps-pushdown', 'band-pushdown', 'bench-dip', 'db-kickback', 'db-skull-crusher'] },
  core:   { new:  ['dead-bug', 'bird-dog', 'plank', 'side-plank'],
            some: ['dead-bug', 'plank', 'side-plank', 'bird-dog', 'pallof-press', 'hanging-knee-raise'],
            exp:  ['hanging-knee-raise', 'pallof-press', 'side-plank', 'plank', 'dead-bug', 'bird-dog'] },
  carry:  { new:  ['farmers-carry', 'suitcase-carry'],
            some: ['farmers-carry', 'suitcase-carry'],
            exp:  ['suitcase-carry', 'farmers-carry'] },
  calves: { new:  ['standing-calf-raise'], some: ['standing-calf-raise'], exp: ['standing-calf-raise'] }
};

/* ------------------------------------------------------------ splits
   Why these:
   2 days  Full body A/B. Each major pattern once; hinge twice. Minimum that
           still trains everything weekly.
   3 days  Full body A/B/C. Squat, hinge, push and pull all reach about twice a
           week; best value for new lifters and for 60 minutes.
   4 days  Upper / Lower x2. Every pattern twice, sessions stay short, and the
           two lower days differ (squat-led, hinge-led).
   5 days  The 4-day upper/lower plus a short light full-body day (day 5,
           `light`). Beats a push/pull/legs split here because it keeps every
           muscle at about twice a week without needing 6 days or long sessions.
           For 'new' it adds the least: more days is not better yet.
   Upper B lists its row before its press (Upper A is the reverse) so that when
   time trims an odd number of upper slots, push and pull even out across the
   week rather than on one day.
   Slots are in priority order; trimming for time removes from the END. Slots
   whose pattern has no option for the user are dropped, see the rules. */
/** @typedef {{pattern:string, role:'main'|'secondary'|'accessory'}} Slot */
/** @type {Record<number, {key:string, name:string, light?:boolean, slots:Slot[]}[]>} */
export const SPLITS = {
  2: [
    { key: 'full-a', name: 'Full body A', slots: [
      { pattern: 'squat', role: 'main' }, { pattern: 'hpush', role: 'main' }, { pattern: 'hpull', role: 'main' },
      { pattern: 'hinge', role: 'secondary' }, { pattern: 'core', role: 'accessory' },
      { pattern: 'triceps', role: 'accessory' }, { pattern: 'biceps', role: 'accessory' }] },
    { key: 'full-b', name: 'Full body B', slots: [
      { pattern: 'hinge', role: 'main' }, { pattern: 'vpush', role: 'main' }, { pattern: 'vpull', role: 'main' },
      { pattern: 'lunge', role: 'secondary' }, { pattern: 'core', role: 'accessory' },
      { pattern: 'carry', role: 'accessory' }, { pattern: 'calves', role: 'accessory' }] }
  ],
  3: [
    { key: 'full-a', name: 'Full body A', slots: [
      { pattern: 'squat', role: 'main' }, { pattern: 'hpush', role: 'main' }, { pattern: 'hpull', role: 'main' },
      { pattern: 'hinge', role: 'secondary' }, { pattern: 'core', role: 'accessory' },
      { pattern: 'biceps', role: 'accessory' }, { pattern: 'triceps', role: 'accessory' }] },
    { key: 'full-b', name: 'Full body B', slots: [
      { pattern: 'hinge', role: 'main' }, { pattern: 'vpush', role: 'main' }, { pattern: 'vpull', role: 'main' },
      { pattern: 'lunge', role: 'secondary' }, { pattern: 'carry', role: 'accessory' },
      { pattern: 'triceps', role: 'accessory' }, { pattern: 'calves', role: 'accessory' }] },
    { key: 'full-c', name: 'Full body C', slots: [
      { pattern: 'squat', role: 'main' }, { pattern: 'vpull', role: 'main' }, { pattern: 'hpush', role: 'secondary' },
      { pattern: 'hpull', role: 'secondary' }, { pattern: 'core', role: 'accessory' },
      { pattern: 'calves', role: 'accessory' }, { pattern: 'biceps', role: 'accessory' }] }
  ],
  4: [
    { key: 'upper-a', name: 'Upper A', slots: [
      { pattern: 'hpush', role: 'main' }, { pattern: 'hpull', role: 'main' }, { pattern: 'vpush', role: 'secondary' },
      { pattern: 'vpull', role: 'secondary' }, { pattern: 'triceps', role: 'accessory' },
      { pattern: 'biceps', role: 'accessory' }, { pattern: 'core', role: 'accessory' }] },
    { key: 'lower-a', name: 'Lower A', slots: [
      { pattern: 'squat', role: 'main' }, { pattern: 'hinge', role: 'secondary' }, { pattern: 'lunge', role: 'secondary' },
      { pattern: 'core', role: 'accessory' }, { pattern: 'calves', role: 'accessory' }, { pattern: 'carry', role: 'accessory' }] },
    { key: 'upper-b', name: 'Upper B', slots: [
      { pattern: 'vpush', role: 'main' }, { pattern: 'vpull', role: 'main' }, { pattern: 'hpull', role: 'secondary' },
      { pattern: 'hpush', role: 'secondary' }, { pattern: 'biceps', role: 'accessory' },
      { pattern: 'triceps', role: 'accessory' }, { pattern: 'core', role: 'accessory' }] },
    { key: 'lower-b', name: 'Lower B', slots: [
      { pattern: 'hinge', role: 'main' }, { pattern: 'squat', role: 'secondary' }, { pattern: 'lunge', role: 'secondary' },
      { pattern: 'core', role: 'accessory' }, { pattern: 'carry', role: 'accessory' }, { pattern: 'calves', role: 'accessory' }] }
  ],
  5: [
    { key: 'upper-a', name: 'Upper A', slots: [
      { pattern: 'hpush', role: 'main' }, { pattern: 'hpull', role: 'main' }, { pattern: 'vpush', role: 'secondary' },
      { pattern: 'vpull', role: 'secondary' }, { pattern: 'triceps', role: 'accessory' },
      { pattern: 'biceps', role: 'accessory' }, { pattern: 'core', role: 'accessory' }] },
    { key: 'lower-a', name: 'Lower A', slots: [
      { pattern: 'squat', role: 'main' }, { pattern: 'hinge', role: 'secondary' }, { pattern: 'lunge', role: 'secondary' },
      { pattern: 'core', role: 'accessory' }, { pattern: 'calves', role: 'accessory' }, { pattern: 'carry', role: 'accessory' }] },
    { key: 'upper-b', name: 'Upper B', slots: [
      { pattern: 'vpush', role: 'main' }, { pattern: 'vpull', role: 'main' }, { pattern: 'hpull', role: 'secondary' },
      { pattern: 'hpush', role: 'secondary' }, { pattern: 'biceps', role: 'accessory' },
      { pattern: 'triceps', role: 'accessory' }, { pattern: 'core', role: 'accessory' }] },
    { key: 'lower-b', name: 'Lower B', slots: [
      { pattern: 'hinge', role: 'main' }, { pattern: 'squat', role: 'secondary' }, { pattern: 'lunge', role: 'secondary' },
      { pattern: 'core', role: 'accessory' }, { pattern: 'carry', role: 'accessory' }, { pattern: 'calves', role: 'accessory' }] },
    { key: 'full-c', name: 'Full body (light)', light: true, slots: [
      { pattern: 'squat', role: 'secondary' }, { pattern: 'hpush', role: 'secondary' }, { pattern: 'hpull', role: 'secondary' },
      { pattern: 'vpull', role: 'secondary' }, { pattern: 'core', role: 'accessory' }, { pattern: 'carry', role: 'accessory' }] }
  ]
};

/* ------------------------------------------------------------ dose
   DOSE[role][level]. rep is the double-progression range; rir is the target
   reps in reserve; rest in seconds. Beginners: more reps, further from failure. */
export const DOSE = {
  main: {
    new:  { sets: 3, rep: [8, 12], rir: 3, rest: 120 },
    some: { sets: 3, rep: [6, 10], rir: 2, rest: 150 },
    exp:  { sets: 4, rep: [5, 8],  rir: 2, rest: 180 }
  },
  secondary: {
    new:  { sets: 2, rep: [10, 12], rir: 3, rest: 90 },
    some: { sets: 3, rep: [8, 12],  rir: 2, rest: 90 },
    exp:  { sets: 3, rep: [8, 12],  rir: 2, rest: 120 }
  },
  accessory: {
    new:  { sets: 2, rep: [12, 15], rir: 3, rest: 60 },
    some: { sets: 2, rep: [10, 15], rir: 2, rest: 60 },
    exp:  { sets: 3, rep: [10, 15], rir: 1, rest: 60 }
  }
};
/* Exercise `rep` (when set) replaces DOSE rep for that exercise; `rest` replaces
   DOSE rest. Keep DOSE as a starting point: the app's own progression rules move
   load from there. Optional gentle start for 'new': week 1, cap every exercise
   at 2 sets and RIR 4 (see START_EASY); the engineer may skip it. */
export const START_EASY = { new: { weeks: 1, maxSets: 2, rir: 4 } };

/* ------------------------------------------------------------ time
   Minutes a slot takes, including its warm-up sets and setup. Fill slots in
   order while the running total <= minutes - warmup. Slots lighter than a
   loaded lift (load 'bw', kind reps / time / band / distance) take
   lightFactor x the listed minutes, rounded up. At least minSlots per day. */
export const TIME = {
  warmup: 5,
  slotMinutes: {
    main:      { new: 13, some: 14, exp: 17 },
    secondary: { new: 8,  some: 9,  exp: 11 },
    accessory: { new: 6,  some: 6,  exp: 7 }
  },
  lightFactor: 0.75,
  minSlots: 3,
  /* Spare time after trimming: add one set to main slots, in order, while it
     fits, never past maxMainSets. Novices stay at the base dose. */
  fill: { perSetMinutes: { new: 3.5, some: 4, exp: 4.5 }, maxMainSets: { new: 3, some: 4, exp: 5 } }
};

/* ------------------------------------------------------------ pain
   Beyond per-exercise `avoid` (always applied) and the 'roles' limits. */
export const PAIN_MESSAGE = 'Stop any exercise that hurts and swap it. Pain that stays: see a physio.';

export const PAIN_RULES = {
  /* Shown as a note on the plan for each selected flag. */
  back: {
    text: 'Back: no loaded barbell squat or deadlift, hinges are glute bridges and hip thrusts where possible, rows are supported.',
    /* ids moved to the front of the candidate list for that pattern */
    preferFirst: {
      squat: ['goblet-squat', 'box-squat', 'leg-press'],
      hinge: ['glute-bridge', 'db-hip-thrust'],
      hpull: ['chest-supported-db-row', 'seated-cable-row']
    },
    /* minimum RIR for these patterns (applied as max(dose rir, floor)) */
    rirFloor: { squat: 3, hinge: 3, lunge: 2, hpull: 2, carry: 2 }
  },
  knees: {
    text: 'Knees: shallow squats to a chair or box, step back rather than forward in lunges, stop before any knee pain.',
    preferFirst: {
      squat: ['box-squat', 'goblet-squat', 'leg-press'],
      lunge: ['reverse-lunge']
    },
    rirFloor: { squat: 3, lunge: 3 }
  },
  shoulders: {
    text: 'Shoulders: neutral-grip or machine pressing, no overhead pressing on dumbbells or a bar, front-grip pulldowns only.',
    preferFirst: {
      hpush: ['neutral-grip-db-press', 'db-floor-press', 'chest-press-machine', 'squeeze-press', 'incline-pushup'],
      triceps: ['db-kickback', 'triceps-pushdown'],
      vpull: ['lat-pulldown']
    },
    rirFloor: { hpush: 3, vpush: 3, vpull: 2, triceps: 2, biceps: 2 }
  },
  /* When a pattern has no eligible exercise for this user (pain or equipment),
     the slot becomes this pattern instead; dropped if still none or if the day
     already has it. Not used for accessory slots, which are simply dropped. */
  fallback: { vpush: 'hpush', vpull: 'hpull', lunge: 'hinge', squat: 'hinge' },
  fallbackRoles: ['main', 'secondary'],
  /* DATA HINT (2026-10-11), for the engineer: a fallback into pattern X is
     allowed only while the day has fewer than N slots already filling X
     (counting slots by the pattern actually used, `slot.use`). Past N the
     fallback slot is dropped. So a missing vertical pull becomes a row only
     while the day has at most one row; a missing overhead press becomes a
     push (chest) variant while the day has at most one. Slots are resolved in
     the usual main-then-secondary order across the week. */
  fallbackMaxOnDay: { hpull: 2, hpush: 2 },
  /* Several flags at once: union of avoid; rirFloor is the highest per pattern;
     preferFirst lists are concatenated in the order the user's flags are listed. */
  multi: 'union'
};

/* ------------------------------------------------------------ RIR help */
export const RIR_HELP = {
  short: 'Reps in reserve: how many more good reps you could still have done.',
  long: 'RIR means reps in reserve: when you finish a set, how many more good reps you could have done. RIR 3 means you stopped with three left, so it felt solid but not close to your limit. RIR 0 means nothing left; as a beginner, stay at 2 or 3 and stop a set early if your form slips. Not sure? Guess that you had more left than you think.'
};
