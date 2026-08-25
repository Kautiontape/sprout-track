# Frozen Breast Milk Bag Inventory

Date: 2026-08-24
Status: Approved, ready for implementation planning
Scope: ktn fork

## Problem

The app tracks pumping sessions in detail and freezer stock only as a side effect.
The user does not care about pumping sessions and intends to hide the Pump tile.
What matters is the freezer inventory, counted in **bags** rather than ounces,
because bags are the unit you actually reach for.

## What already exists

An ounce-based breast milk inventory ships upstream, bolted onto Pump:

- `Settings.enableBreastMilkTracking` (default `true`), toggled in `ConfigTab`
- `PumpLog.pumpAction = 'STORED'` adds ounces
- `BreastMilkAdjustment` is a manual +/- ounce ledger with reasons
  (`Initial Stock`, `Expired`, `Spilled`, `Donated`, `Other`)
- Bottle feeds with `bottleType` of `Breast Milk`, plus the `breastMilkAmount`
  portion of `Formula/Breast`, subtract ounces
- `GET /api/breast-milk-balance` sums the three into one number, surfaced only
  inside `PumpingStatsSection`

That system is invisible once Pump is hidden, and it has no concept of a bag.

## Decisions

1. **Bags are their own ledger.** A new `BreastMilkBagLog` model is the source of
   truth for the freezer. The existing pump-driven balance is left untouched and
   simply not shown. Two systems computing overlapping numbers would drift.
2. **One signed form.** A direction toggle produces `+N` or `-N` bags. No
   separate freeze and thaw record types.
3. **Runway is measured against consumption**, from existing bottle feeds, not
   against freezer drawdown. Drawdown is lumpy; demand is the useful denominator.
4. **Gate on the existing `enableBreastMilkTracking` setting.** The semantics
   already match. No new settings column.

## Data model

