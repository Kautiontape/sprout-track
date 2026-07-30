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

// --- Potty catches never inflate diaper counts ---
const pottyDay = computeDayStats([
  { condition: 'NORMAL', type: 'WET', time: at(9, 0) } as any,
  { type: 'WET', pottyLocation: 'Potty Chair', time: at(11, 0), notes: null } as any,
  { type: 'DIRTY', pottyLocation: 'Toilet', time: at(14, 0), notes: null } as any,
], day, opts);

check('potty count', pottyDay.pottyCount, 2);
check('potty does not inflate wet diapers', pottyDay.wetCount, 1);
check('potty does not inflate poop count', pottyDay.poopCount, 0);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
