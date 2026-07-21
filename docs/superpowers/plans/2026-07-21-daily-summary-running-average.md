# Daily Summary Running Averages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable running-average line (and today-only "expected by now" pace popover) to the four core Daily Summary stat tiles in TimelineV2.

**Architecture:** Client-side only. The daily view's per-day activity cache widens asymmetrically (N days back, 1 forward); a pure `computeDayStats` function (extracted from the existing 600-line `useMemo`) runs once per baseline day, with an optional `cutoff` timestamp powering the pace comparison. A new `dailyStatsAvgDays` field on the family `Settings` model (default 5, clamped 2–14) controls the window.

**Tech Stack:** Next.js App Router, TypeScript, Prisma (SQLite/Postgres), Tailwind + CVA, existing localization (`t()` is a flat key lookup — no interpolation; compose strings by concatenation).

**Spec:** `docs/superpowers/specs/2026-07-21-daily-summary-running-average-design.md`

**Conventions that apply to every task:**
- Commits: `stats: <Message>` style, NO `Co-Authored-By` lines (user rule).
- No `dark:` Tailwind classes — dark mode is `html.dark` selectors in plain `.css` files. The classes used below (`text-gray-400`, `text-gray-500`, `text-gray-800`) are already covered by existing overrides in `TimelineV2DailyStats.css`; no CSS changes expected.
- There is no test runner in this repo. `computeDayStats` gets a committed, runnable verification script (`npx tsx`). UI tasks verify via `npx tsc --noEmit` plus the manual QA task at the end.
- Typecheck baseline: at the start of Task 1, run `npx tsc --noEmit 2>&1 | tail -5` and note the existing error count (it may be nonzero). Every later "typecheck" step means: run the same command and confirm **no new** errors versus that baseline.

---

## File map

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `dailyStatsAvgDays Int @default(5)` to `Settings` |
| `prisma/migrations/*_add_daily_stats_avg_days/` | Generated migration |
| `app/api/settings/route.ts` | Allowlist + clamp `dailyStatsAvgDays` |
| `src/components/forms/SettingsForm/ConfigTab.tsx` | "Daily Summary" section with number input |
| `src/components/Timeline/TimelineV2/computeDayStats.ts` | **New** — pure per-day stats function |
| `scripts/verify-compute-day-stats.ts` | **New** — runnable assertions for computeDayStats |
| `src/components/Timeline/TimelineV2/useActivityCache.ts` | Asymmetric `fetchWindow({ before, after })` |
| `src/components/Timeline/TimelineV2/index.tsx` | `windowActivities` state, `avgDays`, new props |
| `src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx` | Consume `computeDayStats`, averages memo, avg line, pace popover, zero-data core tiles |
| `src/localization/translations/en.json` (+ es/fr/de/it via script) | New keys |

---

### Task 1: Settings backend — schema, migration, API allowlist

**Files:**
- Modify: `prisma/schema.prisma` (Settings model, ~line 496)
- Modify: `app/api/settings/route.ts:113-133`

- [ ] **Step 1: Capture typecheck baseline**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Note the error count (possibly zero). All later typecheck steps compare against this.

- [ ] **Step 2: Add the schema field**

In `prisma/schema.prisma`, inside `model Settings`, after the `timeFormat` line:

```prisma
  timeFormat          String   @default("12h") // "12h" | "24h"
  dailyStatsAvgDays   Int      @default(5) // Daily Summary running-average window in days (2-14)
```

- [ ] **Step 3: Create the migration**

Run: `npm run prisma:migrate -- --name add_daily_stats_avg_days`
Expected: "Your database is now in sync with your schema" and a new folder `prisma/migrations/<timestamp>_add_daily_stats_avg_days/`. This also regenerates the Prisma client, so `Settings` (which extends `PrismaSettings` in `app/api/types.ts`) picks up the field with no type edits.

- [ ] **Step 4: Allowlist + clamp in the settings API**

In `app/api/settings/route.ts`, add to `adminOnlyFields` (matches its ConfigTab siblings `dateFormat`/`timeFormat`):

```typescript
    const adminOnlyFields: (keyof Settings)[] = [
      'familyName', 'securityPin', 'authType',
      'enableDebugTimer', 'enableDebugTimezone',
      'enableBreastMilkTracking',
      'includeSolidsInFeedTimer',
      'dateFormat', 'timeFormat',
      'dailyStatsAvgDays',
    ];
```

Then, immediately after the `for (const field of allowedFields) { ... }` copy loop (line ~133), add server-side clamping:

```typescript
    if (data.dailyStatsAvgDays !== undefined) {
      const n = Math.round(Number(data.dailyStatsAvgDays));
      data.dailyStatsAvgDays = Number.isFinite(n) ? Math.min(14, Math.max(2, n)) : 5;
    }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no new errors vs baseline.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations app/api/settings/route.ts
git commit -m "stats: Add dailyStatsAvgDays setting (schema, migration, API)"
```

---

### Task 2: Settings UI — ConfigTab number input

**Files:**
- Modify: `src/components/forms/SettingsForm/ConfigTab.tsx`
- Modify: `src/localization/translations/en.json`

