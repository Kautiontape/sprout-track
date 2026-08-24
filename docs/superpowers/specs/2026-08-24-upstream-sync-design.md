# Upstream Sync: 1.3.4 → 1.6.5 — Design

**Date:** 2026-08-24
**Status:** Approved, ready for implementation planning

## Problem

We forked `Oak-and-Sprout/sprout-track` at tag **1.3.4** (commit `1c0d6a1`, 2026-05-19)
and have not merged upstream since. Upstream is now at **1.6.5**, eight tagged
releases and 484 commits ahead. We are missing two security patches, an
accessibility overhaul, a test runner, and roughly 80k lines of features.

We want to close that gap without losing our four features — potty/EC tracking,
day-night flip, the daily-summary running average, and the ktn deployment
customizations — and without doing this the hard way again in three months.

## Divergence

|                        | commits | files | net lines |
| ---------------------- | ------: | ----: | --------: |
| Our fork since 1.3.4   |     114 |   192 |   +22,496 |
| Upstream since 1.3.4   |     484 |   895 |   +80,086 |

92 files were touched by both sides. Our commits group cleanly by topic:
`potty:` (47), `flip:` (28), `ktn:` (16), `stats:` (14), `docs:` (3).

**No feature collides.** Upstream has no potty/EC tracking, no day-night flip, and
no hue config. Our four features are purely additive, which is what makes this a
merge rather than a rewrite.

**No migration filenames collide.** We added 4 migrations (hue config, day-night
flip, daily-stats avg days, potty log); upstream added 22. The dates interleave,
but Prisma applies unapplied migrations regardless of sort position relative to
already-applied ones. The dry run on a copy DB proves this rather than assuming it.

## Decisions

Five decisions settled during design and drive everything below.

1. **Staged merge along release tags, not one big merge and not a re-fork.**
   Eight rungs, each a `git merge <tag>`. Conflicts arrive in small batches and a
   regression can be attributed to a specific release. Our 114 commits keep their
   history.
2. **Our nursery mode wins; upstream's is restored alongside it behind a toggle.**
   See below — this turns the worst conflict source into a mechanical one.
3. **Our decisions stand. Upstream is absorbed, not adopted.** Where upstream made
   a different call than we did, ours survives the merge unchanged. We conform to
   upstream only where their code path mechanically requires it.
4. **`main` is not touched until the end.** A push to `main` triggers
   `build & publish` → `deploy-ktn`. All work happens on `sync/upstream-1.6.5`.
5. **The real database is not migrated until cutover.** All migration testing runs
   against a throwaway copy.

## Nursery mode

Our fork **deleted upstream's entire nursery tree** — `Clock`, `FeedTile`,
`SleepTile`, `PumpTile`, `DiaperTile`, `SettingsDrawer`, `TileShell`, `SubButton`,
`NurseryModeContainer`, `nursery-animations.css`, and
`app/api/nursery-mode-settings/route.ts` — and replaced it with a self-contained
`src/components/NurseryMode/` (index.tsx + NurseryMode.css), with
`app/(nursery)/[slug]/nursery-mode/page.tsx` repointed to ours.

Our implementation imports nothing from upstream's nursery tree. Its only imports
are React, Next navigation, our baby and localization contexts, and our own potty
constants and elimination helper. The two implementations are fully decoupled.

Therefore the ~11 nursery files are **delete-vs-modify conflicts, not semantic
ones**. Policy, applied at every rung without re-litigation: **always take theirs.**
Upstream's tree is restored to its 1.6.5 state; ours is untouched.

At the end, `page.tsx` chooses between them from a **device-local setting**
(`localStorage`), defaulting to ours. This matches upstream's own "personalization
saved per device" pattern for nursery mode and requires no schema change and no
migration.

Upstream put **50 commits** into nursery mode since we forked, including a full
redesign in 1.5.0 (immersive scenes, personalization drawer, one-tap undo, large
on-screen timers, reduced-motion support). Restoring their tree makes those ideas
diffable and cherry-pickable instead of hypothetical. We expect to run ours in
essentially every case; the toggle exists so good upstream ideas can be evaluated
in place rather than reconstructed from a changelog.

## The ladder

