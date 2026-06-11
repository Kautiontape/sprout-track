# Day/Night Flip — MVP Design Spec

**Date:** 2026-06-11
**Status:** Approved design, pre-implementation
**Source ruleset:** `day-night-flip-rules.md` (Newborn Day/Night Flip Protocol)
**App:** Sprout Track (Next.js App Router, TypeScript, Prisma + SQLite, Tailwind + CVA)

---

## 1. Summary

Add a new in-app tool, **Day/Night Flip**, that guides parents through fixing newborn
day/night confusion using the WHEN/THEN/WHY protocol. It appears as a sidebar item
directly below **Nursery Mode**, opens a full page inside the normal app shell (so it can
reuse the existing dashboard stats), and is configured per-baby via a new tab in the
**Edit Baby** form.

This is an **MVP**. It implements the protocol's core "now" engine — *where are you right
now and what should you do* — with live timers derived from existing activity logs, the
day/night mode rule chips, per-baby settings, and always-on safety/escalation. Deeper
interactive decision-tree wizards, the full browsable rationale bank, and Home Assistant
sensor ingest are explicitly deferred (see §11).

### Decisions locked during brainstorming
- **Scope:** Focused MVP first (not the full protocol, not read-only).
- **Data:** Hybrid — derive timers/stats from existing Sprout Track logs, with a manual
  override when a log is missing or wrong.
- **Visual:** Hybrid — native Sprout Track components + a day→night gradient accent and
  mono "time-as-data" timers.
- **Storage:** Per-baby config as a `dayNightFlipConfig` JSON column on the `Baby` model.

---

## 2. Goals / Non-goals

**Goals**
- A "now" surface that resolves the current block (day/night, nap/awake/feed/bedtime) from
  local time + the baby's actual activity and tells the parent the single next action.
- Live `wake_window_elapsed` and `nap_elapsed` timers, plus a next-feed estimate, with the
  75-min wake-window ceiling color shift.
- Day-mode and night-mode rule chips, each with a "why?" affordance.
- Per-baby configuration of all protocol values, defaulting to the source-run defaults.
- Always-on medical disclaimer + R-42 escalation flags + age-aware sunset.

**Non-goals (MVP)**
- No new logging primitives — the tool reads existing sleep/feed/diaper/measurement data.
- No reproduction of every decision rule as an interactive wizard (see §11).
- No changes to Nursery Mode, Reports, or other existing surfaces beyond the sidebar and
  the Edit Baby form.

---

## 3. Priority hierarchy (from the ruleset)

The engine resolves conflicts in this fixed order (ruleset §2):

1. **Safety** — safe sleep, escalation flags. Always wins.
2. **Hunger** — feed a hungry baby; schedule bends to hunger.
3. **Awake window / overtired prevention** — cue/timer based, beats clock times.
4. **Clock anchors** — set the light/dark environment, not feeding or sleep pressure.

Key invariant encoded throughout: **anchors decide *what the environment looks like*; the
awake window decides *when* to put the baby down.** They are independent systems and can
drift apart (early-wake mornings).

---

## 4. Surface & routing

- **Page:** `app/(app)/[slug]/day-night-flip/page.tsx` — inside the `(app)` route group, so
  it renders within the existing shell (sidebar, green header, baby selector) exactly like
  `log-entry`, `calendar`, and `reports`. *Not* the bare `(nursery)` route group — the tool
  needs the shell to reuse dashboard stats and the selected-baby context.
- **Sidebar item:** new `<SideNavItem path="/day-night-flip" label={t('Day/Night Flip')} />`
  inserted directly below the Nursery Mode item in
  `src/components/ui/side-nav/index.tsx` (nursery item is at L437–443). Uses a
  lucide icon (`SunMoon` or `MoonStar`). The same SideNav renders as the mobile modal nav
  (there is no separate bottom nav), so one insertion covers desktop and mobile.
- **Header title:** extend the pathname→title logic in
  `app/(app)/[slug]/client-layout.tsx` (the `.includes()` ternary chain at L849–857) to
  return `t('Day/Night Flip')` for `/day-night-flip`. The chain currently falls back to
  `t('Full Log')` for unmatched paths, so this branch is required, not cosmetic.
- **Selected baby:** read from `BabyContext` (`useBaby()` → `selectedBaby`,
  `sleepingBabies`), same as the rest of the app. The tool follows the global baby selector.

---

## 5. The "now" engine (core)

