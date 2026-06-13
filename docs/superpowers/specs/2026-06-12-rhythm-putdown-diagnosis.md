# Rhythm evening putdown — diagnosis and fix design (R-23 / R-24)

**Date:** 2026-06-12
**Trigger:** screenshot of the Rhythm timeline rendering the evening as
`18:03 Bedtime routine → 20:00` with no putdown event. Ambiguous between
"down at ~18:30–19:00" (correct per R-21) and "held up until night_start
at 20:00" (a ~3-hour awake stretch against a 75-minute ceiling).

## Diagnosis

### How the evening putdown time is currently computed

It isn't. There is no putdown concept anywhere in the code. The projection
(`projectDay`, `src/components/DayNightFlip/schedule.ts`) ends the day with
two blocks:

1. A `bedtime-routine` block whose **start** is computed correctly —
   `routineStart = finalNapWake + wakeWindowTargetMin[1]` when the final
   wake lands in the catnap slot (R-21 early pull), otherwise the 19:15
   `bedtimeRoutine` anchor — but whose **end is hard-coded to `nightStart`**
   (`schedule.ts:179`, `end: nightStart`).
2. A `night-sleep` anchor block labeled **"Down for the night" at exactly
   `nightStart`** (`schedule.ts:187-192`).

`FlipSchedule.Row` renders every block as `start → end`, so the routine block
prints as `18:03 Bedtime routine → 20:00` purely because its end edge was
anchored to the mode boundary.

### Is 20:00 a putdown target or only a block-rendering boundary?

**Both — this is a display bug *and* a scheduling/guidance bug:**

- **Display:** the implied putdown is the routine block's end edge, which is
  `nightStart`. The data model has no putdown event, so the renderer cannot
  show one.
- **Scheduling/guidance:** the only "down" event in the projected plan is the
  "Down for the night" anchor at 20:00, and the live engine's bedtime-routine
  guidance says literally `Down by ${anchors.nightStart}`
  (`engine.ts:239`). So `night_start` *is* communicated as the putdown target
  in two independent places. The projected plan for the screenshot day
  contains a 17:03 → 20:00 awake stretch (177 min vs. the 75-min
  `wakeWindowCeilingMin`). The live R-16 overtired nudge would fire at 18:18
  and contradict the plan the schedule view displays.
- Note the bug is not limited to R-21 nights: even on a nominal day
  (catnap wake 18:30 → routine 19:15 → "down" 20:00) the implied awake
  stretch is 90 min, over the 75-min ceiling.

### Root cause

The timeline data model has no first-class putdown event — sleep boundaries
are implied by block edges, and the evening block's end edge was anchored to
the environment-mode boundary (`night_start`) instead of a computed putdown.
The priority hierarchy (safety > hunger > awake window > clock anchors) was
implemented for naps (R-21 pulls the routine start off the anchor) but never
carried through to the putdown itself, so the anchor silently won the
evening.

## Fix design

### R-24 — evening putdown (new rule)

- **Putdown is an explicit, first-class timeline event** (`kind: 'putdown'`,
  label "Down for the night") with its own computed time. It is never implied
  by a block's end boundary.
- **Computation:**
  `putdown = routineStart + bedtimeRoutineMin`, clamped to
  no later than `bedtimeRoutine anchor + 30 min` **and** no later than
  `finalNapWake + wakeWindowCeilingMin` (never earlier than `routineStart` —
  the routine compresses when clamped). `routineStart` keeps its shipped
  R-21 semantics (`finalNapWake + wakeWindowTargetMin[1]`, anchor-capped).
  With defaults this puts the screenshot night (final wake 17:03) at
  routine 18:03 → **down 18:18**, and a nominal night (catnap wake 18:30)
  at routine 19:15 → down 19:45.
- **`night_start` is an environment-mode boundary only** — when night rules
  (robot mode, white noise, shifts) activate. It never appears in the putdown
  computation. The 20:00 anchor block is relabeled to "Night mode" so the
  putdown event owns the "Down for the night" label.
- **Catnap insertion, not window stretching:** when the gap from final-nap
  wake to the computed putdown would exceed `wakeWindowCeilingMin`, the
  scheduler inserts a catnap (existing simulation-loop behavior, now covered
  by a validation test) rather than stretching the awake window. Where no
  catnap is insertable (final wake already in the catnap slot), the ceiling
  clamp above bounds the stretch instead.
- **Display rule:** the putdown event is always rendered explicitly, and
  contextual notes (e.g. "Earlier than usual tonight") attach to the putdown
  event so the note and the rendered times cannot contradict each other.
- `bedtimeRoutineMin` is a new config field (`durations.bedtimeRoutineMin`,
  default 30); the 30-min anchor clamp in the ticket corresponds to an
  anchor-started routine running its full default length.

### R-23 — early crash at day's end (new rule)

If the baby falls asleep between `lastWakeBy` and `night_start` (i.e. before
the planned putdown but past the point where another catnap fits):

- **Fed fully within the last ~45 min** → convert to night start: putdown is
  the sleep start, night feed estimates shift earlier by
  (`night_start` − sleep start), the morning anchor does not move.
- **Not fed** → allow a 20–30 min micro-nap (plan wakes her at +30), then a
  compressed routine + full feed + down (putdown via the R-24 clamps).

### Validation

No generated schedule may contain a planned awake stretch exceeding
`wakeWindowCeilingMin`. Covered by a sweep test over final-nap wake times
plus a regression test reproducing the screenshot (nap ending 17:03 →
putdown in 18:15–19:00, not 20:00).

## Scope decision on the optional data-model refactor

Declined for this ticket. `projectDay` is a pure function emitting a flat
block list consumed by a single renderer; restructuring to sleep/awake-cycle
primary entities would touch every consumer (renderer, NOW-marking, all
tests) for a structural guarantee that the explicit putdown event already
provides at the boundary that matters. If a second consumer of the timeline
appears, do the cycle-primary refactor then, in its own ticket.