Branch `sync/upstream-1.6.5` off `main`. Each rung produces one merge commit,
`sync: Merge upstream <version>`.

| Rung | Upstream commits | Overlap (+locale) | Our features in the blast radius | Pass  |
| ---- | ---------------: | ----------------: | -------------------------------- | ----- |
| 1.3.5 |               5 |            11     | auth/settings/caretaker (ktn)     | light |
| 1.4.0 |              18 |        44 + 9     | DailyStats, hooks API, report route, schema | deep |
| 1.5.0 |             112 |        37 + 9     | timeline, activity settings, schema | deep |
| 1.6.0 |              68 |        42 + 9     | report route, timeline, ActivityTileGroup | deep |
| 1.6.2 |             129 |        29 + 9     | hooks API, report route, schema    | deep |
| 1.6.3 |               5 |             2     | Dockerfile only                    | light |
| 1.6.4 |             113 |        35 + 9     | notification prefs, timeline export, db-backup | deep |
| 1.6.5 + main |       34 |         6 + 9     | TimelineV2                        | full  |

Upstream never tagged 1.6.1, so the 1.6.2 rung carries 1.6.1's content (WHO growth
data, backdated breastfeed timers, grams weight, per-baby feed-timer resets) as
well. It is the largest rung and cannot be split on a tag boundary.

Deep passes are **targeted**: they exercise the features that rung actually
touched, not all four every time.

## What each release brings

- **1.3.5 — Security patch.** Auth-forgery fix, session hardening, PINs and config
  secrets no longer sent to the browser, tightened admin/family-management access,
  auto-generated JWT key on setup and upgrade. Non-negotiable.
- **1.4.0 — Accessibility, bath types, feed timers.** Screen-reader and keyboard
  overhaul; bath types; per-baby feed-timer-from-start-or-end; nursing sessions
  linked across sides; webhook breastfeed timer control. **Brings vitest.**
- **1.5.0 — Nursery redesign, Photos, Baby Buddy import.** Full nursery redesign;
  encrypted photo gallery with per-family quotas and timeline attachments; Baby
  Buddy CSV import; global sleep-location rename/merge/hide.
- **1.6.0 — Foods & allergens.** Solid feeds split into a dedicated food activity
  with a foods database, allergen linking, first-100-foods tracker, and report-card
  sections. Ships an **automatic migration converting existing solid-feed logs into
  food logs.**
- **1.6.2 (incl. 1.6.1).** WHO growth data with CDC fallback; breastfeeding pause
  tracking; **webhook API `PUT`/`DELETE` with strict unknown-field rejection and
  case-insensitive value validation**; family-scoping security fix; mixed
  bottle-type data migration.
- **1.6.3 — Hotfix.** WHO data in the Docker build; breastfeed link time fix.
- **1.6.4 — QoL + native layer.** Multi-food logs, dry-diaper logging, diaper and
  sleep notes, timeline activity icons and caretaker badges, gift codes, native app
  layer, Firefox idle-timer fix.
- **1.6.5 — Polish.** Nursery yesterday/today labels and 24h time, Baby Buddy
  medication import, growth chart scaling, sleep location sorting, Hindi. Plus one
  trailing `main` commit (CI change).

## Conflict recipes

Decided once, applied at every rung.

**Locale files** — the loudest conflict, 9 files × 8 rungs. Our `en.json` adds
**350 keys and modifies zero existing ones**, so "take theirs, then re-append our
350" is provably lossless. A helper script `scripts/merge-locale-conflict.js`,
written before rung 1, performs this; then `scripts/check-missing-translations.js`
propagates and sorts. This reduces ~72 file conflicts to one command per rung.

**`prisma/schema.prisma`** (5 rungs) — union. Our `PottyLog` model and baby config
fields are additive against upstream's 391 new lines. Gate: `prisma validate`, then
`prisma migrate deploy` against the copy DB.

**`app/api/types.ts`** (7 of 8 rungs) — union; our potty types appended.

**`Dockerfile` / `.dockerignore`** (every rung) — ours is a ktn-specific rewrite.
Keep ours as the base and hand-port upstream's substantive changes (GHCR move,
dropped emulation). Decided once, not re-litigated per rung.