A **pure, dependency-free, unit-tested** module:
`src/components/DayNightFlip/engine.ts`.

```
resolveNow(config: FlipConfig, facts: ActivityFacts, now: Date): FlipState
```

**Inputs**
- `config` — the per-baby `FlipConfig` (anchors, day_mode, night_mode, feeding, durations).
- `facts` — derived activity snapshot (see §6): `lastWakeTime`, `napStartTime | null`
  (non-null ⇒ currently sleeping), `lastFeed`, `wetDiapersLast24h`, `dirtyDiapersLast24h`,
  `latestWeightOz` + date, `previousWeightOz` + date, `birthDate`. Any fact can be
  null/unknown; the engine must degrade gracefully (see `needs-input` below).
- `now` — current local time (injected so the engine is deterministic/testable).

**Output `FlipState`**
- `mode: 'day' | 'night'` — `day` when `day_start ≤ now < night_start`, else `night`.
- `currentBlock` — one of: `needs-input`, `nap`, `night-sleep`, `awake`, `feed-due`,
  `bedtime-routine`, `night-feed`, `night-hold`, plus a human-readable label. Resolution
  order:
  1. `needs-input` — no usable wake/sleep fact (nothing logged, or latest wake is stale
     `> ~12 h`, and no manual override): lead with the override control instead of
     fabricating timers.
  2. Sleeping (`napStartTime` non-null): day → `nap` (cap countdown; D-2 wake-to-feed and
     D-3 cap nudges), night → `night-sleep` (robot mode, leave alone; N-2 — estimates,
     never alarms).
  3. Awake in the early-morning night leg (after midnight, before `day_start`) →
     `night-hold` (R-10/N-6: feed in the dark if hungry, hold dark until `day_start`).
  4. Awake in the evening night leg (after `night_start`) → `night-feed` (feed on demand,
     robot mode).
  5. Awake in day with feed interval exceeded → `feed-due` (hunger beats clock, §3).
  6. Awake in day at/after `bedtime_routine` (or the R-21 early trigger) → `bedtime-routine`.
  7. Otherwise → `awake` (wake-window countdown; inside `catnap_slot` the label and next
     action become catnap guidance — keep it short, wake by `last_wake_by`).

  `nextAction` is then chosen by the §3 priority hierarchy (safety > hunger > window >
  clock), independent of which block label applies.
- `nextAction` — the single most important instruction (e.g. *"Wake by 11:05 (nap cap 2h)"*,
  *"Put down by 11:18 — wake window 47m / ceiling 75"*, *"Robot mode: feed on demand, dark"*).
- `timers` — `{ wakeWindowElapsedMin, napElapsedMin, sinceLastFeedMin, nextFeedEstimate }`.
  `nextFeedEstimate` = `lastFeed + feed_interval_max_hr` in day mode; `lastFeed +
  feed_expected_interval_hr` (a range, rendered with `~`) in night mode.
- `intake` — weight-derived feeding estimates (R-30/R-32), pure math from facts + config:
  projected weight range (`latestWeightOz + days × growth_oz_per_day`) and daily intake
  target (`projected_lb × daily_oz_per_lb`), always framed as starting estimates.
  `feedingMethod` branches the display: `bottle` → oz ranges; `nursing` → output-based
  tracking (≥6 wet / ≥3 dirty per day — the other consumer of the diaper facts);
  `combo` → both. This is what the `feeding` config section exists for.
- `activeRules` — the rule IDs relevant to the current mode/block (for the chips).
- `nudges` — derived prompts: feed-interval exceeded (D-2), nap cap hit (D-3), wake-window
  ceiling exceeded → overtired inversion (R-16), wake-window origin correction (R-12).
- `escalations` — R-42 flags that currently trip (see §8).

**Rules encoded in the MVP engine** (others rendered as static chips only):
- **Mode boundaries** + anchor environment (D-1, N-1, N-5).
- **D-2** wake to feed if `feed_interval_max_hr` exceeded.
- **D-3** nap cap at `nap_cap_hr`.
- **R-12** wake-window origin = actual last wake (sleep `endTime`), even if before
  `day_start`. The most common day-1 failure; must be correct.
- **R-16** overtired inversion when `wake_window_elapsed > wake_window_ceiling_min` →
  surface "more help, not more patience," skip waiting.
