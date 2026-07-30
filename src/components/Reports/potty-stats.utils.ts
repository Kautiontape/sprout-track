/**
 * potty-stats.utils.ts
 *
 * Pure computation module for the EC Potty Stats section (Phase 2, Task 1).
 * See docs/superpowers/specs/2026-07-30-ec-potty-stats-phase-2-design.md for
 * the binding design rules this module implements.
 *
 * PURITY CONSTRAINT: this module imports nothing with side effects — no React,
 * no useTimezone, no Prisma client. All timezone knowledge enters exclusively
 * through the injected `toLocalParts` function, so it runs under bare
 * `npx tsx --test`. Nothing here mutates its inputs.
 */

// -----------------------------------------------------------------------------
// Row shapes (locally defined, duck-typed — not imported from reports.types.ts,
// which pulls Prisma client enums; keeping this module free of that import is
// what keeps it side-effect-free). Callers pass the Reports ActivityType[] and
// this module narrows it internally.
// -----------------------------------------------------------------------------

interface PottyLikeRow {
  time: string;
  type: unknown;
  pottyLocation?: unknown;
  deletedAt?: unknown;
}

interface DiaperLikeRow {
  time: string;
  type: unknown;
  condition?: unknown;
  deletedAt?: unknown;
}

interface SleepLikeRow {
  startTime: string;
  endTime?: unknown;
  duration?: unknown;
  type: unknown;
  deletedAt?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Potty must be checked before diaper: both carry `type`, but only PottyLog has
// `pottyLocation` and only DiaperLog has `condition` (see app/api/timeline/export/route.ts).
function isPottyRow(value: unknown): value is PottyLikeRow {
  return isRecord(value) && 'pottyLocation' in value && 'time' in value && 'type' in value;
}

function isDiaperRow(value: unknown): value is DiaperLikeRow {
  return isRecord(value) && 'condition' in value && 'time' in value && 'type' in value;
}

// Same discriminator StatsTab.tsx and timeline-heatmap.utils.ts already use for
// sleep rows: duration + startTime + type, narrowed to NAP/NIGHT_SLEEP so it
// can't collide with PlayActivity (which also has duration/startTime/type).
function isSleepRow(value: unknown): value is SleepLikeRow {
  return (
    isRecord(value) &&
    'duration' in value &&
    'startTime' in value &&
    'type' in value &&
    (value.type === 'NAP' || value.type === 'NIGHT_SLEEP')
  );
}

function isDeleted(value: Record<string, unknown>): boolean {
  return value.deletedAt !== null && value.deletedAt !== undefined;
}

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface PottyStatsDailyEntry {
  day: string; // YYYY-MM-DD, family-local calendar day
  pees: number;
  poops: number;
  catches: number;
}

export interface PottyStatsRollingEntry {
  day: string;
  value: number;
}

export interface PottyStatsWeeklyEntry {
  weekStart: string; // YYYY-MM-DD, Monday of the ISO week
  caught: number;
  diapered: number;
  share: number | null;
}

export interface PottyStatsHourBin {
  startHour: number;
  pees: number;
  poops: number;
}

export interface PottyStats {
  totalCatches: number; // rows
  peesCaught: number; // type WET|BOTH (eliminations)
  poopsCaught: number; // type DIRTY|BOTH (eliminations)
  avgCatchesPerDay: number; // 1 decimal, over daysInRange
  daysInRange: number;
  dailySeries: PottyStatsDailyEntry[];
  rollingAvg7: PottyStatsRollingEntry[];
  scoreboard: {
    poopsCaught: number;
    poopyDiapers: number;
    shareCaught: number | null; // null when denominator is 0
    weekly: PottyStatsWeeklyEntry[];
  };
  wakeUp: {
    windowMinutes: number; // 20
    wakeUpCatches: number;
    shareOfAllCatches: number | null;
    napCoverage: { hit: number; total: number };
    nightCoverage: { hit: number; total: number };
    medianGapMinutes: number | null; // null below 10 wake-up catches
  };
  hourHistogram: { binHours: 1 | 2; bins: PottyStatsHourBin[] };
}

export interface PottyStatsDateRange {
  from: Date;
  to: Date;
}

export type ToLocalParts = (iso: string) => { dayKey: string; hour: number };

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const WAKE_WINDOW_MINUTES = 20;
const ADAPTIVE_BIN_THRESHOLD = 50;
const MEDIAN_GAP_MIN_SAMPLE = 10;

// -----------------------------------------------------------------------------
// Calendar-key helpers (operate purely on YYYY-MM-DD strings via a UTC-anchored
// Date used only as a calendar calculator — this is NOT a timezone conversion,
// it never touches wall-clock/instant data, so it doesn't violate the purity
// constraint. The actual instant -> local-day conversion always goes through
// the injected toLocalParts.)
// -----------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKeyToUTCDate(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcDateToDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDaysToKey(dayKey: string, days: number): string {
  const d = dayKeyToUTCDate(dayKey);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDateToDayKey(d);
}

