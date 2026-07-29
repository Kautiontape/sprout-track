# Elimination Communication (Potty) Tracking — Design

**Date:** 2026-07-29
**Status:** Approved, ready for implementation planning

## Problem

We practice elimination communication (EC) and currently record potty successes as
free-text notes. We want it built in as a first-class thing: when and where she
went. We do not want to track attempts or misses — only wins, the times a diaper
was skipped.

## Decisions

Four decisions were settled during design and drive everything below.

1. **A potty catch resets the diaper timer but is counted separately.** The
   "time since last diaper" status bubble should treat a catch as elimination
   (the diaper is clean, stop nagging), while daily stats keep "Diapers" and
   "Potty" as distinct numbers. Diaper counts continue to mean diapers used.
2. **"Where" means the receptacle, from a preset list.** Potty chair, toilet,
   sink, tub, outside, other. A family can hide receptacles it never uses.
3. **The payoff surfaces are all four:** a daily count, timeline entries, a
   time-of-day pattern in Reports, and streaks.
4. **No feature gating.** This is a personal fork; potty tracking is always on,
   like diaper tracking. There is no `enablePottyTracking` setting.

## Architecture

`PottyLog` is a **sibling of `DiaperLog`, not a variant of it.**

The alternative considered was a boolean flag on `DiaperLog` (`inPotty`), which
would inherit every existing surface for free — form, timeline, tile, export,
backup — and reset the diaper timer automatically. It was rejected on failure
mode. With a flag, "counted separately" means adding `where: { inPotty: false }`
to every diaper aggregation forever: `DailyStats`, `computeDayStats`,
`Reports/StatsTab`, `HeatmapsTab`, `DiaperStatsSection`,
`MonthlyReportCard/DiapersSection`, `DayNightFlip/facts.ts`,
`baby-last-activities`, and the hooks status endpoint. Miss one and the diaper
count is silently wrong. With a separate model, missing an aggregation site means
potty data is merely absent from that view — visible and harmless. Fail-loud beats
fail-silent for numbers we intend to trust later.

A separate model is also what streaks, a dedicated Reports section, and a distinct
timeline identity all want anyway.

### Schema

```prisma
model PottyLog {
  id            String     @id @default(uuid())
  time          DateTime
  type          DiaperType // WET | DIRTY | BOTH — labeled Pee / Poop / Both in potty UI
  pottyLocation String?    // POTTY_CHAIR | TOILET | SINK | TUB | OUTSIDE | OTHER
  notes         String?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  deletedAt     DateTime?

  family   Family? @relation(fields: [familyId], references: [id])
  familyId String?

  baby        Baby       @relation(fields: [babyId], references: [id], onDelete: Cascade)
  babyId      String
  caretaker   Caretaker? @relation(fields: [caretakerId], references: [id])
  caretakerId String?

  @@index([time])
  @@index([babyId])
  @@index([caretakerId])
  @@index([deletedAt])
  @@index([familyId])
}
```

Two field choices are load-bearing:

**`type` reuses `DiaperType`** rather than introducing a `PottyType` enum. The
three values map exactly onto pee/poop/both, the migration stays free of enum DDL
(which matters because it must apply cleanly to both PostgreSQL and SQLite), and a
combined elimination view stays trivial if we ever want one. The UI labels the
values Pee / Poop / Both wherever potty is the subject.

**`pottyLocation`, not `location`.** `getActivityVariant()` in
`src/components/ui/activity-tile/activity-tile-utils.ts` identifies activity types
by duck-typing on field presence (`'condition' in activity` → diaper). A bare
`location` would collide with `SleepLog.location` and `PlayLog.location`.
`'pottyLocation' in activity` is collision-free and requires no refactoring of the
existing `ActivityType` union. Stored as a string, mirroring `SleepLog.location`.

One `Settings` addition:

```prisma
pottyLocationSettings String? // JSON string for hidden potty locations
```

A direct copy of the `sleepLocationSettings` pattern. It prunes the receptacle
list so a family that never uses the sink or tub isn't tapping past them — both in
`PottyForm` and in the Nursery Mode chip row.

