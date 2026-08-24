# Frozen Breast Milk Bag Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make frozen breast milk bag storage a first-class tracked activity — a milk tile that logs "+N bags at X oz each" or "-N bags", a per-day line in the daily stats, and two Reports cards showing freezer stock with a days-of-supply projection.

**Architecture:** A new `BreastMilkBagLog` Prisma model is a signed ledger (`bagCount` positive = frozen, negative = removed) with `amountPerBag` stored separately so bag counts stay recoverable. All arithmetic lives in pure functions in `src/utils/breastMilkBags.ts` and is unit-tested without a database. The feature registers itself into the existing activity-tile, timeline, daily-stats, and reports pipelines by following the pattern the Potty feature already established, and is gated behind the existing `Settings.enableBreastMilkTracking` flag.

**Tech Stack:** Next.js App Router, TypeScript (strict), Prisma (SQLite locally, Postgres in production), TailwindCSS + CVA, Vitest (node environment), lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-24-frozen-breast-milk-bag-inventory-design.md`

---

## Orientation for the engineer

Read this before Task 1. It is the context you cannot infer from the file tree.

**Where the feature already half-exists.** An ounce-based breast milk inventory ships upstream, wired to the Pump feature: `PumpLog.pumpAction = 'STORED'` adds ounces, `BreastMilkAdjustment` is a manual +/- ounce ledger, bottle feeds subtract, and `GET /api/breast-milk-balance` sums them. **You are not modifying any of that.** The bag ledger is deliberately separate. If you find yourself editing `src/utils/breastMilkInventory.ts` or `app/api/breast-milk-balance/route.ts`, stop — you have gone off-plan.

(One exception, already applied in Task 1 and closed: `breastMilkInventory.ts` now exports a shared `sumBreastMilkConsumed` helper that both ledgers call. Import from it freely; do not otherwise edit it.)

**The family-authorization golden rule.** Never trust a client-sent family id. `authContext.familyId` from the auth middleware is the only source of truth. On read/update/delete by id: fetch first, verify `resource.familyId === userFamilyId`, return 404 on mismatch. On create: verify the parent baby belongs to the family, then set `familyId: userFamilyId` explicitly. On list: always `where: { familyId: userFamilyId }`.

**Dark mode.** This project does **not** use Tailwind `dark:` classes. Light mode is Tailwind utilities via CVA in a `.styles.ts` file; dark mode is `html.dark .class-name` overrides in a plain `.css` file. Tailwind's `dark:` responds to system preference, which bypasses the in-app theme toggle. Using `dark:` is a bug.

**Localization.** No user-facing string may be hardcoded. Use `const { t } = useLocalization()` from `@/src/context/localization` and `t('English text')`. Keys *are* the English text. Add keys to `en.json` only; Task 16 propagates them.

**How the timeline identifies activity types.** There is no discriminant field. Every branch tests for the *presence* of a field: `if ('pottyLocation' in activity)`, `if ('leftAmount' in activity)`. Our discriminator is `'bagCount' in activity`, which is unique across every model in the schema. It does not collide with the breast-milk-adjustment check (`'reason' in activity && 'amount' in activity`) because our model has `amountPerBag`, not `amount`. Place the bag branch **before** the adjustment and pump branches anyway, so a future field rename cannot silently reroute our rows.

**Where the `enableBreastMilkTracking` gate applies — a deliberate narrowing of the spec.**

The spec says the setting hides "tile, timeline rows, daily line, and both cards". Planning found that gating the *tile* on it is wrong, so this plan gates only the aggregate surfaces:

| Surface | Gated? | Why |
| --- | --- | --- |
| Reports cards | Yes | Inventory totals are meaningless with the feature off. |
| Daily stats lines (v1 + v2) | Yes | Same. |
| Log-entry tile | **No** | Tile visibility already has its own per-family control (`activity-settings` order/visible, Task 8). A second hidden gate would let a user tick "show Frozen Milk" in settings and still see nothing — a bug, not a feature. `ActivityTileGroup` also has no settings access today, so gating it means adding a fetch to buy that bug. |
| Timeline rows | **No** | Rows for entries that exist must stay visible and editable. Hiding them would make already-logged data unreachable rather than merely inactive. |

If you want the tile gated anyway, that is a follow-up: pass `enableBreastMilkTracking` down from the log-entry page as a prop and skip the `case 'milkbag'` when false.

**Naming, fixed for the whole plan.** Deviating breaks later tasks.

| Thing | Name |
| --- | --- |
| Prisma model | `BreastMilkBagLog` |
| Tile / variant / filter key | `'milkbag'` |
| API routes | `/api/breast-milk-bag-log`, `/api/breast-milk-bag-balance` |
| Pure-function module | `src/utils/breastMilkBags.ts` |
| Form component dir | `src/components/forms/BreastMilkBagForm/` |
| Reports section | `src/components/Reports/BreastMilkStashSection.tsx` |

**Commands.** `npm test` runs Vitest once. `npm run test:watch` watches. `npx vitest run tests/foo.test.ts` runs one file. `npm run prisma:migrate` wraps `prisma migrate dev`. `npm run prisma:generate` regenerates the client.

**`npm run lint` is known-broken in this repo.** Do not treat its output as a gate.

---

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `src/utils/breastMilkBags.ts` | All bag arithmetic. Pure, no React, no Prisma. |
| `tests/breastMilkBags.test.ts` | Unit tests for the above. |
| `prisma/migrations/<timestamp>_add_breast_milk_bag_log/migration.sql` | Generated by Prisma. |
| `app/api/breast-milk-bag-log/route.ts` | CRUD for bag entries. |
| `app/api/breast-milk-bag-balance/route.ts` | Aggregate freezer state. |
| `src/components/forms/BreastMilkBagForm/index.tsx` | The log form. |
| `src/components/forms/BreastMilkBagForm/breast-milk-bag-form.css` | `html.dark` overrides. |
| `src/components/forms/BreastMilkBagForm/breast-milk-bag-form.types.ts` | Props type. |
| `src/components/forms/BreastMilkBagForm/README.md` | Component docs. |
| `src/components/Reports/BreastMilkStashSection.tsx` | The two Reports cards. |

**Modify:** `prisma/schema.prisma`, `app/api/types.ts`, `app/api/timeline/route.ts`, `app/api/timeline/export/route.ts`, `app/api/utils/db-backup.ts`, `app/api/utils/csv-export.ts`, `app/api/accounts/download-data/route.ts`, `src/utils/activityTileOrder.ts`, `tests/activityTileOrder.test.ts`, `src/components/ui/activity-tile/activity-tile.types.ts`, `activity-tile.styles.ts`, `activity-tile-utils.ts`, `activity-tile-icon.tsx`, `src/components/ActivityTileGroup/index.tsx`, `app/(app)/[slug]/log-entry/page.tsx`, `src/components/Timeline/types.ts`, `utils.tsx`, `TimelineFilter.tsx`, `TimelineActivityDetails.tsx`, `index.tsx`, `src/components/Timeline/TimelineV2/index.tsx`, `computeDayStats.ts`, `TimelineV2DailyStats.tsx`, `src/components/DailyStats/index.tsx`, `daily-stats.types.ts`, `src/components/Reports/StatsTab.tsx`, `src/localization/translations/*.json`.

---

## Task 1: Pure bag arithmetic

Start here. Everything downstream imports from this module, and it needs no database, no server, and no React.

> **Post-implementation note (commit `60e69fe1`).** Task 1 shipped with one change beyond the code below, made in response to code review. `averageBreastMilkPerDay`'s reduce body was byte-for-byte identical to `calculateBreastMilkBalance`'s `consumedTotal` reduce in `src/utils/breastMilkInventory.ts`, so that logic was extracted into an exported `sumBreastMilkConsumed(feedLogs, targetUnit)` helper in `breastMilkInventory.ts` and both now call it. `averageBreastMilkPerDay` reduced to a guard plus one delegating line, and `isAutoCreatedPumpFeed` is no longer imported by `breastMilkBags.ts`.
>
> This is the *only* sanctioned edit to `breastMilkInventory.ts` in this whole plan. The "do not edit that file" rule in the orientation section still stands for everything else — it exists to keep the two ledgers independent, and moving one shared pure predicate does not violate that. `averageBreastMilkPerDay`'s exported signature is unchanged, so no later task is affected.

**Files:**
- Create: `src/utils/breastMilkBags.ts`
- Test: `tests/breastMilkBags.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/breastMilkBags.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  calculateBagBalance,
  sumBagsForDay,
  lastAmountPerBag,
  averageBreastMilkPerDay,
  projectDaysOfSupply,
} from '@/src/utils/breastMilkBags';

describe('calculateBagBalance', () => {
  it('returns zero for an empty ledger', () => {
    expect(calculateBagBalance([], 'OZ')).toEqual({ bags: 0, amount: 0 });
  });

  it('sums signed bag counts and derives volume', () => {
    const result = calculateBagBalance(
      [
        { bagCount: 5, amountPerBag: 4, unitAbbr: 'OZ' },
        { bagCount: -2, amountPerBag: 4, unitAbbr: 'OZ' },
      ],
      'OZ'
    );
    expect(result).toEqual({ bags: 3, amount: 12 });
  });

  it('normalizes mixed units to the target unit', () => {
    // 1 bag of 100 ML is ~3.38 oz, plus 1 bag of 4 oz = ~7.38 oz over 2 bags.
    const result = calculateBagBalance(
      [
        { bagCount: 1, amountPerBag: 100, unitAbbr: 'ML' },
        { bagCount: 1, amountPerBag: 4, unitAbbr: 'OZ' },
      ],
      'OZ'
    );
    expect(result.bags).toBe(2);
    expect(result.amount).toBeCloseTo(7.38, 1);
  });

  it('treats a missing unit as OZ', () => {
    expect(calculateBagBalance([{ bagCount: 2, amountPerBag: 3, unitAbbr: null }], 'OZ'))
      .toEqual({ bags: 2, amount: 6 });
  });

  it('reports a net-negative balance rather than clamping to zero', () => {
    const result = calculateBagBalance(
      [
        { bagCount: 1, amountPerBag: 4, unitAbbr: 'OZ' },
        { bagCount: -3, amountPerBag: 4, unitAbbr: 'OZ' },
      ],
      'OZ'
    );
    expect(result).toEqual({ bags: -2, amount: -8 });
  });

  it('ignores soft-deleted rows', () => {
    const result = calculateBagBalance(
      [
        { bagCount: 5, amountPerBag: 4, unitAbbr: 'OZ' },
        { bagCount: 5, amountPerBag: 4, unitAbbr: 'OZ', deletedAt: '2026-08-01T00:00:00.000Z' },
      ],
      'OZ'
    );
    expect(result.bags).toBe(5);
  });
});

describe('sumBagsForDay', () => {
  it('returns zeroes for an empty list', () => {
    expect(sumBagsForDay([], 'OZ')).toEqual({
      frozenBags: 0,
      frozenAmount: 0,
      removedBags: 0,
      removedAmount: 0,
    });
  });

  it('separates frozen from removed and reports removals as positive magnitudes', () => {
    const result = sumBagsForDay(
      [
        { bagCount: 3, amountPerBag: 4, unitAbbr: 'OZ' },
        { bagCount: -2, amountPerBag: 4, unitAbbr: 'OZ' },
      ],
      'OZ'
    );
    expect(result).toEqual({
      frozenBags: 3,
      frozenAmount: 12,
      removedBags: 2,
      removedAmount: 8,
    });
  });
});

describe('lastAmountPerBag', () => {
  it('returns null for an empty ledger', () => {
    expect(lastAmountPerBag([])).toBeNull();
  });

  it('returns the most recent freeze amount by time, not array order', () => {
    const result = lastAmountPerBag([
      { bagCount: 1, amountPerBag: 4, unitAbbr: 'OZ', time: '2026-08-01T00:00:00.000Z' },
      { bagCount: 1, amountPerBag: 6, unitAbbr: 'OZ', time: '2026-08-05T00:00:00.000Z' },
      { bagCount: 1, amountPerBag: 5, unitAbbr: 'OZ', time: '2026-08-03T00:00:00.000Z' },
    ]);
    expect(result).toBe(6);
  });

  it('ignores removal rows', () => {
    const result = lastAmountPerBag([
      { bagCount: 2, amountPerBag: 4, unitAbbr: 'OZ', time: '2026-08-01T00:00:00.000Z' },
      { bagCount: -2, amountPerBag: 9, unitAbbr: 'OZ', time: '2026-08-09T00:00:00.000Z' },
    ]);
    expect(result).toBe(4);
  });

  it('ignores soft-deleted rows', () => {
    const result = lastAmountPerBag([
      { bagCount: 1, amountPerBag: 4, unitAbbr: 'OZ', time: '2026-08-01T00:00:00.000Z' },
      {
        bagCount: 1,
        amountPerBag: 9,
        unitAbbr: 'OZ',
        time: '2026-08-09T00:00:00.000Z',
        deletedAt: '2026-08-10T00:00:00.000Z',
      },
    ]);
    expect(result).toBe(4);
  });
});

describe('averageBreastMilkPerDay', () => {
  it('returns zero when there are no feeds', () => {
    expect(averageBreastMilkPerDay([], 7, 'OZ')).toBe(0);
  });

  it('returns zero rather than dividing by zero days', () => {
    expect(
      averageBreastMilkPerDay([{ amount: 4, unitAbbr: 'OZ', bottleType: 'Breast Milk', breastMilkAmount: null }], 0, 'OZ')
    ).toBe(0);
  });

  it('averages breast milk bottles over the day count', () => {
    const result = averageBreastMilkPerDay(
      [
        { amount: 4, unitAbbr: 'OZ', bottleType: 'Breast Milk', breastMilkAmount: null },
        { amount: 6, unitAbbr: 'OZ', bottleType: 'Breast Milk', breastMilkAmount: null },
      ],
      2,
      'OZ'
    );
    expect(result).toBe(5);
  });

  it('counts only the breast milk half of a combination bottle', () => {
    const result = averageBreastMilkPerDay(
      [{ amount: 8, unitAbbr: 'OZ', bottleType: 'Formula/Breast', breastMilkAmount: 3 }],
      1,
      'OZ'
    );
    expect(result).toBe(3);
  });

  it('ignores formula-only bottles', () => {
    const result = averageBreastMilkPerDay(
      [{ amount: 8, unitAbbr: 'OZ', bottleType: 'Formula', breastMilkAmount: null }],
      1,
      'OZ'
    );
    expect(result).toBe(0);
  });

  it('ignores feeds auto-created from a pump session', () => {
    const result = averageBreastMilkPerDay(
      [
        { amount: 4, unitAbbr: 'OZ', bottleType: 'Breast Milk', breastMilkAmount: null, sourcePumpId: 'pump-1' },
        { amount: 4, unitAbbr: 'OZ', bottleType: 'Breast Milk', breastMilkAmount: null },
      ],
      1,
      'OZ'
    );
    expect(result).toBe(4);
  });
});

describe('projectDaysOfSupply', () => {
  it('divides freezer volume by daily consumption', () => {
    expect(projectDaysOfSupply(168, 15)).toBe(11.2);
  });

  it('returns null at zero consumption instead of Infinity', () => {
    expect(projectDaysOfSupply(168, 0)).toBeNull();
  });

  it('returns null for negative consumption', () => {
    expect(projectDaysOfSupply(168, -3)).toBeNull();
  });

  it('returns null when the freezer is empty or negative, since negative days are meaningless', () => {
    expect(projectDaysOfSupply(0, 15)).toBeNull();
    expect(projectDaysOfSupply(-8, 15)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/breastMilkBags.test.ts`

Expected: FAIL — `Failed to resolve import "@/src/utils/breastMilkBags"`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/breastMilkBags.ts`:

```typescript
import { convertVolume } from './unit-conversion';
import { isAutoCreatedPumpFeed, BreastMilkFeedInventoryRow } from './breastMilkInventory';

/**
 * A single freezer ledger entry. `bagCount` carries the sign: positive is bags
 * put into the freezer, negative is bags taken out. `amountPerBag` is always
 * positive and describes one bag, so a bag count is never lost to rounding the
 * way a stored total would lose it.
 */