```prisma
model BreastMilkBagLog {
  id           String    @id @default(uuid())
  time         DateTime
  bagCount     Int       // signed: +N frozen, -N removed
  amountPerBag Float     // volume of ONE bag, in unitAbbr; always positive
  unitAbbr     String?   // "OZ" | "ML"
  reason       String?   // removals: Fed | Discarded | Donated | Other
                         // additions: Initial Stock | null
  notes        String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?

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

`bagCount` and `amountPerBag` are stored separately rather than as one total.
The recorded fact is "3 bags of 4 oz", so the daily line can restate it exactly
and total volume is always derived. A stored total would make the bag count
unrecoverable.

`familyId` is nullable to match every other model in the schema: Postgres deploys
run `prisma db push`, which cannot add a required column to a populated table.

The migration must be valid on both SQLite and Postgres.

## API

### `app/api/breast-milk-bag-log/route.ts`

GET / POST / PUT / DELETE, structured as a near-copy of `app/api/potty-log/route.ts`:

- `withAuthContext` on every method
- `checkWritePermission(authContext)` first on every mutating method
- Create: verify the baby belongs to `authContext.familyId`, then set
  `familyId: userFamilyId` explicitly
- Read / update / delete by id: fetch first, verify `familyId` matches, return
  404 on mismatch
- List: `where: { familyId: userFamilyId }`
- `toUTC` on input times, `formatForResponse` on output
- Soft delete via `deletedAt`

No notification hook. Freezing a bag is not time-sensitive and does not reset a
timer.

### `app/api/breast-milk-bag-balance/route.ts`

`GET ?babyId=&unit=` returns `{ bags, amount, unit, lastAmountPerBag }`.

Deliberately separate from `breast-milk-balance`, which sums a different ledger.

### Data-portability registrations

The new model must be added to:

- `app/api/utils/db-backup.ts`
- `app/api/accounts/download-data/route.ts`
- `app/api/utils/csv-export.ts`
- `app/api/timeline/export/route.ts`
- `app/api/timeline/route.ts`
- `app/api/types.ts` (`BreastMilkBagLogCreate`, `BreastMilkBagLogResponse`)

Omitting any of these means the freezer silently disappears from backups.

## Testable core: `src/utils/breastMilkBags.ts`

All arithmetic lives in pure functions so it is testable without a database or a
React renderer.

| Function | Returns |
| --- | --- |
| `calculateBagBalance(rows, targetUnit)` | `{ bags, amount }`; sums signed counts, normalizes mixed units via `convertVolume` |
| `sumBagsForDay(rows)` | `{ frozenBags, frozenAmount, removedBags, removedAmount }` |
| `lastAmountPerBag(rows)` | most recent positive row's `amountPerBag`, else `null` |
| `averageBreastMilkPerDay(feedRows, daysInRange, targetUnit)` | average volume/day consumed, from `Breast Milk` feeds plus the `breastMilkAmount` portion of `Formula/Breast` |
| `projectDaysOfSupply(amountInFreezer, avgPerDay)` | `number \| null`; `null` when `avgPerDay <= 0` |

`lastAmountPerBag` derives the remembered default from history rather than storing
it in settings, so editing or deleting a log corrects the default automatically.

### Test plan — `tests/breastMilkBags.test.ts`

Written before the implementation:

- Empty ledger returns zero bags and zero volume
- Mixed OZ and ML rows normalize to the target unit
- Net-negative balance is reported as negative, not clamped
- `projectDaysOfSupply` returns `null` at zero consumption
- `lastAmountPerBag` ignores removal rows and soft-deleted rows
- `sumBagsForDay` separates frozen from removed
- Single-day range does not divide by zero

`tests/activityTileOrder.test.ts` gains cases proving an existing family gains the
`milkbag` tile without losing a custom order.

### Validation and edge cases

- `amountPerBag` must be greater than 0
- `bagCount` must be a non-zero integer
- A net-negative bag count displays as-is. Clamping to zero would hide unlogged
  stock; the correction is an `Initial Stock` entry.
- Removing more bags than are in stock is allowed, not blocked.

## UI

### Tile

New activity type `'milkbag'`, added to `DEFAULT_ACTIVITY_TILE_ORDER` immediately
after `'food'`.

Not after `'pump'`: `placeTileAfter` falls back to the end of the list when its
anchor is hidden, and the Pump tile is being disabled. Anchoring there would bury
the tile at the bottom for exactly the user who wants it most.

Requires:

- `placeMilkBagTile()` beside `placeFoodTile` / `placePottyTile`, wired into
  `mergeMissingActivityTiles`
- `'milkbag'` added to `ActivityTileVariant` and `getActivityVariant`
- `'bagCount' in activity` as the discriminator in `activity-tile-utils.ts`

Icon: the lucide `Milk` icon. Every other tile uses illustrated PNG art and there
is no milk PNG in `public/`. The styles map supports both, so dropping in a
`milk-128.png` later is a one-line change.

### Form: `src/components/forms/BreastMilkBagForm/`

Files: `index.tsx`, `breast-milk-bag-form.css`, `breast-milk-bag-form.types.ts`,
`README.md` — following `PottyForm`.

Fields:

- Direction toggle: Froze / Used
- Bag count stepper, defaulting to 1
- Amount per bag, prefilled from `lastAmountPerBag`, editable, unit symbol from
  `useUnit`
- Live derived total: `3 bags x 4 oz = 12 oz`
- Reason select, shown on removals only
- Notes, date, time

Dark mode via `html.dark` selectors in the `.css` file, never Tailwind `dark:`
classes. Light mode via CVA in the styles file.

### Timeline

`'bagCount' in activity` is unique across every model, so it is a clean
discriminator. It must be checked **before** the pump and breast-milk-adjustment
branches, which already collide on `reason` and `amount`.

Touches `src/components/Timeline/types.ts`, `utils.tsx` (icon, label, detail rows,
export row, color), `TimelineFilter.tsx`, `TimelineActivityList.tsx`,
`TimelineV2/TimelineV2ActivityList.tsx`, `TimelineV2/computeDayStats.ts`, and the
`onEdit` union in `types.ts`.

Rows are editable and deletable like any other activity. That is what makes the
ledger correctable.

### DailyStats

Two stat items, rendered only when non-zero:

> **Froze** 3 bags (12 oz)   **Used** 2 bags (8 oz)

### Reports: `BreastMilkStashSection` in `StatsTab`

**Card 1 — In the freezer.** Headline `42 bags`, sub `168 oz`, subline
`~11 days of supply at 15 oz/day`.

This card is deliberately not scoped to the report date range. The freezer is a
current-state number. The selected range affects only the rate in the subline.

**Card 2 — Average breast milk / day.** `15 oz/day consumed` over the selected
range, with average frozen/day beside it, so net gain or loss of stock is visible.

With no breast-milk feeds in the range, the runway renders `—`.

### Gating

Everything — tile, timeline rows, daily line, both cards — is gated on
`enableBreastMilkTracking`, the existing setting, which defaults to on.

## Localization

New strings are added to `src/localization/translations/en.json` only, then
`node scripts/check-missing-translations.js` propagates and sorts across all
locale files, then non-English files are translated as well as possible.

No user-facing string is hardcoded.

## Out of scope

- Per-bag freeze dates, FIFO removal, or oldest-bag age tracking
- Automatic freezer decrement from bottle feeds
- Migrating existing `BreastMilkAdjustment` or `PumpLog` `STORED` rows into the
  bag ledger
- Any change to the Pump feature itself; the user hides it via existing tile
  visibility settings