Note that hidden sleep locations are managed **inside `SleepForm` itself**, not in
`SettingsForm`; `PottyForm` mirrors that. One rule from `SleepForm` must carry
over: a hidden receptacle is still displayed when editing a record that already
uses it, so hiding a receptacle never makes an existing record uneditable. Unlike
`SleepForm`, potty receptacles are a fixed preset list — no user-defined custom
receptacles.

## Components

### API

**`/api/potty-log`** — GET/POST/PUT/DELETE modeled on `app/api/diaper-log/route.ts`.
All four handlers wrapped in `withAuthContext`. Family scoping follows the same
shape the diaper route already uses: queries are scoped directly rather than
fetched-then-compared, e.g. `where: { id, familyId: userFamilyId }` for
read/update/delete and `where: { id: body.babyId, familyId: userFamilyId }` to
verify the baby on create. `familyId` is set explicitly from `authContext` on
create and stripped from update payloads. Timestamps pass through
`formatForResponse`. Deletes are soft (`deletedAt`).

**`/api/potty-location-settings`** — GET/POST, a near-copy of
`app/api/sleep-location-settings/route.ts`, reading and writing
`Settings.pottyLocationSettings` as `{ hiddenLocations: string[] }`.

### Timer semantics

`app/api/baby-last-activities/route.ts` returns `lastPotty` alongside the existing
`lastDiaper` and `lastPoopDiaper`. The log-entry page feeds the existing diaper
`StatusBubble` with `max(lastDiaper.time, lastPotty.time)`, so the warning stops
nagging about a diaper that is still clean. No `DiaperLog` aggregation changes.

### Main app

- `src/components/forms/PottyForm/` and `src/components/modals/PottyModal.tsx`,
  mirroring the diaper pair, wired from `app/(app)/[slug]/log-entry/page.tsx` via
  an `onPottyClick` handler. Fields: time (`DateTimePicker`), type (Pee / Poop /
  Both), receptacle (preset list with per-family hiding, as above), and an
  optional free-text notes field backing `PottyLog.notes`.
- A `potty` activity-tile variant using lucide-react's `toilet` icon. Light-mode
  variants via CVA in `activity-tile.styles.ts`; dark mode via `html.dark`
  selectors in the tile's `.css` file. No `dark:` Tailwind classes.
- `'potty'` added to the activity-settings default `order`/`visible` arrays. These
  are duplicated across roughly six literal sites in
  `app/api/activity-settings/route.ts` and
  `src/components/ActivityTileGroup/index.tsx`; all must be updated together or
  the tile will be pruned on the next settings save. This is per-caretaker tile
  show/hide/reorder, unrelated to the rejected feature gate.
- Timeline and FullLogTimeline: entry rendering, details panel, filter chip,
  additions to `FilterType` and the `onEdit` union in
  `src/components/Timeline/types.ts`, plus `useActivityCache` and
  `computeDayStats`.
- A Potty count in `DailyStats` and `TimelineV2DailyStats`, beside Diapers and
  Poops.

### Nursery Mode

Nursery Mode is a curated subset of the app — four of eleven activity types — with
its own vocabulary: `nk-` classes in plain CSS, no CVA, no `FormPage`, no `ui/`
primitives. Its ethos is one tap, optimistic POST, toast with an Undo that DELETEs
the created record. Potty earns a slot because EC is precisely the hands-full,
four-second-window activity a kiosk exists for.

Receptacle is chosen per log rather than defaulted from a setting: the "kiosk" is
often a phone that moves room to room, so there is no fixed location to default to.

- A **full-width `POTTY …` button** below the three diaper buttons. Full width
  specifically so it cannot be mistaken for a diaper button on a screen nobody is
  looking at closely.
- It opens an `nk-sheet` modal reusing the Bottle modal's structure: type chips
  (Pee / Poop / Both), then receptacle chips filtered by `hiddenLocations`, then
  Log.
- The sheet **pre-selects the receptacle last used on that device**, held in
  localStorage. Not a hidden default — the chips are visible and switching is one
  tap — but consecutive catches in the same bathroom don't require re-picking.