export interface BreastMilkBagRow {
  bagCount: number;
  amountPerBag: number;
  unitAbbr?: string | null;
  time?: string | Date;
  deletedAt?: string | Date | null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const isLive = (row: BreastMilkBagRow): boolean => !row.deletedAt;

/** Volume of one row in `targetUnit`, signed the same way as `bagCount`. */
function rowVolume(row: BreastMilkBagRow, targetUnit: string): number {
  return convertVolume(row.bagCount * row.amountPerBag, row.unitAbbr || 'OZ', targetUnit);
}

/**
 * Net freezer contents. A negative result is returned as-is rather than clamped:
 * clamping would hide unlogged stock, and the correction is an "Initial Stock"
 * entry, not a silently floored number.
 */
export function calculateBagBalance(
  rows: BreastMilkBagRow[],
  targetUnit: string
): { bags: number; amount: number } {
  const live = rows.filter(isLive);
  const bags = live.reduce((total, row) => total + row.bagCount, 0);
  const amount = live.reduce((total, row) => total + rowVolume(row, targetUnit), 0);
  return { bags, amount: round2(amount) };
}

/**
 * Frozen and removed totals for an already date-filtered set of rows.
 * Removals are reported as positive magnitudes so the UI reads
 * "Used 2 bags (8 oz)" without re-negating.
 */
export function sumBagsForDay(
  rows: BreastMilkBagRow[],
  targetUnit: string
): { frozenBags: number; frozenAmount: number; removedBags: number; removedAmount: number } {
  const live = rows.filter(isLive);
  const frozen = live.filter((row) => row.bagCount > 0);
  const removed = live.filter((row) => row.bagCount < 0);

  // Negate per-term rather than negating the whole reduce: `-reduce(...)` over an
  // empty array produces -0, and Vitest's toEqual distinguishes -0 from 0.
  return {
    frozenBags: frozen.reduce((total, row) => total + row.bagCount, 0),
    frozenAmount: round2(frozen.reduce((total, row) => total + rowVolume(row, targetUnit), 0)),
    removedBags: removed.reduce((total, row) => total - row.bagCount, 0),
    removedAmount: round2(removed.reduce((total, row) => total - rowVolume(row, targetUnit), 0)),
  };
}

/**
 * The per-bag amount to prefill the form with: the most recent freeze.
 * Derived from history rather than stored in settings, so editing or deleting
 * a log corrects the default automatically. Removals are ignored — taking out
 * an odd-sized bag should not change what you normally freeze.
 */
export function lastAmountPerBag(rows: BreastMilkBagRow[]): number | null {
  const candidates = rows.filter((row) => isLive(row) && row.bagCount > 0);
  if (candidates.length === 0) return null;

  const newest = candidates.reduce((latest, row) => {
    const rowTime = row.time ? new Date(row.time).getTime() : 0;
    const latestTime = latest.time ? new Date(latest.time).getTime() : 0;
    return rowTime > latestTime ? row : latest;
  });

  return newest.amountPerBag;
}

/**
 * Average volume of breast milk consumed per day over the range, from bottle
 * feeds. Feeds auto-created from a pump session are excluded: that milk never
 * entered the freezer, so it is demand the freezer does not have to meet.
 */
export function averageBreastMilkPerDay(
  feedRows: BreastMilkFeedInventoryRow[],
  daysInRange: number,
  targetUnit: string
): number {
  if (daysInRange <= 0) return 0;

  const total = feedRows.reduce((sum, log) => {
    if (isAutoCreatedPumpFeed(log)) return sum;

    if (log.bottleType === 'Breast Milk' && log.amount != null) {
      return sum + convertVolume(log.amount, log.unitAbbr || 'OZ', targetUnit);
    }

    if (log.bottleType === 'Formula/Breast' && log.breastMilkAmount != null) {
      return sum + convertVolume(log.breastMilkAmount, log.unitAbbr || 'OZ', targetUnit);
    }

    return sum;
  }, 0);

  return round2(total / daysInRange);
}

/**
 * Days the freezer will last at the current consumption rate.
 *
 * Returns null — rendered as an em dash — rather than a number whenever the
 * answer would be meaningless: no consumption (Infinity), or an empty/negative
 * freezer (zero or negative days). Note this differs deliberately from
 * `calculateBagBalance`, which *does* surface a negative balance: a negative
 * bag count is real information about unlogged stock, whereas "-3 days of
 * supply" is not information at all.
 */
export function projectDaysOfSupply(
  amountInFreezer: number,
  avgPerDay: number
): number | null {
  if (avgPerDay <= 0) return null;
  if (amountInFreezer <= 0) return null;
  return Math.round((amountInFreezer / avgPerDay) * 10) / 10;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/breastMilkBags.test.ts`

Expected: PASS, 22 tests.

- [ ] **Step 5: Run the whole suite to confirm nothing regressed**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/breastMilkBags.ts tests/breastMilkBags.test.ts
git commit -m "milkbags: Add pure freezer inventory arithmetic"
```

---

## Task 2: Prisma model and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_breast_milk_bag_log/migration.sql` (generated)

- [ ] **Step 1: Back up the local database**

The local SQLite database holds real data. Back it up before running any migration, following the existing naming convention in `db/`.

```bash
cp db/baby-tracker.db "db/baby-tracker.db.pre-milkbags-$(date +%Y%m%d-%H%M%S).bak"
ls -1 db/*.bak | tail -3
```

Expected: the new `.bak` file is listed.

- [ ] **Step 2: Add the model to the schema**

In `prisma/schema.prisma`, insert this immediately after the closing brace of `model BreastMilkAdjustment` (which ends around line 763, just before `model PlayLog`):

```prisma
model BreastMilkBagLog {
  id           String    @id @default(uuid())
  time         DateTime
  bagCount     Int // Signed: positive = bags frozen, negative = bags removed
  amountPerBag Float // Volume of ONE bag, in unitAbbr; always positive
  unitAbbr     String? // "OZ" | "ML"
  reason       String? // Removals: "Fed" | "Discarded" | "Donated" | "Other". Additions: "Initial Stock" | null
  notes        String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?

  // Add family relation
  family   Family? @relation(fields: [familyId], references: [id])
  familyId String? // Nullable initially for migration

  // Relationships
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

`familyId` is nullable on purpose. Production Postgres deploys run `prisma db push`, which cannot add a required column to a populated table. Every other log model in this schema does the same.

- [ ] **Step 3: Add the back-relations**

Prisma requires the other side of each relation. Add these three lines, one to each model:

In `model Family`, alongside the other log back-relations (search for `breastMilkAdjustments` to find the block):

```prisma
  breastMilkBagLogs BreastMilkBagLog[]
```

In `model Baby`, alongside its log back-relations:

```prisma
  breastMilkBagLogs BreastMilkBagLog[]
```

In `model Caretaker`, alongside its log back-relations:

```prisma
  breastMilkBagLogs BreastMilkBagLog[]
```

If you cannot find the existing back-relation lines, run `grep -n "BreastMilkAdjustment\[\]" prisma/schema.prisma` — the three results are exactly the three places to edit.

- [ ] **Step 4: Generate the migration WITHOUT a shadow database**

**Do not run `prisma migrate dev` in this repo. It cannot succeed.**

`migrate dev` validates history by replaying every migration from empty into a throwaway "shadow" database. This fork's history cannot survive that replay: `20260729174752_add_potty_log` adds `Settings.pottyLocationSettings`, and `20260801000000_restore_fork_settings_columns` adds it again. On a real deployment that is correct — upstream's `Settings` table rebuild drops the column in between, which is the entire reason the restore migration exists — but on a from-empty replay nothing drops it, so the second `ADD COLUMN` fails:

```
Error: P3006 ... duplicate column name: pottyLocationSettings
```

This is the pre-existing, documented "Known issue: fresh installs fail" in `documentation/upstream-sync.md`. It has nothing to do with this feature, and fixing it is explicitly out of scope here.

Generate the SQL by diffing the live database against the schema instead. This is Prisma's supported manual-migration path and touches no shadow database:

```bash
MIGRATION_DIR="prisma/migrations/$(date +%Y%m%d%H%M%S)_add_breast_milk_bag_log"
mkdir -p "$MIGRATION_DIR"
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$MIGRATION_DIR/migration.sql"
cat "$MIGRATION_DIR/migration.sql"
```

Expected: exactly one `CREATE TABLE "BreastMilkBagLog"` and five `CREATE INDEX` statements.

- [ ] **Step 5: Verify the SQL is additive only, THEN apply it**

Read the generated file before running it. It must contain **no** `DROP` of any kind, and **no** `ALTER TABLE` against a pre-existing table. If it does, stop and report BLOCKED — that means the diff picked up unrelated drift and applying it could destroy data.

```bash
grep -iE "drop|alter table" "$MIGRATION_DIR/migration.sql" || echo "CLEAN: additive only"
```

Expected: `CLEAN: additive only`.

Only once that prints clean, apply it and record it in migration history:

```bash
npx prisma db execute --file "$MIGRATION_DIR/migration.sql" --schema prisma/schema.prisma
npx prisma migrate resolve --applied "$(basename "$MIGRATION_DIR")"
```

Expected: the execute prints `Script executed successfully.` and the resolve prints `Migration marked as applied.`

`migrate resolve` writes the row into `_prisma_migrations` that `migrate dev` would have written, so production `migrate deploy` — which does **not** use a shadow database — will treat this migration exactly like any other.

- [ ] **Step 6: Regenerate the Prisma client**

```bash
npm run prisma:generate
```

Expected: `Generated Prisma Client`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "milkbags: Add BreastMilkBagLog model and migration"
```

---

## Task 3: API types

**Files:**
- Modify: `app/api/types.ts`

- [ ] **Step 1: Import the Prisma type**

In `app/api/types.ts` line 1, add `BreastMilkBagLog` to the `@prisma/client` import list, immediately after `BreastMilkAdjustment`:

```typescript
import { Baby, SleepLog, FeedLog, DiaperLog, PottyLog, MoodLog, Note, Caretaker, Settings as PrismaSettings, Gender, SleepType, SleepQuality, FeedType, BreastSide, DiaperType, Mood, PumpLog, PlayLog, Milestone, MilestoneCategory, Measurement, MeasurementType, Medicine, MedicineLog, EmailConfig as PrismaEmailConfig, EmailProviderType, BreastMilkAdjustment, BreastMilkBagLog, ActiveBreastFeed, ActiveActivity, VaccineLog, VaccineDocument, Food, FoodLog, FoodEnjoyment, BabyAllergen, AllergenType } from '@prisma/client';
```

- [ ] **Step 2: Add the response and create types**

In the same file, immediately after the `BreastMilkBalanceResponse` interface (which ends around line 367, just before `// Milestone types`), add:

```typescript
// Breast milk bag (freezer inventory) types
export type BreastMilkBagLogResponse = Omit<BreastMilkBagLog, 'time' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  time: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export interface BreastMilkBagLogCreate {
  babyId: string;
  time: string;
  bagCount: number; // Positive = frozen, negative = removed. Never zero.
  amountPerBag: number; // Always positive
  unitAbbr?: string;
  reason?: string | null;
  notes?: string | null;
}

// Aggregate freezer state, for the Reports card and the form's remembered default
export interface BreastMilkBagBalanceResponse {
  bags: number;
  amount: number;
  unit: string;
  lastAmountPerBag: number | null;
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors mentioning `types.ts` or `BreastMilkBagLog`. (Pre-existing errors elsewhere in the repo may appear; ignore any that do not name files you touched.)

- [ ] **Step 4: Commit**

```bash
git add app/api/types.ts
git commit -m "milkbags: Add API types for freezer bag logs"
```

---

## Task 4: Bag log CRUD route

**Files:**
- Create: `app/api/breast-milk-bag-log/route.ts`

This mirrors `app/api/potty-log/route.ts`. Read that file first if anything below looks unfamiliar.

- [ ] **Step 1: Write the route**

Create `app/api/breast-milk-bag-log/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../db';
import { ApiResponse, BreastMilkBagLogCreate, BreastMilkBagLogResponse } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';
import { toUTC, formatForResponse } from '../utils/timezone';
import { checkWritePermission } from '../utils/writeProtection';

const format = (log: any): BreastMilkBagLogResponse => ({
  ...log,
  time: formatForResponse(log.time) || '',
  createdAt: formatForResponse(log.createdAt) || '',
  updatedAt: formatForResponse(log.updatedAt) || '',
  deletedAt: formatForResponse(log.deletedAt),
});

/**
 * A zero bag count records nothing, and a non-positive per-bag amount would make
 * the derived volume meaningless. Reject both rather than storing a row that no
 * downstream reader can interpret.
 */
function validate(body: Partial<BreastMilkBagLogCreate>): string | null {
  if (body.bagCount !== undefined) {
    if (!Number.isInteger(body.bagCount) || body.bagCount === 0) {
      return 'Bag count must be a non-zero whole number';
    }
  }
  if (body.amountPerBag !== undefined) {
    if (typeof body.amountPerBag !== 'number' || !(body.amountPerBag > 0)) {
      return 'Amount per bag must be greater than zero';
    }
  }
  return null;
}

async function handlePost(req: NextRequest, authContext: AuthResult) {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId, caretakerId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const body: BreastMilkBagLogCreate = await req.json();

    const validationError = validate(body);
    if (validationError) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: validationError }, { status: 400 });
    }

    const baby = await prisma.baby.findFirst({
      where: { id: body.babyId, familyId: userFamilyId },
    });

    if (!baby) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby not found in this family.' }, { status: 404 });
    }

    const bagLog = await prisma.breastMilkBagLog.create({
      data: {
        ...body,
        time: toUTC(body.time),
        caretakerId: caretakerId,
        familyId: userFamilyId,
      },
    });

    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>({ success: true, data: format(bagLog) });
  } catch (error) {
    console.error('Error creating breast milk bag log:', error);
    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>(
      { success: false, error: 'Failed to create breast milk bag log' },
      { status: 500 }
    );
  }
}

