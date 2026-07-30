// src/components/Reports/potty-stats.utils.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePottyStats } from './potty-stats.utils';

// ---------------------------------------------------------------------------
// Timezone injectors (purity: the module must take ALL timezone knowledge
// through the injected toLocalParts function — never Date.getHours()/getDate()
// on its own, never useTimezone()). Two flavors below prove the module has no
// hardcoded assumption: everything is deterministic given the same injector,
// and different injectors on the same raw activities produce different
// bucketing (see the "purity" test near the bottom).
// ---------------------------------------------------------------------------

function toLocalPartsUTC(iso: string): { dayKey: string; hour: number } {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { dayKey: `${y}-${m}-${day}`, hour: d.getUTCHours() };
}

function toLocalPartsOffset(hoursOffset: number) {
  return (iso: string): { dayKey: string; hour: number } => {
    const shifted = new Date(new Date(iso).getTime() + hoursOffset * 60 * 60 * 1000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shifted.getUTCDate()).padStart(2, '0');
    return { dayKey: `${y}-${m}-${day}`, hour: shifted.getUTCHours() };
  };
}

// ---------------------------------------------------------------------------
// Minimal duck-typed row builders — only the fields the module's discriminators
// and computations touch, per elimination.test.ts / facts.test.ts convention.
// ---------------------------------------------------------------------------

function potty(
  time: string,
  type: 'WET' | 'DIRTY' | 'BOTH',
  opts: { deletedAt?: string | null; pottyLocation?: string | null } = {}
) {
  return {
    time,
    type,
    pottyLocation: opts.pottyLocation ?? 'Potty Chair',
    deletedAt: opts.deletedAt ?? null,
  };
}

function diaper(
  time: string,
  type: 'WET' | 'DIRTY' | 'BOTH',
  opts: { deletedAt?: string | null } = {}
) {
  return {
    time,
    type,
    condition: null as string | null,
    deletedAt: opts.deletedAt ?? null,
  };
}

function sleep(
  startTime: string,
  endTime: string | null,
  type: 'NAP' | 'NIGHT_SLEEP',
  opts: { deletedAt?: string | null } = {}
) {
  return {
    startTime,
    endTime,
    duration: null as number | null,
    type,
    deletedAt: opts.deletedAt ?? null,
  };
}

function range(from: string, to: string) {
  return { from: new Date(from), to: new Date(to) };
}

function nCatches(n: number, baseIso = '2026-07-15T00:00:00Z') {
  const base = new Date(baseIso).getTime();
  return Array.from({ length: n }, (_, i) => potty(new Date(base + i * 60000).toISOString(), 'WET'));
}

// Wednesday, single day.
const DAY = range('2026-07-15T00:00:00Z', '2026-07-15T23:59:59Z');
// Monday 2026-07-06 through Sunday 2026-07-12 (verified via `date -d`).
const WEEK = range('2026-07-06T00:00:00Z', '2026-07-12T23:59:59Z');

// ---------------------------------------------------------------------------
// Rule: BOTH counts in both splits; totalCatches counts rows.
// ---------------------------------------------------------------------------

test('a single BOTH catch counts once as a catch but in both the pee and poop splits', () => {
  const stats = computePottyStats([potty('2026-07-15T09:00:00Z', 'BOTH')], DAY, toLocalPartsUTC);
  assert.equal(stats.totalCatches, 1);
  assert.equal(stats.peesCaught, 1);
  assert.equal(stats.poopsCaught, 1);
});

test('cards count catches (rows) while the pee/poop split counts eliminations', () => {
  const activities = [
    potty('2026-07-15T08:00:00Z', 'WET'),
    potty('2026-07-15T12:00:00Z', 'BOTH'),
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.totalCatches, 2); // rows
  assert.equal(stats.peesCaught, 2); // WET + BOTH
  assert.equal(stats.poopsCaught, 1); // BOTH only
});

// ---------------------------------------------------------------------------
// Daily series / averages
// ---------------------------------------------------------------------------

test('avgCatchesPerDay is rounded to one decimal over daysInRange', () => {
  const activities = [
    potty('2026-07-06T09:00:00Z', 'WET'),
    potty('2026-07-07T09:00:00Z', 'WET'),
    potty('2026-07-08T09:00:00Z', 'WET'),
    potty('2026-07-09T09:00:00Z', 'WET'),
    potty('2026-07-10T09:00:00Z', 'WET'),
  ];
  const stats = computePottyStats(activities, WEEK, toLocalPartsUTC);
  assert.equal(stats.daysInRange, 7);
  assert.equal(stats.avgCatchesPerDay, 0.7); // 5/7 = 0.714... -> 0.7
});

