# Daily Summary Running Averages — Design Spec

**Date:** 2026-07-21
**Status:** Approved design, pre-implementation
**App:** Sprout Track (Next.js App Router, TypeScript, Prisma SQLite/Postgres, Tailwind + CVA)
**Surface:** TimelineV2 Daily Summary (`src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx`)

---

## 1. Summary

Add a small, always-visible **running average line** to the core stat tiles in the Daily
Summary. Each averaged tile shows the day's value as it does today, plus a third line like
`avg 6h 58m` computed over the N days *preceding* the viewed day. When the viewed day is
today (in progress), the average line gains an **(i) popover** with an "expected by now"
pace comparison. The window length N is a family-level setting.

### Decisions locked during brainstorming

- **Metrics (core four):** Total Sleep, Feeds (count + bottle volume), Wet Diapers, Poops.
  No averages on other tiles.
- **Baseline excludes the viewed day:** average = the N days before it. The day is
  compared against its preceding baseline; today's partial data never skews the average.
- **Today (in progress):** "expected by now" pace — baseline days are truncated at the
  same clock time and averaged, e.g. *"Usually 5h 10m by 2:30pm — ahead of pace."*
  Detail lives in the (i) popover; past days get no pace treatment.
- **Placement:** third small text line under the tile's value/label. The (i) appears on
  that line only when viewing today.
- **Setting:** `dailyStatsAvgDays`, family-level, integer, default **5**, valid range
  2–14. No off switch in v1.
