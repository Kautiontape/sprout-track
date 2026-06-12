# Day/Night Flip — Phase 2 Design Spec

**Date:** 2026-06-12
**Status:** Approved design, pre-implementation
**Builds on:** MVP spec `2026-06-11-day-night-flip-design.md` (shipped on `claude/day-night-flip`)
**Sources:** ruleset `day-night-flip-rules.md`; schedule prototype `~/downloads/vivaldi/sylvie-schedule.html`; HA mirror repo `~/documents/apps/homeassistant-config`

---

## 1. Summary

Four additions to the shipped Day/Night Flip MVP, built engine-outward in one cycle:

1. **Wizards** — interactive "when it goes sideways" decision trees (R-15 rescue,
   R-17 pacifier loop, R-18 gas, R-31 finished-bottle-still-hungry).
2. **FAQ / rationale bank** — the ruleset's 11-entry "why" engine as a browsable surface.
3. **Live-adapted schedule view** — the prototype's "page is the day" timeline
   (day → dusk gradient → night), with past blocks showing what actually happened and
   future blocks projected from the baby's real current state.
4. **HA flip-state exposure** — extend the existing `hooks/v1/.../status` endpoint with a
   `dayNightFlip` section so Home Assistant automations can react (lights at day start,
   white noise at night start, nap-cap alarm).

### Decisions locked during brainstorming
- **Scope:** all four in one spec; built engine-first; each feature lands independently.
- **HA direction:** expose flip state out through the existing polled status endpoint
  (HA already pulls from Sprout Track every 60 s — the "Sprouty" REST sensors). No
  ingest/write path. **Push notifications are dropped** — HA automations cover them.
- **Schedule view:** **live-adapted** — actual logs for the past, projection from the
  current state for the future, anchors held firm. Template-only fallback when facts are
  unknown.

---

## 2. Goals / Non-goals

**Goals**
- Every troubleshooting flow in the ruleset reachable in ≤2 taps from the flip page.
- The full day visible at a glance, truthful to today (not an idealized template),
  with the prototype's visual identity (warm day, dusk strip, indigo night, NOW tag).
- HA can drive the physical environment from flip state with zero new auth surface.

**Non-goals**
- No push notifications (superseded by HA automations).
- No HA → Sprout Track write path (logging stays in-app / existing API).
- No schedule editing from the schedule view (config stays in the Edit Baby tab).
- No persistence of wizard runs.

---

## 3. Feature 1 — Wizards ("When it goes sideways")

**Data, not components.** New `src/components/DayNightFlip/wizards.ts` holds four typed
decision trees; one generic renderer walks any of them.

```ts
type WizardNode =
  | { kind: 'question'; prompt: string; help?: string;
      options: { label: string; to: string }[] }
  | { kind: 'outcome'; title: string; actions: string[]; why: string;
      ruleIds: string[];                      // chips linking to ModeRules/FAQ
      dynamic?: 'rescue-timing';              // see below
      links?: { label: string; wizard?: WizardId; to?: string }[] };

type WizardId = 'rescue' | 'pacifier' | 'gas' | 'bottle';
type Wizard = { id: WizardId; title: string; entry: string;
                nodes: Record<string, WizardNode> };
```

**Tree content** (condensed from the ruleset; exact node copy written at plan time):

- **`rescue` (R-15, the big one).** How long / how many attempts? → under
  `fuss_wait_min` and fussing is grunting/squirming/eyes-closed → *outcome: wait 5–10 min,
  this is often active sleep (R-13)*. Sustained real crying or past
  `putdown_abandon_min`/2 attempts/`wake_window_ceiling_min` → gas-signs check (arching,
  settles upright but rages flat) → *branch to `gas`*; pacifier loop check → *branch to
  `pacifier`*; else → *outcome: rescue — abandon the crib this cycle; fastest means wins
  (contact, motion, feeding down); white noise + contact napping legal for one nap; guard:
  don't let the rescue become the default (R-15)*.
- **`pacifier` (R-17).** Pattern confirm (in → spit → cry → replace) → *outcome: abandon
  the pacifier for this settling attempt; switch to motion/contact, which demand nothing
  from the baby.*
- **`gas` (R-18).** Signs confirm → *outcome: bicycle legs, clockwise tummy massage,
  belly-down across the forearm during awake time; mid-feed burps mandatory for the next
  several feeds; fast/frantic bottle feeds are the #1 source of swallowed air (→ link
  `bottle`).*
- **`bottle` (R-31).** Drained the bottle, still seems hungry → classify: rooting/smacking
  AND eagerly takes more AND settles → *outcome: real hunger — offer ~1 oz increments*;
  turns away / comfort-sucks / settles with holding → *outcome: non-nutritive sucking —
  don't add milk*. Both outcomes carry paced-feeding guidance (slow-flow nipple, bottle
  horizontal, pauses every oz, 15–20 min, mid-feed burp) and the escalation: consistently
  draining bottles across many feeds → pediatrician conversation.