test('dailySeries includes a zero-filled entry for every day in range, not just days with catches', () => {
  const activities = [potty('2026-07-08T09:00:00Z', 'WET')];
  const stats = computePottyStats(activities, WEEK, toLocalPartsUTC);
  assert.equal(stats.dailySeries.length, 7);
  assert.deepEqual(
    stats.dailySeries.map((d) => d.day),
    ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12']
  );
  const wed = stats.dailySeries.find((d) => d.day === '2026-07-08');
  assert.deepEqual(wed, { day: '2026-07-08', pees: 1, poops: 0, catches: 1 });
  const empty = stats.dailySeries.find((d) => d.day === '2026-07-06');
  assert.deepEqual(empty, { day: '2026-07-06', pees: 0, poops: 0, catches: 0 });
});

test('rollingAvg7 averages the trailing up-to-7 days only (no look-ahead)', () => {
  const activities = [
    potty('2026-07-06T08:00:00Z', 'WET'),
    potty('2026-07-06T09:00:00Z', 'WET'),
    potty('2026-07-08T08:00:00Z', 'WET'),
    potty('2026-07-08T09:00:00Z', 'WET'),
    potty('2026-07-08T10:00:00Z', 'WET'),
    potty('2026-07-08T11:00:00Z', 'WET'),
  ];
  const stats = computePottyStats(activities, WEEK, toLocalPartsUTC);
  // day1 (07-06) has 2 catches; window = [day1] -> avg 2
  assert.equal(stats.rollingAvg7[0].value, 2);
  // day3 (07-08) has 4 catches; window = [day1..day3] = (2+0+4)/3 = 2
  assert.equal(stats.rollingAvg7[2].value, 2);
  // day7 (07-12); window = all 7 days = (2+0+4+0+0+0+0)/7 = 0.857.. -> 0.9
  assert.equal(stats.rollingAvg7[6].value, 0.9);
});

// ---------------------------------------------------------------------------
// Poop scoreboard
// ---------------------------------------------------------------------------

test('scoreboard compares potty DIRTY|BOTH against diaper DIRTY|BOTH', () => {
  const activities = [
    potty('2026-07-15T08:00:00Z', 'DIRTY'),
    potty('2026-07-15T12:00:00Z', 'BOTH'),
    potty('2026-07-15T14:00:00Z', 'WET'), // pee only, must not count
    diaper('2026-07-15T09:00:00Z', 'DIRTY'),
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.scoreboard.poopsCaught, 2); // DIRTY + BOTH
  assert.equal(stats.scoreboard.poopyDiapers, 1);
  assert.equal(stats.scoreboard.shareCaught, 2 / 3);
});

test('scoreboard.shareCaught is null (never NaN, never a fake 0) when there is no poop data on either side', () => {
  const activities = [potty('2026-07-15T08:00:00Z', 'WET')];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.scoreboard.poopsCaught, 0);
  assert.equal(stats.scoreboard.poopyDiapers, 0);
  assert.equal(stats.scoreboard.shareCaught, null);
});

test('a potty-only input (no DiaperLog rows at all) yields scoreboard.poopyDiapers: 0', () => {
  const activities = [potty('2026-07-15T08:00:00Z', 'DIRTY')];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.scoreboard.poopyDiapers, 0);
  assert.equal(stats.scoreboard.shareCaught, 1); // 1 / (1 + 0)
});

test('scoreboard.weekly buckets by ISO week (Monday start), matching the BathChartModal precedent', () => {
  const TWO_WEEKS = range('2026-07-06T00:00:00Z', '2026-07-19T23:59:59Z'); // Mon 7/6 - Sun 7/19
  const activities = [
    potty('2026-07-08T08:00:00Z', 'DIRTY'), // Wed, week of 7/6
    diaper('2026-07-16T08:00:00Z', 'DIRTY'), // Thu, week of 7/13
  ];
  const stats = computePottyStats(activities, TWO_WEEKS, toLocalPartsUTC);
  assert.equal(stats.scoreboard.weekly.length, 2);
  assert.deepEqual(stats.scoreboard.weekly[0], { weekStart: '2026-07-06', caught: 1, diapered: 0, share: 1 });
  assert.deepEqual(stats.scoreboard.weekly[1], { weekStart: '2026-07-13', caught: 0, diapered: 1, share: 0 });
});

