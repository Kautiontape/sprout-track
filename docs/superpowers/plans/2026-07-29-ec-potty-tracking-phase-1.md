# EC Potty Tracking — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log a potty catch (when, what, which receptacle) from either the main app or Nursery Mode, see it in the timeline and daily stats, and have it stop the diaper warning bubble from nagging — without touching any diaper count.

**Architecture:** `PottyLog` is a new Prisma model that is a *sibling* of `DiaperLog`, not a variant of it. Nothing reads or writes `DiaperLog`. The one place the two meet is the status bubble, which is fed `max(lastDiaper.time, lastPotty.time)`.

**Tech Stack:** Next.js App Router, TypeScript (strict), Prisma (must work on both PostgreSQL and SQLite), TailwindCSS + CVA, `node:test` via `npx tsx --test`.

**Source spec:** `docs/superpowers/specs/2026-07-29-ec-potty-tracking-design.md`

**Scope:** Phase 1 only — logging works end to end and data exports correctly. Phase 2 (Reports time-of-day analysis) and Phase 3 (streaks) get their own plans.

---

## Orientation for someone new to this codebase

Read these before starting. They are the patterns every task below copies.

- **Auth is never hand-rolled.** Every API route wraps handlers in `withAuthContext` from `app/api/utils/auth.ts`, which supplies `authContext.familyId`. Client-sent family context is never trusted. Queries scope directly — `where: { id, familyId: userFamilyId }` — rather than fetching then comparing.
- **All API responses are `{ success: boolean, data?: T, error?: string }`.**
- **Dark mode is NOT Tailwind `dark:` classes.** Light mode is Tailwind via CVA in `[component].styles.ts`; dark mode is `html.dark .class-name` rules in a plain `[component].css`. The app's theme toggle sets `html.dark`, so `dark:` classes would bypass it. This is deliberate — do not "fix" it.
- **No React Query, no React Hook Form.** Data fetching is `useEffect` + `fetch`; forms are `useState`.
- **All user-facing text goes through `t()`** from `useLocalization()`. Keys are the English text verbatim.
- **There is no test runner.** Pure functions get `node:test` files run with `npx tsx --test <file>`; some logic has standalone assertion scripts run with `npx tsx scripts/verify-*.ts`. React components are not unit-testable here and are verified by running the app.
- **Commit style is `topic: message`** (e.g. `potty: Add PottyLog model`). Never add `Co-Authored-By` lines.

**READ THIS FIRST: `documentation/Implementation/add-new-activity.md`.**

The repo contains a 450-line guide for adding an activity type, including a
**29-file checklist** (line 260) and a dark-mode section (line 300). It was written for
exactly this kind of change and is authoritative. This plan was drafted before it was
found, and cross-checking revealed genuine gaps — several are corrected below, but if
the checklist and this plan ever disagree, **the checklist wins**. Work through it as
you go and report anything this plan misses.

Known gaps this correction already covers: `Timeline/utils.tsx` needs all five
activity-dispatching functions (not just the endpoint one), three CSS files need potty
dark-mode rules, `Timeline/index.tsx` (the older container) was omitted entirely, and
`PottyForm` needs a `.css` file.

**Two duck-typing discriminators you will trip over.** The codebase identifies activity types by which fields are present, in two places:
1. `getActivityVariant()` in `src/components/ui/activity-tile/activity-tile-utils.ts` — activity → tile variant.
2. `src/components/Timeline/utils.tsx:1016` — activity → API endpoint name.

A `PottyLog` has `type` but none of `duration`/`quality`/`amount`/`condition`, so it falls through every existing branch and lands on `'default'`. The `pottyLocation` check must come **first** in both.

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `src/constants/potty-locations.ts` | The canonical receptacle list, shared by `PottyForm` and Nursery Mode |
| `app/api/potty-log/route.ts` | CRUD for `PottyLog`, family-scoped |
| `app/api/potty-location-settings/route.ts` | Read/write hidden receptacles |
| `src/components/forms/PottyForm/index.tsx` | The potty entry form |
| `src/components/forms/PottyForm/README.md` | Component docs (project convention) |
| `src/lib/elimination.ts` | Pure `latestElimination()` helper — the only place diaper and potty times mix |
| `src/lib/elimination.test.ts` | `node:test` coverage for the above |

**Modify (grouped by what they do):**

- *Schema/types:* `prisma/schema.prisma`, `app/api/types.ts`
- *Discriminators:* `src/components/ui/activity-tile/activity-tile-utils.ts`, `src/components/Timeline/utils.tsx`
- *Tile rendering:* `activity-tile.types.ts`, `activity-tile.styles.ts`, `activity-tile-icon.tsx`, `activity-tile.css`
- *Entry points:* `app/(app)/[slug]/log-entry/page.tsx`, `src/components/ActivityTileGroup/index.tsx`, `app/api/activity-settings/route.ts`
- *Timeline:* `src/components/Timeline/types.ts`, `TimelineFilter.tsx`, `TimelineActivityList.tsx`, `TimelineActivityDetails.tsx`, `TimelineV2/index.tsx`, `TimelineV2/useActivityCache.ts`, `TimelineV2/computeDayStats.ts`, `app/api/timeline/route.ts`
- *Full log:* `FullLogTimeline/index.tsx`, `full-log-timeline.types.ts`, `FullLogFilter.tsx`, `FullLogActivityDetails.tsx`
- *Stats:* `src/components/DailyStats/index.tsx`, `TimelineV2/TimelineV2DailyStats.tsx`, `scripts/verify-compute-day-stats.ts`
- *Timer:* `app/api/baby-last-activities/route.ts`
- *Nursery Mode:* `src/components/NurseryMode/index.tsx`, `NurseryMode.css`
- *Plumbing:* `app/api/utils/db-backup.ts`, `app/api/utils/csv-export.ts`, `app/api/accounts/download-data/route.ts`, `app/api/timeline/export/route.ts`, `app/api/babies/[babyId]/report/[yearMonth]/route.ts`, `app/api/hooks/v1/babies/[babyId]/activities/route.ts`, `app/api/hooks/v1/babies/[babyId]/status/route.ts`
- *Localization:* `src/localization/translations/en.json`

---

## Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the `PottyLog` model**

Add after the `DiaperLog` model (which ends around line 420). Mirrors `DiaperLog` exactly, including all five indexes.

```prisma
model PottyLog {
  id            String     @id @default(uuid())
  time          DateTime
  type          DiaperType // WET | DIRTY | BOTH — labeled Pee / Poop / Both in potty UI
  pottyLocation String?    // 'Potty Chair' | 'Toilet' | 'Sink' | 'Tub' | 'Outside' | 'Other'
  notes         String?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  deletedAt     DateTime?

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

Note: `DiaperType` is reused deliberately — no new enum. This keeps the migration free of enum DDL, which matters because it must apply to both PostgreSQL and SQLite.

- [ ] **Step 2: Add the three back-relations**

`diaperLogs DiaperLog[]` appears at lines 180 (Baby), 238 (Caretaker), and 285 (Family). Add a `pottyLogs` line directly beneath each:

```prisma
  pottyLogs      PottyLog[]
```

Match the surrounding alignment in each model — the three sites use different column widths.

- [ ] **Step 3: Add the settings field**

In the `Settings` model, directly below the `sleepLocationSettings` line:

```prisma
  pottyLocationSettings String? // JSON string for hidden potty locations
```

- [ ] **Step 4: Generate the client and create the migration**

```bash
npm run prisma:generate
npx prisma migrate dev --name add_potty_log
```

Expected: migration created under `prisma/migrations/`, client regenerated with no errors.

- [ ] **Step 5: Verify the model exists on the client**

```bash
npx tsx -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); console.log(typeof p.pottyLog.findMany)"
```

Expected output: `function`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "potty: Add PottyLog model and pottyLocationSettings"
```

---

## Task 2: Shared constants and API types

**Files:**
- Create: `src/constants/potty-locations.ts`
- Modify: `app/api/types.ts`

- [ ] **Step 1: Create the receptacle constant**

These are human-readable display strings, matching how `SleepLog.location` stores `'Bassinet'` / `'Car Seat'`. This lives in `src/constants/` (not inline in the form) because `PottyForm` and Nursery Mode both need it and must not drift apart.

```typescript
// src/constants/potty-locations.ts

/**
 * Canonical potty receptacles. Stored verbatim in PottyLog.pottyLocation,
 * mirroring how SleepLog.location stores human-readable strings.
 *
 * Shared by PottyForm and NurseryMode — do not duplicate this list.
 */
export const POTTY_LOCATIONS = [
  'Potty Chair',
  'Toilet',
  'Sink',
  'Tub',
  'Outside',
  'Other',
] as const;

export type PottyLocation = (typeof POTTY_LOCATIONS)[number];
```

- [ ] **Step 2: Add API types**

In `app/api/types.ts`, add `PottyLog` to the existing `@prisma/client` import at the top of the file, then add these directly after the `DiaperLogCreate` interface (which ends around line 159):

```typescript
// Potty log types
export type PottyLogResponse = Omit<PottyLog, 'time' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  time: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export interface PottyLogCreate {
  babyId: string;
  time: string;
  type: DiaperType;
  pottyLocation?: string | null;
  notes?: string | null;
}
```

- [ ] **Step 3: Add the settings type**