- [ ] **Step 1: Add state + input section**

In `ConfigTab.tsx`, change the React import (line 3):

```typescript
import React, { useState, useEffect } from 'react';
```

Inside the component body, after `const { setDateTimeFormats } = useTimezone();` (line ~93):

```typescript
  const [avgDaysInput, setAvgDaysInput] = useState<string>('5');

  useEffect(() => {
    const v = (settings as any)?.dailyStatsAvgDays;
    if (v !== undefined && v !== null) setAvgDaysInput(String(v));
  }, [(settings as any)?.dailyStatsAvgDays]);
```

Then add a new section between the "Feed Timer" section (ends line ~324) and the "Date & Time Format" section:

```tsx
      {/* Daily Summary */}
      <div className="border-t border-slate-200 pt-6">
        <h3 className="form-label mb-4">{t('Daily Summary')}</h3>
        <div className="space-y-4">
          <div>
            <Label className="form-label">{t('Running average window (days)')}</Label>
            <Input
              type="number"
              min={2}
              max={14}
              value={avgDaysInput}
              onChange={(e) => setAvgDaysInput(e.target.value)}
              onBlur={() => {
                const parsed = Math.round(Number(avgDaysInput));
                const clamped = Number.isFinite(parsed) ? Math.min(14, Math.max(2, parsed)) : 5;
                setAvgDaysInput(String(clamped));
                if (clamped !== (settings as any)?.dailyStatsAvgDays) {
                  onSettingsChange({ dailyStatsAvgDays: clamped } as any);
                }
              }}
              className="w-24"
            />
            <p className="text-sm text-gray-500 mt-1">{t('How many previous days are averaged for the Daily Summary comparison')}</p>
          </div>
        </div>
      </div>
```