**`src/components/features/nursery-mode/*` and `app/api/nursery-mode-settings/`** —
always take theirs, per the nursery decision above.

## Reconcile deliberately — but our decisions stand

Three places where upstream made a different call. In all three, **our
implementation survives the merge unchanged.** They are listed so the merge is a
conscious act rather than an autopilot one.

1. **1.4.0 report-card denominators.** Upstream changed report-card averages to
   divide by days since birth instead of calendar days. We anchor potty stat
   denominators to the first-ever catch. Both stay. Their change applies to their
   averages; ours applies to potty. We verify the two coexist in
   `MonthlyReportCard`, and we do not re-base our anchoring on theirs.
2. **1.6.2 webhook validation.** Upstream's hooks API now rejects unknown fields and
   validates values case-insensitively. Our potty fields flow through that
   validator, so they must be **registered with it to keep working** — mechanical
   conformance, forced by their code path. The shape and semantics of our potty
   hooks API do not change.
3. **1.6.4 dry-diaper flag.** Upstream added dry-diaper logging, which is
   conceptually adjacent to EC. We do **not** rework our never-increment-diaper-
   counts invariant around it. Recorded under Deferred below.

## Verification

Every rung: `tsc --noEmit`, `next build`, `scripts/check-missing-translations.js`
clean. (`npm run lint` is known-broken and is not a gate.)

Deep rungs add: `prisma migrate deploy` against `db/sync-test.db` (a copy),
`npm run dev`, and a browser smoke test of the feature that rung touched.

**At rung 1.4.0, wire up the tests.** Upstream introduces vitest there. Our six test
files (`DayNightFlip/engine`, `facts`, `protocol`, `schedule`, `wizards`, and
`Reports/potty-stats.utils`) currently use `node:test` and have **no runner at all**
— `package.json` has no test script. Porting them is a one-line import change per
file (`node:test` → `vitest`; the `node:assert/strict` calls work unchanged). Every
rung from 1.4.0 onward then gets automated regression coverage of the flip engine
and potty stats for free.

## Data safety

Before starting, back up `db/baby-tracker.db` to
`.pre-upstream-20260824-<hhmmss>.bak`, matching the existing `.pre-flip-` /
`.pre-potty-` convention. Deep-rung migration testing runs against a copy at
`db/sync-test.db` via a `DATABASE_URL` override.

Two upstream releases ship data migrations that rewrite existing rows — 1.6.0
(solid feeds → food logs) and 1.6.2 (mixed bottle-type values). These are the rungs
where the copy-DB dry run matters most, and both must be inspected on the copy
before cutover.

## Cutover

Full verification on `sync/upstream-1.6.5`. Back up the real DB. Merge to `main`,
which triggers `build & publish` → `deploy-ktn`. Verify on ktn. Version lands at
1.6.5.

## Phase 2 — after the ladder

Deliberately sequenced after the merge; refactoring against code that is about to
shift underneath is wasted work.

**Sync doc** at `documentation/upstream-sync.md`: the `upstream` remote, the ladder
procedure, the conflict recipe table, the hotspot list, and a cadence
recommendation — sync at each upstream tag, since one rung is a coffee break and
eight is this project.

**Isolation refactor** of the files that conflicted most, so our logic sits behind
seams and upstream files carry a call site rather than scattered edits:
`DailyStats` and `TimelineV2` (stats), `ActivityTileGroup` (potty). Nursery is
already fully isolated by the decision above and needs nothing.

## Deferred

Not in scope. Recorded so they are choices rather than oversights.

- Adopting upstream's **dry-diaper flag** as part of the EC model, and the
  simplification it might allow in the never-increment-diaper-counts invariant.
- **`PUT`/`DELETE` webhook support for potty entries.** Upstream added edit and
  delete to the hooks API in 1.6.2 for its own activity types. Extending it to
  potty is new functionality, not restored parity.
- Cherry-picking ideas from upstream's **1.5.0 nursery redesign** into ours.
- **Upstreaming** potty/EC tracking or day-night flip as contributions to
  Oak-and-Sprout.

## Out of scope

- Any change to the shape or semantics of our four features.
- Fixing `npm run lint`.
- Upstream releases past 1.6.5 (the ladder ends at `upstream/main` as of 2026-08-24).