// ---------------------------------------------------------------------------
// Wake-up join
// ---------------------------------------------------------------------------

test('a catch within the 20-minute window after a sleep end is classified as a wake-up catch', () => {
  const activities = [
    sleep('2026-07-15T08:00:00Z', '2026-07-15T09:00:00Z', 'NAP'),
    potty('2026-07-15T09:10:00Z', 'WET'), // 10 min after nap end
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.wakeUp.wakeUpCatches, 1);
  assert.deepEqual(stats.wakeUp.napCoverage, { hit: 1, total: 1 });
});

test('a catch exactly 20 minutes after a sleep end still counts (inclusive boundary)', () => {
  const activities = [
    sleep('2026-07-15T08:00:00Z', '2026-07-15T09:00:00Z', 'NAP'),
    potty('2026-07-15T09:20:00Z', 'WET'), // exactly 20:00 after
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.wakeUp.wakeUpCatches, 1);
});

test('a catch just past the 20-minute window (20:01) falls outside it', () => {
  const activities = [
    sleep('2026-07-15T08:00:00Z', '2026-07-15T09:00:00Z', 'NAP'),
    potty('2026-07-15T09:20:01Z', 'WET'),
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.wakeUp.wakeUpCatches, 0);
  assert.deepEqual(stats.wakeUp.napCoverage, { hit: 0, total: 1 });
});

test('an open-ended sleep (endTime null) is excluded from both the wake join and the coverage denominator', () => {
  const activities = [
    sleep('2026-07-15T08:00:00Z', null, 'NAP'),
    potty('2026-07-15T08:10:00Z', 'WET'),
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.wakeUp.wakeUpCatches, 0);
  assert.deepEqual(stats.wakeUp.napCoverage, { hit: 0, total: 0 });
});

test('when two sleeps end near each other, the catch attributes to the nearer end (nap vs night)', () => {
  const activities = [
    sleep('2026-07-15T07:00:00Z', '2026-07-15T09:00:00Z', 'NAP'), // ends 09:00, gap 7 min
    sleep('2026-07-15T08:50:00Z', '2026-07-15T09:05:00Z', 'NIGHT_SLEEP'), // ends 09:05, gap 2 min
    potty('2026-07-15T09:07:00Z', 'WET'),
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.wakeUp.wakeUpCatches, 1);
  assert.deepEqual(stats.wakeUp.nightCoverage, { hit: 1, total: 1 }); // nearer NIGHT_SLEEP wins
  assert.deepEqual(stats.wakeUp.napCoverage, { hit: 0, total: 1 }); // NOT the further NAP
});

test('nap and night wake-ups are tallied into separate coverage buckets', () => {
  const activities = [
    sleep('2026-07-15T07:00:00Z', '2026-07-15T07:30:00Z', 'NAP'),
    potty('2026-07-15T07:35:00Z', 'WET'), // nap wake-up
    sleep('2026-07-15T19:00:00Z', '2026-07-15T20:00:00Z', 'NIGHT_SLEEP'),
    potty('2026-07-15T20:05:00Z', 'DIRTY'), // night wake-up
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.wakeUp.wakeUpCatches, 2);
  assert.deepEqual(stats.wakeUp.napCoverage, { hit: 1, total: 1 });
  assert.deepEqual(stats.wakeUp.nightCoverage, { hit: 1, total: 1 });
});

test('wakeUp.shareOfAllCatches is wake-up catches over all catches in range', () => {
  const activities = [
    sleep('2026-07-15T08:00:00Z', '2026-07-15T09:00:00Z', 'NAP'),
    potty('2026-07-15T09:05:00Z', 'WET'), // wake-up
    potty('2026-07-15T14:00:00Z', 'WET'), // not a wake-up
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.totalCatches, 2);
  assert.equal(stats.wakeUp.wakeUpCatches, 1);
  assert.equal(stats.wakeUp.shareOfAllCatches, 0.5);
});

test('wakeUp.shareOfAllCatches is null when there are zero catches in range', () => {
  const stats = computePottyStats([], DAY, toLocalPartsUTC);
  assert.equal(stats.wakeUp.shareOfAllCatches, null);
});