(The `(settings as any)` casts match this file's existing style for settings fields.)

- [ ] **Step 2: Add en.json keys**

In `src/localization/translations/en.json` add (anywhere — the script sorts later; `"Daily Summary"` already exists):

```json
  "Running average window (days)": "Running average window (days)",
  "How many previous days are averaged for the Daily Summary comparison": "How many previous days are averaged for the Daily Summary comparison",
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/forms/SettingsForm/ConfigTab.tsx src/localization/translations/en.json
git commit -m "stats: Add running average window input to ConfigTab"
```

---

### Task 3: `computeDayStats` — pure function + verification script (test-first)

**Files:**
- Create: `scripts/verify-compute-day-stats.ts`
- Create: `src/components/Timeline/TimelineV2/computeDayStats.ts`

The logic is a faithful port of `TimelineV2DailyStats.tsx` lines 100–368, with three changes: no hooks (`unitSymbol` is passed in), an optional `cutoff` replacing the inline `isToday ? now : endOfDay` logic, and a `hasAnyActivity` flag for empty-day exclusion.

- [ ] **Step 1: Write the verification script (the "failing test")**

Create `scripts/verify-compute-day-stats.ts`:

```typescript
/**
 * Runnable assertions for computeDayStats (no test runner in this repo).
 * Run: npx tsx scripts/verify-compute-day-stats.ts
 */
import { computeDayStats } from '../src/components/Timeline/TimelineV2/computeDayStats';

const opts = { preferredUnit: 'OZ', unitSymbol: (u?: string | null) => u || '' };
const day = new Date(2026, 6, 15); // July 15 2026, local
const at = (h: number, m = 0, dayOffset = 0) =>
  new Date(2026, 6, 15 + dayOffset, h, m).toISOString();

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

const activities: any[] = [
  // Overnight sleep 22:00 (Jul 14) -> 02:00 (Jul 15): 120 min overlap with the day
  { duration: 240, startTime: at(22, 0, -1), endTime: at(2, 0), type: 'NIGHT_SLEEP' },
  // Nap 13:00 -> 14:00: 60 min
  { duration: 60, startTime: at(13, 0), endTime: at(14, 0), type: 'NAP' },
  // Two OZ bottles: 4 + 3
  { amount: 4, type: 'BOTTLE', time: at(9, 0), unitAbbr: 'OZ', bottleType: 'Formula' },
  { amount: 3, type: 'BOTTLE', time: at(12, 0), unitAbbr: 'OZ', bottleType: 'Breast Milk' },
  // Diapers: BOTH at 08:00 (wet+poop), WET at 15:00
  { condition: 'NORMAL', type: 'BOTH', time: at(8, 0) },
  { condition: 'NORMAL', type: 'WET', time: at(15, 0) },
];

// --- Full day ---
const full = computeDayStats(activities, day, opts);
check('full: sleep minutes (120 overnight + 60 nap)', full.totalSleepMinutes, 180);
check('full: feed count', full.totalFeedCount, 2);
check('full: bottle total oz', Math.round(full.bottleFeedTotal * 100) / 100, 7);
check('full: wet count (BOTH + WET)', full.wetCount, 2);
check('full: poop count (BOTH)', full.poopCount, 1);
check('full: hasAnyActivity', full.hasAnyActivity, true);

// --- Cutoff at 13:30: nap truncated to 30, 15:00 wet excluded ---
const cut = computeDayStats(activities, day, { ...opts, cutoff: new Date(2026, 6, 15, 13, 30) });
check('cutoff: sleep minutes (120 + 30 of nap)', cut.totalSleepMinutes, 150);
check('cutoff: wet count (15:00 excluded)', cut.wetCount, 1);
check('cutoff: feed count unchanged', cut.totalFeedCount, 2);

// --- Ongoing sleep credited up to cutoff ---
const ongoing: any[] = [{ duration: 0, startTime: at(12, 0), endTime: null, type: 'NAP' }];
const cut2 = computeDayStats(ongoing, day, { ...opts, cutoff: new Date(2026, 6, 15, 13, 30) });
check('ongoing sleep to cutoff: 90 min', cut2.totalSleepMinutes, 90);

// --- Empty day ---
const empty = computeDayStats([], day, opts);
check('empty: hasAnyActivity', empty.hasAnyActivity, false);
check('empty: sleep 0', empty.totalSleepMinutes, 0);

// --- Awake minutes: full past day = 1439 elapsed - 180 sleep ---
check('full: awake minutes', full.awakeMinutes, 1439 - 180);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-compute-day-stats.ts`
Expected: FAIL — cannot resolve `computeDayStats` (module doesn't exist yet).

- [ ] **Step 3: Implement `computeDayStats`**

Create `src/components/Timeline/TimelineV2/computeDayStats.ts`:

```typescript
import { ActivityType } from '../types';
import { convertVolume } from '@/src/utils/unit-conversion';

export interface DayStatsOptions {
  preferredUnit: string;
  /** Absolute timestamp; stats only count activity through min(end of day, cutoff).
   *  Ongoing sleep (no endTime) is credited up to this bound. Omit for full days. */
  cutoff?: Date;
  /** Unit display mapper (the useUnit hook's unitSymbol) — passed in to keep this pure. */
  unitSymbol: (unitAbbr?: string | null) => string;
}

export interface MedicineStat {
  count: number;
  total: number;
  unit: string;
}

export interface DayStats {
  totalSleepMinutes: number;
  awakeMinutes: number;
  totalFeedCount: number;
  bottleFeedTotal: number;
  breastMilkBottleTotal: number;
  formulaBottleTotal: number;
  otherBottleTotal: number;
  leftBreastFeedMinutes: number;
  rightBreastFeedMinutes: number;
  solidsAmounts: Record<string, number>;
  wetCount: number;
  dirtyCount: number;
  poopCount: number;
  medicineStats: Record<string, MedicineStat>;
  supplementStats: Record<string, MedicineStat>;
  noteCount: number;
  bathCount: number;
  pumpCount: number;
  pumpTotal: number;
  milestoneCount: number;
  measurementCount: number;
  playCount: number;
  totalPlayMinutes: number;
  vaccineCount: number;
  /** False when zero activities of any type touched this day — treated as "not tracked". */
  hasAnyActivity: boolean;
}

const PLAY_TYPES = ['TUMMY_TIME', 'INDOOR_PLAY', 'OUTDOOR_PLAY', 'WALK', 'CUSTOM'];

export function computeDayStats(
  activities: ActivityType[],
  dayDate: Date,
  options: DayStatsOptions
): DayStats {
  const { preferredUnit, cutoff, unitSymbol } = options;

  const startOfDay = new Date(dayDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(dayDate);
  endOfDay.setHours(23, 59, 59, 999);
  const endBound = cutoff && cutoff < endOfDay ? cutoff : endOfDay;

  const stats: DayStats = {
    totalSleepMinutes: 0,
    awakeMinutes: 0,
    totalFeedCount: 0,
    bottleFeedTotal: 0,
    breastMilkBottleTotal: 0,
    formulaBottleTotal: 0,
    otherBottleTotal: 0,
    leftBreastFeedMinutes: 0,
    rightBreastFeedMinutes: 0,
    solidsAmounts: {},
    wetCount: 0,
    dirtyCount: 0,
    poopCount: 0,
    medicineStats: {},
    supplementStats: {},
    noteCount: 0,
    bathCount: 0,
    pumpCount: 0,
    pumpTotal: 0,
    milestoneCount: 0,
    measurementCount: 0,
    playCount: 0,
    totalPlayMinutes: 0,
    vaccineCount: 0,
    hasAnyActivity: false,
  };

  activities.forEach(activity => {
    // Play activities - check before sleep since both have duration, startTime, type
    if ('activities' in activity && 'type' in activity && PLAY_TYPES.includes((activity as any).type)) {
      const time = new Date((activity as any).startTime);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.playCount++;
        if ((activity as any).duration) {
          stats.totalPlayMinutes += (activity as any).duration;
        }
      }
      return; // Skip further checks for this activity
    }

    // Sleep activities (exclude pump activities which also have duration and startTime)
    if ('duration' in activity && 'startTime' in activity &&
        'type' in activity && // Sleep activities have type (NAP or NIGHT_SLEEP)
        !('leftAmount' in activity || 'rightAmount' in activity)) { // Exclude pump activities
      const startTime = new Date(activity.startTime);
      const endTime = 'endTime' in activity && activity.endTime ? new Date(activity.endTime) : null;

      if (endTime) {
        const overlapStart = Math.max(startTime.getTime(), startOfDay.getTime());
        const overlapEnd = Math.min(endTime.getTime(), endBound.getTime());

        if (overlapEnd > overlapStart) {
          stats.hasAnyActivity = true;
          stats.totalSleepMinutes += Math.floor((overlapEnd - overlapStart) / (1000 * 60));
        }
      } else if (startTime >= startOfDay && startTime <= endBound) {
        // Ongoing sleep (no endTime): credit up to the end bound
        stats.hasAnyActivity = true;
        const activeMinutes = Math.floor((endBound.getTime() - startTime.getTime()) / (1000 * 60));
        if (activeMinutes > 0) {
          stats.totalSleepMinutes += activeMinutes;
        }
      }
    }

    // Feed activities - track all types together
    if ('amount' in activity && 'type' in activity) {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        if (activity.type === 'BOTTLE') {
          stats.hasAnyActivity = true;
          stats.totalFeedCount++;
          const entryUnit = activity.unitAbbr || 'OZ';
          const amount = activity.amount || 0;
          const converted = convertVolume(amount, entryUnit, preferredUnit);
          stats.bottleFeedTotal += converted;
          // Split the measured amount into breast milk vs formula by bottle type
          const bottleType = (activity as any).bottleType;
          if (bottleType === 'Breast Milk') {
            stats.breastMilkBottleTotal += converted;
          } else if (bottleType === 'Formula') {
            stats.formulaBottleTotal += converted;
          } else if (bottleType === 'Formula\\Breast') {
            const bmConverted = convertVolume((activity as any).breastMilkAmount || 0, entryUnit, preferredUnit);
            stats.breastMilkBottleTotal += bmConverted;
            stats.formulaBottleTotal += Math.max(0, converted - bmConverted);
          } else {
            // Milk, Other, or uncategorized
            stats.otherBottleTotal += converted;
          }
        } else if (activity.type === 'SOLIDS') {
          stats.hasAnyActivity = true;
          stats.totalFeedCount++;
          // Track solids amounts by unit
          const unit = activity.unitAbbr || 'g';
          if (!stats.solidsAmounts[unit]) {
            stats.solidsAmounts[unit] = 0;
          }
          stats.solidsAmounts[unit] += activity.amount || 0;
        }
      }
    }

    // Breast feed activities - track duration separately for left and right
    if ('type' in activity && activity.type === 'BREAST') {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.totalFeedCount++;
        // Track duration: prefer feedDuration (in seconds), fall back to amount (in minutes)
        let feedMinutes = 0;
        if ('feedDuration' in activity && activity.feedDuration) {
          // Convert seconds to minutes
          feedMinutes = Math.floor(activity.feedDuration / 60);
        } else if ('amount' in activity && activity.amount) {
          // Amount is already in minutes for older records
          feedMinutes = activity.amount;
        }

        // Track by side if available
        if ('side' in activity && activity.side) {
          if (activity.side === 'LEFT') {
            stats.leftBreastFeedMinutes += feedMinutes;
          } else if (activity.side === 'RIGHT') {
            stats.rightBreastFeedMinutes += feedMinutes;
          }
        }
        // Note: If no side specified, we don't track it separately to avoid inaccuracy
        // The feed is still counted in totalFeedCount
      }
    }

    // Diaper activities
    if ('condition' in activity && 'type' in activity) {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        // Count wet and dirty diapers exclusively
        if (activity.type === 'WET') {
          stats.wetCount++;
        } else if (activity.type === 'DIRTY') {
          stats.dirtyCount++;
          stats.poopCount++;
        } else if (activity.type === 'BOTH') {
          // BOTH counts as both wet and dirty
          stats.wetCount++;
          stats.dirtyCount++;
          stats.poopCount++;
        }
      }
    }

    // Medicine and supplement activities
    if ('doseAmount' in activity && 'medicineId' in activity) {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        // Determine if supplement
        const isSupplement = 'medicine' in activity && activity.medicine && typeof activity.medicine === 'object' && 'isSupplement' in activity.medicine && (activity.medicine as any).isSupplement;
        const targetStats = isSupplement ? stats.supplementStats : stats.medicineStats;

        // Get medicine/supplement name (display fallback resolved by the component)
        let medicineName = 'unknown';
        if ('medicine' in activity && activity.medicine && typeof activity.medicine === 'object' && 'name' in activity.medicine) {
          medicineName = (activity.medicine as { name?: string }).name || medicineName;
        }

        // Initialize record if it doesn't exist
        if (!targetStats[medicineName]) {
          targetStats[medicineName] = {
            count: 0,
            total: 0,
            unit: unitSymbol(activity.unitAbbr)
          };
        }

        // Increment count and add to total
        targetStats[medicineName].count += 1;
        if (activity.doseAmount && typeof activity.doseAmount === 'number') {
          targetStats[medicineName].total += activity.doseAmount;
        }
      }
    }

    // Note activities
    if ('content' in activity) {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.noteCount++;
      }
    }

    // Bath activities
    if ('soapUsed' in activity) {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.bathCount++;
      }
    }

    // Pump activities
    if ('leftAmount' in activity || 'rightAmount' in activity) {
      let time: Date | null = null;
      if ('startTime' in activity && activity.startTime) {
        time = new Date(activity.startTime);
      } else if ('time' in activity && activity.time) {
        time = new Date(activity.time);
      }
      if (time && time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.pumpCount++;
        const total = (activity as any).totalAmount || 0;
        if (total > 0) {
          const entryUnit = (activity as any).unitAbbr || 'OZ';
          stats.pumpTotal += convertVolume(total, entryUnit, preferredUnit);
        }
      }
    }

    // Vaccine activities
    if ('vaccineName' in activity) {
      const time = new Date((activity as any).time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.vaccineCount++;
      }
      return;
    }

    // Milestone activities
    if ('title' in activity && 'category' in activity) {
      const activityDate = new Date(activity.date);
      if (activityDate >= startOfDay && activityDate <= endBound) {
        stats.hasAnyActivity = true;
        stats.milestoneCount++;
      }
    }

    // Measurement activities
    if ('value' in activity && 'unit' in activity) {
      const activityDate = new Date(activity.date);
      if (activityDate >= startOfDay && activityDate <= endBound) {
        stats.hasAnyActivity = true;
        stats.measurementCount++;
      }
    }
  });

  // Awake time: elapsed time (to the end bound) minus sleep
  const elapsedMinutes = Math.floor((endBound.getTime() - startOfDay.getTime()) / (1000 * 60));
  stats.awakeMinutes = Math.max(0, elapsedMinutes - stats.totalSleepMinutes);

  return stats;
}
```

Port-fidelity notes for the implementer:
- The original's separate "active sleep" pass (`activities.find(...)` + `isToday ? now : endOfDay`) is folded into the sleep branch's `else if` — behavior is identical because the viewed-day caller passes `cutoff = now` when the day is today (Task 4).
- The original's `medicineName = t('unknown')` becomes the literal `'unknown'` — the component wraps display, and the tile label uses the name only for actually-named medicines; if you want exact parity, map `'unknown'` → `t('unknown')` when building tiles in Task 4 (shown there).
- `hasAnyActivity` is new (used by Task 6 for empty-day exclusion).

- [ ] **Step 4: Run the verification script**

Run: `npx tsx scripts/verify-compute-day-stats.ts`
Expected: `All checks passed`, exit code 0. (If `tsx` can't resolve the `@/src/...` alias, run `npx tsx --tsconfig tsconfig.json scripts/verify-compute-day-stats.ts`.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Timeline/TimelineV2/computeDayStats.ts scripts/verify-compute-day-stats.ts
git commit -m "stats: Extract pure computeDayStats with cutoff support"
```

---

### Task 4: Behavior-neutral refactor — TimelineV2DailyStats consumes computeDayStats

**Files:**
- Modify: `src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx:100-368`

Goal: delete the inline per-day computation and replace it with a `computeDayStats` call. **Zero visible change** — tiles render exactly as before. The tile-assembly code (original lines 370–685) survives unchanged except for reading values from the stats struct.

- [ ] **Step 1: Add the import**

```typescript
import { computeDayStats } from './computeDayStats';
```

- [ ] **Step 2: Replace the computation section**

Inside the `statTiles` `useMemo` (starts line 100), delete everything from `const startOfDay = new Date(date);` (line 101) through the `awakeMinutes = Math.max(...)` line (line 368) and replace with:

```typescript
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const preferredUnit = defaultBottleUnit || 'OZ';

    const dayStats = computeDayStats(activities, date, {
      preferredUnit,
      unitSymbol,
      cutoff: isToday ? now : undefined,
    });

    const {
      totalSleepMinutes, awakeMinutes, totalFeedCount,
      bottleFeedTotal, breastMilkBottleTotal, formulaBottleTotal, otherBottleTotal,
      leftBreastFeedMinutes, rightBreastFeedMinutes, solidsAmounts,
      wetCount, poopCount, noteCount, bathCount, pumpCount, pumpTotal,
      milestoneCount, measurementCount, playCount, totalPlayMinutes, vaccineCount,
    } = dayStats;
```

The medicine/supplement tile blocks read `Object.entries(medicineStats)` / `Object.entries(supplementStats)` — change those two references to `Object.entries(dayStats.medicineStats)` and `Object.entries(dayStats.supplementStats)`, and where a medicine name renders in a label, map the sentinel: `` `${name === 'unknown' ? t('unknown') : name}: ...` `` (two label template spots, single- and multi-entry).

Everything below (the `const tiles: StatTile[] = [];` block onward) stays as-is.

- [ ] **Step 3: Update the memo dependency array**

Line 686: `[activities, date, t]` → `[activities, date, t, defaultBottleUnit, unitSymbol]`.

- [ ] **Step 4: Typecheck + visual sanity**

Run: `npx tsc --noEmit 2>&1 | tail -5` — no new errors.
Run: `npm run dev`, open the app's daily view for today and for a past day — tiles must look identical to before (same values, same tiles, awake time included). Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx
git commit -m "stats: Refactor daily stats tiles onto computeDayStats"
```

---

### Task 5: Data plumbing — asymmetric fetch window + new props

**Files:**
- Modify: `src/components/Timeline/TimelineV2/useActivityCache.ts:44-61,120-132`
- Modify: `src/components/Timeline/TimelineV2/index.tsx`
- Modify: `src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx` (props only)

- [ ] **Step 1: Asymmetric `buildDateRange` + `fetchWindow`**

In `useActivityCache.ts`, replace `buildDateRange` (lines 44–61):

```typescript
function buildDateRange(centerDate: Date, before: number, after: number): { startDate: Date; endDate: Date; dateKeys: string[] } {
  const startDate = new Date(centerDate);
  startDate.setDate(startDate.getDate() - before);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(centerDate);
  endDate.setDate(endDate.getDate() + after);
  endDate.setHours(23, 59, 59, 999);

  const dateKeys: string[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    dateKeys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return { startDate, endDate, dateKeys };
}
```

Change `fetchWindow`'s signature (lines 120–124) and its one `buildDateRange` call (line 132):

```typescript
  const fetchWindow = useCallback(async (
    babyId: string,
    centerDate: Date,
    window: { before: number; after: number } = { before: 1, after: 1 }
  ): Promise<FetchResult> => {
```

```typescript
    const { startDate, endDate, dateKeys } = buildDateRange(centerDate, window.before, window.after);
```

- [ ] **Step 2: Wire `avgDays` + `windowActivities` in `index.tsx`**

Add state next to the existing activity state (line ~32):

```typescript
  const [windowActivities, setWindowActivities] = useState<ActivityType[]>([]);
```

Add the clamped setting read next to `breastMilkTrackingEnabled` (line ~43):

```typescript
  const avgDays = Math.min(14, Math.max(2, Number((settings as any)?.dailyStatsAvgDays ?? 5)));
```

In `fetchActivitiesForDate` (line ~144), replace the fetch call and store the window:

```typescript
      // before: avgDays + 1 so the oldest baseline day still sees overnight sleep
      // that started the previous evening
      const result = await activityCache.fetchWindow(babyId, date, { before: avgDays + 1, after: 1 });
      setDateFilteredActivities(result.activities);
      setWindowActivities(result.allActivities);
```

Add `avgDays` to `fetchActivitiesForDate`'s dependency array (line 167): `[babyId, activityCache, emitLatestStatus, avgDays]`.

Change the initial-fetch effect (line ~260) so a changed setting refetches (per-day cache makes this cheap; `invalidateAll` only fires on real changes):

```typescript
  useEffect(() => {
    if (babyId) {
      activityCache.invalidateAll();
      fetchActivitiesForDate(selectedDate, true);
    }
  }, [babyId, avgDays]);
```

Pass the new props to `TimelineV2DailyStats` (line ~413):

```tsx
      <TimelineV2DailyStats
        activities={dateFilteredActivities}
        windowActivities={windowActivities}
        avgDays={avgDays}
        heatmapActivities={heatmapActivities}
```

- [ ] **Step 3: Accept the props in `TimelineV2DailyStats.tsx`**

Add to `TimelineV2DailyStatsProps` (line ~42):

```typescript
  /** All activities for the fetched window (avgDays+1 back through +1 forward) — baseline for averages */
  windowActivities: ActivityType[];
  /** Running-average window length from family settings (clamped 2-14) */
  avgDays: number;
```

Add both to the destructured props in the component signature (line ~71). They are consumed in Task 6.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no new errors (unused-prop warnings are not errors).

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline/TimelineV2/useActivityCache.ts src/components/Timeline/TimelineV2/index.tsx src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx
git commit -m "stats: Widen activity fetch window for running-average baseline"
```

---### Task 6: Averages — baseline memo, avg line, zero-data core tiles

**Files:**
- Modify: `src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx`
- Modify: `src/localization/translations/en.json`

- [ ] **Step 1: Add the averages memo**

In `TimelineV2DailyStats.tsx`, above the `statTiles` memo:

```typescript
  interface CoreAverages {
    sleepMinutes: number;
    feedCount: number;
    bottleVolume: number;
    wetCount: number;
    poopCount: number;
  }

  // Baseline averages over the avgDays days preceding the viewed day.
  // Depends on `activities` (not just windowActivities) so the 30s polling
  // re-truncates today's expected-by-now with a fresh "now".
  const averages = useMemo(() => {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const preferredUnit = defaultBottleUnit || 'OZ';

    const fullDays: ReturnType<typeof computeDayStats>[] = [];
    const truncatedDays: ReturnType<typeof computeDayStats>[] = [];

    for (let i = 1; i <= avgDays; i++) {
      const day = new Date(date);
      day.setDate(day.getDate() - i);
      const full = computeDayStats(windowActivities, day, { preferredUnit, unitSymbol });
      if (!full.hasAnyActivity) continue; // untracked day — excluded from the baseline
      fullDays.push(full);
      if (isToday) {
        const cutoff = new Date(day);
        cutoff.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 999);
        truncatedDays.push(computeDayStats(windowActivities, day, { preferredUnit, unitSymbol, cutoff }));
      }
    }

    if (fullDays.length === 0) return null;

    const avgOf = (list: typeof fullDays): CoreAverages => {
      const mean = (pick: (s: (typeof list)[number]) => number) =>
        list.reduce((sum, s) => sum + pick(s), 0) / list.length;
      return {
        sleepMinutes: mean(s => s.totalSleepMinutes),
        feedCount: mean(s => s.totalFeedCount),
        bottleVolume: mean(s => s.bottleFeedTotal),
        wetCount: mean(s => s.wetCount),
        poopCount: mean(s => s.poopCount),
      };
    };

    return {
      full: avgOf(fullDays),
      expectedByNow: isToday && truncatedDays.length > 0 ? avgOf(truncatedDays) : null,
      asOf: now,
    };
  }, [windowActivities, activities, date, avgDays, defaultBottleUnit, unitSymbol]);
```

- [ ] **Step 2: Extend `StatTile` and formatting helpers**

Add to the `StatTile` interface (line ~58):

```typescript
  // Running-average secondary line, e.g. "avg 6h 58m"
  avg?: string;
  // Today-only pace detail rendered in an (i) popover on the avg line
  pace?: { usuallyText: string; statusLabel: string };
```

Inside the `statTiles` memo, after the `dayStats` destructuring from Task 4, add:

```typescript
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const roundAmount = (n: number) => Math.round(n * 100) / 100;

    const buildPace = (
      actual: number,
      expected: number | undefined,
      fmt: (n: number) => string
    ): StatTile['pace'] => {
      if (!averages?.expectedByNow || expected === undefined) return undefined;
      let status: 'ahead' | 'behind' | 'on-pace';
      if (expected <= 0) {
        status = actual > 0 ? 'ahead' : 'on-pace';
      } else if (actual >= expected * 1.1) {
        status = 'ahead';
      } else if (actual <= expected * 0.9) {
        status = 'behind';
      } else {
        status = 'on-pace';
      }
      return {
        usuallyText: `${t('Usually')} ${fmt(expected)} ${t('by')} ${formatTimeDisplay(averages.asOf, timeFormat)}`,
        statusLabel: status === 'ahead' ? t('Ahead of pace') : status === 'behind' ? t('Behind pace') : t('On pace'),
      };
    };
```

(The feed block already declares its own `roundAmount` at line ~405 — delete that inner declaration and use this hoisted one.)

This needs two new imports/values: `formatTimeDisplay` from `@/src/utils/dateFormat` (extend the existing import on line 36), and `timeFormat` from the timezone hook — change line 88 to `const { dateFormat, timeFormat } = useTimezone();`.

- [ ] **Step 3: Wire the four core tiles (render-at-zero + avg + pace)**

**Sleep tile** — replace the `if (totalSleepMinutes > 0) { tiles.push({...}) }` block:

```typescript
    // Sleep tile
    const sleepAvg = averages ? averages.full.sleepMinutes : null;
    if (totalSleepMinutes > 0 || (sleepAvg ?? 0) > 0) {
      tiles.push({
        filter: 'sleep',
        label: t('Total Sleep'),
        value: formatMinutes(totalSleepMinutes),
        icon: <Moon className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#9ca3af]', // gray-400 - matches timeline
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100',
        avg: sleepAvg !== null ? `${t('avg')} ${formatMinutes(Math.round(sleepAvg))}` : undefined,
        pace: buildPace(totalSleepMinutes, averages?.expectedByNow?.sleepMinutes, (n) => formatMinutes(Math.round(n))),
      });
    }
```

**Feed tile** — change the guard `if (totalFeedCount > 0) {` to:

```typescript
    const feedAvg = averages ? averages.full.feedCount : null;
    if (totalFeedCount > 0 || (feedAvg ?? 0) > 0) {
```

(the zero-feed day naturally renders `t('Feeds')` with no amounts via the existing `labelParts` fallback, and `feedBreakdown` stays undefined), and replace the existing final `breakdown: feedBreakdown` property of its `tiles.push({...})` object with these three properties (do not duplicate `breakdown`):

```typescript
        breakdown: feedBreakdown,
        avg: feedAvg !== null
          ? `${t('avg')} ${round1(feedAvg)}${averages!.full.bottleVolume > 0 ? ` · ${roundAmount(averages!.full.bottleVolume)} ${preferredUnit.toLowerCase()}` : ''}`
          : undefined,
        pace: buildPace(totalFeedCount, averages?.expectedByNow?.feedCount, (n) => String(round1(n))),
```

**Wet diaper tile** — replace the guard and object:

```typescript
    // Wet diaper tile
    const wetAvg = averages ? averages.full.wetCount : null;
    if (wetCount > 0 || (wetAvg ?? 0) > 0) {
      tiles.push({
        filter: 'diaper',
        label: t('Wet Diapers'),
        value: wetCount.toString(),
        icon: <Icon iconNode={diaper} className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#0d9488]', // teal-600 (green) - matches timeline for wet
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100',
        avg: wetAvg !== null ? `${t('avg')} ${round1(wetAvg)}` : undefined,
        pace: buildPace(wetCount, averages?.expectedByNow?.wetCount, (n) => String(round1(n))),
      });
    }
```

**Poop tile** — same pattern:

```typescript
    // Poop tile
    const poopAvg = averages ? averages.full.poopCount : null;
    if (poopCount > 0 || (poopAvg ?? 0) > 0) {
      tiles.push({
        filter: 'poop',
        label: t('Poops'),
        value: poopCount.toString(),
        icon: <Icon iconNode={diaper} className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-amber-700', // amber-700 for poops
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100',
        avg: poopAvg !== null ? `${t('avg')} ${round1(poopAvg)}` : undefined,
        pace: buildPace(poopCount, averages?.expectedByNow?.poopCount, (n) => String(round1(n))),
      });
    }
```

Update the `statTiles` memo deps: `[activities, date, t, defaultBottleUnit, unitSymbol, averages, timeFormat]`.

- [ ] **Step 4: Render the avg line (popover rendering comes in Task 7)**

In the tile JSX, directly after the label/breakdown `<div className="flex items-center gap-1 text-xs ...">...</div>` closes (line ~874), add:

```tsx
                        {tile.avg && (
                          <div className="flex items-center gap-1 text-[10px] text-gray-400 font-medium leading-tight">
                            <span>{tile.avg}</span>
                          </div>
                        )}
```

- [ ] **Step 5: Add en.json key**

```json
  "avg": "avg",
```

- [ ] **Step 6: Typecheck + visual check**

Run: `npx tsc --noEmit 2>&1 | tail -5` — no new errors.
Run: `npm run dev` — past days show `avg …` lines on the core four tiles; a core metric with 0 today but a nonzero baseline shows a `0`-value tile with its avg; other tiles unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx src/localization/translations/en.json
git commit -m "stats: Show running averages on core Daily Summary tiles"
```

---

### Task 7: Today's pace popover

**Files:**
- Modify: `src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx` (JSX from Task 6 Step 4)
- Modify: `src/localization/translations/en.json`

- [ ] **Step 1: Render the (i) popover on the avg line**

Replace the Task 6 avg-line JSX with:

```tsx
                        {tile.avg && (
                          <div className="flex items-center gap-1 text-[10px] text-gray-400 font-medium leading-tight">
                            <span>{tile.avg}</span>
                            {tile.pace && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex-shrink-0 text-gray-400 hover:opacity-70 transition-opacity"
                                    aria-label={t('Pace details')}
                                  >
                                    <Info className="h-3 w-3" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-auto p-2">
                                  <div className="flex flex-col gap-1 text-xs">
                                    <span className="text-gray-500">{tile.pace.usuallyText}</span>
                                    <span className="font-semibold text-gray-800">{tile.pace.statusLabel}</span>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        )}
```

(`Popover`, `PopoverTrigger`, `PopoverContent`, and `Info` are already imported for the feed-breakdown popover. `pace` is only ever set when viewing today — `buildPace` returns `undefined` otherwise — so no extra isToday guard is needed here.)

- [ ] **Step 2: Add en.json keys**

```json
  "Usually": "Usually",
  "by": "by",
  "Ahead of pace": "Ahead of pace",
  "Behind pace": "Behind pace",
  "On pace": "On pace",
  "Pace details": "Pace details",
```

- [ ] **Step 3: Typecheck + visual check**

Run: `npx tsc --noEmit 2>&1 | tail -5` — no new errors.
Run: `npm run dev` — on today, each core tile's avg line shows an (i); tapping it opens "Usually {value} by {time}" + a pace status, and does NOT toggle the tile's filter. Past days show no (i).

- [ ] **Step 4: Commit**

```bash
git add src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx src/localization/translations/en.json
git commit -m "stats: Add expected-by-now pace popover for today"
```

---

### Task 8: Translations sweep, build, manual QA

**Files:**
- Modify: `src/localization/translations/*.json` (via script)

- [ ] **Step 1: Sync translation files**

Run: `node scripts/check-missing-translations.js`
Expected: reports the new keys added to `es/fr/de/it` (empty values) and sorts all files.

- [ ] **Step 2: Verify computeDayStats script still passes**

Run: `npx tsx scripts/verify-compute-day-stats.ts`
Expected: `All checks passed`.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual QA (spec §10)**

With `npm run dev`:
1. **Past day:** averages match hand-computed means over the N preceding tracked days (spot-check one metric against the timeline).
2. **Today:** (i) popover values look right; status flips around the ±10% thresholds.
3. **Zero-data core tile:** appears with `0` + avg when the baseline is nonzero; absent when baseline is 0 too.
4. **Settings:** change the window (e.g. 5 → 3) in Settings → Config; daily view refetches and averages change. Enter `99` → clamps to 14; enter `0` → clamps to 2.
5. **Dark mode:** toggle in-app theme; avg line and popover are legible (existing `html.dark .timeline-v2-daily-stats` overrides cover `text-gray-*`; if the `text-[10px]` avg line needs contrast, add `html.dark .timeline-v2-daily-stats .text-gray-400 { color: rgb(156, 163, 175) !important; }` to `TimelineV2DailyStats.css`).
6. **Regression:** tile filters still toggle, feed-breakdown (i) still works, awake-time tile unchanged, heatmap unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/localization/translations
git commit -m "stats: Sync translation files for running averages"
```