- **Zero-data core tiles:** a core tile renders even when the day's value is 0, as long
  as its baseline average is > 0 (e.g. `0` poops with `avg 2.1` visible — "baby hasn't
  pooped today, is that unusual?"). *Interpreted from approval note "including tiles
  without data for now" — flag if the opposite (keep current visibility rules) was meant.*

---

## 2. Goals / Non-goals

**Goals**
- At-a-glance "is this day normal?" context on the four rhythm metrics.
- Honest treatment of in-progress days via time-of-day-matched pacing.
- Zero new API surface — computed client-side from data the daily view already caches.

**Non-goals (v1)**
- No averages on pump, play, bath, medicine, note, milestone, or measurement tiles.
- No off switch (can later allow `0 = disabled` if wanted).
- No server-side aggregation endpoint; no Reports/heatmap changes.
- No per-caretaker setting; no trend arrows or sparklines.

---

## 3. Setting

- **Schema:** `dailyStatsAvgDays Int @default(5)` on the `Settings` model (family-level).
  Plain `Int` with default — compatible with both SQLite and PostgreSQL. Requires a
  migration.
- **API:** `/api/settings` PUT maintains an explicit allowlist of updatable fields
  (`app/api/settings/route.ts` ~line 108) — add `dailyStatsAvgDays` there, clamped to
  2–14 server-side. GET needs no change (Prisma default covers existing rows/creates).
- **UI:** number input in the existing SettingsForm **ConfigTab**, near the other
  behavior toggles. Label: *"Running average window (days)"* with a one-line description.
  Client clamps to 2–14. All strings localized.

---

## 4. Data loading

The daily view fetches through `useActivityCache` (`fetchWindow(babyId, date, radius)`),
currently a symmetric ±1 day window bucketed per-day.

- Extend `fetchWindow` to an **asymmetric window**: `N = max(1, dailyStatsAvgDays)` days
  back, 1 day forward. Signature: `radius: number` becomes `{ before, after }`;
  `buildDateRange` generalizes accordingly.
- Per-day cache bucketing is unchanged, so day-to-day navigation still only fetches
  uncached days. `fetchWindow` already returns `allActivities` for the whole window.
- `TimelineV2/index.tsx` passes two new props to `TimelineV2DailyStats`:
  `windowActivities` (the `allActivities` result) and `avgDays` (from settings).
- **Settings race:** the first fetch may run with the default (5) before `/api/settings`
  resolves. The fetch effect gains `avgDays` as a dependency; when settings arrive, the
  cache fetches only the missing days.
- Polling (`refreshCurrentDay`) is unchanged — it refreshes the selected day only, which
  is correct: baseline days are in the past and don't need polling.

---

## 5. `computeDayStats` extraction

The ~600-line single-day stats computation inside the `statTiles` `useMemo` moves to a
**pure function** in a new colocated file
`src/components/Timeline/TimelineV2/computeDayStats.ts`:

```
computeDayStats(activities, dayDate, { preferredUnit, cutoff? }): DayStats
```

- Returns the numeric struct the tile builder needs: `totalSleepMinutes`, `awakeMinutes`,
  `feedCount`, `bottleVolume` (in `preferredUnit`), breast L/R minutes, `solidsAmounts`,
  `wetCount`, `poopCount`, medicine/supplement stats, and the other per-day counts. The
  tile assembly (icons, labels, popovers) stays in the component and consumes this struct
  for the viewed day — existing tiles render identically.
- **`cutoff` (optional `Date`, absolute timestamp):** stats count only activity through
  `min(endOfDay, cutoff)`. Sleep-overlap math truncates naturally; point-in-time
  activities filter by `time <= cutoff`. Ongoing sleep (no `endTime`) is credited up to
  the cutoff. This replaces the current inline `isToday ? now : endOfDay` logic: the
  viewed-day call passes `cutoff = now` when viewing today, nothing otherwise.
- Pure (no `new Date()` for "now" inside) → directly unit-testable.

---

## 6. Average computation

In `TimelineV2DailyStats`, one `useMemo` over `windowActivities`:

1. For each of the `avgDays` days preceding the viewed day, slice `windowActivities` by
   local-time day bounds and run `computeDayStats` (no cutoff).
2. **Empty-day exclusion:** a baseline day with *zero activities of any type* is treated
   as "not tracked" (travel, pre-app) and excluded from the denominator. A tracked day
   with zero of one metric (no poops logged) counts as a legitimate 0 for that metric.
   If all baseline days are empty, no averages exist and all average UI is suppressed
   (tiles revert to exact current behavior).
3. **Full-day averages** per metric = mean over included days.
4. **Expected-by-now (today only):** a second pass over the same included days with
   `cutoff` set to the current clock time mapped onto each baseline day; mean per metric.
   Inclusion is still judged on *full-day* emptiness (a tracked day that was quiet until
   this hour is a legitimate "usually 0 by now" signal).

Pace freshness: the 30-second polling refreshes only the selected day's activities, not
`windowActivities`. The averages memo therefore depends on **both** props (viewed-day
`activities` and `windowActivities`), so each poll-driven update recomputes the
expected-by-now cutoff with a fresh "now" — baseline data is past days and never needs
refetching, only re-truncating. The parent must also update its `windowActivities` state
from every `fetchWindow` result (including the post-form-success refetch).

---

## 7. Display

### Average line (all viewed days)

`StatTile` gains optional `avg?: string` and `pace?` fields. The four core tiles set
`avg` when a baseline exists:

| Tile | Format | Example |
|------|--------|---------|
| Total Sleep | `formatMinutes` | `avg 6h 58m` |
| Feeds | count (1 decimal) + bottle volume when avg > 0 | `avg 7.2 · 24.5 oz` |
| Wet Diapers | 1 decimal | `avg 4.6` |
| Poops | 1 decimal | `avg 2.1` |

Rendered as a third line under the label: small (`text-[10px]`), muted gray, prefixed
with the localized `avg`. Volume uses the same rounding as existing bottle totals and the
family's preferred unit.

### Pace popover (today only)

The avg line gains an (i) button (same `Popover` pattern and `stopPropagation` handling
as the existing feed-breakdown popover, since tiles are filter buttons). Content:

- *"Usually {expected} by {time}"* — `{time}` respects the family's 12h/24h format.
- Status line: **ahead of pace** (actual ≥ 110% of expected), **behind pace**
  (≤ 90%), else **on pace**. If expected is 0: actual > 0 → ahead, actual 0 → on pace.

Wording is neutral (ahead/behind describes quantity, not judgment).

### Zero-data core tiles

A core tile renders when `dayValue > 0` (current rule) **or** its baseline avg > 0.
At zero: value shows `0` (`0h 0m` for sleep), the label falls back to its plain form
(e.g. `Feeds` with no amounts, no breakdown popover), and the avg line renders as usual.
Tap-to-filter behavior is unchanged (filtering an empty day yields an empty list —
acceptable). Non-core tiles keep the current visibility rule.

### Dark mode

New classes (e.g. `.daily-stats-avg-line`, popover text) get `html.dark` overrides in
`TimelineV2DailyStats.css` per project convention — no `dark:` Tailwind prefixes.

---

## 8. Localization

- New keys added to `en.json` first, composed per existing concatenation patterns
  (the codebase builds strings like `` `${t('L:')} ${formatMinutes(...)}` ``): `avg`,
  `Usually`, `by`, `Ahead of pace`, `Behind pace`, `On pace`, `Running average window
  (days)` plus its settings description.
- Run `node scripts/check-missing-translations.js` after adding keys.

---

## 9. Edge cases & known limitations

- **Short history (new baby):** fewer tracked baseline days → average over what exists;
  none → no average UI at all.
- **DST:** day bounds and cutoff mapping use local `Date`/`setHours` like the existing
  stats; JS clock-time adjustment on transition days is accepted as-is.
- **Baseline staleness after edits:** form success invalidates only the selected day's
  cache (pre-existing behavior). Editing an activity dated on a baseline day may leave a
  stale average until cache expiry/navigation. Accepted for v1; verify per-day cache
  staleness behavior during implementation.
- **Timezone:** unchanged — same local-device-time semantics as current daily stats.

---

## 10. Verification

No test runner is currently configured in the repo (no `test` script in `package.json`).
`computeDayStats` is deliberately pure so unit tests can be added when a runner exists,
covering: day-bound slicing, cutoff truncation, ongoing-sleep crediting, empty-day
exclusion, and unit conversion.

Manual checklist for v1:
1. Past day: averages match hand-computed values over the N preceding tracked days.
2. Today: (i) popover shows expected-by-now matching truncated baseline days; status
   flips correctly around the ±10% thresholds.
3. Zero-data core tile appears with avg when baseline > 0; disappears when baseline = 0.
4. Settings: change window length → save → daily view refetches and averages update;
   values outside 2–14 are clamped.
5. Dark mode styling; translations script run; existing tiles/filters unaffected.