Directly after the existing `SleepLocationSettings` interface (around line 49):

```typescript
// Potty location settings types
export interface PottyLocationSettings {
  hiddenLocations: string[];
}
```

- [ ] **Step 4: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors mentioning `PottyLog`, `PottyLogResponse`, or `PottyLocationSettings`.

- [ ] **Step 5: Commit**

```bash
git add src/constants/potty-locations.ts app/api/types.ts
git commit -m "potty: Add shared location constants and API types"
```

---

## Task 3: The `/api/potty-log` route

**Files:**
- Create: `app/api/potty-log/route.ts`

This is a close adaptation of `app/api/diaper-log/route.ts`. Read that file first — the structure below matches it deliberately, including the `checkWritePermission` guard on every mutating handler (expired accounts are read-only) and the type-assertion exports at the bottom.

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../db';
import { ApiResponse, PottyLogCreate, PottyLogResponse } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';
import { toUTC, formatForResponse } from '../utils/timezone';
import { checkWritePermission } from '../utils/writeProtection';
import { notifyActivityCreated, resetTimerNotificationState } from '@/src/lib/notifications/activityHook';

const format = (log: any): PottyLogResponse => ({
  ...log,
  time: formatForResponse(log.time) || '',
  createdAt: formatForResponse(log.createdAt) || '',
  updatedAt: formatForResponse(log.updatedAt) || '',
  deletedAt: formatForResponse(log.deletedAt),
});

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

    const body: PottyLogCreate = await req.json();

    const baby = await prisma.baby.findFirst({
      where: { id: body.babyId, familyId: userFamilyId },
    });

    if (!baby) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby not found in this family.' }, { status: 404 });
    }

    const pottyLog = await prisma.pottyLog.create({
      data: {
        ...body,
        time: toUTC(body.time),
        caretakerId: caretakerId,
        familyId: userFamilyId,
      },
    });

    // A potty catch resets the diaper timer — see src/lib/elimination.ts.
    notifyActivityCreated(pottyLog.babyId, 'potty', { accountId: authContext.accountId, caretakerId: authContext.caretakerId }, { type: body.type }).catch(console.error);
    resetTimerNotificationState(pottyLog.babyId, 'diaper').catch(console.error);

    return NextResponse.json<ApiResponse<PottyLogResponse>>({ success: true, data: format(pottyLog) });
  } catch (error) {
    console.error('Error creating potty log:', error);
    return NextResponse.json<ApiResponse<PottyLogResponse>>(
      { success: false, error: 'Failed to create potty log' },
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
    const body: Partial<PottyLogCreate> = await req.json();

    if (!id) {
      return NextResponse.json<ApiResponse<PottyLogResponse>>(
        { success: false, error: 'Potty log ID is required' },
        { status: 400 }
      );
    }

    const existing = await prisma.pottyLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existing) {
      return NextResponse.json<ApiResponse<PottyLogResponse>>(
        { success: false, error: 'Potty log not found or access denied' },
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

    const pottyLog = await prisma.pottyLog.update({ where: { id }, data });

    return NextResponse.json<ApiResponse<PottyLogResponse>>({ success: true, data: format(pottyLog) });
  } catch (error) {
    console.error('Error updating potty log:', error);
    return NextResponse.json<ApiResponse<PottyLogResponse>>(
      { success: false, error: 'Failed to update potty log' },
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
      const pottyLog = await prisma.pottyLog.findFirst({
        where: { id, familyId: userFamilyId },
      });

      if (!pottyLog) {
        return NextResponse.json<ApiResponse<PottyLogResponse>>(
          { success: false, error: 'Potty log not found or access denied' },
          { status: 404 }
        );
      }

      return NextResponse.json<ApiResponse<PottyLogResponse>>({ success: true, data: format(pottyLog) });
    }

    const pottyLogs = await prisma.pottyLog.findMany({
      where: {
        familyId: userFamilyId,
        ...(babyId && { babyId }),
        ...(startDate && endDate && {
          time: { gte: toUTC(startDate), lte: toUTC(endDate) },
        }),
      },
      orderBy: { time: 'desc' },
    });

    return NextResponse.json<ApiResponse<PottyLogResponse[]>>({
      success: true,
      data: pottyLogs.map(format),
    });
  } catch (error) {
    console.error('Error fetching potty logs:', error);
    return NextResponse.json<ApiResponse<PottyLogResponse[]>>(
      { success: false, error: 'Failed to fetch potty logs' },
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
        { success: false, error: 'Potty log ID is required' },
        { status: 400 }
      );
    }

    const existing = await prisma.pottyLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existing) {
      return NextResponse.json<ApiResponse<void>>(
        { success: false, error: 'Potty log not found or access denied' },
        { status: 404 }
      );
    }

    await prisma.pottyLog.delete({ where: { id } });

    return NextResponse.json<ApiResponse<void>>({ success: true });
  } catch (error) {
    console.error('Error deleting potty log:', error);
    return NextResponse.json<ApiResponse<void>>(
      { success: false, error: 'Failed to delete potty log' },
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

- [ ] **Step 2: Check `notifyActivityCreated` accepts `'potty'`**

Open `src/lib/notifications/activityHook.ts` and find the type of the second parameter. If it is a union of activity-name string literals, add `'potty'` to it. If it is plain `string`, no change is needed.

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors in `app/api/potty-log/route.ts`.

- [ ] **Step 4: Verify the route responds**

Start the dev server (`npm run dev`), then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/potty-log
```

Expected: `401` — the route exists and auth is correctly rejecting an unauthenticated request. A `404` means the file is in the wrong place.

- [ ] **Step 5: Commit**

```bash
git add app/api/potty-log/route.ts
git commit -m "potty: Add potty-log API route"
```

---

## Task 4: The `/api/potty-location-settings` route

**Files:**
- Create: `app/api/potty-location-settings/route.ts`

- [ ] **Step 1: Copy and adapt the sleep equivalent**

```bash
cp app/api/sleep-location-settings/route.ts app/api/potty-location-settings/route.ts
```

- [ ] **Step 2: Rename the three identifiers**

In the new file, replace throughout:
- `SleepLocationSettings` → `PottyLocationSettings` (the imported type)
- `sleepLocationSettings` → `pottyLocationSettings` (the `Settings` column, appears in both the type assertion and the update payload)
- `sleep location settings` → `potty location settings` (in `console.error` messages)

The `{ hiddenLocations: string[] }` shape, the `withAuthContext` wrappers, and the default-on-error behavior all stay exactly as they are.

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors in `app/api/potty-location-settings/route.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/api/potty-location-settings/route.ts
git commit -m "potty: Add potty location settings API route"
```

---

## Task 5: The elimination helper (TDD)

This is the only place diaper and potty data mix. It is pure, so it gets real tests.

**Files:**
- Create: `src/lib/elimination.ts`
- Test: `src/lib/elimination.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/elimination.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestElimination } from './elimination';

const EARLY = new Date(2026, 6, 29, 8, 0, 0, 0);
const LATE = new Date(2026, 6, 29, 11, 30, 0, 0);

test('returns the potty time when it is the more recent of the two', () => {
  assert.deepEqual(latestElimination(EARLY, LATE), { time: LATE, source: 'potty' });
});

test('returns the diaper time when it is the more recent of the two', () => {
  assert.deepEqual(latestElimination(LATE, EARLY), { time: LATE, source: 'diaper' });
});

test('returns the diaper time when only a diaper exists', () => {
  assert.deepEqual(latestElimination(EARLY, null), { time: EARLY, source: 'diaper' });
});

test('returns the potty time when only a potty catch exists', () => {
  assert.deepEqual(latestElimination(null, EARLY), { time: EARLY, source: 'potty' });
});

test('returns null when neither exists', () => {
  assert.equal(latestElimination(null, null), null);
});

test('prefers diaper when the two timestamps are identical', () => {
  // Arbitrary but deterministic: a tie must not flip the badge between renders.
  assert.deepEqual(latestElimination(EARLY, new Date(EARLY.getTime())), { time: EARLY, source: 'diaper' });
});

test('accepts ISO strings as well as Date objects', () => {
  assert.deepEqual(
    latestElimination(EARLY.toISOString(), LATE.toISOString()),
    { time: LATE, source: 'potty' }
  );
});

test('accepts epoch milliseconds', () => {
  // NurseryMode holds times as epoch ms (DiaperSnap.time / PottySnap.time),
  // so this overload is load-bearing, not a convenience.
  assert.deepEqual(
    latestElimination(EARLY.getTime(), LATE.getTime()),
    { time: LATE, source: 'potty' }
  );
});

test('treats an invalid date as absent', () => {
  assert.deepEqual(latestElimination('not-a-date', EARLY), { time: EARLY, source: 'potty' });
});

test('treats epoch 0 as a present time on the diaper side, not absent', () => {
  // The explicit null/undefined/'' guard in toDate exists for exactly this:
  // 0 is falsy but valid. A `!value` guard would wrongly drop it.
  assert.deepEqual(latestElimination(0, null), { time: new Date(0), source: 'diaper' });
});

test('treats epoch 0 as a present time on the potty side, not absent', () => {
  assert.deepEqual(latestElimination(null, 0), { time: new Date(0), source: 'potty' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test src/lib/elimination.test.ts
```

Expected: FAIL — `Cannot find module './elimination'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/elimination.ts

/**
 * A potty catch means the diaper stayed clean, so it counts as elimination for
 * the purposes of the "time since last diaper" status bubble. This is the ONLY
 * place diaper and potty data mix — every count and statistic keeps them apart.
 */
export type EliminationSource = 'diaper' | 'potty';

export interface LatestElimination {
  time: Date;
  source: EliminationSource;
}

/** Date from the API layer, ISO string from JSON, epoch ms from NurseryMode. */
type TimeInput = Date | string | number | null | undefined;

const toDate = (value: TimeInput): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Returns whichever of the two happened most recently, tagged with its source,
 * or null if neither exists. Ties resolve to 'diaper' so the result is stable
 * across renders.
 */
export function latestElimination(
  diaperTime: TimeInput,
  pottyTime: TimeInput
): LatestElimination | null {
  const diaper = toDate(diaperTime);
  const potty = toDate(pottyTime);

  if (!diaper && !potty) return null;
  if (!potty) return { time: diaper!, source: 'diaper' };
  if (!diaper) return { time: potty, source: 'potty' };

  return potty.getTime() > diaper.getTime()
    ? { time: potty, source: 'potty' }
    : { time: diaper, source: 'diaper' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx tsx --test src/lib/elimination.test.ts
```

Expected: PASS, 11 tests.

Verify the epoch-0 tests actually bite before moving on: temporarily change the guard to `if (!value) return null;` and confirm those two tests FAIL, then revert. A test that passes under the broken implementation protects nothing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/elimination.ts src/lib/elimination.test.ts
git commit -m "potty: Add latestElimination helper with tests"
```

---

## Task 6: Wire the elimination helper into the status bubble

**Files:**
- Modify: `app/api/baby-last-activities/route.ts`
- Modify: `app/(app)/[slug]/log-entry/page.tsx`

- [ ] **Step 1: Return `lastPotty` from the API**

In `app/api/baby-last-activities/route.ts`, the `Promise.all` around line 49 destructures `[lastDiaper, lastPoopDiaper, lastBath, measurements, lastNote]`. Add a sixth query mirroring the `lastDiaper` one:

```typescript
      prisma.pottyLog.findFirst({
        where: { babyId, familyId: userFamilyId, deletedAt: null },
        orderBy: { time: 'desc' },
        include: { caretaker: true },
      }),
```

Add `lastPotty` to the destructuring array in the same position, then add to the response object alongside `lastDiaper` (around line 100):

```typescript
      lastPotty: lastPotty ? {
        ...lastPotty,
        time: formatForResponse(lastPotty.time) || '',
        caretakerName: lastPotty.caretaker?.name
      } : null,
```

Match the exact `where` clause shape used by the existing `lastDiaper` query in this file — if it omits `deletedAt: null`, omit it here too, so the two stay consistent.

- [ ] **Step 2: (moved to Task 10) — do not edit the log-entry page here**

> **Plan correction, found during execution.** An earlier draft of this step said
> `app/(app)/[slug]/log-entry/page.tsx` populates `lastDiaperTime` from the
> `baby-last-activities` response. **It does not.** Commit `ca29eb8` ("refactor to
> reduce timeline calls in log entry") moved that page off direct
> `baby-last-activities` fetches. Verified: `grep -n "baby-last-activities"` on
> that page returns nothing.
>
> The real path is: `TimelineV2` computes status in `emitLatestStatus()`
> (`src/components/Timeline/TimelineV2/index.tsx:48`), deriving `lastDiaperTime` at
> line 76 by filtering `'condition' in a`, and hands it to the page via the
> `onLatestStatusReady` callback (page.tsx:399-406).
>
> So the bubble wiring belongs in `emitLatestStatus`, and it is **inert until Task 10**
> puts `PottyLog` rows into `/api/timeline`. Doing it here would require inventing a
> parallel fetch that races TimelineV2's own refresh cycle and gets silently
> overwritten on every activity save. The step now lives in **Task 10, Step 7**.
>
> Task 6 is therefore API-surface only: Step 1 alone.

Note on `lastPotty`: nothing in Phase 1 consumes it yet. It is added because the
endpoint already returns a fine-grained set (`lastDiaper`, `lastPoopDiaper`,
`lastBath`, `lastNote`), `BabyQuickInfo` is its only consumer and the natural home
for a "last potty" display, and the parallel keeps the endpoint coherent. If you
prefer strict YAGNI, this is the one line in Phase 1 safe to drop.

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Verify by hand**

Run `npm run dev`. On the log-entry page, note the "time since diaper" bubble. Log a potty catch (this will not be possible until Task 9 wires the tile — if you are working strictly in order, defer this check to after Task 9 and note it here). Confirm the bubble resets.

- [ ] **Step 5: Commit**

```bash
git add app/api/baby-last-activities/route.ts "app/(app)/[slug]/log-entry/page.tsx"
git commit -m "potty: Reset diaper status bubble on potty catch"
```

---

## Task 7: Tile variant, discriminators, and icon

**Files:**
- Modify: `src/components/ui/activity-tile/activity-tile-utils.ts`
- Modify: `src/components/ui/activity-tile/activity-tile.types.ts`
- Modify: `src/components/ui/activity-tile/activity-tile.styles.ts`
- Modify: `src/components/ui/activity-tile/activity-tile-icon.tsx`
- Modify: `src/components/ui/activity-tile/activity-tile.css`
- Modify: `src/components/Timeline/utils.tsx`

- [ ] **Step 1: Extend the type unions**

In `activity-tile.types.ts`, add `PottyLogResponse` to the `@/app/api/types` import, then to both unions:

```typescript
export type ActivityType = SleepLogResponse | FeedLogResponse | DiaperLogResponse | PottyLogResponse | MoodLogResponse | NoteResponse | BathLogResponse | PumpLogResponse | PlayLogResponse | MeasurementResponse | MilestoneResponse | MedicineLogResponse | VaccineLogResponse;

export type ActivityTileVariant = 'sleep' | 'feed' | 'diaper' | 'potty' | 'note' | 'bath' | 'pump' | 'play' | 'measurement' | 'milestone' | 'medicine' | 'vaccine' | 'default';
```

- [ ] **Step 2: Add the tile-variant discriminator FIRST**

In `activity-tile-utils.ts`, add `'potty'` to `getActivityVariant`'s return type union, then add this as the **very first statement in the function body**, before the play-log check:

```typescript
  // Potty must be checked first: a PottyLog has `type` but none of duration/
  // quality/amount/condition, so it would otherwise fall through to 'default'.
  if ('pottyLocation' in activity) return 'potty';
```

- [ ] **Step 3: Add the endpoint discriminator**

In `src/components/Timeline/utils.tsx`, line 1016 reads `if ('condition' in activity) return 'diaper-log';`. Add directly **above** it:

```typescript
  if ('pottyLocation' in activity) return 'potty-log';
```

- [ ] **Step 4: Add style entries for the variant**

In `activity-tile.styles.ts`, the object is `as const`, so a missing key is a TypeScript index error. Add a `potty` entry to each of the three variant maps, directly after the `diaper` line in each:

```typescript
// in button.variants:
      potty: "",
// in iconContainer.variants:
      potty: "",
// in icon.variants:
      potty: "text-fuchsia-600",
```

Do **not** add `potty` to `icon.defaultIcons` — there is no `/public/potty-128.png`, and an entry there would render a broken image. The next step handles the icon explicitly instead.

- [ ] **Step 5: Render the icon explicitly**

In `activity-tile-icon.tsx`, add `Toilet` to the `lucide-react` import:

```typescript
import { Moon, Edit, Icon, LampWallDown, Trophy, Baby, Activity, Syringe, Toilet } from 'lucide-react';
```

Then add this immediately after `const variant = variantProp || getActivityVariant(activity);` and before `let icon = null;` — an early return, because both the `isButton` image path and the `!icon` fallback at the bottom depend on `defaultIcons[variant]`, which is deliberately absent for potty:

```typescript
  // Potty has no PNG asset in /public, so it renders a Lucide icon in both the
  // button and timeline paths. If /potty-128.png is ever added, add it to
  // styles.icon.defaultIcons and delete this block.
  if (variant === 'potty') {
    return (
      <div className={cn(
        styles.iconContainer.base,
        styles.iconContainer.variants.potty,
        className
      )}>
        <Toilet className={cn(
          isButton ? 'h-16 w-16' : styles.icon.base,
          styles.icon.variants.potty
        )} />
      </div>
    );
  }
```

- [ ] **Step 6: Add the dark-mode rule**

In `src/components/ui/activity-tile/activity-tile.css`, following the pattern already used for other variants in that file (plain `html.dark` selectors, never Tailwind `dark:`):

```css
html.dark .activity-tile-icon-potty {
  color: rgb(240 171 252);
}
```

Then add `activity-tile-icon-potty` to the `className` in the block from Step 5, so the rule has something to bind to:

```typescript
        <Toilet className={cn(
          'activity-tile-icon-potty',
          styles.icon.base,
          styles.icon.variants.potty
        )} />
```

- [ ] **Step 7: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. If you see an index-signature error on `styles.icon.defaultIcons[variant]`, the early return in Step 5 is misplaced — it must come before any code that indexes `defaultIcons`.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/activity-tile src/components/Timeline/utils.tsx
git commit -m "potty: Add potty activity tile variant and discriminators"
```

---

## Task 8: The `PottyForm` component

**Files:**
- Create: `src/components/forms/PottyForm/index.tsx`
- Create: `src/components/forms/PottyForm/README.md`

Model this on `src/components/forms/DiaperForm/index.tsx` — read it first. It uses `FormPage`/`FormPageContent`/`FormPageFooter`, `DateTimePicker`, `useTimezone().toUTCString`, `handleExpirationError` for 403s, and an `isInitialized` guard so reopening the form does not clobber edits. Receptacle hiding follows `SleepForm`, which manages hidden locations inline rather than in `SettingsForm`.

- [ ] **Step 1: Write the component**

```typescript
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { DiaperType } from '@prisma/client';
import { PottyLogResponse } from '@/app/api/types';
import { POTTY_LOCATIONS } from '@/src/constants/potty-locations';
import { Settings } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
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

interface PottyFormProps {
  isOpen: boolean;
  onClose: () => void;
  babyId: string | undefined;
  initialTime: string;
  activity?: PottyLogResponse;
  onSuccess?: () => void;
}

export default function PottyForm({
  isOpen,
  onClose,
  babyId,
  initialTime,
  activity,
  onSuccess,
}: PottyFormProps) {
  const { t } = useLocalization();
  const { toUTCString } = useTimezone();
  const { showToast } = useToast();

  const [selectedDateTime, setSelectedDateTime] = useState<Date>(() => {
    const date = new Date(initialTime);
    return isNaN(date.getTime()) ? new Date() : date;
  });
  const [type, setType] = useState<DiaperType | ''>('');
  const [pottyLocation, setPottyLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [hiddenLocations, setHiddenLocations] = useState<string[]>([]);
  const [showLocationManager, setShowLocationManager] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load hidden receptacles so families never see options they don't use.
  useEffect(() => {
    if (!isOpen) return;
    const load = async () => {
      try {
        const authToken = localStorage.getItem('authToken');
        const response = await fetch('/api/potty-location-settings', {
          headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data.success && data.data) {
          setHiddenLocations(data.data.hiddenLocations || []);
        }
      } catch {
        // Non-fatal: fall back to showing every receptacle.
      }
    };
    load();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !isInitialized) {
      if (activity) {
        const activityDate = new Date(activity.time);
        if (!isNaN(activityDate.getTime())) setSelectedDateTime(activityDate);
        setType(activity.type);
        setPottyLocation(activity.pottyLocation || '');
        setNotes(activity.notes || '');
      } else {
        const date = new Date(initialTime);
        if (!isNaN(date.getTime())) setSelectedDateTime(date);
        setType('');
        setPottyLocation('');
        setNotes('');
      }
      setIsInitialized(true);
    } else if (!isOpen) {
      setIsInitialized(false);
    }
  }, [isOpen, activity, initialTime, isInitialized]);

  // A hidden receptacle is still shown when editing a record that uses it,
  // so hiding one never makes an existing record uneditable. Same rule as SleepForm.
  const visibleLocations = POTTY_LOCATIONS.filter(loc =>
    !hiddenLocations.includes(loc) || activity?.pottyLocation === loc
  );

  const saveHiddenLocations = useCallback(async (newHidden: string[]) => {
    setHiddenLocations(newHidden);
    try {
      const authToken = localStorage.getItem('authToken');
      await fetch('/api/potty-location-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken ? `Bearer ${authToken}` : '',
        },
        body: JSON.stringify({ hiddenLocations: newHidden }),
      });
    } catch (error) {
      console.error('Error saving potty location settings:', error);
    }
  }, []);

  const toggleLocationVisibility = useCallback((location: string) => {
    const newHidden = hiddenLocations.includes(location)
      ? hiddenLocations.filter(l => l !== location)
      : [...hiddenLocations, location];
    saveHiddenLocations(newHidden);
  }, [hiddenLocations, saveHiddenLocations]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!babyId || !type) return;
    if (!selectedDateTime || isNaN(selectedDateTime.getTime())) return;

    setLoading(true);
    try {
      const payload = {
        babyId,
        time: toUTCString(selectedDateTime),
        type,
        pottyLocation: pottyLocation || null,
        notes: notes || null,
      };

      const authToken = localStorage.getItem('authToken');
      const response = await fetch(`/api/potty-log${activity ? `?id=${activity.id}` : ''}`, {
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
            'tracking potty visits'
          );
          if (isExpirationError) return;
        }
        throw new Error(t('Failed to save potty log'));
      }

      onClose();
      onSuccess?.();
    } catch (error) {
      console.error('Error saving potty log:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormPage
      isOpen={isOpen}
      onClose={onClose}
      title={activity ? t('Edit Potty') : t('Log Potty')}
      description={activity ? t('Update details about this potty visit') : t('Celebrate a potty win')}
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
                placeholder={t('Select potty time...')}
              />
            </div>

            <div>
              <label className="form-label">{t('Type')}</label>
              <Select
                value={type || ''}
                onValueChange={(value: DiaperType) => setType(value)}
                disabled={loading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('Select type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WET">{t('Pee')}</SelectItem>
                  <SelectItem value="DIRTY">{t('Poop')}</SelectItem>
                  <SelectItem value="BOTH">{t('Pee and Poop')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="form-label">{t('Where')}</label>
                <button
                  type="button"
                  onClick={() => setShowLocationManager(!showLocationManager)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title={t('Manage visible locations')}
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
              {showLocationManager && (
                <div className="mb-2 p-3 border border-gray-300 rounded-md bg-muted/50 space-y-1">
                  <p className="text-xs text-muted-foreground mb-2">{t('Toggle locations to show or hide them')}</p>
                  {POTTY_LOCATIONS.map(location => (
                    <label key={location} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        variant="primary"
                        size="sm"
                        checked={!hiddenLocations.includes(location)}
                        onCheckedChange={() => toggleLocationVisibility(location)}
                      />
                      {t(location)}
                    </label>
                  ))}
                </div>
              )}
              <Select
                value={pottyLocation}
                onValueChange={setPottyLocation}
                disabled={loading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('Select location')} />
                </SelectTrigger>
                <SelectContent>
                  {visibleLocations.map(loc => (
                    <SelectItem key={loc} value={loc}>{t(loc)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
          <Button onClick={handleSubmit} disabled={loading}>
            {activity ? t('Update') : t('Save')}
          </Button>
        </div>
      </FormPageFooter>
    </FormPage>
  );
}
```

- [ ] **Step 2: Write the README**

Project convention is a `README.md` beside each component. Read `src/components/forms/DiaperForm/README.md` and match its structure exactly, covering: the props table (`isOpen`, `onClose`, `babyId`, `initialTime`, `activity`, `onSuccess`), a usage example, and two implementation notes — that `type` reuses the `DiaperType` enum but is labeled Pee/Poop/Both, and that receptacle visibility is managed in-form via `/api/potty-location-settings`.

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. If `Textarea`'s import path is wrong, check `src/components/ui/textarea/` for its actual export name.

- [ ] **Step 4: Commit**

```bash
git add src/components/forms/PottyForm
git commit -m "potty: Add PottyForm component"
```

---

## Task 9: Wire the tile into the log-entry page

**Files:**
- Modify: `src/components/ActivityTileGroup/index.tsx`
- Modify: `app/(app)/[slug]/log-entry/page.tsx`
- Modify: `app/api/activity-settings/route.ts`

- [ ] **Step 1: Add `potty` to every activity list**

`'potty'` must be added to the `ActivityType` union and to **every** literal activity array, or the tile is silently pruned on the next settings save. In `src/components/ActivityTileGroup/index.tsx` these are at roughly lines 50, 102, 265, 283, and 284; in `app/api/activity-settings/route.ts` at roughly lines 31, 32, 277, 278, 316–318, and 366–369.

Insert `'potty'` directly after `'diaper'` in each array so it sits next to it in the default tile order. In the type alias on line 50:

```typescript
type ActivityType = 'sleep' | 'feed' | 'diaper' | 'potty' | 'note' | 'bath' | 'pump' | 'play' | 'measurement' | 'milestone' | 'medicine' | 'vaccine';
```

Verify none are missed:

```bash
grep -c "'diaper'" src/components/ActivityTileGroup/index.tsx app/api/activity-settings/route.ts
grep -c "'potty'" src/components/ActivityTileGroup/index.tsx app/api/activity-settings/route.ts
```

Expected: the two counts match for each file.

- [ ] **Step 2: Add the prop and the display name**

Add to `ActivityTileGroupProps`:

```typescript
  onPottyClick?: () => void;
```

Add to the destructured params, defaulting like the other optional handlers:

```typescript
  onPottyClick = () => {},
```

Add to `activityDisplayNames`:

```typescript
    potty: t('Potty'),
```

- [ ] **Step 3: Add the render case**

In `renderActivityTile`'s switch, directly after the `case 'diaper'` block:

```typescript
      case 'potty':
        return (
          <div key="potty" className="relative w-[82px] min-h-24 flex-shrink-0 snap-center">
            <ActivityTile
              activity={{
                type: 'WET',
                id: 'potty-button',
                babyId: selectedBaby.id,
                time: new Date().toISOString(),
                pottyLocation: null,
                notes: '',
                caretakerId: null,
                familyId: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                deletedAt: null
              } as unknown as PottyLogResponse}
              title={t('Potty')}
              variant="potty"
              isButton={true}
              onClick={() => {
                updateUnlockTimer();
                onPottyClick();
              }}
            />
          </div>
        );
```

Add `PottyLogResponse` to the `@/app/api/types` import at the top of the file.

Note there is no `StatusBubble` here — the potty catch feeds the *diaper* bubble via Task 6, and a second bubble would double up.

- [ ] **Step 4: Wire the page**

In `app/(app)/[slug]/log-entry/page.tsx`, mirroring the diaper wiring at lines 16, 39, 459, and 613:

```typescript
import PottyForm from '@/src/components/forms/PottyForm';
```

```typescript
  const [showPottyForm, setShowPottyForm] = useState(false);
```

Pass to `ActivityTileGroup`:

```typescript
          onPottyClick={() => setShowPottyForm(true)}
```

And render directly beside the existing `<DiaperForm>` block, matching its props exactly (`localTime` is already in scope in this file, and `triggerRefresh` is what DiaperForm calls on success):

```tsx
      {/* Potty Form */}
      <PottyForm
        isOpen={showPottyForm}
        onClose={() => {
          setShowPottyForm(false);
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

- [ ] **Step 5: Verify end to end**

Run `npm run dev`, open the log-entry page. Expected:
- A "Potty" tile appears next to "Diaper" with a toilet icon.
- Tapping it opens the form; saving creates a record with no console errors.
- The "time since diaper" bubble resets (this completes the deferred check from Task 6, Step 4).
- The Configure dropdown lists "Potty" and can hide/reorder it.

- [ ] **Step 6: Commit**

```bash
git add src/components/ActivityTileGroup "app/(app)/[slug]/log-entry/page.tsx" app/api/activity-settings/route.ts
git commit -m "potty: Add potty tile to log entry page"
```

---

## Task 10: Timeline integration

**Files:**
- Modify: `src/components/Timeline/types.ts`
- Modify: `src/components/Timeline/TimelineFilter.tsx`
- Modify: `src/components/Timeline/TimelineActivityList.tsx`
- Modify: `src/components/Timeline/TimelineActivityDetails.tsx`
- Modify: `src/components/Timeline/TimelineV2/index.tsx`
- Modify: `src/components/Timeline/TimelineV2/useActivityCache.ts`
- Modify: `app/api/timeline/route.ts`

- [ ] **Step 1: Extend the timeline type unions**

In `src/components/Timeline/types.ts`, add `'potty'` to `FilterType` (line 14) and to the `onEdit` type union (line 68):

```typescript
export type FilterType = 'sleep' | 'feed' | 'diaper' | 'potty' | 'poop' | 'medicine' | 'note' | 'bath' | 'pump' | 'breast-milk-adjustment' | 'milestone' | 'measurement' | 'play' | 'vaccine' | null;
```

The same literal union appears inline in `TimelineV2/index.tsx` at lines 27 and 417 — add `'potty'` there too.

- [ ] **Step 2: Fetch potty logs in the timeline API**

In `app/api/timeline/route.ts`, the `Promise.all` at line 150 destructures a dozen log arrays and each entry is guarded by `shouldFetch(...)`. Add a `pottyLogs` entry mirroring the `diaperLogs` one at line 200:

```typescript
      shouldFetch('potty') ? prisma.pottyLog.findMany({
        where: whereClause,
        include: { caretaker: true },
      }) : Promise.resolve([]),
```

Use whatever `where` and `include` shape the neighboring `diaperLog.findMany` call uses in this file. Add `pottyLogs` to the destructuring array in the matching position.

Then add a formatting block mirroring `formattedDiaperLogs` (line 408), and include the result in whatever array the formatted logs are concatenated into before sorting.

- [ ] **Step 3: Add the filter chip**

In `src/components/Timeline/TimelineFilter.tsx`, the filter array around line 51 has one entry per type. Add after the diaper entry, importing `Toilet` from `lucide-react`:

```typescript
    { type: 'potty', icon: <Toilet className="h-4 w-4" />, label: t('Potty') },
```

- [ ] **Step 4: Handle potty in the edit dispatch**

In `TimelineV2/index.tsx`, the switch at line 354 maps activity → edit type. Add a `'potty'` case mirroring `'diaper'`, using the `pottyLocation` discriminator.

Then render a `PottyForm` directly beside the existing `DiaperForm` (around line 499). Note the sibling forms narrow `activity` with an `in` check rather than a cast, so a mismatched activity yields `undefined` instead of a bad render — follow that:

```tsx
          <PottyForm
            isOpen={editModalType === 'potty'}
            onClose={() => setEditModalType(null)}
            babyId={selectedActivity.babyId}
            initialTime={getActivityTime(selectedActivity)}
            activity={'pottyLocation' in selectedActivity ? selectedActivity : undefined}
            onSuccess={handleFormSuccess}
          />
```

- [ ] **Step 5: Add potty to the activity cache**

`TimelineV2/useActivityCache.ts` line 245 passes a comma-separated activity-type list to the timeline API:

```typescript
      const activities = await fetchFromApi(babyId, startOfWindow, endOfWindow, undefined, 'sleep,feed,diaper,pump');
```

Change it to:

```typescript
      const activities = await fetchFromApi(babyId, startOfWindow, endOfWindow, undefined, 'sleep,feed,diaper,potty,pump');
```

This string is what `shouldFetch(...)` in the timeline route (Task 10, Step 2) tests against, so the two must agree — if potty entries are missing from the timeline, check this line first.

- [ ] **Step 5b: Cover ALL FIVE activity-dispatching functions in `Timeline/utils.tsx`**

> **Plan correction.** Task 7 added `potty` to `getActivityEndpoint` only. The
> checklist doc (`documentation/Implementation/add-new-activity.md`, row 15) says
> "Add to all 5 utility functions." `grep -c "potty" src/components/Timeline/utils.tsx`
> currently returns 1 — it must end up covering every dispatcher below.

The activity-dispatching exports in that file are:

| Line (approx) | Function | What to add |
|---|---|---|
| 64 | `getActivityIcon` | A potty branch returning the `Toilet` icon |
| 191 | `getActivityDetails` | Type (Pee/Poop/Both), receptacle, notes |
| 647 | `getActivityDescription` | A short human summary line |
| 1007 | `getActivityEndpoint` | ✅ already done in Task 7 — `'potty-log'` |
| 1031 | `getActivityStyle` | Colors/classes for the timeline entry |

`getActivityTime` (line 132) is generic (`'time' in activity`) and needs nothing.

For each, mirror the existing **diaper** branch and place the potty check **above** it — both carry `type`, and a `PottyLog` has no `condition`, so `'pottyLocation' in activity` must be tested first. Use `t()` for every label.

Verify with `grep -c "potty" src/components/Timeline/utils.tsx` — expect at least 5.

- [ ] **Step 5c: Add potty to the older `Timeline/index.tsx` container**

The checklist's row 21 lists `src/components/Timeline/index.tsx` alongside `TimelineV2/index.tsx`. This plan originally omitted it. Add the same filter/form/type wiring you did for TimelineV2, mirroring its diaper handling. If the file turns out to be dead or no longer rendered, say so in your report rather than editing it speculatively.

- [ ] **Step 5d: Dark-mode CSS**

Per the checklist rows 16 and 19 and the doc's "Adding Dark Mode for a New Activity" section (line 391), add potty rules mirroring diaper's in:
- `src/components/Timeline/timeline-activity-list.css`
- `src/components/Timeline/TimelineV2/TimelineV2DailyStats.css` (needed by Task 12's stat tile)

Use `html.dark` selectors. NEVER Tailwind `dark:` classes.

Also create `src/components/forms/PottyForm/potty-form.css` (checklist row 12) if `PottyForm` needs any dark-mode overrides, and import it from the component. If it genuinely needs none because it only uses already-themed primitives, say so explicitly rather than creating an empty file.

- [ ] **Step 6: Render list entries and details**

In `TimelineActivityList.tsx` and `TimelineActivityDetails.tsx`, locate the diaper branches (search for `'condition' in`) and add a potty branch **above** each, keyed on `'pottyLocation' in activity`. Ordering matters for the same reason it does everywhere else: both types carry `type`.

The details panel shows time, type, receptacle, and notes:

```tsx
  const pottyTypeLabel = (type: string) =>
    type === 'WET' ? t('Pee') : type === 'DIRTY' ? t('Poop') : t('Pee and Poop');
```

Render `pottyTypeLabel(activity.type)`, `t(activity.pottyLocation)` when present, and `activity.notes` when present. Every label goes through `t()`; the receptacle value is itself a translation key (see Task 16).

**Also check `useActivityDescription().getActivityDescription`** in `src/components/ui/activity-tile/activity-tile-utils.ts`. It has no `pottyLocation` branch, so a potty activity rendered through `ActivityTileContent` (i.e. `ActivityTile` with `isButton={false}`) falls through to a generic `{ type: 'Activity', details: 'logged' }`. That path is currently unreachable — `ActivityTileGroup` always passes `isButton={true}` — but if this task gives `ActivityTile` a non-button consumer, add a potty branch there mirroring the diaper one. Flagged in Task 7's code review.

- [ ] **Step 7: Make the diaper status bubble elimination-aware** (relocated from Task 6)

This is the step Task 6 could not do, because the status bubble is fed by `TimelineV2`, not by `baby-last-activities`. It only works once Step 2 above has put `PottyLog` rows into the timeline feed — so it must come after, not before.

In `src/components/Timeline/TimelineV2/index.tsx`, `emitLatestStatus()` (around line 48) currently derives the diaper time by filtering for `'condition' in a` (line 72) and assigning at line 76. Replace that assignment so a potty catch also resets the bubble:

```typescript
import { latestElimination } from '@/src/lib/elimination';
```

```typescript
const lastPottyEntry = activities
  .filter((a) => 'pottyLocation' in a && 'time' in a)
  .sort((a, b) => new Date((b as any).time).getTime() - new Date((a as any).time).getTime())[0];

const elimination = latestElimination(
  lastDiaper ? (lastDiaper as any).time : null,
  lastPottyEntry ? (lastPottyEntry as any).time : null
);
if (elimination) {
  status.lastDiaperTime = elimination.time;
}
```

Use the existing `latestElimination` helper — do NOT re-derive max-of-two inline. It is tested (11 cases) and handles nulls, invalid dates, and epoch-0.

The `as any` duck-typing matches this file's existing style. Note `'pottyLocation' in a` is the same discriminator used everywhere else, and it must be checked independently of `'condition' in a` — a `PottyLog` has neither `condition` nor `duration`.

**This changes only the bubble's input. It must not touch any diaper count.** `wetCount`, `dirtyCount`, and `poopCount` all stay diaper-only.

- [ ] **Step 8: Verify by hand**

Run `npm run dev`. Expected:
- Potty catches appear in the timeline with a toilet icon.
- The Potty filter chip shows only potty entries.
- Tapping an entry opens details showing the receptacle.
- Editing an entry opens `PottyForm` pre-populated, and saving persists.

- [ ] **Step 9: Commit**

```bash
git add src/components/Timeline app/api/timeline/route.ts
git commit -m "potty: Add potty entries to timeline"
```

---

## Task 11: Full log timeline

**Files:**
- Modify: `src/components/FullLogTimeline/index.tsx`
- Modify: `src/components/FullLogTimeline/full-log-timeline.types.ts`
- Modify: `src/components/FullLogTimeline/FullLogFilter.tsx`
- Modify: `src/components/FullLogTimeline/FullLogActivityDetails.tsx`

- [ ] **Step 1: Mirror the Task 10 changes**

These four files parallel the Timeline ones. Find each diaper site and add the potty equivalent beside it:

```bash
grep -n "diaper" src/components/FullLogTimeline/index.tsx src/components/FullLogTimeline/full-log-timeline.types.ts src/components/FullLogTimeline/FullLogFilter.tsx src/components/FullLogTimeline/FullLogActivityDetails.tsx
```

Per file:
- `full-log-timeline.types.ts` — add `'potty'` to the filter/activity type unions.
- `FullLogFilter.tsx` — add the chip, importing `Toilet` from `lucide-react`, mirroring the diaper chip's shape in this file.
- `index.tsx` — include potty logs in the fetch/merge and in whatever activity-type string is sent to the API (the same `shouldFetch` contract as Task 10, Step 2).
- `FullLogActivityDetails.tsx` — add a `'pottyLocation' in activity` branch **above** the `'condition' in activity` branch, reusing the `pottyTypeLabel` helper shape from Task 10, Step 6.

- [ ] **Step 2: Verify by hand**

Run `npm run dev`, open the full log view. Expected: potty entries appear, the filter works, and details render the receptacle.

- [ ] **Step 3: Commit**

```bash
git add src/components/FullLogTimeline
git commit -m "potty: Add potty entries to full log timeline"
```

---

## Task 12: Daily stats count (TDD)

**Files:**
- Modify: `src/components/Timeline/TimelineV2/computeDayStats.ts`
- Modify: `scripts/verify-compute-day-stats.ts`
- Modify: `src/components/DailyStats/index.tsx`
- Modify: `src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx`

`computeDayStats` is pure and already has an assertion script — extend that rather than adding a new harness.

- [ ] **Step 1: Add failing assertions**

In `scripts/verify-compute-day-stats.ts`, following the existing `check(...)` style in that file, add a case with two potty catches and one wet diaper on the same day:

```typescript
const pottyDay = computeDayStats([
  { id: 'd1', time: at(9), type: 'WET', condition: null, color: null } as any,
  { id: 'p1', time: at(11), type: 'WET', pottyLocation: 'Potty Chair', notes: null } as any,
  { id: 'p2', time: at(14), type: 'DIRTY', pottyLocation: 'Toilet', notes: null } as any,
], day, opts);

check('potty count', pottyDay.pottyCount, 2);
check('potty does not inflate wet diapers', pottyDay.wetCount, 1);
check('potty does not inflate poop count', pottyDay.poopCount, 0);
```

Match the exact activity-object shape the surrounding assertions in that file already use — they may wrap records differently.

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx scripts/verify-compute-day-stats.ts
```

Expected: FAIL — `pottyCount` is `undefined`.

- [ ] **Step 3: Implement the count**

In `computeDayStats.ts`, add to the `DayStats` interface beside `poopCount`:

```typescript
  pottyCount: number;
```

Initialize it to `0` with the other counters, then add a counting branch alongside the diaper block at line 205. Discriminate on `pottyLocation`, and make sure the potty branch is checked **before** the diaper branch — a `PottyLog` has `type` just like a `DiaperLog`, so a `'type' in activity` test would otherwise swallow it:

```typescript
    // Potty activities — checked before diapers, since both carry `type`.
    else if ('pottyLocation' in activity) {
      pottyCount++;
    }
```

Return `pottyCount` in the result object.

- [ ] **Step 4: Run to verify it passes**

```bash
npx tsx scripts/verify-compute-day-stats.ts
```

Expected: PASS, no failures.

- [ ] **Step 5: Display the count**

In `src/components/DailyStats/index.tsx`, the stat rows are built around lines 491–492 and 564–573, conditional on the value not being `'0'`. Add a Potty row after Poops, importing `Toilet` from `lucide-react`:

```typescript
              ...(pottyCount !== '0' ? [{ icon: <Toilet className="h-3 w-3 text-fuchsia-600" />, label: "Potty", value: pottyCount }] : []),
```

Add the matching entry in the expanded section (around line 573) following the pattern of the adjacent Diapers/Poops blocks, and compute `pottyCount` alongside `diaperCount` in the counting loop around line 268 using the same `'pottyLocation' in activity` discriminator.

Do the same in `TimelineV2/TimelineV2DailyStats.tsx`, which reads `DayStats` directly and therefore just needs a display row for `pottyCount`.

- [ ] **Step 6: Verify by hand**

Run `npm run dev`. Log a potty catch. Expected: "Potty: 1" appears in the daily summary, and the Diapers count is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/components/Timeline/TimelineV2/computeDayStats.ts scripts/verify-compute-day-stats.ts src/components/DailyStats/index.tsx src/components/Timeline/TimelineV2/TimelineV2DailyStats.tsx
git commit -m "potty: Add potty count to daily stats"
```

---

## Task 13: Nursery Mode — logging sheet

**Files:**
- Modify: `src/components/NurseryMode/index.tsx`
- Modify: `src/components/NurseryMode/NurseryMode.css`

Nursery Mode is a self-contained kiosk view with its own conventions: `nk-` CSS classes in plain CSS (no CVA, no `ui/` primitives), one-tap commits, and toasts whose Undo DELETEs the created record. Match those, not the main app's.

Receptacle is picked per log rather than defaulted, because this "kiosk" is often a phone that moves room to room.

- [ ] **Step 1: Add state and the snapshot type**

Beside the existing `DiaperSnap` interface (line 29):

```typescript
interface PottySnap {
  id: string;
  time: number;
  type: 'WET' | 'DIRTY' | 'BOTH';
  pottyLocation: string | null;
}
```

Add to the component's state, beside `lastDiaper`:

```typescript
  const [lastPotty, setLastPotty] = useState<PottySnap | null>(null);

  // potty sheet
  const [pottyOpen, setPottyOpen] = useState(false);
  const [pottyType, setPottyType] = useState<'WET' | 'DIRTY' | 'BOTH'>('WET');
  const [pottyLocation, setPottyLocation] = useState<string>(POTTY_LOCATIONS[0]);
  const [pottyHidden, setPottyHidden] = useState<string[]>([]);
```

Import the shared constant at the top:

```typescript
import { POTTY_LOCATIONS } from '@/src/constants/potty-locations';
```

- [ ] **Step 2: Fetch potty logs in `refreshStatus`**

In `refreshStatus` (line 240), add a fifth request to the `Promise.all` and destructure it:

```typescript
      const [feeds, diapers, sleeps, pumps, potties] = await Promise.all([
        api<any[]>(`/api/feed-log?babyId=${selectedBaby.id}`),
        api<any[]>(`/api/diaper-log?babyId=${selectedBaby.id}`),
        api<any[]>(`/api/sleep-log?babyId=${selectedBaby.id}`),
        api<any[]>(`/api/pump-log?babyId=${selectedBaby.id}`),
        api<any[]>(`/api/potty-log?babyId=${selectedBaby.id}`),
      ]);
```

Then, beside the `setLastDiaper` call (line 265):

```typescript
      const pt = potties?.[0];
      setLastPotty(pt ? {
        id: pt.id,
        time: new Date(pt.time).getTime(),
        type: pt.type,
        pottyLocation: pt.pottyLocation ?? null,
      } : null);
```

- [ ] **Step 3: Load hidden receptacles and the sticky location**

Add an effect beside the Hue config loader (line 309). The last-used receptacle is remembered per device so consecutive catches in one bathroom do not require re-picking — it is a pre-selection, not a hidden default, and the chips remain visible.

```typescript
  useEffect(() => {
    if (!authChecked) return;
    api<{ hiddenLocations: string[] }>('/api/potty-location-settings')
      .then((cfg) => setPottyHidden(cfg?.hiddenLocations ?? []))
      .catch(() => setPottyHidden([]));
    const remembered = localStorage.getItem('nkPottyLocation');
    if (remembered && (POTTY_LOCATIONS as readonly string[]).includes(remembered)) {
      setPottyLocation(remembered);
    }
  }, [authChecked]);
```

- [ ] **Step 4: Add the commit function**

Beside `commitDiaper` (line 364), mirroring its structure exactly:

```typescript
  const commitPotty = useCallback(async (type: 'WET' | 'DIRTY' | 'BOTH', location: string, label: string) => {
    if (!selectedBaby?.id) return;
    try {
      const data = await api<any>('/api/potty-log', {
        method: 'POST',
        body: JSON.stringify({
          babyId: selectedBaby.id,
          time: new Date().toISOString(),
          type,
          pottyLocation: location,
        }),
      });
      setLastPotty({
        id: data.id,
        time: new Date(data.time).getTime(),
        type: data.type,
        pottyLocation: data.pottyLocation ?? null,
      });
      localStorage.setItem('nkPottyLocation', location);
      let toastId = 0;
      toastId = pushToast(label, 'ok', {
        ms: 5000, undoable: true,
        onUndo: async () => {
          removeToast(toastId);
          try {
            await api(`/api/potty-log?id=${data.id}`, { method: 'DELETE' });
            pushToast(t('undone'), 'ok', { ms: 1500 });
            await refreshStatus();
          } catch (e: any) {
            pushToast(e.message || t('undo failed'), 'err', { ms: 4000 });
          }
        },
      });
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 5000 });
    }
  }, [selectedBaby?.id, pushToast, removeToast, refreshStatus, t]);
```

- [ ] **Step 5: Add the button**

Directly below the existing diaper `nk-grid` block (line 823). Full width specifically so it cannot be mistaken for one of the three diaper buttons on a screen nobody is looking at closely:

```tsx
      <div className="nk-grid one">
        <button type="button" className="nk-btn" onClick={() => setPottyOpen(true)}>
          {t('Potty')}…
        </button>
      </div>
```

Add the single-column grid to `NurseryMode.css`, beside the existing `.nk-grid.two` rule (line 55):

```css
.nursery-kiosk .nk-grid.one { grid-template-columns: 1fr; }
```

- [ ] **Step 6: Add the sheet**

Beside the bottle modal (line 882), reusing its `nk-sheet` / `nk-chip` structure:

```tsx
      {pottyOpen && (
        <div className="nk-modal">
          <div className="nk-sheet">
            <h3>{t('Potty')}</h3>
            <div className="nk-field">
              <label>{t('Type')}</label>
              <div className="nk-row">
                {([['WET', 'Pee'], ['DIRTY', 'Poop'], ['BOTH', 'Both']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={'nk-chip' + (pottyType === value ? ' on' : '')}
                    onClick={() => setPottyType(value)}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>
            <div className="nk-field">
              <label>{t('Where')}</label>
              <div className="nk-types">
                {POTTY_LOCATIONS.filter(loc => !pottyHidden.includes(loc)).map(loc => (
                  <button
                    key={loc}
                    type="button"
                    className={'nk-chip' + (pottyLocation === loc ? ' on' : '')}
                    onClick={() => setPottyLocation(loc)}
                  >
                    {t(loc)}
                  </button>
                ))}
              </div>
            </div>
            <div className="nk-modal-actions">
              <button type="button" onClick={() => setPottyOpen(false)}>{t('Cancel')}</button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setPottyOpen(false);
                  const typeLabel = pottyType === 'WET' ? t('Pee') : pottyType === 'DIRTY' ? t('Poop') : t('Both');
                  void commitPotty(pottyType, pottyLocation, `${t('Potty')} · ${typeLabel} · ${t(pottyLocation)}`);
                }}
              >
                {t('Log Potty')}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 7: Include the sheet in the Esc handler**

The effect at line 585 closes open modals on Escape. Extend its guard and body to cover `pottyOpen`:

```typescript
    if (!bottleOpen && !editKind && !pottyOpen) return;
```

and add `else if (pottyOpen) setPottyOpen(false);` to the key handler, with `pottyOpen` in the dependency array.

- [ ] **Step 8: Verify by hand**

Open `/<slug>/nursery-mode`. Expected:
- A full-width "Potty…" button below the diaper row.
- Tapping opens a sheet with type and receptacle chips; hidden receptacles are absent.
- Logging shows a toast; Undo removes the record.
- Reopening the sheet pre-selects the receptacle used last.
- Escape closes the sheet.

- [ ] **Step 9: Commit**

```bash
git add src/components/NurseryMode
git commit -m "potty: Add potty logging to nursery mode"
```

---

## Task 14: Nursery Mode — elimination badge and edit sheet

**Files:**
- Modify: `src/components/NurseryMode/index.tsx`

- [ ] **Step 1: Make the badge elimination-aware**

The badge row (line 786) currently renders a diaper badge from `lastDiaper`. Replace that badge so it shows whichever elimination came last, matching the timer behavior. Import the shared helper rather than re-deriving the rule:

```typescript
import { latestElimination } from '@/src/lib/elimination';
```

```tsx
        {(() => {
          const latest = latestElimination(lastDiaper?.time ?? null, lastPotty?.time ?? null);
          if (!latest) return null;
          return (
            <button
              type="button"
              className="nk-badge"
              onClick={() => openEdit(latest.source)}
            >
              {latest.source === 'potty' ? t('potty') : t('diaper')} {fmtAgo(latest.time.getTime())}
            </button>
          );
        })()}
```

- [ ] **Step 2: Extend the edit modal state**

Widen the `editKind` union (line 153) and add potty edit state:

```typescript
  const [editKind, setEditKind] = useState<null | 'feed' | 'diaper' | 'potty'>(null);
  const [editPottyType, setEditPottyType] = useState<'WET' | 'DIRTY' | 'BOTH'>('WET');
  const [editPottyLocation, setEditPottyLocation] = useState<string>(POTTY_LOCATIONS[0]);
```

- [ ] **Step 3: Handle potty in `openEdit`, `saveEdit`, and `deleteEdit`**

In `openEdit` (line 626), add a branch mirroring the diaper one:

```typescript
    } else if (kind === 'potty' && lastPotty) {
      setEditPottyType(lastPotty.type);
      setEditPottyLocation(lastPotty.pottyLocation || POTTY_LOCATIONS[0]);
      setEditTime(fmtHM(lastPotty.time));
      setEditKind('potty');
    }
```

Widen its parameter type to `'feed' | 'diaper' | 'potty'`.

In `saveEdit` (line 643), add:

```typescript
      } else if (editKind === 'potty' && lastPotty) {
        const body = { time: hmToIso(editTime), type: editPottyType, pottyLocation: editPottyLocation };
        await api(`/api/potty-log?id=${lastPotty.id}`, { method: 'PUT', body: JSON.stringify(body) });
        pushToast(t('Saved'), 'ok', { ms: 2000 });
      }
```

In `deleteEdit` (line 676), add a branch mirroring the diaper one exactly — snapshot the full record with a GET, DELETE it, then offer an Undo that re-POSTs the cleaned body:

```typescript
      } else if (editKind === 'potty' && lastPotty) {
        const full = await api<any>(`/api/potty-log?id=${lastPotty.id}`);
        const body = cleanForRePost(full);
        await api(`/api/potty-log?id=${lastPotty.id}`, { method: 'DELETE' });
        setLastPotty(null);
        closeEdit();
        let toastId = 0;
        toastId = pushToast(t('Deleted'), 'ok', {
          ms: 5000, undoable: true,
          onUndo: async () => {
            removeToast(toastId);
            try {
              await api('/api/potty-log', { method: 'POST', body: JSON.stringify(body) });
              pushToast(t('undone'), 'ok', { ms: 1500 });
              await refreshStatus();
            } catch (e: any) {
              pushToast(e.message || t('undo failed'), 'err', { ms: 4000 });
            }
          },
        });
      }
```

- [ ] **Step 4: Render the edit sheet**

Beside the diaper edit sheet (line 975):

```tsx
      {editKind === 'potty' && lastPotty && (
        <div className="nk-modal">
          <div className="nk-sheet">
            <h3>{t('Edit potty')}</h3>
            <div className="nk-field">
              <label>{t('Time')}</label>
              <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
            </div>
            <div className="nk-field">
              <label>{t('Type')}</label>
              <div className="nk-row">
                {([['WET', 'Pee'], ['DIRTY', 'Poop'], ['BOTH', 'Both']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={'nk-chip' + (editPottyType === value ? ' on' : '')}
                    onClick={() => setEditPottyType(value)}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>
            <div className="nk-field">
              <label>{t('Where')}</label>
              <div className="nk-types">
                {POTTY_LOCATIONS.filter(loc => !pottyHidden.includes(loc) || editPottyLocation === loc).map(loc => (
                  <button
                    key={loc}
                    type="button"
                    className={'nk-chip' + (editPottyLocation === loc ? ' on' : '')}
                    onClick={() => setEditPottyLocation(loc)}
                  >
                    {t(loc)}
                  </button>
                ))}
              </div>
            </div>
            <div className="nk-modal-actions three">
              <button type="button" onClick={closeEdit}>{t('Cancel')}</button>
              <button type="button" className="danger" onClick={deleteEdit}>{t('Delete')}</button>
              <button type="button" className="primary" onClick={saveEdit}>{t('Save')}</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Verify by hand**

Open `/<slug>/nursery-mode`. Expected:
- After a potty catch, the badge reads "potty Xm ago".
- After a later diaper change, it flips to "diaper Xm ago".
- Tapping the badge opens the edit sheet for the correct record type.
- Editing time/type/receptacle saves; Delete offers a working Undo.

- [ ] **Step 6: Commit**

```bash
git add src/components/NurseryMode/index.tsx
git commit -m "potty: Make nursery mode badge elimination-aware"
```

---

## Task 15: Export, backup, and hooks plumbing

**Files:**
- Modify: `app/api/utils/db-backup.ts`
- Modify: `app/api/utils/csv-export.ts`
- Modify: `app/api/accounts/download-data/route.ts`
- Modify: `app/api/timeline/export/route.ts`
- Modify: `app/api/babies/[babyId]/report/[yearMonth]/route.ts`
- Modify: `app/api/hooks/v1/babies/[babyId]/activities/route.ts`
- Modify: `app/api/hooks/v1/babies/[babyId]/status/route.ts`

Without this task, potty data silently escapes backups and exports. It is not optional.

- [ ] **Step 1: Find every diaper reference**

```bash
grep -n "diaperLog\|DiaperLog\|'diaper'" app/api/utils/db-backup.ts app/api/utils/csv-export.ts app/api/accounts/download-data/route.ts app/api/timeline/export/route.ts "app/api/babies/[babyId]/report/[yearMonth]/route.ts" "app/api/hooks/v1/babies/[babyId]/activities/route.ts" "app/api/hooks/v1/babies/[babyId]/status/route.ts"
```

- [ ] **Step 2: Add the potty parallel at each site**

For each match, add the `pottyLog` equivalent immediately alongside. Specifically:
- **`db-backup.ts`** — include `pottyLog` in the model list that gets dumped and restored. Restore order matters if the code respects FK dependencies; `PottyLog` depends on `Baby`, `Caretaker`, and `Family`, exactly like `DiaperLog`, so place it beside `diaperLog`.
- **`csv-export.ts`** and **`timeline/export/route.ts`** — add a potty row type with columns for time, type, receptacle, and notes.
- **`download-data/route.ts`** — add `pottyLog` to the tables included in the user's data download.
- **`report/[yearMonth]/route.ts`** — fetch and include potty logs in the monthly payload.
- **`hooks/.../activities/route.ts`** — include potty logs in the activity feed.
- **`hooks/.../status/route.ts`** — include last potty time. If this endpoint reports a diaper timer, feed it through `latestElimination` from `src/lib/elimination.ts` so the hooks API and the UI agree.

- [ ] **Step 3: Verify the backup round-trips**

Trigger a backup and confirm potty rows are present in the output:

```bash
grep -c -i "pottylog" <path-to-generated-backup-file>
```

Expected: at least 1.

- [ ] **Step 4: Verify the export**

Download a CSV export from the UI with at least one potty catch logged. Expected: the potty row appears with its receptacle.

- [ ] **Step 5: Commit**

```bash
git add app/api/utils app/api/accounts app/api/timeline app/api/babies app/api/hooks
git commit -m "potty: Include potty logs in exports, backups, and hooks API"
```

---

## Task 16: Localization

**Files:**
- Modify: `src/localization/translations/en.json`

> **Note:** the push-notification key `notification.activityType.potty` is NOT in the
> list below and is handled in Task 3 instead. The `notification.*` keys are a
> separate namespaced block in `en.json`, not plain-English UI keys, and
> `src/lib/notifications/i18n.ts` falls back to rendering the raw key when one is
> missing — so omitting it produces a push title reading literally
> "notification.activityType.potty logged for <baby>". Found in code review of Task 3.

- [ ] **Step 1: Add the English keys**

Keys are the English text verbatim. Add only to `en.json` — the script propagates the rest. New strings introduced across this plan:

```json
  "Potty": "Potty",
  "Log Potty": "Log Potty",
  "Edit Potty": "Edit Potty",
  "Edit potty": "Edit potty",
  "potty": "potty",
  "Celebrate a potty win": "Celebrate a potty win",
  "Update details about this potty visit": "Update details about this potty visit",
  "Select potty time...": "Select potty time...",
  "Failed to save potty log": "Failed to save potty log",
  "Pee": "Pee",
  "Poop": "Poop",
  "Pee and Poop": "Pee and Poop",
  "Where": "Where",
  "Select location": "Select location",
  "Optional notes": "Optional notes",
  "Potty Chair": "Potty Chair",
  "Toilet": "Toilet",
  "Sink": "Sink",
  "Tub": "Tub",
  "Outside": "Outside",
```

**Already present — do not re-add** (verified in `en.json`; a duplicate key is a JSON error): `Both`, `Notes`, `Other`, `Manage visible locations`, `Toggle locations to show or hide them`. Also check `Time`, `Type`, `Cancel`, `Save`, `Update`, `Delete`, and `Select type` before adding — they are near-certain to exist from other forms.

Confirm before editing:

```bash
grep -n '"Toilet"\|"Outside"\|"Where"\|"Potty"' src/localization/translations/en.json
```

Expected: no matches — these are the genuinely new ones.

- [ ] **Step 2: Propagate to the other languages**

```bash
node scripts/check-missing-translations.js
```

Expected: keys added to all eight non-English locales and every file re-sorted. Note there are **nine** translation files — `de`, `en`, `es`, `fr`, `it`, `nl`, `pt-br`, `pt-pt`, `ro`. `CLAUDE.md` documents only five (en/es/fr/de/it) and is out of date; trust `ls src/localization/translations/` over the doc.

- [ ] **Step 3: Verify no hardcoded strings remain**

```bash
grep -rn "Potty\|Pee\|Poop" --include="*.tsx" src/components/forms/PottyForm src/components/NurseryMode src/components/ActivityTileGroup | grep -v "t('" | grep -v "t(\"" | grep -v "^.*//"
```

Expected: no user-facing string literals outside a `t()` call. Matches inside type unions, `POTTY_LOCATIONS` imports, or comments are fine.

- [ ] **Step 4: Commit**

```bash
git add src/localization/translations
git commit -m "potty: Add potty translation keys"
```

---

## Task 17: Full verification

- [ ] **Step 1: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean (0 errors).

> **`npm run lint` does not work in this repo — do not use it as a gate.** The script is
> `next lint`, but the project is on Next.js 16, which removed that subcommand and now
> reads `lint` as a directory argument, failing with
> `Invalid project directory provided, no such directory: <repo>/lint`. There is also no
> `.eslintrc*` or `eslint.config.*` anywhere in the repo, so there is nothing to run
> standalone. This is pre-existing and unrelated to potty tracking. `tsc --noEmit` plus
> `next build` in Step 3 are the real gates. Fixing the lint setup is separate cleanup.

- [ ] **Step 2: Run every test**

```bash
npx tsx --test src/lib/elimination.test.ts
npx tsx scripts/verify-compute-day-stats.ts
npx tsx --test src/components/DayNightFlip/engine.test.ts
npx tsx --test src/components/DayNightFlip/facts.test.ts
npx tsx --test src/components/DayNightFlip/schedule.test.ts
```

Expected: all pass. The DayNightFlip tests are regression checks — they consume diaper facts, and this work must not have disturbed them.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Walk the feature end to end**

With `npm run dev` running, confirm each:
- Log a potty catch from the log-entry tile. It saves.
- The diaper status bubble resets; the daily Diapers count does **not** increase.
- The daily summary shows "Potty: 1".
- The entry appears in Timeline and Full Log, filters correctly, and opens for editing.
- Log a catch from Nursery Mode. The badge reads "potty Xm ago". Undo works.
- A CSV export contains the potty rows.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "potty: Fix issues found in end-to-end verification"
```

---

## Notes for the implementer

**Line numbers drift.** Every line reference above was accurate when the plan was written. Locate the code by its surrounding content, not by jumping to a line.

**Two known dead-code items, deliberately out of scope.** `src/components/modals/DiaperModal.tsx` is imported by nothing (the `showDiaperModal` state in `log-entry/page.tsx` actually drives `DiaperForm`), and `Settings.nurseryModeSettings` is never read or written. Both should be deleted, but as separate cleanup — do not bundle it here.

**The one rule that matters most.** A potty catch must never increment a diaper count. If you find yourself editing a diaper aggregation, stop and check whether you should be adding a potty branch beside it instead.