- `commitPotty()` mirrors `commitDiaper()`: POST, toast, Undo deletes.
- The badge row's diaper badge becomes **elimination-aware**: it shows
  `potty 30m ago` or `diaper 4h ago`, whichever is later, matching the timer
  behavior. Tapping opens the edit sheet for whichever record it represents.
- `editKind` gains `'potty'`; the edit sheet is time + type chips + receptacle
  chips + Delete/Save.
- `refreshStatus()` gains a fifth parallel fetch to `/api/potty-log`.

Because there is no feature gate, Nursery Mode needs no settings fetch — it
continues to fetch only babies, Hue config, and the log endpoints.

### Reports

A `PottyStatsSection` showing catches over time and a **time-of-day
distribution** — for EC this is the genuinely useful view, since it reveals her
rhythm and lets us predict the next window. Plus heatmap integration and a
monthly report card section.

### Streaks

A **streak is a run of consecutive calendar days each having at least one potty
catch** — not a run of consecutive catches. The current streak ends at the most
recent day with a catch; a day with zero catches breaks it. Days are resolved in
the family's configured timezone, consistent with the rest of the app. Also a
first-catch marker (the earliest `PottyLog` for that baby). Both computed from
existing rows, not stored.

## Data flow

Logging from either entry point (main app tile, or Nursery Mode sheet) POSTs to
`/api/potty-log`, which scopes to `authContext.familyId` and writes a `PottyLog`
row. Reads fan out from that single table: `baby-last-activities` for the status
bubble, the timeline endpoints for entries, and the stats components for counts
and patterns. Nothing reads or writes `DiaperLog`, which is the entire point of
the separate-model decision.

## Error handling

Follows existing conventions throughout: the `{ success, data?, error? }` API
response shape, `withAuthContext` for auth, 404 on family mismatch rather than
403 (avoids leaking existence), `handleExpirationError` in forms for expired
accounts, and Nursery Mode's toast-with-Undo for optimistic writes that fail.

## Testing

The repo has no test runner. Existing coverage is `node:test` files for pure
functions (`src/components/DayNightFlip/*.test.ts`) and standalone assertion
scripts (`npx tsx scripts/verify-compute-day-stats.ts`). Matching that:

- A `node:test` file for the elimination-max timer resolution
  (`max(lastDiaper, lastPotty)`), covering the cases where each side is null.
- A `node:test` file for streak computation, covering gaps, single days, and
  timezone-boundary days.
- An extension to `scripts/verify-compute-day-stats.ts` asserting potty counts and
  that diaper counts are unaffected.

React components are not testable under this setup and are verified by running the
app.

## Phasing

**Phase 1 — core loop.** Schema and migration, `/api/potty-log`,
`/api/potty-location-settings`, `PottyForm` + `PottyModal`, the tile variant,
activity-settings defaults, timeline and filter integration, the daily count,
the timer reset, and the Nursery Mode button, sheet, badge, and edit path.

Phase 1 also includes the plumbing that cannot be deferred without silently losing
data: `app/api/utils/db-backup.ts`, `app/api/accounts/download-data/route.ts`,
`app/api/utils/csv-export.ts`, `app/api/timeline/export/route.ts`,
`app/api/babies/[babyId]/report/[yearMonth]/route.ts`, and the hooks API
`activities` and `status` endpoints. Skipping these means potty data escapes
backups and exports.

Localization keys are added to `src/localization/translations/en.json` only,
followed by `node scripts/check-missing-translations.js`.

**Phase 2 — analysis.** `PottyStatsSection` with the time-of-day distribution,
heatmap integration, monthly report card section.

**Phase 3 — motivation.** Consecutive-day streaks and the first-catch marker.

## Notes

`Settings.nurseryModeSettings` is declared in the schema as `String?` with the
comment "JSON string for nursery mode settings per caretaker" and is **never read
or written by any file in the repo**. It is dead. It was considered as a home for
the potty location default before that default was dropped. It should be deleted,
but as separate cleanup — not as part of this work.