**`dynamic: 'rescue-timing'`** — the rescue outcome is time-aware (R-20/R-21): when the
renderer sees this flag it computes from `config` + `now`: rescue starting ≥ ~16:00 →
"this becomes the day's final nap — wake by `rescue_nap_max_min` (90 m)" plus the computed
early bedtime (`final wake + wake_window_target + routine`). Pure helper
`rescueTiming(config, now)` lives in `engine.ts` so it's unit-tested.

**Renderer.** `WizardPanel.tsx` — takes a `Wizard`, walks nodes, supports back/restart,
renders outcome cards (actions list, WHY, rule chips, cross-wizard links). Opens as an
in-page panel on the flip page (not a modal — at 3am a mis-tap shouldn't lose state).

**Entry points.** A "When it goes sideways" section on the flip page with the four
wizard buttons; contextual deep-links from nudges (R-16 overtired nudge → `rescue`,
feed-due nudges → `bottle`).

**Graph integrity is tested:** every `to`/`wizard` reference resolves, every path from
`entry` terminates at an outcome within 10 steps, no orphan nodes.

---

## 4. Feature 2 — FAQ / rationale bank

- `FLIP_FAQ` in `protocol.ts`: the 11 entries from ruleset §5 as
  `{ id, question, answer }[]` (strings via the en.json key===value convention).
- `FlipFaq.tsx`: accordion list ("Why does this work?"), one entry open at a time,
  reachable from a link on the flip page footer and from rule-chip WHY popovers
  ("more →").
- Rendered as a third view on the flip route (see §5 view toggle) so it gets the header
  and back affordances for free.

---

## 5. Feature 3 — Live-adapted schedule view

### Engine: `projectDay`

New pure module `src/components/DayNightFlip/schedule.ts`:

```ts
type ScheduleBlock = {
  start: Date; end: Date | null;
  kind: 'wake-feed' | 'awake' | 'nap' | 'catnap' | 'bedtime-routine'
      | 'night-sleep' | 'night-feed' | 'night-hold' | 'feed';
  label: string; note?: string;
  source: 'actual' | 'projected' | 'anchor';
  isNow: boolean;
};

projectDay(
  config: FlipConfig,
  facts: ActivityFacts,
  todayLogs: { sleeps: { start: Date; end: Date | null }[]; feeds: Date[] },
  now: Date,
): ScheduleBlock[]
```

**Projection rules:**
1. **Past = actual.** Today's logged sleep intervals become `nap`/`night-sleep` blocks
   (`source: 'actual'`, ✓-marked in the UI); logged feeds become point `feed` entries.
   Gaps between them are `awake` blocks.
2. **Now.** The block containing `now` comes from the same state `resolveNow` sees and
   carries `isNow: true` (single source of truth: `projectDay` calls the same internal
   helpers; it must never disagree with the NowBanner).
3. **Future = projected from the real state.** Loop forward from `now`:
   next nap start = `lastWake + wake_window_target_hi`; nap end =
   `min(start + nap_cap, next D-2 feed-due wake)`; wake → feed → awake → down, feeds at
   `feed_interval_max_hr`. Inside `catnap_slot` the nap becomes a `catnap` (30–45 m,
   wake by `last_wake_by`).
4. **Anchors hold.** The `bedtime-routine` block lands at
   `min(R-21 early trigger, bedtime_routine)` and `night-sleep` at `night_start`
   (`source: 'anchor'`); projection drift is absorbed mid-day, never by moving the
   anchors (R-22). Night side: `night-sleep` with `~`-prefixed `night-feed` estimate
   blocks from `scheduled_feeds`, then `night-hold` until tomorrow's `day_start`.
5. **Template fallback.** With `needs-input` facts, emit the pure config template
   (exactly the prototype's idealized day) with a banner nudging the wake-time override.

Table-driven tests: 9:40 wake at 10:00 → nap 1 projected 10:40; rescue-style 17:30 wake →
early routine 18:30; midnight wrap; template fallback; anchors never move.

### View

`FlipSchedule.tsx` + scoped CSS adapted from `sylvie-schedule.html`:
- **Day section** (warm: `#FBF6EC` bg, `#C07A1E` accent) → **dusk gradient strip** →
  **night section** (indigo: `#15132B` bg, `#A89BF0` accent). The section backgrounds are
  intentional and identical in light/dark app themes — the page *is* the day; only the
  surrounding chrome follows `html.dark`.
- Blocks: mono time rail (left), label + note, thin timeline line, `actual` blocks get a
  ✓, `projected` get no marker, night estimates get `~`. NOW block: accent border + soft
  glow + NOW tag; "jump to now" pill with pulsing dot (respects
  `prefers-reduced-motion`).
- Section-head rule chips reuse `ModeRules` data (compact, non-interactive here).

### View toggle

The flip route gains a three-way segmented control under the header:
**Now | Schedule | Why** (Now = existing MVP surface, Schedule = `FlipSchedule`,
Why = `FlipFaq`). State is local (`useState`, default Now). `useFlipData` additionally
fetches today's feeds (`/api/feed-log?babyId&startDate&endDate` — already supported) and
exposes `todayLogs`.

---

## 6. Feature 4 — HA flip-state exposure

**Server side (this repo).** Extend
`app/api/hooks/v1/babies/[babyId]/status/route.ts` (existing API-key auth, no new
endpoints). When the baby's merged config has `enabled: true`, derive facts server-side
(the route already queries last activities; add: sleep logs for the trailing 7 days,
trailing-24 h diaper counts, two latest weights) and run the same pure
`deriveFacts` → `resolveNow`. Response gains:

```ts
dayNightFlip: {
  enabled: boolean;            // false → no other fields
  phase: 'pre' | 'active' | 'sunset';
  mode: 'day' | 'night';
  block: FlipBlock; blockLabel: string; nextAction: string;
  wakeWindowMin: number | null; napElapsedMin: number | null;
  sinceLastFeedMin: number | null;
  napCapAt: string | null;             // ISO — when sleeping in day mode
  nextFeedEstimate: { from: string; to: string | null } | null;
  escalations: string[];               // rule ids, e.g. ["R-42-wet"]
}
```

**Caveats (documented in the response and README):**
- Server-side state reflects **logged data only** — the phone-local manual override is
  invisible to HA (it lives in localStorage by design).
- The engine interprets times in the **server process timezone**; `TZ` must match the
  family's timezone. True today (`.env` and prod container both set
  `America/New_York`).

**HA side (mirror repo, guarded).** Stage a new sensor block in
`~/documents/apps/homeassistant-config/.local-backups/sprouty-flip-sensors.yaml` for the
existing `rest:` resource (same poll, same secret): `Sprouty Flip Block`,
`Sprouty Flip Mode`, `Sprouty Flip Next Action`, `Sprouty Flip Wake Window Min`,
`Sprouty Flip Nap Cap At` (timestamp), `Sprouty Flip Escalation` — each with an
availability template on `dayNightFlip.enabled`. Per that repo's rules the live box is
**not** touched by this work: the staged YAML + an apply checklist (box backup → edit →
`ha core check` → UI reload) is the deliverable. Example automations (lights at
`day_start`, white noise at `night_start`, nap-cap alarm at `napCapAt`) ship as comments
in the staged file.

---

## 7. Testing (TDD)

- `schedule.ts` `projectDay` — table-driven, same style as `engine.test.ts` (cases in §5).
- `wizards.ts` — graph integrity: all references resolve, all paths terminate at an
  outcome ≤10 steps, no orphans; `rescueTiming` unit tests (pre/post-16:00, early-bedtime
  math).
- Status route — verified live with `curl -H "Authorization: Bearer <key>"` against the
  dev server (enabled and disabled babies).
- Surfaces — Playwright pass: view toggle, schedule NOW highlight + jump-to-now,
  wizard walk-through to an outcome and back, FAQ accordion. (Remember: the Playwright
  browser runs in UTC; assert against browser-local expectations.)

---

## 8. Affected / new files

**New (this repo)**
- `src/components/DayNightFlip/wizards.ts` + `wizards.test.ts`
- `src/components/DayNightFlip/WizardPanel.tsx`
- `src/components/DayNightFlip/schedule.ts` + `schedule.test.ts`
- `src/components/DayNightFlip/FlipSchedule.tsx` (+ schedule CSS, scoped)
- `src/components/DayNightFlip/FlipFaq.tsx`

**Modified (this repo)**
- `src/components/DayNightFlip/protocol.ts` — `FLIP_FAQ`
- `src/components/DayNightFlip/engine.ts` — `rescueTiming` helper
- `src/components/DayNightFlip/index.tsx` — view toggle, wizard section, nudge deep-links
- `src/components/DayNightFlip/useFlipData.ts` — today's feeds fetch, `todayLogs`
- `app/api/hooks/v1/babies/[babyId]/status/route.ts` — `dayNightFlip` section
- `src/localization/translations/en.json` (+ script back-fill)
- `src/components/DayNightFlip/README.md`

**Staged (homeassistant-config repo, not applied)**
- `.local-backups/sprouty-flip-sensors.yaml` + apply checklist

---

## 9. Explicitly deferred

- Push-notification nudges (superseded by HA automations).
- HA → Sprout Track write path.
- Schedule editing from the schedule view.
- Wizard run history / analytics.