test('medianGapMinutes is null with fewer than 10 wake-up catches', () => {
  const activities: unknown[] = [];
  for (let i = 0; i < 9; i++) {
    const hour = String(i + 1).padStart(2, '0');
    activities.push(sleep(`2026-07-15T${hour}:00:00Z`, `2026-07-15T${hour}:30:00Z`, 'NAP'));
    activities.push(potty(`2026-07-15T${hour}:35:00Z`, 'WET')); // 5 min gap each
  }
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.wakeUp.wakeUpCatches, 9);
  assert.equal(stats.wakeUp.medianGapMinutes, null);
});

test('medianGapMinutes is computed once there are exactly 10 wake-up catches', () => {
  const gaps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // minutes; median of 10 values = (5+6)/2 = 5.5
  const activities: unknown[] = [];
  gaps.forEach((gap, i) => {
    const hour = String(i + 1).padStart(2, '0');
    const endIso = `2026-07-15T${hour}:30:00Z`;
    activities.push(sleep(`2026-07-15T${hour}:00:00Z`, endIso, 'NAP'));
    const catchIso = new Date(new Date(endIso).getTime() + gap * 60000).toISOString();
    activities.push(potty(catchIso, 'WET'));
  });
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.wakeUp.wakeUpCatches, 10);
  assert.equal(stats.wakeUp.medianGapMinutes, 5.5);
});

// ---------------------------------------------------------------------------
// Adaptive hour-histogram bins
// ---------------------------------------------------------------------------

test('adaptive bins: exactly 49 total catches uses 2-hour bins', () => {
  const stats = computePottyStats(nCatches(49), DAY, toLocalPartsUTC);
  assert.equal(stats.totalCatches, 49);
  assert.equal(stats.hourHistogram.binHours, 2);
  assert.equal(stats.hourHistogram.bins.length, 12);
});

test('adaptive bins: exactly 50 total catches uses 1-hour bins', () => {
  const stats = computePottyStats(nCatches(50), DAY, toLocalPartsUTC);
  assert.equal(stats.totalCatches, 50);
  assert.equal(stats.hourHistogram.binHours, 1);
  assert.equal(stats.hourHistogram.bins.length, 24);
});

test('hourHistogram buckets pees and poops into the correct adaptive bin (BOTH counts in both)', () => {
  const activities = [
    potty('2026-07-15T01:15:00Z', 'WET'), // hour 1 -> bin startHour 0
    potty('2026-07-15T05:45:00Z', 'DIRTY'), // hour 5 -> bin startHour 4
    potty('2026-07-15T23:00:00Z', 'BOTH'), // hour 23 -> bin startHour 22
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.hourHistogram.binHours, 2);
  assert.deepEqual(
    stats.hourHistogram.bins.find((b) => b.startHour === 0),
    { startHour: 0, pees: 1, poops: 0 }
  );
  assert.deepEqual(
    stats.hourHistogram.bins.find((b) => b.startHour === 4),
    { startHour: 4, pees: 0, poops: 1 }
  );
  assert.deepEqual(
    stats.hourHistogram.bins.find((b) => b.startHour === 22),
    { startHour: 22, pees: 1, poops: 1 }
  );
});

// ---------------------------------------------------------------------------
// Soft delete, discriminator ordering, empty/invalid input, purity
// ---------------------------------------------------------------------------

test('soft-deleted rows (deletedAt set) are excluded from every computation', () => {
  const activities = [
    potty('2026-07-15T08:00:00Z', 'DIRTY', { deletedAt: '2026-07-16T00:00:00Z' }),
    diaper('2026-07-15T09:00:00Z', 'DIRTY', { deletedAt: '2026-07-16T00:00:00Z' }),
    sleep('2026-07-15T06:00:00Z', '2026-07-15T07:00:00Z', 'NAP', { deletedAt: '2026-07-16T00:00:00Z' }),
    potty('2026-07-15T07:05:00Z', 'WET'), // would be a wake-up catch if the nap above counted
  ];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.totalCatches, 1);
  assert.equal(stats.scoreboard.poopsCaught, 0);
  assert.equal(stats.scoreboard.poopyDiapers, 0);
  assert.equal(stats.wakeUp.wakeUpCatches, 0);
  assert.deepEqual(stats.wakeUp.napCoverage, { hit: 0, total: 0 });
});