- **R-21 / R-22** anchor elasticity: steer back toward the two hard anchors (`day_start`,
  `bedtime_routine`) by evening; never withhold food / force wakefulness for an intermediate
  clock time. R-21 concretely: when `lastWakeTime + wake_window_target` lands before
  `bedtime_routine`, suggest starting the routine then instead (one-night adjustment).
- **R-10 + Night hold (N-6 / R-11)**: early-hunger wake before `day_start` → feed
  immediately in full night conditions; never stall with a pacifier, never start the day
  early; hold dark until `day_start` even after an early feed.

Rule metadata (IDs, translation keys, numeric defaults) lives as typed constants `as const`
in `src/components/DayNightFlip/protocol.ts` so the engine and the chips share one source.
The rule text and WHY strings themselves live in `en.json` keyed by rule ID (e.g.
`flip.rule.D2.why`) — the app keeps *all* user-facing copy in translation files, and
`check-missing-translations.js` back-fills the other eight language files.

---

## 6. Live data — hybrid (derive + override)

Hook: `src/components/DayNightFlip/useFlipData.ts` → `{ facts, loading, error, override }`.

**Derived from existing APIs (no duplicate logging):**

| Fact | Source | Derivation |
|------|--------|-----------|
| `lastWakeTime` | latest `SleepLog` with `endTime != null` (`NAP` or `NIGHT_SLEEP`) | the `endTime` = actual wake; if stale (> ~12 h), treat as unknown → `needs-input` |
| `napStartTime` | open `SleepLog` (`endTime == null`) for baby | non-null ⇒ currently sleeping; also cross-checks `sleepingBabies` from `BabyContext` |
| `lastFeed` / interval | `GET /api/feed-log/last?babyId=` | `time` (or `endTime` for breast); `sinceLastFeed = now − time` |
| `wetDiapersLast24h`, `dirtyDiapersLast24h` | `/api/timeline` (diaper) or diaper-log | counts over the **trailing 24 h** — not since midnight, which would falsely trip the <6-wet R-42 flag every morning |
| `latestWeightOz` + date, `previousWeightOz` + date | two most recent `Measurement`s of type `WEIGHT` | normalized to oz (`unit` is a free string on `Measurement`); feeds intake math + R-33/R-42 — loss/no-gain needs two data points |
| `birthDate` | `selectedBaby.birthDate` | age → validity / sunset (R-43) |

- `wake_window_elapsed = now − lastWakeTime`; `nap_elapsed = now − napStartTime`. Timer math
  reuses the formatters already in `DailyStats` / `ActiveFeedBanner`.
- Live ticking via the `setInterval` pattern from
  `src/components/ActiveFeedBanner/index.tsx` (recalc on tab `visibilitychange`).
- All local-time math runs client-side in the browser timezone — the app's existing
  convention (`TimezoneContext` provides the helpers `DailyStats` uses). The engine gets
  `now` as a `Date` and interprets `HH:mm` config strings in that zone. Night mode spans
  midnight (20:00 → 08:00), so boundary math must wrap.

**Manual override (the "hybrid" half):**
- A control on the NowBanner — *"Mark awake now"* / *"Set actual wake time…"* /
  *"Mark down now"* — for when a log is missing or wrong (e.g. baby woke but the sleep-end
  isn't logged yet).
- Override is stored locally per baby (`localStorage`, family-scoped key like the existing
  `sleepingBabies_${familyId}` pattern) as `{ kind: 'wake' | 'down', time, setAt }` and
  takes precedence over derived `lastWakeTime` / `napStartTime`. A real `SleepLog`
  supersedes it as soon as the log's relevant timestamp (`endTime` for wake, `startTime`
  for down) is at or after the override's `setAt`.
- The override offers a one-tap **"also log it"** shortcut that writes the real
  `SleepLog` via the existing API, keeping the main log consistent. Declining leaves the
  override local-only.

---

## 7. Components

Folder `src/components/DayNightFlip/` (each file < 200 lines, matching app conventions —
`index.tsx`, `*.styles.ts`, `*.css` with `html.dark` overrides, `*.types.ts`, `README.md`):

- `index.tsx` — page shell: resolves `selectedBaby`, runs `useFlipData` + `resolveNow`,
  lays out the sections, handles loading/empty/disabled/sunset states.
- `NowBanner.tsx` — current block + next action + manual-override control. The "primary
  surface = now."
- `FlipTimers.tsx` — wake-window and nap timers (mono, color-shift near the 75-min ceiling),
  next-feed estimate, and the weight-derived intake estimate line (§5 `intake`). Reuses the
  `ActiveFeedBanner` interval pattern.
