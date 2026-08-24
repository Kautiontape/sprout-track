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

  it('converts a ML bottle to the target unit before averaging', () => {
    const result = averageBreastMilkPerDay(
      [{ amount: 100, unitAbbr: 'ML', bottleType: 'Breast Milk', breastMilkAmount: null }],
      1,
      'OZ'
    );
    expect(result).toBeCloseTo(3.38, 1);
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