test('an object with both pottyLocation and condition is classified as potty (checked before diaper)', () => {
  const hybrid = {
    time: '2026-07-15T08:00:00Z',
    type: 'DIRTY',
    pottyLocation: 'Toilet',
    condition: 'firm',
    deletedAt: null,
  };
  const stats = computePottyStats([hybrid], DAY, toLocalPartsUTC);
  assert.equal(stats.totalCatches, 1);
  assert.equal(stats.scoreboard.poopyDiapers, 0); // must NOT also be read as a diaper
});

test('unrelated activity shapes (feeds, notes) are ignored without affecting counts', () => {
  const feed = { time: '2026-07-15T08:00:00Z', type: 'BOTTLE', amount: 4 };
  const note = { time: '2026-07-15T08:00:00Z', content: 'hi' };
  const activities = [feed, note, potty('2026-07-15T09:00:00Z', 'WET')];
  const stats = computePottyStats(activities, DAY, toLocalPartsUTC);
  assert.equal(stats.totalCatches, 1);
});

test('an empty activities array produces zero counts and no NaN, for a valid range', () => {
  const stats = computePottyStats([], WEEK, toLocalPartsUTC);
  assert.equal(stats.totalCatches, 0);
  assert.equal(stats.peesCaught, 0);
  assert.equal(stats.poopsCaught, 0);
  assert.equal(stats.avgCatchesPerDay, 0);
  assert.equal(stats.daysInRange, 7);
  assert.equal(stats.dailySeries.length, 7);
  assert.ok(stats.dailySeries.every((d) => d.catches === 0 && !Number.isNaN(d.catches)));
  assert.equal(stats.scoreboard.shareCaught, null);
  assert.equal(stats.wakeUp.shareOfAllCatches, null);
  assert.equal(stats.wakeUp.medianGapMinutes, null);
  assert.equal(stats.hourHistogram.binHours, 2);
  assert.ok(stats.hourHistogram.bins.every((b) => b.pees === 0 && b.poops === 0));
});

test('an invalid date range returns the fully-zeroed default struct instead of throwing', () => {
  const badRange = { from: new Date('not-a-date'), to: new Date('also-not-a-date') };
  const stats = computePottyStats([], badRange, toLocalPartsUTC);
  assert.equal(stats.totalCatches, 0);
  assert.equal(stats.daysInRange, 0);
  assert.deepEqual(stats.dailySeries, []);
  assert.deepEqual(stats.scoreboard, { poopsCaught: 0, poopyDiapers: 0, shareCaught: null, weekly: [] });
});

test('computePottyStats does not mutate a frozen activities array or its (frozen) rows', () => {
  const rows = Object.freeze([
    Object.freeze(potty('2026-07-15T08:00:00Z', 'BOTH')),
    Object.freeze(diaper('2026-07-15T09:00:00Z', 'DIRTY')),
    Object.freeze(sleep('2026-07-15T06:00:00Z', '2026-07-15T07:00:00Z', 'NAP')),
  ]);
  assert.doesNotThrow(() => computePottyStats(rows, DAY, toLocalPartsUTC));
});

test('computePottyStats does not mutate the dateRange Date objects it is given', () => {
  const from = new Date('2026-07-06T00:00:00Z');
  const to = new Date('2026-07-12T23:59:59Z');
  const fromBefore = from.getTime();
  const toBefore = to.getTime();
  computePottyStats([potty('2026-07-08T08:00:00Z', 'WET')], { from, to }, toLocalPartsUTC);
  assert.equal(from.getTime(), fromBefore);
  assert.equal(to.getTime(), toBefore);
});

test('day bucketing comes only from the injected toLocalParts, never a hardcoded timezone', () => {
  const activities = [potty('2026-07-15T02:00:00Z', 'WET')];
  const utcStats = computePottyStats(activities, DAY, toLocalPartsUTC);
  const offsetStats = computePottyStats(activities, DAY, toLocalPartsOffset(-5));
  const utcDay = utcStats.dailySeries.find((d) => d.catches === 1)?.day;
  const offsetDay = offsetStats.dailySeries.find((d) => d.catches === 1)?.day;
  assert.equal(utcDay, '2026-07-15');
  assert.equal(offsetDay, '2026-07-14');
  assert.notEqual(utcDay, offsetDay);
});