- `ModeRules.tsx` — day/night rule chips (pill badges) for the active mode, each with a
  "why?" affordance that reveals the WHY text (translation key from `protocol.ts`,
  resolved via `t()`).
- `EscalationBanner.tsx` — R-42 flags + persistent "Not medical advice" footer.
- `engine.ts` — pure `resolveNow` (§5). No React, no fetch.
- `protocol.ts` — typed rule metadata (IDs, translation keys) and config defaults
  (`as const`).
- `useFlipData.ts` — activity-fact assembly + override (§6).

---

## 8. Safety (always-on, non-negotiable)

- **Disclaimer:** persistent "Not medical advice; see escalation guidance" footer on the page.
- **R-42 hard flags** surfaced as a prominent "contact pediatrician" banner when derivable
  from data: `< 6 wet diapers` in the trailing 24 h (suppressed when there is no diaper
  data at all), weight loss / no gain across the two most recent `Measurement`s. Non-
  derivable flags (lethargy, frantic feeding, parental mood) are listed as a static
  "call your pediatrician if…" reference so they are never silently dropped.
- **R-33 weight sanity check** where the latest weight is displayed on the flip page: flag
  a `Measurement` implying `> 1.5 oz/day` gain or any loss vs. the `growth_oz_per_day`
  projection from the previous measurement. (No weight is entered in the settings tab —
  weight always comes from `Measurement` logs.)
- **Age-aware state** from `birthDate`:
  - `< ~2 weeks` — informational "protocol becomes relevant around 2 weeks" note.
  - `~2–10 weeks` — active.
  - `> ~10 weeks` or nights consolidated — **sunset** messaging (R-43): relax contrast
    rules, offer transition guidance. Tool still reachable but de-emphasized.

---

## 9. Settings — new "Day/Night Flip" tab in Edit Baby

- Convert `src/components/forms/BabyForm/BabyForm.tsx` to use the `FormPage` `tabs` prop
  (it already supports tabs; today it renders a single panel). Tabs: **Basic Info** |
  **Day/Night Flip**.
- The new tab edits the full `FlipConfig`, grouped into collapsible sections, every value
  defaulting to the ruleset's source-run defaults:
  - **Enable** toggle for this baby (default **off**) + live age/validity badge. The
    sidebar item stays visible either way; the page renders an enable prompt when off.
  - **feeding_method** — `bottle | nursing | combo` (new; branches feeding guidance).
  - **anchors** — `day_start` (08:00), `bedtime_routine` (19:15), `night_start` (20:00).
  - **day_mode** — `feed_interval_max_hr` (3), `nap_cap_hr` (2),
    `wake_window_target_min` ([45,60]), `wake_window_ceiling_min` (75),
    `catnap_slot` (17:00–18:30), `last_wake_by` (18:30).
  - **night_mode** — `feed_expected_interval_hr` ([2.5,4]),
    `scheduled_feeds` (~23:00, ~02:00, ~05:00; display-only estimates).
  - **feeding** — `daily_oz_per_lb` ([2.0,2.5]), `growth_oz_per_day` ([0.5,1.0]).
  - **durations** — `fuss_wait_min` ([5,10]), `putdown_abandon_min` (20),
    `rescue_nap_max_min` (90).
