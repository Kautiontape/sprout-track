# EC Potty Stats (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `PottyStatsSection` in Reports (catches/day, poop scoreboard, wake-up panel, hour histogram), a potty lane in the heatmaps, and a potty section on the monthly report card.

**Architecture:** All computation client-side over the `/api/timeline` payload Reports already fetches, in one pure TDD'd module. Components mirror the `DiaperStatsSection` + `DiaperChartModal` pattern. One additive API change: `poopCatchShare` on `MonthlyReport.potty`.

**Tech Stack:** Next.js App Router, strict TypeScript, TailwindCSS + CVA light / `html.dark` CSS dark, `node:test` via `npx tsx --test`.

**Source spec:** `docs/superpowers/specs/2026-07-30-ec-potty-stats-phase-2-design.md` — READ IT FIRST; its "Design rules" section is binding. The research behind it: `docs/superpowers/specs/2026-07-30-ec-stats-research.md`.

---

## Orientation

Everything in Phase 1's orientation still applies (see `docs/superpowers/plans/2026-07-29-ec-potty-tracking-phase-1.md`): family scoping, `{success,data,error}` envelope, `html.dark` not `dark:`, `t()` for all text with keys added centrally at the end, `topic: message` commits with no Co-Authored-By, tsc baseline 0 errors, and **the invariant: a potty catch never increments a diaper count** (the poop scoreboard READS diaper dirty counts as a denominator — that is the design, not a violation; diaper stats themselves stay untouched).

Discriminators: `'pottyLocation' in a` identifies potty; always check it before `'condition' in a` (both carry `type`).

Key reference files (read before coding against them):
- `src/components/Reports/StatsTab.tsx` — fetches activities once, computes a `stats` object in a big `useMemo` (diaper block at ~line 618), renders accordion sections (~line 829). Note its timezone day-key pattern.
- `src/components/Reports/DiaperStatsSection.tsx` + `DiaperChartModal.tsx` — the structural template: `AccordionItem` → `statsGrid` of tappable `Card`s → modal with a metric enum.
- `src/components/Reports/reports.types.ts` — `DiaperStats` at ~line 393; add `PottyStats` beside it.
- `src/components/Timeline/TimelineV2/timeline-heatmap.utils.ts` — `HeatmapType` union (line 7), `HEATMAP_TYPES_IN_ORDER` (line 9), `HEATMAP_COLORS` (line 20), slot-count builder (line 89, 288 five-minute slots, ±30-min smoothing).
- `src/components/Reports/HeatmapsTab.tsx` — lane order constant at line 28, label/icon wiring.
- `app/api/babies/[babyId]/report/[yearMonth]/route.ts` + `MonthlyReport` type in `app/api/types.ts` — Phase 1 already added `potty: { totalCatches, avgCatchesPerDay, locationDistribution }`.
- `src/components/Reports/MonthlyReportCard/` — existing sections (e.g. `DiapersSection.tsx`) to mirror.

Data reality: production has ~0 potty rows. **Empty/low-data states are first-class deliverables**, not afterthoughts — every surface must look intentional with 0–10 catches (spec "Presentation" section).

---

## Task 1: `potty-stats.utils.ts` (TDD)

**Files:**
- Create: `src/components/Reports/potty-stats.utils.ts`
- Test: `src/components/Reports/potty-stats.utils.test.ts`