async function handlePut(req: NextRequest, authContext: AuthResult) {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const body: Partial<BreastMilkBagLogCreate> = await req.json();

    if (!id) {
      return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>(
        { success: false, error: 'Breast milk bag log ID is required' },
        { status: 400 }
      );
    }

    const validationError = validate(body);
    if (validationError) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: validationError }, { status: 400 });
    }

    const existing = await prisma.breastMilkBagLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existing) {
      return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>(
        { success: false, error: 'Breast milk bag log not found or access denied' },
        { status: 404 }
      );
    }

    const data: any = { ...body };
    if (body.time) {
      data.time = toUTC(body.time);
    }
    delete data.babyId;
    delete data.familyId;
    delete data.caretakerId;

    const bagLog = await prisma.breastMilkBagLog.update({ where: { id }, data });

    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>({ success: true, data: format(bagLog) });
  } catch (error) {
    console.error('Error updating breast milk bag log:', error);
    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>(
      { success: false, error: 'Failed to update breast milk bag log' },
      { status: 500 }
    );
  }
}

async function handleGet(req: NextRequest, authContext: AuthResult) {
  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const babyId = searchParams.get('babyId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (id) {
      const bagLog = await prisma.breastMilkBagLog.findFirst({
        where: { id, familyId: userFamilyId },
      });

      if (!bagLog) {
        return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>(
          { success: false, error: 'Breast milk bag log not found or access denied' },
          { status: 404 }
        );
      }

      return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>({ success: true, data: format(bagLog) });
    }

    const bagLogs = await prisma.breastMilkBagLog.findMany({
      where: {
        familyId: userFamilyId,
        ...(babyId && { babyId }),
        ...(startDate && endDate && {
          time: { gte: toUTC(startDate), lte: toUTC(endDate) },
        }),
      },
      orderBy: { time: 'desc' },
    });

    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse[]>>({
      success: true,
      data: bagLogs.map(format),
    });
  } catch (error) {
    console.error('Error fetching breast milk bag logs:', error);
    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse[]>>(
      { success: false, error: 'Failed to fetch breast milk bag logs' },
      { status: 500 }
    );
  }
}

async function handleDelete(req: NextRequest, authContext: AuthResult) {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json<ApiResponse<void>>(
        { success: false, error: 'Breast milk bag log ID is required' },
        { status: 400 }
      );
    }

    const existing = await prisma.breastMilkBagLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existing) {
      return NextResponse.json<ApiResponse<void>>(
        { success: false, error: 'Breast milk bag log not found or access denied' },
        { status: 404 }
      );
    }

    await prisma.breastMilkBagLog.delete({ where: { id } });

    return NextResponse.json<ApiResponse<void>>({ success: true });
  } catch (error) {
    console.error('Error deleting breast milk bag log:', error);
    return NextResponse.json<ApiResponse<void>>(
      { success: false, error: 'Failed to delete breast milk bag log' },
      { status: 500 }
    );
  }
}