- Persisted as `dayNightFlipConfig` (JSON string) via the existing `PUT /api/baby`.
- `BabyForm` is rendered from both `SettingsForm` and the account manager's
  `FamilyPeopleTab`, so the tab appears in every edit context for free. Creation flows
  (e.g. the SetupWizard's `BabySetupStage`) need no changes — a baby created without the
  column merges over `DEFAULT_FLIP_CONFIG`.

**FlipConfig TypeScript shape** (also the JSON column contents):
```ts
type FlipConfig = {
  enabled: boolean;
  feedingMethod: 'bottle' | 'nursing' | 'combo';
  anchors: { dayStart: string; bedtimeRoutine: string; nightStart: string };
  dayMode: {
    feedIntervalMaxHr: number; napCapHr: number;
    wakeWindowTargetMin: [number, number]; wakeWindowCeilingMin: number;
    catnapSlot: [string, string]; lastWakeBy: string;
  };
  nightMode: { feedExpectedIntervalHr: [number, number]; scheduledFeeds: string[] };
  feeding: { dailyOzPerLb: [number, number]; growthOzPerDay: [number, number] };
  durations: { fussWaitMin: [number, number]; putdownAbandonMin: number; rescueNapMaxMin: number };
};
```
A `DEFAULT_FLIP_CONFIG` constant in `protocol.ts` provides the source-run defaults; a missing
or partial column is merged over the defaults so old babies and added fields are safe.

---

## 10. Data & API changes

- **Prisma:** add `dayNightFlipConfig String?` to `model Baby` in `prisma/schema.prisma`
  (provider is **SQLite**; a nullable text column is trivially portable regardless). Note
  the repo has a second schema, `prisma/log-schema.prisma`, with its own generated client
  (`prisma:generate` vs `prisma:generate:log`) — the migration targets the main schema
  only. JSON-string settings columns are an established convention, but on the
  family-level `Settings` model (`activitySettings`, `nurseryModeSettings`); this adds the
  first **per-baby** one, which is deliberate — the protocol is inherently per-baby.
- **API:** `app/api/baby/route.ts` POST/PUT spread the request body into Prisma
  create/update, so the field flows through once added to the `BabyCreate`/update payload
  types and `BabyResponse` in `app/api/types.ts`; validate it parses as JSON before
  persisting.
- **Auth:** unchanged — `/api/baby` already enforces family scoping via `withAuthContext`.
- **Localization:** add all new user-facing strings — including the rule texts and WHY
  copy (§5) — to `src/localization/translations/en.json`, then run
  `node scripts/check-missing-translations.js` (back-fills the eight other language files).

---

## 11. Explicitly deferred (later phases)

- Interactive decision-tree wizards: gas protocol (R-18), pacifier-loop detection (R-17),
  "finished the bottle, still hungry" tree (R-31), failed-putdown rescue flow (R-15).
- Full browsable FAQ / rationale bank (the 11-entry "why" engine) as its own surface —
  MVP only surfaces WHY strings inline on the active rule chips.
- Home Assistant feed/diaper sensor ingest (the owner-specific integration hook).
- Push-notification nudges (nap-cap alarm, q3h feed reminder) — MVP shows them on-page only.

---

## 12. Testing (TDD)

- `engine.ts` `resolveNow` is the primary unit under test — table-driven cases over
  `(config, facts, now) → expected { mode, currentBlock, nextAction, nudges, escalations }`:
  - Mode boundary at `day_start` / `night_start`.
  - **R-12**: 7:30 wake before 08:00 anchor → wake window originates at 7:30, nap 1 earlier.
  - **D-2 / D-3**: feed-interval exceeded; nap cap hit.
  - **R-16**: wake window past 75-min ceiling → overtired inversion nudge.
  - **R-42 / R-33**: <6 wet in trailing 24 h, weight loss → escalation; implausible
    weight-gain flag; an early-morning case proves the trailing-24h window doesn't
    false-positive.
  - **R-43**: age > 10 weeks → sunset state.
  - Midnight crossing: `now` at 02:00 resolves night mode against the previous evening's
    `night_start`.
  - Missing/stale facts: no sleep data, or latest wake > ~12 h old → `needs-input`, no
    fabricated timers or nudges.
  - Intake math: projected weight + daily target ranges from weight/config; `nursing`
    switches the display to output-based tracking.
- `protocol.ts` defaults validated against the ruleset's `config` block.
- Config merge: partial/missing `dayNightFlipConfig` merges over `DEFAULT_FLIP_CONFIG`.
- Override merge: the local override beats derived facts; a newer real `SleepLog`
  supersedes it (tested as a pure helper consumed by `useFlipData`).

---

## 13. Affected / new files (summary)

**New**
- `app/(app)/[slug]/day-night-flip/page.tsx`
- `src/components/DayNightFlip/` (index, NowBanner, FlipTimers, ModeRules,
  EscalationBanner, engine, protocol, useFlipData, styles, css, types, README)
- `prisma/migrations/<ts>_add_baby_day_night_flip_config/`
- engine test file(s)

**Modified**
- `src/components/ui/side-nav/index.tsx` — new nav item below Nursery Mode
- `app/(app)/[slug]/client-layout.tsx` — header title for `/day-night-flip`
- `src/components/forms/BabyForm/BabyForm.tsx` — tabbed (Basic Info | Day/Night Flip)
- `prisma/schema.prisma` — `Baby.dayNightFlipConfig`
- `app/api/baby/route.ts` + `app/api/types.ts` — persist/return the new field
- `src/localization/translations/en.json` (+ generated language files)