// Enumerates every calendar day from fromKey to toKey inclusive. Capped as a
// defensive guard against a reversed/degenerate range looping forever.
function enumerateDayKeys(fromKey: string, toKey: string): string[] {
  const keys: string[] = [];
  let cursor = fromKey;
  let iterations = 0;
  const MAX_DAYS = 3660; // ~10 years — generous upper bound for a Reports range
  while (cursor <= toKey && iterations < MAX_DAYS) {
    keys.push(cursor);
    cursor = addDaysToKey(cursor, 1);
    iterations++;
  }
  return keys;
}

// ISO week (Monday start), matching the existing BathChartModal.tsx convention
// (getWeekKey) — no conflicting weekly precedent was found elsewhere in Reports.
function weekStartKey(dayKey: string): string {
  const d = dayKeyToUTCDate(dayKey);
  const dow = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return utcDateToDayKey(d);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function isWetType(type: unknown): boolean {
  return type === 'WET' || type === 'BOTH';
}

function isDirtyType(type: unknown): boolean {
  return type === 'DIRTY' || type === 'BOTH';
}

function zeroedStats(): PottyStats {
  return {
    totalCatches: 0,
    peesCaught: 0,
    poopsCaught: 0,
    avgCatchesPerDay: 0,
    daysInRange: 0,
    dailySeries: [],
    rollingAvg7: [],
    scoreboard: { poopsCaught: 0, poopyDiapers: 0, shareCaught: null, weekly: [] },
    wakeUp: {
      windowMinutes: WAKE_WINDOW_MINUTES,
      wakeUpCatches: 0,
      shareOfAllCatches: null,
      napCoverage: { hit: 0, total: 0 },
      nightCoverage: { hit: 0, total: 0 },
      medianGapMinutes: null,
    },
    hourHistogram: { binHours: 2, bins: [] },
  };
}

// -----------------------------------------------------------------------------
// Main entry point
// -----------------------------------------------------------------------------

// EC anchor: when the caller supplies the timestamp of the baby's first-ever
// potty log and it falls after the visible range's start, every "how many
// days/opportunities were there" denominator clamps its window start to the
// anchor's local day — see docs/superpowers/specs/2026-07-30-ec-potty-stats-
// phase-2-design.md, "EC anchor". Numerator-only stats (hour histogram, total
// catches) are computed over the unclamped range and are unaffected.
function resolveAnchorDayKey(
  firstCatchEver: Date | string | number | null | undefined,
  toLocalParts: ToLocalParts
): string | null {
  if (firstCatchEver === null || firstCatchEver === undefined) return null;
  const d = firstCatchEver instanceof Date ? firstCatchEver : new Date(firstCatchEver);
  if (Number.isNaN(d.getTime())) return null;
  return toLocalParts(d.toISOString())?.dayKey ?? null;
}

export function computePottyStats(
  activities: readonly unknown[],
  dateRange: PottyStatsDateRange,
  toLocalParts: ToLocalParts,
  firstCatchEver?: Date | string | number | null
): PottyStats {
  if (!Array.isArray(activities) || !dateRange || !dateRange.from || !dateRange.to) {
    return zeroedStats();
  }

  const fromTime = dateRange.from.getTime();
  const toTime = dateRange.to.getTime();
  if (Number.isNaN(fromTime) || Number.isNaN(toTime)) {
    return zeroedStats();
  }

  const fromParts = toLocalParts(dateRange.from.toISOString());
  const toParts = toLocalParts(dateRange.to.toISOString());
  let fromKey = fromParts?.dayKey;
  let toKey = toParts?.dayKey;
  if (!fromKey || !toKey) {
    return zeroedStats();
  }
  if (fromKey > toKey) {
    const tmp = fromKey;
    fromKey = toKey;
    toKey = tmp;
  }

  // rangeDayKeys/-Set: the visible range as requested, unaffected by the
  // anchor — used to gate numerator-only stats (potty rows: totalCatches,
  // pee/poop splits, hour histogram, the wake-up join).
  const rangeDayKeys = enumerateDayKeys(fromKey, toKey);
  const rangeDayKeySet = new Set(rangeDayKeys);

  // effectiveDayKeys/-Set: the anchor-clamped window — used for every
  // "how many days/opportunities were there" denominator (daysInRange,
  // dailySeries/rollingAvg7, the weekly scoreboard series, the diaper
  // denominator, and wake-up coverage totals). Day arithmetic is inclusive,
  // so when the anchor lands on the range's last day, effective days = 1.
  const anchorDayKey = resolveAnchorDayKey(firstCatchEver, toLocalParts);
  const effectiveFromKey = anchorDayKey && anchorDayKey > fromKey ? anchorDayKey : fromKey;
  const effectiveDayKeys = enumerateDayKeys(effectiveFromKey, toKey);
  const daysInRange = effectiveDayKeys.length;
  const effectiveDayKeySet = new Set(effectiveDayKeys);

  // --- classify activities (duck-typed; potty checked before diaper) ---
  const pottyRows: { time: string; type: unknown; dayKey: string; hour: number }[] = [];
  const diaperRows: { time: string; type: unknown; dayKey: string }[] = [];
  const sleepRows: { endTime: string | null; type: unknown; endDayKey: string | null }[] = [];

  for (const raw of activities) {
    if (!isRecord(raw) || isDeleted(raw)) continue;

    if (isPottyRow(raw)) {
      if (typeof raw.time !== 'string') continue;
      const parts = toLocalParts(raw.time);
      // Numerator-only: gated by the unclamped visible range, not the anchor.
      if (!parts?.dayKey || !rangeDayKeySet.has(parts.dayKey)) continue;
      pottyRows.push({ time: raw.time, type: raw.type, dayKey: parts.dayKey, hour: parts.hour });
      continue;
    }

    if (isDiaperRow(raw)) {
      if (typeof raw.time !== 'string') continue;
      const parts = toLocalParts(raw.time);
      // Denominator: gated by the anchor-clamped window (dirty-diaper share).
      if (!parts?.dayKey || !effectiveDayKeySet.has(parts.dayKey)) continue;
      diaperRows.push({ time: raw.time, type: raw.type, dayKey: parts.dayKey });
      continue;
    }

    if (isSleepRow(raw)) {
      const endTime = typeof raw.endTime === 'string' ? raw.endTime : null;
      const endDayKey = endTime ? toLocalParts(endTime)?.dayKey ?? null : null;
      sleepRows.push({ endTime, type: raw.type, endDayKey });
      continue;
    }
  }

  // --- #1: catches per day, split pee/poop ---
  const dailyMap = new Map<string, PottyStatsDailyEntry>();
  effectiveDayKeys.forEach((day) => dailyMap.set(day, { day, pees: 0, poops: 0, catches: 0 }));

  let totalCatches = 0;
  let peesCaught = 0;
  let poopsCaught = 0;
  for (const row of pottyRows) {
    totalCatches++;
    const wet = isWetType(row.type);
    const dirty = isDirtyType(row.type);
    if (wet) peesCaught++;
    if (dirty) poopsCaught++;
    const bucket = dailyMap.get(row.dayKey);
    if (bucket) {
      bucket.catches++;
      if (wet) bucket.pees++;
      if (dirty) bucket.poops++;
    }
  }
  const dailySeries = effectiveDayKeys.map((day) => dailyMap.get(day) as PottyStatsDailyEntry);

  const avgCatchesPerDay = daysInRange > 0 ? Math.round((totalCatches / daysInRange) * 10) / 10 : 0;

  const rollingAvg7: PottyStatsRollingEntry[] = dailySeries.map((entry, idx) => {
    const windowStart = Math.max(0, idx - 6);
    const windowSlice = dailySeries.slice(windowStart, idx + 1);
    const sum = windowSlice.reduce((acc, d) => acc + d.catches, 0);
    const value = windowSlice.length > 0 ? Math.round((sum / windowSlice.length) * 10) / 10 : 0;
    return { day: entry.day, value };
  });

  // --- #2: poop scoreboard ---
  const poopyDiapers = diaperRows.reduce((acc, row) => acc + (isDirtyType(row.type) ? 1 : 0), 0);
  const scoreboardShareCaught =
    poopsCaught + poopyDiapers > 0 ? poopsCaught / (poopsCaught + poopyDiapers) : null;

  const weekKeysOrdered: string[] = [];
  const seenWeeks = new Set<string>();
  for (const day of effectiveDayKeys) {
    const wk = weekStartKey(day);
    if (!seenWeeks.has(wk)) {
      seenWeeks.add(wk);
      weekKeysOrdered.push(wk);
    }
  }

  const weeklyCaught = new Map<string, number>();
  const weeklyDiapered = new Map<string, number>();
  weekKeysOrdered.forEach((wk) => {
    weeklyCaught.set(wk, 0);
    weeklyDiapered.set(wk, 0);
  });
  for (const row of pottyRows) {
    if (!isDirtyType(row.type)) continue;
    const wk = weekStartKey(row.dayKey);
    weeklyCaught.set(wk, (weeklyCaught.get(wk) ?? 0) + 1);
  }
  for (const row of diaperRows) {
    if (!isDirtyType(row.type)) continue;
    const wk = weekStartKey(row.dayKey);
    weeklyDiapered.set(wk, (weeklyDiapered.get(wk) ?? 0) + 1);
  }
  const weekly: PottyStatsWeeklyEntry[] = weekKeysOrdered.map((wk) => {
    const caught = weeklyCaught.get(wk) ?? 0;
    const diapered = weeklyDiapered.get(wk) ?? 0;
    const share = caught + diapered > 0 ? caught / (caught + diapered) : null;
    return { weekStart: wk, caught, diapered, share };
  });

  // --- #3: wake-up join ---
  // Sleep candidates for the join are NOT restricted to the visible range (a
  // catch just after the range boundary can still legitimately be a wake-up
  // catch for a sleep that ended just before it); only the coverage
  // denominators (below) are restricted to sleeps ending inside the range.
  const matchedSleepRefs = new Set<(typeof sleepRows)[number]>();
  const wakeUpGaps: number[] = [];
  let wakeUpCatchCount = 0;

  for (const row of pottyRows) {
    const catchTime = new Date(row.time).getTime();
    let best: { sleep: (typeof sleepRows)[number]; gapMin: number } | null = null;
    for (const s of sleepRows) {
      if (!s.endTime) continue; // open-ended sleeps excluded from the join
      const endMs = new Date(s.endTime).getTime();
      const gapMin = (catchTime - endMs) / 60000;
      if (gapMin < 0 || gapMin > WAKE_WINDOW_MINUTES) continue;
      if (!best || gapMin < best.gapMin) {
        best = { sleep: s, gapMin };
      }
    }
    if (best) {
      wakeUpCatchCount++;
      wakeUpGaps.push(best.gapMin);
      matchedSleepRefs.add(best.sleep);
    }
  }

  const shareOfAllCatches = totalCatches > 0 ? wakeUpCatchCount / totalCatches : null;
  const medianGapMinutes = wakeUpGaps.length >= MEDIAN_GAP_MIN_SAMPLE ? median(wakeUpGaps) : null;

  let napHit = 0;
  let napTotal = 0;
  let nightHit = 0;
  let nightTotal = 0;
  for (const s of sleepRows) {
    if (!s.endTime) continue; // open-ended sleeps excluded from coverage denominators
    if (!s.endDayKey || !effectiveDayKeySet.has(s.endDayKey)) continue; // ending inside the anchor-clamped window only
    const hit = matchedSleepRefs.has(s);
    if (s.type === 'NAP') {
      napTotal++;
      if (hit) napHit++;
    } else if (s.type === 'NIGHT_SLEEP') {
      nightTotal++;
      if (hit) nightHit++;
    }
  }

  // --- #5: adaptive hour histogram ---
  const binHours: 1 | 2 = totalCatches >= ADAPTIVE_BIN_THRESHOLD ? 1 : 2;
  const binCount = 24 / binHours;
  const bins: PottyStatsHourBin[] = Array.from({ length: binCount }, (_, i) => ({
    startHour: i * binHours,
    pees: 0,
    poops: 0,
  }));
  for (const row of pottyRows) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor(row.hour / binHours)));
    if (isWetType(row.type)) bins[idx].pees++;
    if (isDirtyType(row.type)) bins[idx].poops++;
  }

  return {
    totalCatches,
    peesCaught,
    poopsCaught,
    avgCatchesPerDay,
    daysInRange,
    dailySeries,
    rollingAvg7,
    scoreboard: {
      poopsCaught,
      poopyDiapers,
      shareCaught: scoreboardShareCaught,
      weekly,
    },
    wakeUp: {
      windowMinutes: WAKE_WINDOW_MINUTES,
      wakeUpCatches: wakeUpCatchCount,
      shareOfAllCatches,
      napCoverage: { hit: napHit, total: napTotal },
      nightCoverage: { hit: nightHit, total: nightTotal },
      medianGapMinutes,
    },
    hourHistogram: { binHours, bins },
  };
}