// Apply authentication middleware to all handlers
// Use type assertions to handle the multiple return types
export const GET = withAuthContext(handleGet as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const POST = withAuthContext(handlePost as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const PUT = withAuthContext(handlePut as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const DELETE = withAuthContext(handleDelete as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors naming `breast-milk-bag-log/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/api/breast-milk-bag-log/route.ts
git commit -m "milkbags: Add breast milk bag log CRUD route"
```

---

## Task 5: Bag balance route

**Files:**
- Create: `app/api/breast-milk-bag-balance/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/breast-milk-bag-balance/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../db';
import { ApiResponse, BreastMilkBagBalanceResponse } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';
import { calculateBagBalance, lastAmountPerBag } from '@/src/utils/breastMilkBags';

async function handleGet(req: NextRequest, authContext: AuthResult) {
  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const babyId = searchParams.get('babyId');
    const targetUnit = (searchParams.get('unit') || 'OZ').toUpperCase();

    if (!babyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby ID is required' }, { status: 400 });
    }

    const baby = await prisma.baby.findFirst({
      where: { id: babyId, familyId: userFamilyId },
    });

    if (!baby) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby not found in this family.' }, { status: 404 });
    }

    // The whole ledger, not a date window: the freezer is current state.
    const rows = await prisma.breastMilkBagLog.findMany({
      where: { babyId, familyId: userFamilyId, deletedAt: null },
      select: { bagCount: true, amountPerBag: true, unitAbbr: true, time: true, deletedAt: true },
    });

    const { bags, amount } = calculateBagBalance(rows, targetUnit);

    return NextResponse.json<ApiResponse<BreastMilkBagBalanceResponse>>({
      success: true,
      data: { bags, amount, unit: targetUnit, lastAmountPerBag: lastAmountPerBag(rows) },
    });
  } catch (error) {
    console.error('Error calculating breast milk bag balance:', error);
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Failed to calculate bag balance' }, { status: 500 });
  }
}

export const GET = withAuthContext(handleGet as any);
```

Note `lastAmountPerBag` is returned in the *stored* unit of the most recent freeze, not converted to `targetUnit`. That is intentional: the form prefills the number you last typed, and converting it would turn a clean `4` into `118.29`.

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors naming `breast-milk-bag-balance/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/api/breast-milk-bag-balance/route.ts
git commit -m "milkbags: Add freezer bag balance route"
```

---

## Task 6: Data portability

Without this task the freezer silently vanishes from backups and exports.

**Files:**
- Modify: `app/api/utils/db-backup.ts`
- Modify: `app/api/utils/csv-export.ts`
- Modify: `app/api/accounts/download-data/route.ts`

- [ ] **Step 1: Register the model in the backup table list**

In `app/api/utils/db-backup.ts`, in the ordered model-name array, add `'BreastMilkBagLog'` immediately after `'BreastMilkAdjustment'` (around line 49):

```typescript
  'PumpLog',
  'BreastMilkAdjustment',
  'BreastMilkBagLog',
  'PlayLog',
```

- [ ] **Step 2: Register its date fields**

In the same file, in the date-field map (around line 125), add an entry after the `PumpLog` line:

```typescript
  BreastMilkBagLog: ['time', 'createdAt', 'updatedAt', 'deletedAt'],
```

- [ ] **Step 3: Add the CSV export key**

In `app/api/utils/csv-export.ts`, add `breastMilkBagLogs?: any[];` to the `exportData` parameter type immediately after `pumpLogs?: any[];` (around line 110):

```typescript
  pumpLogs?: any[];
  breastMilkBagLogs?: any[];
  playLogs?: any[];
```

Then add its filename to the `dataTypes` array immediately after the `pumpLogs` entry (around line 145):

```typescript
    { key: 'pumpLogs', filename: 'pump-logs.csv' },
    { key: 'breastMilkBagLogs', filename: 'breast-milk-bag-logs.csv' },
    { key: 'playLogs', filename: 'play-logs.csv' },
```

- [ ] **Step 4: Add it to the account data download**

`app/api/accounts/download-data/route.ts` uses a destructured `Promise.all`. Three coordinated edits:

Add `breastMilkBagLogs,` to the destructuring list (around line 51), immediately after `pottyLogs,`:

```typescript
      pottyLogs,
      breastMilkBagLogs,
```

Add the matching query to the `Promise.all` array in **the same position** — the destructuring is positional, so an out-of-order insert silently swaps two datasets:

```typescript
      prisma.breastMilkBagLog.findMany({ where: { familyId }, include: { baby: { select: { firstName: true, lastName: true } }, caretaker: { select: { name: true } } } }),
```

Add the count to the summary object (around line 103), after `pottyLogs: pottyLogs.length,`:

```typescript
        breastMilkBagLogs: breastMilkBagLogs.length,
```

Add the shaped output after the `pottyLogs` mapping block (around line 150):

```typescript
      breastMilkBagLogs: breastMilkBagLogs.map(b => ({
        ...b,
        babyName: b.baby ? `${b.baby.firstName} ${b.baby.lastName}` : '',
        caretakerName: b.caretaker?.name || '',
        baby: undefined,
        caretaker: undefined
      })),
```

- [ ] **Step 5: Verify the destructuring order matches**

Run: `grep -n "pottyLogs\|breastMilkBagLogs" app/api/accounts/download-data/route.ts`

Expected: `breastMilkBagLogs` appears at the same relative offset from `pottyLogs` in both the destructuring block and the `Promise.all` block — that is, the Nth name in the destructure lines up with the Nth query.

- [ ] **Step 6: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors naming `db-backup.ts`, `csv-export.ts`, or `download-data/route.ts`.

- [ ] **Step 7: Commit**

```bash
git add app/api/utils/db-backup.ts app/api/utils/csv-export.ts app/api/accounts/download-data/route.ts
git commit -m "milkbags: Include freezer bag logs in backups and exports"
```

---

## Task 7: Timeline API

The timeline endpoint is what feeds every UI surface. Until this task lands, nothing downstream can see a bag log.

**Files:**
- Modify: `app/api/timeline/route.ts`
- Modify: `app/api/timeline/export/route.ts`

- [ ] **Step 1: Import the response type**

In `app/api/timeline/route.ts` line 3, add `BreastMilkBagLogResponse` to the import from `'../types'`, after `BreastMilkAdjustmentResponse`.

- [ ] **Step 2: Add it to the activity union**

In the same file around line 80, add `| BreastMilkBagLogResponse` to the `ActivityTypeWithCaretaker` union.

- [ ] **Step 3: Add the fetch**

In the `Promise.all` destructuring (around line 227), add `breastMilkBagLogs` to the destructured names, immediately after `pottyLogs`, and add the matching query in the same position in the array. The destructuring is positional — the Nth name must line up with the Nth query.

Destructuring:

```typescript
    const [sleepLogs, feedLogs, diaperLogs, pottyLogs, breastMilkBagLogs, noteLogs, bathLogs, pumpLogs, playLogs, milestoneLogs, measurementLogs, medicineLogs, breastMilkAdjustments, vaccineLogs, foodLogs, photoLogs] = await Promise.all([
```

Query, inserted immediately after the `shouldFetch('potty') ? prisma.pottyLog.findMany({...}) : emptyPromise,` block (which ends around line 307):

```typescript
      shouldFetch('milkbag') ? prisma.breastMilkBagLog.findMany({
        where: {
          babyId,
          ...(startDateUTC && endDateUTC ? {
            time: {
              gte: startDateUTC,
              lte: endDateUTC
            }
          } : {}),
          familyId, // Filter by the verified family ID
        },
        include: {
          caretaker: true
        },
        orderBy: { time: 'desc' }
      }) : emptyPromise,
```

- [ ] **Step 4: Add the formatter**

Immediately after the `formattedPottyLogs` block (which ends around line 597), add:

```typescript
    const formattedBreastMilkBagLogs: ActivityTypeWithCaretaker[] = breastMilkBagLogs
      .map(log => {
        const { caretaker, ...logWithoutCaretaker } = log;

        return {
          ...logWithoutCaretaker,
          time: formatForResponse(log.time) || '',
          createdAt: formatForResponse(log.createdAt) || '',
          updatedAt: formatForResponse(log.updatedAt) || '',
          deletedAt: formatForResponse(log.deletedAt),
          caretakerId: log.caretakerId,
          caretakerName: log.caretaker ? log.caretaker.name : undefined,
        };
      });
```

- [ ] **Step 5: Add it to the merged output**

Around line 843, add `...formattedBreastMilkBagLogs,` immediately after `...formattedPottyLogs,`.

- [ ] **Step 6: Do the same in the export route**

`app/api/timeline/export/route.ts` follows the same shape:

- Around line 42, add a discriminator branch before the potty one:

```typescript
  // Bag logs carry `bagCount`, which no other model has.
  if ('bagCount' in activity) return 'milkbag';
```

- Around line 62, add to the label map: `'milkbag': 'Frozen Milk',`
- Around line 96, add a `case 'milkbag':` to the type-label switch that returns
  `activity.bagCount > 0 ? t('Froze', translations) : t('Used', translations)`.
- Around line 220, add a `case 'milkbag':` to the detail-parts switch:

```typescript
    case 'milkbag':
      parts.push(`${t('Bags', translations)}: ${Math.abs(activity.bagCount)}`);
      parts.push(`${t('Per Bag', translations)}: ${activity.amountPerBag}`);
      if (activity.reason) parts.push(`${t('Reason', translations)}: ${t(activity.reason, translations)}`);
      break;
```

- Around line 393, add `breastMilkBagLogs` to the `Promise.all` destructuring and the matching `prisma.breastMilkBagLog.findMany` query in the same position, mirroring Step 3.
- Around line 534, add `...breastMilkBagLogs.map(formatLog),` immediately after `...pottyLogs.map(formatLog),`.

- [ ] **Step 7: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors naming `timeline/route.ts` or `timeline/export/route.ts`.

- [ ] **Step 8: Verify the endpoint returns bag rows**

Start the dev server (`npm run dev`), log in, and create one bag entry with curl using a token from `localStorage.authToken` in devtools:

```bash
curl -s -X POST "http://localhost:3000/api/breast-milk-bag-log" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"babyId":"<a real baby id>","time":"2026-08-24T10:00:00.000Z","bagCount":3,"amountPerBag":4,"unitAbbr":"OZ"}'
```

Expected: `{"success":true,"data":{...,"bagCount":3,...}}`.

- [ ] **Step 9: Commit**

```bash
git add app/api/timeline/route.ts app/api/timeline/export/route.ts
git commit -m "milkbags: Surface freezer bag logs in the timeline API"
```

---

## Task 8: Activity tile order

**Files:**
- Modify: `src/utils/activityTileOrder.ts`
- Test: `tests/activityTileOrder.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/activityTileOrder.test.ts`, add `placeMilkBagTile` to the import list at the top, then append these three blocks to the file:

```typescript
describe('DEFAULT_ACTIVITY_TILE_ORDER milkbag placement', () => {
  it('places milkbag immediately after food and before diaper', () => {
    const foodIndex = DEFAULT_ACTIVITY_TILE_ORDER.indexOf('food' as any);
    const milkbagIndex = DEFAULT_ACTIVITY_TILE_ORDER.indexOf('milkbag' as any);
    const diaperIndex = DEFAULT_ACTIVITY_TILE_ORDER.indexOf('diaper' as any);

    expect(milkbagIndex).toBe(foodIndex + 1);
    expect(milkbagIndex).toBeLessThan(diaperIndex);
  });
});

describe('placeMilkBagTile', () => {
  it('inserts milkbag immediately after food', () => {
    const result = placeMilkBagTile({
      order: ['sleep', 'feed', 'food', 'diaper'],
      visible: ['sleep', 'feed', 'food', 'diaper'],
    });
    expect(result.order).toEqual(['sleep', 'feed', 'food', 'milkbag', 'diaper']);
    expect(result.visible).toContain('milkbag');
  });

  it('appends to the end when food is hidden, rather than burying it mid-list', () => {
    const result = placeMilkBagTile({
      order: ['sleep', 'feed', 'food', 'diaper'],
      visible: ['sleep', 'feed', 'diaper'],
    });
    expect(result.order[result.order.length - 1]).toBe('milkbag');
  });

  it('leaves a custom position alone when milkbag is already present', () => {
    const result = placeMilkBagTile({
      order: ['milkbag', 'sleep', 'feed', 'food'],
      visible: ['milkbag', 'sleep', 'feed', 'food'],
    });
    expect(result.order).toEqual(['milkbag', 'sleep', 'feed', 'food']);
    expect(result.changed).toBe(false);
  });
});

describe('mergeMissingActivityTiles with milkbag', () => {
  it('adds milkbag after food for a family that predates the feature', () => {
    const result = mergeMissingActivityTiles({
      order: ['sleep', 'feed', 'food', 'diaper', 'potty', 'note'],
      visible: ['sleep', 'feed', 'food', 'diaper', 'potty', 'note'],
    });
    expect(result.order.slice(0, 5)).toEqual(['sleep', 'feed', 'food', 'milkbag', 'diaper']);
    expect(result.visible).toContain('milkbag');
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/activityTileOrder.test.ts`

Expected: FAIL — `placeMilkBagTile is not a function` / `milkbagIndex` is `-1`.

- [ ] **Step 3: Implement**

In `src/utils/activityTileOrder.ts`:

Add `'milkbag'` to `DEFAULT_ACTIVITY_TILE_ORDER`, immediately after `'food'`:

```typescript
export const DEFAULT_ACTIVITY_TILE_ORDER = [
  'sleep',
  'feed',
  'food',
  'milkbag',
  'diaper',
  'potty',
  'note',
  'photo',
  'bath',
  'pump',
  'play',
  'measurement',
  'milestone',
  'medicine',
  'vaccine',
] as const;
```

Add the placement helper immediately after `placePottyTile`:

```typescript
/**
 * Place the frozen-milk-bag tile immediately after food when merging saved settings.
 *
 * Anchored to food, not pump: `placeTileAfter` falls back to the end of the list
 * when its anchor is hidden, and families using this feature are exactly the ones
 * most likely to have hidden the pump tile.
 */
export function placeMilkBagTile(entry: { order?: string[]; visible?: string[] }): TilePlacement {
  return placeTileAfter(entry, 'milkbag', 'food');
}
```

In `mergeMissingActivityTiles`, add a block after the existing `potty` block and before the `stillMissing` computation:

```typescript
  if (missing.includes('milkbag')) {
    const placed = placeMilkBagTile({ order, visible });
    order = placed.order;
    visible = placed.visible;
  }
```

Note the ordering inside `mergeMissingActivityTiles` matters: `food` must be placed before `milkbag`, since `milkbag` anchors to it. `food` is already handled first in the existing code, so inserting the new block after `potty` is correct.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/activityTileOrder.test.ts`

Expected: PASS. The pre-existing `mergeMissingActivityTiles` test asserting `result.order.slice(0, 6)` will now fail, because the default order changed. Update that assertion to:

```typescript
    expect(result.order.slice(0, 6)).toEqual(['sleep', 'feed', 'food', 'milkbag', 'diaper', 'potty']);
```

Re-run and confirm PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/activityTileOrder.ts tests/activityTileOrder.test.ts
git commit -m "milkbags: Add milkbag to the default activity tile order"
```

---

## Task 9: Activity tile variant and icon

**Files:**
- Modify: `src/components/ui/activity-tile/activity-tile.types.ts`
- Modify: `src/components/ui/activity-tile/activity-tile.styles.ts`
- Modify: `src/components/ui/activity-tile/activity-tile-utils.ts`
- Modify: `src/components/ui/activity-tile/activity-tile-icon.tsx`

- [ ] **Step 1: Add the variant to the type**

In `activity-tile.types.ts` line 6:

```typescript
export type ActivityTileVariant = 'sleep' | 'feed' | 'diaper' | 'potty' | 'milkbag' | 'note' | 'bath' | 'pump' | 'play' | 'measurement' | 'milestone' | 'medicine' | 'vaccine' | 'food' | 'default';
```

- [ ] **Step 2: Add the variant to every style map**

In `activity-tile.styles.ts` the object is `as const`, so a missing key is a type error at every lookup site. Add `milkbag` to all four maps:

- `button.variants`: `milkbag: "",` after `potty: "",`
- `iconContainer.variants`: `milkbag: "",` after `potty: "",`
- `icon.variants`: `milkbag: "text-cyan-600",` after `potty: "text-fuchsia-600",`
- `icon.defaultIcons`: **do not add a key.** There is no `milk-128.png` in `public/`, and pointing at a missing file renders a broken image. Step 4 handles the icon explicitly instead.

Cyan is chosen because it is unused by any existing variant and reads as "cold/frozen"; the neighbouring identity colors are teal (diaper), fuchsia (potty), sky (feed) and purple (pump).

- [ ] **Step 3: Add the discriminator**

In `activity-tile-utils.ts`, widen the `getActivityVariant` return type to include `'milkbag'`, and add the check as the **first** line of the function body, before the potty check:

```typescript
export const getActivityVariant = (activity: ActivityType): 'sleep' | 'feed' | 'diaper' | 'potty' | 'milkbag' | 'note' | 'bath' | 'pump' | 'play' | 'measurement' | 'milestone' | 'medicine' | 'vaccine' | 'food' | 'default' => {
  // Frozen milk bags first: `bagCount` is unique across every model, and checking
  // it up front keeps a future field rename from rerouting these rows.
  if ('bagCount' in activity) return 'milkbag';
  // Potty must be checked first: a PottyLog has `type` but none of duration/
  // quality/amount/condition, so it would otherwise fall through to 'default'.
  if ('pottyLocation' in activity) return 'potty';
```

- [ ] **Step 4: Render the icon**

In `activity-tile-icon.tsx`, add `Milk` to the lucide import on line 2:

```typescript
import { Moon, Edit, Icon, LampWallDown, Trophy, Baby, Activity, Syringe, Toilet, Camera, Milk } from 'lucide-react';
```

Then insert this block immediately after `const variant = variantProp || getActivityVariant(activity);` and before `let icon = null;`:

```typescript
  // Frozen milk bags have no PNG art, so neither the isButton branch nor the
  // defaultIcons fallback below would produce anything. Render the lucide glyph
  // directly, sized for whichever mode we're in.
  if (variant === 'milkbag') {
    return (
      <div aria-hidden="true" className={cn(
        styles.iconContainer.base,
        styles.iconContainer.variants[variant],
        className
      )}>
        <Milk className={cn(isButton ? 'h-16 w-16' : 'h-4 w-4', styles.icon.variants[variant])} />
      </div>
    );
  }
```

- [ ] **Step 5: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors naming any `activity-tile` file. If you see `Property 'milkbag' is missing in type`, you skipped one of the four maps in Step 2.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/activity-tile/
git commit -m "milkbags: Add milkbag activity tile variant and icon"
```

---

## Task 10: The log form

**Files:**
- Create: `src/components/forms/BreastMilkBagForm/breast-milk-bag-form.types.ts`
- Create: `src/components/forms/BreastMilkBagForm/breast-milk-bag-form.css`
- Create: `src/components/forms/BreastMilkBagForm/index.tsx`
- Create: `src/components/forms/BreastMilkBagForm/README.md`

- [ ] **Step 1: Write the types file**

Create `src/components/forms/BreastMilkBagForm/breast-milk-bag-form.types.ts`:

```typescript
import { BreastMilkBagLogResponse } from '@/app/api/types';

export interface BreastMilkBagFormProps {
  isOpen: boolean;
  onClose: () => void;
  babyId: string | undefined;
  initialTime: string;
  /** Present when editing an existing entry rather than creating one. */
  activity?: BreastMilkBagLogResponse;
  onSuccess?: () => void;
}

/** Reasons offered when taking bags out. Additions use 'Initial Stock' or nothing. */
export const BAG_REMOVAL_REASONS = ['Fed', 'Discarded', 'Donated', 'Other'] as const;
```

- [ ] **Step 2: Write the dark-mode CSS**

Create `src/components/forms/BreastMilkBagForm/breast-milk-bag-form.css`:

```css
/*
 * Dark mode for the frozen milk bag form.
 *
 * These use `html.dark` rather than Tailwind's `dark:` prefix on purpose:
 * `dark:` follows the OS preference and would bypass the in-app theme toggle.
 * Light mode lives in the Tailwind classes on the component itself.
 */

html.dark .milkbag-direction-toggle {
  border-color: #4b5563;
  background-color: #1f2937;
}

html.dark .milkbag-direction-option {
  color: #9ca3af;
}

html.dark .milkbag-direction-option-active {
  background-color: #0e7490;
  color: #ffffff;
}

html.dark .milkbag-stepper-button {
  border-color: #4b5563;
  background-color: #374151;
  color: #e5e7eb;
}

html.dark .milkbag-stepper-value {
  color: #f3f4f6;
}

html.dark .milkbag-derived-total {
  border-color: #4b5563;
  background-color: #1f2937;
  color: #d1d5db;
}
```

- [ ] **Step 3: Write the component**

Create `src/components/forms/BreastMilkBagForm/index.tsx`:

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Textarea } from '@/src/components/ui/textarea';
import { DateTimePicker } from '@/src/components/ui/date-time-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/src/components/ui/select';
import { FormPage, FormPageContent, FormPageFooter } from '@/src/components/ui/form-page';
import { useTimezone } from '@/app/context/timezone';
import { useToast } from '@/src/components/ui/toast';
import { handleExpirationError } from '@/src/lib/expiration-error-handler';
import { useLocalization } from '@/src/context/localization';
import { useUnit } from '@/src/hooks/useUnit';
import { BreastMilkBagFormProps, BAG_REMOVAL_REASONS } from './breast-milk-bag-form.types';

import './breast-milk-bag-form.css';

const DEFAULT_AMOUNT_PER_BAG = 4;

export default function BreastMilkBagForm({
  isOpen,
  onClose,
  babyId,
  initialTime,
  activity,
  onSuccess,
}: BreastMilkBagFormProps) {
  const { t } = useLocalization();
  const { toUTCString } = useTimezone();
  const { showToast } = useToast();
  const { unitSymbol } = useUnit();

  const [selectedDateTime, setSelectedDateTime] = useState<Date>(() => {
    const date = new Date(initialTime);
    return isNaN(date.getTime()) ? new Date() : date;
  });
  const [isRemoval, setIsRemoval] = useState(false);
  const [bagCount, setBagCount] = useState(1);
  const [amountPerBag, setAmountPerBag] = useState(String(DEFAULT_AMOUNT_PER_BAG));
  const [unitAbbr, setUnitAbbr] = useState('OZ');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Prefill the per-bag amount from the last freeze, so the common case is one tap.
  // Only for new entries — editing must show what was actually recorded.
  useEffect(() => {
    if (!isOpen || activity || !babyId) return;
    const load = async () => {
      try {
        const authToken = localStorage.getItem('authToken');
        const response = await fetch(`/api/breast-milk-bag-balance?babyId=${babyId}`, {
          cache: 'no-store',
          headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data.success && data.data?.lastAmountPerBag != null) {
          setAmountPerBag(String(data.data.lastAmountPerBag));
        }
      } catch {
        // Non-fatal: fall back to the default amount.
      }
    };
    load();
  }, [isOpen, activity, babyId]);

  useEffect(() => {
    if (isOpen && !isInitialized) {
      if (activity) {
        const activityDate = new Date(activity.time);
        if (!isNaN(activityDate.getTime())) setSelectedDateTime(activityDate);
        setIsRemoval(activity.bagCount < 0);
        setBagCount(Math.abs(activity.bagCount));
        setAmountPerBag(String(activity.amountPerBag));
        setUnitAbbr(activity.unitAbbr || 'OZ');
        setReason(activity.reason || '');
        setNotes(activity.notes || '');
      } else {
        const date = new Date(initialTime);
        if (!isNaN(date.getTime())) setSelectedDateTime(date);
        setIsRemoval(false);
        setBagCount(1);
        setReason('');
        setNotes('');
      }
      setIsInitialized(true);
    } else if (!isOpen) {
      setIsInitialized(false);
    }
  }, [isOpen, activity, initialTime, isInitialized]);

  const parsedAmountPerBag = parseFloat(amountPerBag);
  const amountIsValid = !isNaN(parsedAmountPerBag) && parsedAmountPerBag > 0;
  const derivedTotal = amountIsValid
    ? Math.round(bagCount * parsedAmountPerBag * 100) / 100
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!babyId || bagCount < 1 || !amountIsValid) return;
    if (!selectedDateTime || isNaN(selectedDateTime.getTime())) return;

    setLoading(true);
    try {
      const payload = {
        babyId,
        time: toUTCString(selectedDateTime),
        bagCount: isRemoval ? -bagCount : bagCount,
        amountPerBag: parsedAmountPerBag,
        unitAbbr,
        reason: reason || null,
        notes: notes || null,
      };

      const authToken = localStorage.getItem('authToken');
      const response = await fetch(`/api/breast-milk-bag-log${activity ? `?id=${activity.id}` : ''}`, {
        method: activity ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken ? `Bearer ${authToken}` : '',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (response.status === 403) {
          const { isExpirationError } = await handleExpirationError(
            response,
            showToast,
            'tracking frozen milk'
          );
          if (isExpirationError) return;
        }
        throw new Error(t('Failed to save frozen milk log'));
      }

      onClose();
      onSuccess?.();
    } catch (error) {
      console.error('Error saving breast milk bag log:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormPage
      isOpen={isOpen}
      onClose={onClose}
      title={activity ? t('Edit Frozen Milk') : t('Log Frozen Milk')}
      description={activity ? t('Update this freezer entry') : t('Add or remove bags from the freezer')}
    >
      <FormPageContent>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="form-label">{t('Time')}</label>
              <DateTimePicker
                value={selectedDateTime}
                onChange={setSelectedDateTime}
                disabled={loading}
                placeholder={t('Select time...')}
              />
            </div>

            <div>
              <label className="form-label">{t('Direction')}</label>
              <div className="milkbag-direction-toggle flex rounded-md border border-gray-300 overflow-hidden">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => { setIsRemoval(false); setReason(''); }}
                  className={cn(
                    'milkbag-direction-option flex-1 py-2 text-sm font-medium transition-colors',
                    !isRemoval
                      ? 'milkbag-direction-option-active bg-cyan-600 text-white'
                      : 'text-gray-600'
                  )}
                >
                  {t('Froze')}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => { setIsRemoval(true); setReason(''); }}
                  className={cn(
                    'milkbag-direction-option flex-1 py-2 text-sm font-medium transition-colors',
                    isRemoval
                      ? 'milkbag-direction-option-active bg-cyan-600 text-white'
                      : 'text-gray-600'
                  )}
                >
                  {t('Used')}
                </button>
              </div>
            </div>

            <div>
              <label className="form-label">{t('Bags')}</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={loading || bagCount <= 1}
                  onClick={() => setBagCount((count) => Math.max(1, count - 1))}
                  aria-label={t('Decrease bag count')}
                  className="milkbag-stepper-button flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 bg-gray-50 text-gray-700 disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="milkbag-stepper-value w-10 text-center text-xl font-semibold text-gray-900">
                  {bagCount}
                </span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setBagCount((count) => count + 1)}
                  aria-label={t('Increase bag count')}
                  className="milkbag-stepper-button flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 bg-gray-50 text-gray-700"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div>
              <label className="form-label" htmlFor="milkbag-amount-per-bag">
                {t('Amount Per Bag')}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="milkbag-amount-per-bag"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={amountPerBag}
                  onChange={(e) => setAmountPerBag(e.target.value)}
                  disabled={loading}
                  className="w-32"
                />
                <span className="text-sm text-gray-600">{unitSymbol(unitAbbr)}</span>
              </div>
            </div>

            <div
              className="milkbag-derived-total rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              aria-live="polite"
            >
              {derivedTotal === null
                ? t('Enter an amount per bag')
                : `${bagCount} ${t('bags')} × ${parsedAmountPerBag} ${unitSymbol(unitAbbr)} = ${derivedTotal} ${unitSymbol(unitAbbr)}`}
            </div>

            {isRemoval && (
              <div>
                <label className="form-label">{t('Reason')}</label>
                <Select value={reason} onValueChange={setReason} disabled={loading}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('Select reason')} />
                  </SelectTrigger>
                  <SelectContent>
                    {BAG_REMOVAL_REASONS.map((option) => (
                      <SelectItem key={option} value={option}>{t(option)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="form-label">{t('Notes')}</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={loading}
                placeholder={t('Optional notes')}
              />
            </div>
          </div>
        </form>
      </FormPageContent>
      <FormPageFooter>
        <div className="flex justify-end space-x-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !amountIsValid}>
            {activity ? t('Update') : t('Save')}
          </Button>
        </div>
      </FormPageFooter>
    </FormPage>
  );
}
```

- [ ] **Step 4: Write the README**

Create `src/components/forms/BreastMilkBagForm/README.md`:

```markdown
# BreastMilkBagForm

Logs frozen breast milk bags into and out of the freezer. One form serves both
directions: a toggle flips the sign of `bagCount` on submit.

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `isOpen` | `boolean` | Yes | Whether the form page is open |
| `onClose` | `() => void` | Yes | Called when the form is dismissed |
| `babyId` | `string \| undefined` | Yes | Baby the entry belongs to |
| `initialTime` | `string` | Yes | ISO time to prefill for new entries |
| `activity` | `BreastMilkBagLogResponse` | No | Present when editing an existing entry |
| `onSuccess` | `() => void` | No | Called after a successful save |

## Implementation notes

- **Sign lives in `bagCount`, not in a separate column.** The UI shows a positive
  count with a Froze/Used toggle; `handleSubmit` negates on removal. Editing reads
  the sign back off `activity.bagCount`.
- **The per-bag amount is remembered, not stored.** On open (for new entries only)
  the form fetches `/api/breast-milk-bag-balance` and prefills `lastAmountPerBag`,
  the most recent *freeze* amount. Nothing is persisted in settings, so editing or
  deleting a log corrects the default automatically.
- **Removal reasons only appear on removals.** Switching direction clears the
  reason, so a "Discarded" reason can't survive a flip back to Froze.
- Dark mode lives in `breast-milk-bag-form.css` using `html.dark` selectors.
  Tailwind `dark:` classes are not used anywhere in this project — they follow
  the OS preference and bypass the in-app theme toggle.
```

- [ ] **Step 5: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors naming `BreastMilkBagForm`. If `Input` is not exported from `@/src/components/ui/input`, check the actual export name with `grep -n "export" src/components/ui/input/index.tsx` and adjust the import.

- [ ] **Step 6: Commit**

```bash
git add src/components/forms/BreastMilkBagForm/
git commit -m "milkbags: Add the frozen milk bag log form"
```

---

## Task 11: Wire the tile into the log-entry screen

**Files:**
- Modify: `src/components/ActivityTileGroup/index.tsx`
- Modify: `app/(app)/[slug]/log-entry/page.tsx`

- [ ] **Step 1: Add the prop to ActivityTileGroup**

In `src/components/ActivityTileGroup/index.tsx`, add to the props interface after `onPottyClick?: () => void;` (around line 40):

```typescript
  onMilkBagClick?: () => void;
```

and to the destructured defaults after `onPottyClick = () => {},` (around line 77):

```typescript
  onMilkBagClick = () => {},
```

- [ ] **Step 2: Add the tile case**

Add `BreastMilkBagLogResponse` to the existing `@/app/api/types` import at the top of the file, then add this case to the tile switch, immediately after the `case 'potty':` block ends (around line 633):

```typescript
      case 'milkbag':
        return (
          <div key="milkbag" className="relative w-[82px] min-h-24 flex-shrink-0 snap-center">
            <ActivityTile
              activity={{
                id: 'milkbag-button',
                babyId: selectedBaby.id,
                time: new Date().toISOString(),
                bagCount: 1,
                amountPerBag: 4,
                unitAbbr: 'OZ',
                reason: null,
                notes: '',
                caretakerId: null,
                familyId: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                deletedAt: null
              } as unknown as BreastMilkBagLogResponse}
              title={t('Frozen Milk')}
              variant="milkbag"
              isButton={true}
              onClick={() => {
                updateUnlockTimer();
                onMilkBagClick();
              }}
            />
          </div>
        );
```

- [ ] **Step 3: Wire the page**

In `app/(app)/[slug]/log-entry/page.tsx`:

Add the import next to the `PottyForm` import (line 17):

```typescript
import BreastMilkBagForm from '@/src/components/forms/BreastMilkBagForm';
```

Add the state next to `showPottyForm` (line 90):

```typescript
  const [showMilkBagForm, setShowMilkBagForm] = useState(false);
```

Add the handler prop on `<ActivityTileGroup>` immediately after `onPottyClick` (line 551):

```typescript
          onMilkBagClick={() => setShowMilkBagForm(true)}
```

Add the form render immediately after the `{/* Potty Form */}` block (around line 738):

```typescript
      {/* Frozen Milk Bag Form */}
      <BreastMilkBagForm
        isOpen={showMilkBagForm}
        onClose={() => {
          setShowMilkBagForm(false);
        }}
        babyId={selectedBaby?.id || ''}
        initialTime={localTime}
        onSuccess={() => {
          if (selectedBaby?.id) {
            triggerRefresh();
          }
        }}
      />
```

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors naming `ActivityTileGroup` or `log-entry/page.tsx`.

- [ ] **Step 5: Verify in the browser**

Run `npm run dev`, log in, and open the log-entry screen.

Expected: a "Frozen Milk" tile with a milk-carton glyph appears between Food and Diaper. Tapping it opens the form. Saving 3 bags at 4 oz closes the form without an error.

- [ ] **Step 6: Commit**

```bash
git add src/components/ActivityTileGroup/index.tsx "app/(app)/[slug]/log-entry/page.tsx"
git commit -m "milkbags: Add the frozen milk tile to the log entry screen"
```

---

## Task 12: Timeline display

**Files:**
- Modify: `src/components/Timeline/types.ts`
- Modify: `src/components/Timeline/utils.tsx`
- Modify: `src/components/Timeline/TimelineFilter.tsx`
- Modify: `src/components/Timeline/TimelineActivityDetails.tsx`

- [ ] **Step 1: Add the filter and edit types**

In `src/components/Timeline/types.ts` line 21, add `'milkbag'` to `FilterType`, after `'potty'`.

In the same file, add `'milkbag'` to the `onEdit` type union (line 81), after `'potty'`.

- [ ] **Step 2: Add the icon branch**

In `src/components/Timeline/utils.tsx`, add `Milk` to the lucide import, then add this as the **first** check inside the icon function, before the breast-milk-adjustment check at line 83:

```typescript
  // Frozen milk bags: `bagCount` is unique across every model. Checked first so a
  // future rename of `reason`/`amount` can't reroute these into the adjustment branch.
  if ('bagCount' in activity) {
    return <Milk className="h-4 w-4 text-cyan-600" aria-hidden="true" />;
  }
```

- [ ] **Step 3: Add a shared label helper**

Near `pottyTypeLabel` (line 52) in the same file, add:

```typescript
/** "Froze 3 bags" / "Used 2 bags", never a bare signed number. */
const bagCountLabel = (bagCount: number, t: (key: string) => string): string => {
  const magnitude = Math.abs(bagCount);
  const verb = bagCount < 0 ? t('Used') : t('Froze');
  const noun = magnitude === 1 ? t('bag') : t('bags');
  return `${verb} ${magnitude} ${noun}`;
};
```

- [ ] **Step 4: Add the detail rows**

In the details function, add this branch immediately before the `if ('pottyLocation' in activity) {` branch at line 441:

```typescript
    if ('bagCount' in activity) {
      const bagCount = (activity as any).bagCount as number;
      const amountPerBag = (activity as any).amountPerBag as number;
      const unit = (activity as any).unitAbbr || 'OZ';
      const details = [
        { label: t('Time'), value: formatTime(activity.time, settings, true, t) },
        { label: t('Bags'), value: bagCountLabel(bagCount, t) },
        { label: t('Amount Per Bag'), value: `${amountPerBag} ${t(unit.toLowerCase())}` },
        { label: t('Total'), value: `${Math.round(Math.abs(bagCount) * amountPerBag * 100) / 100} ${t(unit.toLowerCase())}` },
      ];

      if ((activity as any).reason) {
        details.push({ label: t('Reason'), value: t((activity as any).reason) });
      }
      if ((activity as any).notes) {
        details.push({ label: t('Notes'), value: (activity as any).notes });
      }

      return {
        title: t('Frozen Milk Record'),
        details: [...details, ...caretakerDetail],
      };
    }
```

- [ ] **Step 5: Add the list description**

In the description function, add this branch immediately before the `if ('pottyLocation' in activity) {` branch at line 934:

```typescript
    if ('bagCount' in activity) {
      const bagCount = (activity as any).bagCount as number;
      const amountPerBag = (activity as any).amountPerBag as number;
      const unit = (activity as any).unitAbbr || 'OZ';
      const time = formatTime(activity.time, settings, true, t);
      const total = `${Math.round(Math.abs(bagCount) * amountPerBag * 100) / 100} ${t(unit.toLowerCase())}`;
      let notes: string = (activity as any).notes ?? '';
      if (notes.length > 30) {
        notes = notes.slice(0, 30) + '...';
      }
      return {
        type: bagCountLabel(bagCount, t),
        details: [time, total, notes].filter(Boolean).join(' • ')
      };
    }
```

- [ ] **Step 6: Add the API endpoint mapping**

In the endpoint function, add as the first check inside it (before the `isFoodLogActivity` check at line 1170):

```typescript
  if ('bagCount' in activity) return 'breast-milk-bag-log';
```

The value must exactly match the route directory name, since it is used to build `/api/<endpoint>` for edit and delete.

- [ ] **Step 7: Add the row color**

In `getActivityStyle`, add as the first check inside the function body:

```typescript
  // Cyan reads as "frozen" and is unused elsewhere: teal is diaper, sky is feed,
  // fuchsia is potty, purple is pump.
  if ('bagCount' in activity) {
    return {
      bg: 'bg-gradient-to-r from-cyan-500 to-cyan-600',
      textColor: 'text-white',
    };
  }
```

- [ ] **Step 8: Add the filter chip**

In `src/components/Timeline/TimelineFilter.tsx`, add `Milk` to the lucide import, then add this entry immediately after the potty entry on line 53:

```typescript
    { type: 'milkbag', icon: <Milk className="h-4 w-4" aria-hidden="true" />, label: t('Frozen Milk') },
```

- [ ] **Step 9: Route edit clicks**

In `src/components/Timeline/TimelineActivityDetails.tsx` there is an `if / else if` chain around line 88. Insert the bag branch as the **first** `else if` in that chain, before the breast-milk-adjustment check, so the result reads:

```typescript
      // Frozen milk bags before the adjustment check: both models carry `reason`,
      // and only the field names (`amountPerBag` vs `amount`) keep them apart today.
      else if ('bagCount' in activity) {
        onEdit(activity, 'milkbag');
      }
      // Check for breast milk adjustment before pump
      else if ('reason' in activity && 'amount' in activity && !('type' in activity) && !('leftAmount' in activity)) {
        onEdit(activity, 'breast-milk-adjustment');
      }
```

Note the chain starts with an `if` on an earlier line — do not turn your insert into a new `if`, or every branch below it becomes unreachable for non-bag activities.

- [ ] **Step 10: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: errors only in `Timeline/index.tsx` and `TimelineV2/index.tsx`, complaining that `'milkbag'` is not assignable to their local `editModalType` unions. Task 13 fixes those. No other errors.

- [ ] **Step 11: Commit**

```bash
git add src/components/Timeline/types.ts src/components/Timeline/utils.tsx src/components/Timeline/TimelineFilter.tsx src/components/Timeline/TimelineActivityDetails.tsx
git commit -m "milkbags: Render frozen milk entries in the timeline"
```

---

## Task 13: Timeline edit modals

**Files:**
- Modify: `src/components/Timeline/index.tsx`
- Modify: `src/components/Timeline/TimelineV2/index.tsx`

**The two files are not symmetric, despite looking it.** `TimelineV2/index.tsx` renders every edit form, including `PottyForm`. `Timeline/index.tsx` (v1) carries the same `editModalType` union but renders **no** `PottyForm` — potty entries are not editable from the v1 timeline. Follow that precedent exactly: v1 gets the union widened for type compatibility only, and no form. Do not go looking for a v1 `PottyForm` to copy; there isn't one.

- [ ] **Step 1: Widen the unions in Timeline/index.tsx (v1)**

In `src/components/Timeline/index.tsx`, add `'milkbag' | ` after `'potty' | ` in **both** places: the `editModalType` state declaration (line 29) and the `handleEdit` signature (line 302). No import, no form render, no other change to this file.

- [ ] **Step 2: Widen the unions in TimelineV2/index.tsx**

In `src/components/Timeline/TimelineV2/index.tsx`, add `'milkbag' | ` after `'potty' | ` in both the `editModalType` state declaration (line 38) and the `handleEdit` signature (line 523).

- [ ] **Step 3: Add the filter case in TimelineV2/index.tsx**

In the filter switch around line 457, add this case immediately after `case 'potty':`:

```typescript
            case 'milkbag':
              return 'bagCount' in activity;
```

- [ ] **Step 4: Render the edit form in TimelineV2/index.tsx**

Add the import next to the existing `PottyForm` import on line 6:

```typescript
import BreastMilkBagForm from '@/src/components/forms/BreastMilkBagForm';
```

Then add this immediately after the `<PottyForm ... />` element (which ends around line 644), matching the surrounding forms exactly:

```typescript
          <BreastMilkBagForm
            isOpen={editModalType === 'milkbag'}
            onClose={() => setEditModalType(null)}
            babyId={selectedActivity.babyId}
            initialTime={getActivityTime(selectedActivity)}
            activity={'bagCount' in selectedActivity ? selectedActivity : undefined}
            onSuccess={handleFormSuccess}
          />
```

- [ ] **Step 5: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: clean of every error introduced in Task 12.

- [ ] **Step 6: Verify in the browser**

Run `npm run dev`. Log a bag entry, then open the timeline.

Expected: a cyan row reading "Froze 3 bags · 12 oz". Tapping it opens the detail panel; tapping edit opens the form prefilled with 3 bags at 4 oz in the Froze direction. Deleting removes it. The "Frozen Milk" filter chip shows only bag rows.

- [ ] **Step 7: Commit**

```bash
git add src/components/Timeline/index.tsx src/components/Timeline/TimelineV2/index.tsx
git commit -m "milkbags: Wire frozen milk edit and delete into both timelines"
```

---

## Task 14: Daily stats lines

There are two daily-stats implementations — the v1 `DailyStats` and the v2 `TimelineV2DailyStats`, which sources its numbers from `computeDayStats`. Both need the line.

**Files:**
- Modify: `src/components/Timeline/TimelineV2/computeDayStats.ts`
- Modify: `src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx`
- Modify: `src/components/DailyStats/index.tsx`

- [ ] **Step 1: Extend the day stats shape**

In `src/components/Timeline/TimelineV2/computeDayStats.ts`, add to the `DayStats` interface after `pottyCount: number;`:

```typescript
  /** Bags put into the freezer on this day, and their total volume in `preferredUnit`. */
  bagsFrozen: number;
  bagsFrozenAmount: number;
  /** Bags taken out of the freezer on this day, as a positive magnitude. */
  bagsRemoved: number;
  bagsRemovedAmount: number;
```

Add the matching initializers to the `stats` object literal after `pottyCount: 0,`:

```typescript
    bagsFrozen: 0,
    bagsFrozenAmount: 0,
    bagsRemoved: 0,
    bagsRemovedAmount: 0,
```

- [ ] **Step 2: Accumulate them**

Add `import { convertVolume } from '@/src/utils/unit-conversion';` at the top if it is not already imported, then add this branch immediately **before** the `if ('pottyLocation' in activity) {` branch (around line 198):

```typescript
    // Frozen milk bags. `bagCount` is unique across every model, so this branch
    // is disjoint from every other discriminator; it sits first for clarity.
    if ('bagCount' in activity) {
      const time = new Date((activity as any).time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        const bagCount = (activity as any).bagCount as number;
        const volume = convertVolume(
          Math.abs(bagCount) * ((activity as any).amountPerBag as number),
          (activity as any).unitAbbr || 'OZ',
          preferredUnit
        );
        if (bagCount > 0) {
          stats.bagsFrozen += bagCount;
          stats.bagsFrozenAmount += volume;
        } else if (bagCount < 0) {
          stats.bagsRemoved += -bagCount;
          stats.bagsRemovedAmount += volume;
        }
      }
    }
    else if ('pottyLocation' in activity) {
```

Note this converts the existing `if ('pottyLocation' ...)` into an `else if`, matching the defensive style already used for the potty/diaper pair in this file.

- [ ] **Step 3: Render the v2 tiles**

In `src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx`:

Add `Milk` to the lucide import.

Add `bagsFrozen, bagsFrozenAmount, bagsRemoved, bagsRemovedAmount,` to the `computeDayStats` destructuring around line 201.

Add these two tiles immediately after the "Breast milk stored balance tile" block (which ends around line 533):

```typescript
    // Frozen bag activity for the day. Two tiles rather than a net figure: on a
    // day you both froze and thawed, a net of zero would read as "nothing happened".
    if (bagsFrozen > 0 && enableBreastMilkTracking !== false) {
      tiles.push({
        filter: 'milkbag',
        label: `${Math.round(bagsFrozenAmount * 100) / 100} ${unitSymbol(preferredUnit)} ${t('froze')}`,
        value: `${bagsFrozen} ${bagsFrozen === 1 ? t('bag') : t('bags')}`,
        icon: <Milk className="h-full w-full" aria-hidden="true" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#0891b2]', // cyan-600 - frozen milk identity color
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }

    if (bagsRemoved > 0 && enableBreastMilkTracking !== false) {
      tiles.push({
        filter: 'milkbag',
        label: `${Math.round(bagsRemovedAmount * 100) / 100} ${unitSymbol(preferredUnit)} ${t('used')}`,
        value: `${bagsRemoved} ${bagsRemoved === 1 ? t('bag') : t('bags')}`,
        icon: <Milk className="h-full w-full" aria-hidden="true" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#0891b2]', // cyan-600 - frozen milk identity color
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }
```

If `preferredUnit` is not in scope at that point in the file, use whatever variable the neighbouring pump tile uses for its unit (it reads `preferredUnit.toLowerCase()` at line 508, so it is in scope).

- [ ] **Step 4: Render the v1 lines**

In `src/components/DailyStats/index.tsx`:

Add `Milk` to the lucide import.

Add `bagsFrozen`, `bagsFrozenAmount`, `bagsRemoved`, `bagsRemovedAmount`, `bagUnit` to the destructured result of the big `useMemo` (the list beginning at line 121), and compute them inside that `useMemo` using the pure helper. Add this import at the top:

```typescript
import { sumBagsForDay } from '@/src/utils/breastMilkBags';
```

Inside the `useMemo`, after the existing per-activity loop and before the return, add:

```typescript
    // Frozen milk bags for the day. The pure helper owns the arithmetic; this
    // component only owns the date window.
    //
    // This file does not have a family-preferred-unit context (unlike the v2
    // stats, which get `preferredUnit`). It follows the same convention as the
    // feed totals above at line 216: report in the unit the rows were logged in,
    // taken from the first row of the day, defaulting to OZ. Summing in OZ while
    // labelling the result "oz" unconditionally would mislabel an ML family's
    // volumes, so the unit must come from the data.
    const bagRows = activities.filter((activity) => {
      if (!('bagCount' in activity)) return false;
      const time = new Date((activity as any).time);
      return time >= startOfDay && time <= endOfDay;
    }) as any[];
    const bagUnit = (bagRows[0]?.unitAbbr as string | undefined) || 'OZ';
    const bagTotals = sumBagsForDay(bagRows, bagUnit);
```

and add to the object the `useMemo` returns:

```typescript
      bagsFrozen: bagTotals.frozenBags,
      bagsFrozenAmount: bagTotals.frozenAmount,
      bagsRemoved: bagTotals.removedBags,
      bagsRemovedAmount: bagTotals.removedAmount,
      bagUnit,
```

Then add two ticker entries immediately after the `breastMilkBalance` entry at line 522:

```typescript
              ...(bagsFrozen > 0 ? [{ icon: <Milk className="h-3 w-3 text-cyan-600" aria-hidden="true" />, label: t('Froze'), value: `${bagsFrozen} ${bagsFrozen === 1 ? t('bag') : t('bags')} (${bagsFrozenAmount} ${t(bagUnit.toLowerCase())})` }] : []),
              ...(bagsRemoved > 0 ? [{ icon: <Milk className="h-3 w-3 text-cyan-600" aria-hidden="true" />, label: t('Used'), value: `${bagsRemoved} ${bagsRemoved === 1 ? t('bag') : t('bags')} (${bagsRemovedAmount} ${t(bagUnit.toLowerCase())})` }] : []),
```

and two expanded entries immediately after the `breastMilkBalance` `StatItem` block at line 665:

```typescript
              {bagsFrozen > 0 && (
                <StatItem
                  icon={<Milk className="h-4 w-4 text-cyan-600" aria-hidden="true" />}
                  label={t('Froze')}
                  value={`${bagsFrozen} ${bagsFrozen === 1 ? t('bag') : t('bags')} (${bagsFrozenAmount} ${t(bagUnit.toLowerCase())})`}
                />
              )}
              {bagsRemoved > 0 && (
                <StatItem
                  icon={<Milk className="h-4 w-4 text-cyan-600" aria-hidden="true" />}
                  label={t('Used')}
                  value={`${bagsRemoved} ${bagsRemoved === 1 ? t('bag') : t('bags')} (${bagsRemovedAmount} ${t(bagUnit.toLowerCase())})`}
                />
              )}
```

- [ ] **Step 5: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors naming `computeDayStats.ts`, `TimelineV2DailyStats.tsx`, or `DailyStats/index.tsx`.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`

Expected: PASS. If an existing `computeDayStats` test asserts a whole-object equality on `DayStats`, add the four new zero-valued keys to its expected object.

- [ ] **Step 7: Verify in the browser**

Run `npm run dev`, log 3 bags frozen and 1 bag used today, and look at the daily stats strip.

Expected: "Froze 3 bags (12 oz)" and "Used 1 bag (4 oz)".

- [ ] **Step 8: Commit**

```bash
git add src/components/Timeline/TimelineV2/computeDayStats.ts src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx src/components/DailyStats/index.tsx
git commit -m "milkbags: Add daily froze/used lines to both daily stats views"
```

---

## Task 15: Reports cards

**Files:**
- Create: `src/components/Reports/BreastMilkStashSection.tsx`
- Modify: `src/components/Reports/StatsTab.tsx`
- Modify: `src/components/Reports/reports.types.ts`

- [ ] **Step 1a: Close a pre-existing hole in `FeedActivity`**

`averageBreastMilkPerDay` reads `breastMilkAmount` (the breast milk half of a `Formula/Breast` bottle) and `sourcePumpId` (the auto-pump-feed marker). Both arrive at runtime — `app/api/timeline/route.ts:553` spreads the whole feed row — but neither is declared on `FeedActivity` in `reports.types.ts`. Add them so the section does not need an `as any` cast to see fields that are really there:

```typescript
  bottleType: string | null;
  breastMilkAmount: number | null;
  sourcePumpId: string | null;
```

`bottleType` already exists — add only the two new lines beneath it.

- [ ] **Step 1b: Add the activity type to the reports union**

In `src/components/Reports/reports.types.ts`, add this interface next to `BreastMilkAdjustmentActivity` (around line 105):

```typescript
export interface BreastMilkBagActivity {
  id: string;
  babyId: string;
  familyId: string | null;
  time: string;
  bagCount: number;
  amountPerBag: number;
  unitAbbr: string | null;
  reason: string | null;
  notes: string | null;
  caretakerId: string | null;
  caretakerName?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

and add `| BreastMilkBagActivity` to the `ActivityType` union (line 206).

- [ ] **Step 2: Write the section component**

Create `src/components/Reports/BreastMilkStashSection.tsx`:

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { Milk } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Card, CardContent } from '@/src/components/ui/card';
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/src/components/ui/accordion';
import { styles } from './reports.styles';
import { ActivityType, DateRange } from './reports.types';
import { useLocalization } from '@/src/context/localization';
import { useBaby } from '@/app/context/baby';
import { useUnit } from '@/src/hooks/useUnit';
import {
  averageBreastMilkPerDay,
  projectDaysOfSupply,
  sumBagsForDay,
  BreastMilkBagRow,
} from '@/src/utils/breastMilkBags';
import { BreastMilkFeedInventoryRow } from '@/src/utils/breastMilkInventory';

interface BreastMilkStashSectionProps {
  activities: ActivityType[];
  dateRange: DateRange;
  unit: string;
  enableBreastMilkTracking?: boolean;
}

/**
 * Days covered by the selected range. Duplicated from StatsTab's identical
 * one-liner rather than plumbed through: StatsTab's copy lives inside a useMemo
 * typed as CombinedStats, and widening that shared type to export one number
 * would touch every stats section for no benefit.
 */
function daysBetween(dateRange: DateRange): number {
  if (!dateRange.from || !dateRange.to) return 0;
  const startDate = new Date(dateRange.from);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(dateRange.to);
  endDate.setHours(23, 59, 59, 999);
  return Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
}

interface StashStatCardProps {
  value: React.ReactNode;
  label: string;
  subLabel?: React.ReactNode;
  valueClassName?: string;
}

/** A single stat card, styled like the rest of Reports. */
const StashStatCard: React.FC<StashStatCardProps> = ({ value, label, subLabel, valueClassName }) => (
  <Card className={cn(styles.statCard, 'reports-stat-card')}>
    <CardContent className="p-4">
      <div className={cn(styles.statCardValue, 'reports-stat-card-value', valueClassName)}>{value}</div>
      <div className={cn(styles.statCardLabel, 'reports-stat-card-label')}>{label}</div>
      {subLabel !== undefined && (
        <div className={cn(styles.statCardSubLabel, 'reports-stat-card-sublabel')}>{subLabel}</div>
      )}
    </CardContent>
  </Card>
);

/**
 * BreastMilkStashSection Component
 *
 * Two cards: current freezer contents with a days-of-supply projection, and the
 * average daily breast milk consumption that projection divides by.
 *
 * The freezer card is deliberately NOT scoped to the report date range — the
 * freezer is current state, not a windowed aggregate. The date range only affects
 * the consumption rate in the subline.
 */
const BreastMilkStashSection: React.FC<BreastMilkStashSectionProps> = ({
  activities,
  dateRange,
  unit,
  enableBreastMilkTracking = true,
}) => {
  const { t } = useLocalization();
  const { unitSymbol } = useUnit();
  const { selectedBaby } = useBaby();
  const [balance, setBalance] = useState<{ bags: number; amount: number } | null>(null);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!selectedBaby || enableBreastMilkTracking === false) {
        setBalance(null);
        return;
      }
      try {
        const authToken = localStorage.getItem('authToken');
        const response = await fetch(
          `/api/breast-milk-bag-balance?babyId=${selectedBaby.id}&unit=${unit}`,
          {
            cache: 'no-store',
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
          }
        );
        if (!response.ok) return;
        const data = await response.json();
        if (data.success && data.data) {
          setBalance({ bags: data.data.bags, amount: data.data.amount });
        }
      } catch (error) {
        console.error('Error fetching breast milk bag balance:', error);
      }
    };
    fetchBalance();
  }, [selectedBaby, unit, enableBreastMilkTracking, activities]);

  if (enableBreastMilkTracking === false) return null;

  const daysInRange = daysBetween(dateRange);

  // Bottle feeds only. `bottleType` is present on FeedActivity and on nothing else.
  const feedRows = activities.filter((activity) => 'bottleType' in activity) as BreastMilkFeedInventoryRow[];
  const avgPerDay = averageBreastMilkPerDay(feedRows, daysInRange, unit);

  const bagRows = activities.filter((activity) => 'bagCount' in activity) as BreastMilkBagRow[];
  const rangeBags = sumBagsForDay(bagRows, unit);
  const avgFrozenPerDay = daysInRange > 0
    ? Math.round((rangeBags.frozenAmount / daysInRange) * 100) / 100
    : 0;

  const daysOfSupply = balance ? projectDaysOfSupply(balance.amount, avgPerDay) : null;
  const symbol = unitSymbol(unit);

  return (
    <AccordionItem value="milkbag">
      <AccordionTrigger className={cn(styles.accordionTrigger, 'reports-accordion-trigger')}>
        <Milk className={cn(styles.accordionTriggerIcon, 'reports-accordion-trigger-icon text-cyan-600')} />
        <span>{t('Frozen Milk')}</span>
      </AccordionTrigger>
      <AccordionContent className={styles.accordionContent}>
        {balance === null ? (
          <div className={cn(styles.emptyContainer, 'reports-empty-container')}>
            <p className={cn(styles.emptyText, 'reports-empty-text')}>
              {t('No frozen milk logged yet')}
            </p>
          </div>
        ) : (
          <div className={styles.statsGrid}>
            <StashStatCard
              value={`${balance.bags} ${balance.bags === 1 ? t('bag') : t('bags')}`}
              label={t('In the Freezer')}
              subLabel={
                daysOfSupply === null
                  ? `${balance.amount} ${symbol}`
                  : `${balance.amount} ${symbol} · ~${daysOfSupply} ${t('days of supply')}`
              }
            />
            <StashStatCard
              value={avgPerDay === 0 ? '—' : `${avgPerDay} ${symbol}`}
              label={t('Breast Milk / Day')}
              subLabel={`${t('avg consumed')} · ${avgFrozenPerDay} ${symbol} ${t('frozen')}`}
            />
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
};

export default BreastMilkStashSection;
```

- [ ] **Step 3: Mount it in StatsTab**

In `src/components/Reports/StatsTab.tsx`:

Add the import next to the other section imports:

```typescript
import BreastMilkStashSection from './BreastMilkStashSection';
```

Render the section immediately after `<PumpingStatsSection ... />` (line 938):

```typescript
        {/* Frozen Milk Section */}
        <BreastMilkStashSection
          activities={activities}
          dateRange={dateRange}
          unit={stats.pump.unit}
          enableBreastMilkTracking={enableBreastMilkTracking}
        />
```

`stats.pump.unit` is the family's preferred volume unit and is already used by `PumpingStatsSection` for exactly this purpose. Do **not** try to plumb `daysInRange` out of the `useMemo` at line 261: that memo is typed `CombinedStats`, and widening a type shared by every stats section to export one number is not worth it. The section computes its own via `daysBetween`.

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors naming `BreastMilkStashSection.tsx`, `StatsTab.tsx`, or `reports.types.ts`.

- [ ] **Step 5: Verify in the browser**

Run `npm run dev`, log some bags and at least one Breast Milk bottle feed, then open Reports → Stats.

Expected: a "Frozen Milk" accordion section with two cards. The first reads e.g. "42 bags" with subline "168 oz · ~11.2 days of supply". The second reads e.g. "15 oz" labelled "Breast Milk / Day".

Then check the zero cases: with no breast milk feeds in range, the second card reads "—" and the first card's subline shows only the volume, with no days figure.

- [ ] **Step 6: Commit**

```bash
git add src/components/Reports/BreastMilkStashSection.tsx src/components/Reports/StatsTab.tsx src/components/Reports/reports.types.ts
git commit -m "milkbags: Add freezer stash and daily average report cards"
```

---

## Task 16: Localization

Do this last, once every string exists. Doing it earlier means running the script twice.

**Files:**
- Modify: `src/localization/translations/en.json`
- Modify: all other files in `src/localization/translations/`

- [ ] **Step 1: Collect every new key**

Run this to list every `t('...')` call added by this feature:

```bash
git diff main --unified=0 -- 'src/**/*.tsx' 'src/**/*.ts' 'app/**/*.tsx' | grep '^+' | grep -o "t('[^']*'" | sed "s/t('//;s/'$//" | sort -u
```

Expected: the list below, plus anything you added while implementing.

- [ ] **Step 2: Add the keys to en.json**

Add each of these to `src/localization/translations/en.json` as `"key": "key"` — keys are their own English text:

```
Amount Per Bag
Add or remove bags from the freezer
Bags
Breast Milk / Day
Decrease bag count
Direction
Edit Frozen Milk
Enter an amount per bag
Failed to save frozen milk log
Frozen Milk
Frozen Milk Record
Froze
In the Freezer
Increase bag count
Log Frozen Milk
No frozen milk logged yet
Per Bag
Select reason
Select time...
Total
Update this freezer entry
Used
avg consumed
bag
bags
days of supply
frozen
froze
used
```

Plus the two volume unit labels used by `t(unitAbbr.toLowerCase())` in Tasks 12 and 14:

```
ml
oz
```

Many of these likely already exist (`Bags`, `Total`, `Reason`, `Notes`, `Time`, `Cancel`, `Save`, `Update`, `Fed`, `Discarded`, `Donated`, `Other`, `Initial Stock`, `oz`, `ml`). Adding a duplicate key to a JSON object is a syntax error — check before adding:

```bash
for key in "Bags" "Total" "Reason" "Notes" "Time" "Fed" "Discarded" "Donated" "Other" "Initial Stock" "oz" "ml" "bag" "bags" "Froze" "Used" "Direction" "Frozen Milk"; do
  printf "%s: " "$key"; grep -c "^  \"$key\":" src/localization/translations/en.json
done
```

Expected: `0` means safe to add, `1` means it already exists — skip it.

- [ ] **Step 3: Propagate to every other language**

Run: `node scripts/check-missing-translations.js`

Expected: it reports the number of keys added to each of the other locale files and sorts all files alphabetically.

- [ ] **Step 4: Verify every locale file is valid JSON**

```bash
for f in src/localization/translations/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "INVALID: $f"; done
```

Expected: no output.

- [ ] **Step 5: Translate the non-English files**

Fill in the newly added empty values in `es.json`, `fr.json`, `de.json`, `it.json`, `nl.json`, `pl.json`, `pt-br.json`, `pt-pt.json`, `ro.json`, `nb.json`, `hi.json` as well as you can. Domain notes for accuracy:

- "Froze" / "Used" here are past-tense verbs describing a freezer action, not adjectives.
- "bag" is a breast milk storage bag, a disposable pouch.
- "days of supply" means how long the stored milk will last at the current rate.
- "In the Freezer" labels a current inventory count.

- [ ] **Step 6: Verify the JSON is still valid**

```bash
for f in src/localization/translations/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "INVALID: $f"; done
```

Expected: no output.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/localization/translations/
git commit -m "milkbags: Add and translate frozen milk strings"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`

Expected: PASS, with `tests/breastMilkBags.test.ts` and `tests/activityTileOrder.test.ts` both green.

- [ ] **Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors in any file this plan touched. (`npm run lint` is known-broken in this repo — do not gate on it.)

- [ ] **Build**

Run: `npm run build`

Expected: successful build.

- [ ] **End-to-end walkthrough**

With `npm run dev` running:

1. Log-entry screen shows a "Frozen Milk" tile between Food and Diaper.
2. Tap it, freeze 3 bags at 4 oz. Save.
3. Tap it again — the per-bag amount is prefilled at 4.
4. Freeze 2 bags at 6 oz. Save. Reopen — prefilled at 6.
5. Switch to "Used", remove 1 bag. The Reason select appears.
6. Daily stats show "Froze 5 bags (32 oz)" and "Used 1 bag (6 oz)".
7. Timeline shows three cyan rows. Edit one, change the count, confirm it updates. Delete one, confirm it disappears.
8. Reports → Stats → Frozen Milk shows 4 bags with a volume and, if breast milk bottle feeds exist in range, a days-of-supply subline.
9. Turn off "breast milk tracking" in Settings → Config. Confirm the Reports section and the daily stats lines disappear. The tile and the timeline rows stay — see the gating table in the orientation section; that is intended, not a miss.
10. Turn it back on. Confirm everything returns.
11. Switch the family's volume unit to ML in settings and confirm the daily stats line and both Reports cards label their volumes in ml, not oz.

- [ ] **Confirm the pump inventory is untouched**

Run: `git diff main --stat -- src/utils/breastMilkInventory.ts app/api/breast-milk-balance/ app/api/breast-milk-adjustment/ app/api/pump-log/`

Expected: no output. If any of these files changed, the bag ledger has leaked into the pump ledger, which the design explicitly forbids.
