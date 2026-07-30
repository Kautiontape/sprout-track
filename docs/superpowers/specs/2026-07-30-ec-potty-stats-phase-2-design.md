# EC Potty Stats (Phase 2) — Design

**Date:** 2026-07-30
**Status:** Approved scope, ready for implementation planning
**Builds on:** `2026-07-29-ec-potty-tracking-design.md` (Phase 1, shipped) and
`2026-07-30-ec-stats-research.md` (the EC-literature research this design follows)

## Problem

Phase 1 made potty catches loggable. Phase 2 answers "what is her rhythm?" — the
Reports surface. The research doc ranked seven candidate stats against the EC
literature (Bauer, Boucke, Olson/Go Diaper Free, Montessori) under the hard
constraint that only *wins* are logged: no attempts, no misses, so nothing may
require an attempt denominator.

## Approved scope

Four of the seven, chosen by the user (research doc's MVP + the poop scoreboard):

| # | Stat | Research rank |
|---|---|---|
| A | Catches per day: stat cards + daily bar chart, pee/poop split, rolling avg | #1 |
| B | Poop scoreboard: caught vs. poopy diapers, weekly share-caught trend | #2 |
| C | Wake-up catch panel: catches joined to sleep ends | #3 |
| D | Time-of-day: hour histogram + a potty lane in HeatmapsTab | #5 |

Plus: render the `MonthlyReport.potty` payload (added in Phase 1) as a section in
`MonthlyReportCard`, extended with the poop-catch share.

**Explicitly out (research §2–3):** context breakdown (#4) and intervals/dry
stretches (#6) — month-two follow-ups once data density supports them; receptacle
mix (#7) except as the `locationDistribution` already in the monthly payload; any
pee-side catch rate (one wet diaper absorbs several pees — the ratio flatters then
falsely regresses); night-dryness % (`DiaperType` has no dry value — would reward
forgetting to log); predictive next-pee alarms.

## Design rules (from the research, binding)

1. **Pee/poop split everywhere.** Poop timing is usually the stronger signal.
   `BOTH` counts in each split; stat cards count *catches* (rows), splits count
   *eliminations* — label accordingly.
2. **Adaptive binning.** Under 50 catches in range, the hour histogram uses 2-hour
   bins; 1-hour at ≥50. The heatmap lane needs nothing — its ±30-min smoothing is
   the existing diaper-lane convention.
3. **Opportunity coverage, never success rate.** The wake-up panel's denominator is
   wake-ups (fully observed), not attempts (not logged). Copy must read "wake-ups
   followed by a catch," never "success."
4. **The poop scoreboard reads diaper data; it never changes it.** The central
   invariant stands: a potty catch never increments any diaper count. Reading
   `DiaperLog` dirty counts as a denominator alongside potty is the design, not a
   violation of it.
5. **Wake-up join:** a catch is a wake-up catch if it falls within N=20 min after a
   `SleepLog.endTime` (nearest preceding end wins; open-ended sleeps excluded from
   coverage denominators; nap vs. night via `SleepType`). Median wake→catch gap
   shown once ≥10 wake-up catches exist.
6. **Clock view stays, event-anchored views carry the prediction.** The literature
   anchors rhythm to waking/feeding, not the clock (ADH wears off at waking). The
   histogram and heatmap lane are the long-term charts; the wake-up panel is where
   the predictive value lives now. The potty heatmap lane sits **adjacent to the
   Wake and Feeds lanes** so the correlation is visible for free.
7. **EC anchor.** User-reported (post-launch): a family that started EC partway
   through the month saw "Catches/day 0.1" (4 catches ÷ ~30 days) and "Poop catch
   rate 2%" (1 caught poop ÷ every dirty diaper that month) — both denominators
   silently included the weeks before EC began. Their words: "We were not doing EC
   since day 1. So only days since then matter." Fix: the EC anchor is the
   timestamp of the baby's first-ever potty log (any type — anchoring on the first
   caught *poop* specifically would bias the poop rate upward, since counting would
   only start after a success). Every "how many days/opportunities were there"
   denominator clamps its window start to the anchor's local day: daysInRange /
   catches-per-day, the daily and weekly zero-filled series starts, the
   dirty-diaper denominator behind `shareCaught` / `poopCatchShare`, and the
   wake-up coverage denominators. Numerator-only stats (hour histogram, total
   catches) are computed over the unclamped range and stay unaffected — a catch
   can never precede the anchor by construction anyway. Day arithmetic is
   inclusive (first catch today → 1 day, not 0). Implemented in
   `computePottyStats`'s optional 4th param (`potty-stats.utils.ts`, client-side,
   fetched once per selected baby via `GET /api/potty-log?babyId=X&oldest=true`)
   and mirrored server-side in the monthly report route via an un-bounded
   `pottyLog.findFirst(orderBy: time asc)`, scoped to the reported baby.

## Architecture

**All computation is client-side over the `/api/timeline` payload Reports already
fetches** — potty rows have been in it since Phase 1, and sleep/feed/diaper rows are
already there for the joins. No new endpoints. The one API change is additive:
`poopCatchShare` on the existing `MonthlyReport.potty` payload.

New pure-computation module, TDD'd with `node:test` (the repo's convention for
testable logic):

- `src/components/Reports/potty-stats.utils.ts` — exports
  `computePottyStats(activities, dateRange, opts)` returning daily series, split
  counts, weekly scoreboard series, wake-up panel numbers, and adaptive hour bins.
  Discriminators: `'pottyLocation' in a` for potty (always checked before
  `'condition' in a`), same duck-typing as everywhere else. Timezone day/week
  bucketing follows `StatsTab`'s existing `useTimezone().toLocalDate` pattern —
  passed in, keeping the module pure.
- `src/components/Reports/potty-stats.utils.test.ts` — covers: BOTH double-split,
  cards-count-catches vs splits-count-eliminations, scoreboard math, wake join
  (within/outside window, nearest-of-two-sleeps, open-ended excluded, nap vs
  night), adaptive bin threshold at exactly 50, empty-range behavior.

**Components** (mirroring the `DiaperStatsSection` + `DiaperChartModal` pattern:
accordion section, stat-card grid, tap-through chart modal):

- `src/components/Reports/PottyStatsSection.tsx` — cards (Total catches,
  Catches/day, Pees caught, Poops caught, Poops caught vs diapered, wake-up
  catches, typical gap after waking) + the daily bar chart, weekly scoreboard
  trend, and hour histogram behind tap-throughs.
- `src/components/Reports/PottyChartModal.tsx` — mirror of `DiaperChartModal`.
- Wired into `StatsTab.tsx` beside `DiaperStatsSection` (order: after Diapers).

**Heatmap lane:** add `'potty'` to `HeatmapType`, `HEATMAP_TYPES_IN_ORDER`
(positioned adjacent to `feeds`, i.e. between `feeds` and `diapers`),
`HEATMAP_COLORS` (fuchsia: base `#d946ef`, light `#f0abfc`), the slot-count branch
in `timeline-heatmap.utils.ts` keyed on `'pottyLocation' in activity` (before the
diaper branch), and the `HeatmapsTab` label/icon (`Toilet`, `t('Potty')`).

**Monthly report:** `MonthlyReportCard/PottySection.tsx` rendering
`potty.totalCatches`, `avgCatchesPerDay`, `poopCatchShare`, `locationDistribution`;
`report/[yearMonth]/route.ts` gains `poopCatchShare = caught/(caught+dirtyDiapers)`
for the month (null when denominator is 0).

## Presentation

- Potty identity color is **fuchsia** everywhere (`text-fuchsia-600`, gradient
  `from-fuchsia-500 to-fuchsia-600`, dark `rgb(240 171 252)`), consistent with
  Phase 1. Dark mode via `html.dark` selectors in plain CSS; never Tailwind `dark:`.
- Empty/low-data states are first-class: with ~0 rows today, every chart must
  render a friendly "log a few catches" state rather than an empty axis; the
  scoreboard trend hides until 2 weekly points exist; the median-gap card hides
  below 10 wake-up catches.
- All user-facing text through `t()`; keys added centrally in the final task.

## Testing

- `node:test` for `potty-stats.utils.ts` (the only nontrivial logic).
- Existing suites must stay green: elimination (11), DayNightFlip (45), verify
  script. `tsc --noEmit` stays at 0; `next build` passes.

## Phasing within Phase 2

1. Compute module (TDD) → 2. PottyStatsSection + modal + StatsTab wiring →
3. Heatmap lane → 4. Monthly report section + API share → 5. Localization →
6. Verification + deploy confirm.

Follow-ups deliberately deferred: research #4 (context breakdown) and #6
(intervals/dry stretch) when data density supports them; Phase 3 streaks.
