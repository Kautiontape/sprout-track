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