The single pure module all components consume. Signature sketch (adapt field names to what Task 2's cards need, but keep it pure — timezone conversion enters as a passed-in `toLocalDate`-style function, matching how `computeDayStats` keeps itself pure):

```typescript
export interface PottyStats {
  totalCatches: number;          // rows
  peesCaught: number;            // type WET|BOTH  (eliminations)
  poopsCaught: number;           // type DIRTY|BOTH
  avgCatchesPerDay: number;      // 1 decimal, over daysInRange
  daysInRange: number;
  dailySeries: { day: string; pees: number; poops: number; catches: number }[];
  rollingAvg7: { day: string; value: number }[];
  scoreboard: {
    poopsCaught: number;
    poopyDiapers: number;
    shareCaught: number | null;  // null when denominator 0
    weekly: { weekStart: string; caught: number; diapered: number; share: number | null }[];
  };
  wakeUp: {
    windowMinutes: number;       // 20
    wakeUpCatches: number;
    shareOfAllCatches: number | null;
    napCoverage: { hit: number; total: number };
    nightCoverage: { hit: number; total: number };
    medianGapMinutes: number | null; // null below 10 wake-up catches
  };
  hourHistogram: { binHours: 1 | 2; bins: { startHour: number; pees: number; poops: number }[] };
}

export function computePottyStats(
  activities: any[],              // the Reports ActivityType[] — duck-typed inside
  dateRange: { from: Date; to: Date },
  toLocalParts: (iso: string) => { dayKey: string; hour: number }, // tz-aware, injected
): PottyStats
```

Rules the tests must pin down (all from the spec's binding Design rules):
- `BOTH` counts in BOTH splits; `totalCatches` counts rows. A day with one `BOTH` catch → `catches:1, pees:1, poops:1`.
- Scoreboard: potty `DIRTY|BOTH` vs diaper `DIRTY|BOTH`; weeks bucketed via the injected day keys (Monday start, matching however `StatsTab` buckets weeks — check; if it has no weekly precedent, use ISO weeks and say so); `share: null` when `caught+diapered === 0`.
- Wake join: nearest preceding `SleepLog.endTime` within 20 min; open-ended sleeps (`endTime` null) excluded from coverage denominators; nap vs night via `type` (`NAP`/`NIGHT_SLEEP`); two sleeps ending close together → the nearer end wins; `medianGapMinutes: null` below 10 wake-up catches.
- Adaptive bins: `binHours = totalCatches >= 50 ? 1 : 2`. Test the boundary at exactly 50.
- Soft-deleted rows (`deletedAt` set) excluded everywhere. Empty range → zeroed struct, no NaN (guard the averages).
- **Diaper counts never change:** the module reads diapers only for the scoreboard denominator; assert a potty-only input yields `poopyDiapers: 0` and that the function never mutates its inputs.

- [ ] Step 1: Write the full failing test file (aim ~15 cases covering every rule above, node:test style per `src/lib/elimination.test.ts` — fixed local dates, helper builders)
- [ ] Step 2: `npx tsx --test src/components/Reports/potty-stats.utils.test.ts` — CONFIRM failure (module missing), record output
- [ ] Step 3: Implement
- [ ] Step 4: Re-run — all pass. Also `npx tsc --noEmit` (0)
- [ ] Step 5: Commit `potty: Add potty stats computation module`

## Task 2: `PottyStatsSection` + `PottyChartModal` + StatsTab wiring

**Files:**
- Create: `src/components/Reports/PottyStatsSection.tsx`, `src/components/Reports/PottyChartModal.tsx`
- Modify: `src/components/Reports/StatsTab.tsx`, `src/components/Reports/reports.types.ts`, `src/components/Reports/reports.styles.ts` (only if a potty style token is needed), the Reports dark-mode CSS file (find it — check what `reports-stat-card` etc. live in)

Mirror `DiaperStatsSection`/`DiaperChartModal` structurally. Section content:
- Cards: Total catches, Catches/day, Pees caught, Poops caught, Poops caught vs diapered (e.g. "7 caught · 3 in diaper"), Wake-up catches, Typical gap after waking (hidden below 10 wake-up catches per spec).
- Tap-throughs (`PottyChartMetric`): `'daily'` (stacked pee/poop bars + 7-day rolling line), `'scoreboard'` (weekly share-caught stacked bars — hidden until ≥2 weekly points), `'hours'` (histogram at the adaptive bin width).
- Wake-up coverage line rendered as "N of M nap wake-ups followed by a catch" — **opportunity coverage wording, never "success rate"** (spec rule 3).
- Empty state: zero catches in range → a single friendly card ("No potty catches in this range yet") instead of a grid of zeros.
- `PottyStats` type added to `reports.types.ts`; `stats.potty = computePottyStats(...)` added to StatsTab's `useMemo` (both the zeroed default at ~line 131 and the computed object at ~line 618 — match how `diaper` appears in BOTH places); `<PottyStatsSection>` rendered after `<DiaperStatsSection>` (~line 829).
- Icon: lucide `Toilet`; identity color fuchsia (`text-fuchsia-600` light; add the `html.dark` override in the Reports CSS file mirroring how diaper's icon color is dark-moded — find `reports-icon-diaper-wet` and add `reports-icon-potty`).
- Charts: match whatever charting approach `DiaperChartModal` uses (read it — do not introduce a new chart library).

- [ ] Read the four reference files end to end first
- [ ] Implement; `npx tsc --noEmit` 0; re-run Task 1 tests (still green)
- [ ] Commit `potty: Add potty stats section to reports`

## Task 3: Heatmap lane

**Files:**
- Modify: `src/components/Timeline/TimelineV2/timeline-heatmap.utils.ts`, `src/components/Reports/HeatmapsTab.tsx`, plus that tab's dark-mode CSS if lane colors are dark-moded there (check how `diapers` lane colors are handled)

- `HeatmapType` += `'potty'`; `HEATMAP_TYPES_IN_ORDER`: insert between `'feeds'` and `'diapers'` (spec: adjacent to Wake/Feeds so correlation is visible).
- `HEATMAP_COLORS.potty = { base: '#d946ef', light: '#f0abfc' }`.
- Slot-count branch keyed `'pottyLocation' in activity` placed BEFORE the diaper branch, same ±30-min smoothing the diaper lane uses.
- `HeatmapsTab` lane order constant (line ~28), label `t('Potty')`, `Toilet` icon — mirror the diapers entry.
- Check `TimelineV2Heatmap.tsx` (the timeline's own heatmap consumer) — if it enumerates `HeatmapType` exhaustively it needs the same additions; report either way.

- [ ] Implement; tsc 0; verify by reading that a potty row would land in exactly one lane (never the diaper lane)
- [ ] Commit `potty: Add potty lane to heatmaps`

## Task 4: Monthly report card

**Files:**
- Modify: `app/api/babies/[babyId]/report/[yearMonth]/route.ts`, `app/api/types.ts`
- Create: `src/components/Reports/MonthlyReportCard/PottySection.tsx`
- Modify: `src/components/Reports/MonthlyReportCard/index.tsx` (render the section), its types file, and its CSS for dark mode

- API: add `poopCatchShare: number | null` to `MonthlyReport['potty']` — `caughtPoops / (caughtPoops + dirtyDiapers)` for the month, null when denominator 0. Both queries already exist in the route (potty fetch and diaper fetch); this is arithmetic, not new queries. Keep the section sibling-shaped: it must not touch the `diapers` block.
- UI: `PottySection` mirroring `DiapersSection.tsx` — totalCatches, avgCatchesPerDay, poopCatchShare (as "X% of poops caught", hidden when null), locationDistribution as a small list. Fuchsia accents, `html.dark` overrides in the card's CSS.
- Hide the whole section when `totalCatches === 0` (a monthly report full of zeros for a non-EC month is noise).

- [ ] Implement; tsc 0
- [ ] Commit `potty: Add potty section to monthly report`

## Task 5: Localization

- Derive keys from the code (grep `t('` over the four new/changed component files), check each against `en.json` (duplicates are JSON errors — `Potty`, `Pee`, `Poop`, `day`, `avg` etc. already exist), add missing to `en.json` only, run `node scripts/check-missing-translations.js` (propagates to all NINE locales), validate all nine parse.
- [ ] Commit `potty: Add phase 2 translation keys`

## Task 6: Verification

- [ ] `npx tsc --noEmit` — 0
- [ ] All suites: elimination (11), DayNightFlip engine/facts/schedule (22/8/15), `potty-stats.utils.test.ts`, `npx tsx scripts/verify-compute-day-stats.ts`
- [ ] `npm run build` — passes (`npm run lint` is broken repo-wide; not a gate)
- [ ] DB safety: if any test rows were created in `db/baby-tracker.db` (244 DiaperLog / 0 PottyLog / 3 ApiKeys), confirm restored
- [ ] Commit any fixes; controller merges/pushes main and confirms the ktn deploy (build & publish → Deploy to ktn → container healthy)

## Notes for the implementer

- Line numbers drift; locate by content.
- The user's caretaker PIN must never be guessed (3 failures = IP lockout on their real account). Route-handler-level verification with a temp ApiKey (created and deleted via Prisma) is the accepted pattern if runtime proof is needed.
- If `StatsTab`'s existing structure contradicts this plan anywhere, the existing structure wins for HOW and the spec wins for WHAT — report the discrepancy.
