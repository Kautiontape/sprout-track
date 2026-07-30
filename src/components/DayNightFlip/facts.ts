// Pure assembly of ActivityFacts from raw API payloads + the local manual
// override. Kept React-free so the supersede logic is unit-testable.

import { ActivityFacts } from './engine';

export type FlipOverride = {
  kind: 'wake' | 'down';
  time: string;  // ISO — the moment the baby actually woke / went down
  setAt: string; // ISO — when the user set the override
};

export type RawActivityData = {
  sleepLogs: { startTime: string; endTime: string | null }[];
  lastFeed: { time: string; endTime?: string | null } | null;
  diaperLogs: { time: string; type: 'WET' | 'DIRTY' | 'BOTH' }[];
  // PottyLog reuses the DiaperType enum, so the same 'WET'|'BOTH' / 'DIRTY'|'BOTH'
  // predicates that apply to diaperLogs apply here too.
  pottyLogs: { time: string; type: 'WET' | 'DIRTY' | 'BOTH' }[];
  weights: { date: string; value: number; unit: string }[];
  birthDate: string;
};

export function weightToOz(value: number, unit: string): number | null {
  switch ((unit || '').toLowerCase()) {
    case 'oz': return value;
    case 'lb': case 'lbs': return value * 16;
    case 'kg': return value * 35.274;
    case 'g': return value * 0.035274;
    default: return null;
  }
}

export function deriveFacts(
  raw: RawActivityData,
  override: FlipOverride | null,
  now: Date,
): ActivityFacts {
  const byTimeDesc = (a: Date, b: Date) => b.getTime() - a.getTime();

  const wakes = raw.sleepLogs
    .filter(l => l.endTime)
    .map(l => new Date(l.endTime as string))
    .sort(byTimeDesc);
  let lastWakeTime: Date | null = wakes.length > 0 ? wakes[0] : null;

  const opens = raw.sleepLogs
    .filter(l => !l.endTime)
    .map(l => new Date(l.startTime))
    .sort(byTimeDesc);
  let napStartTime: Date | null = opens.length > 0 ? opens[0] : null;

  if (override) {
    const setAt = new Date(override.setAt).getTime();
    const superseded =
      override.kind === 'wake'
        ? lastWakeTime !== null && lastWakeTime.getTime() >= setAt
        : napStartTime !== null && napStartTime.getTime() >= setAt;
    if (!superseded) {
      if (override.kind === 'wake') {
        lastWakeTime = new Date(override.time);
        napStartTime = null; // explicitly awake
      } else {
        napStartTime = new Date(override.time);
      }
    }
  }

  const lastFeedTime = raw.lastFeed
    ? new Date(raw.lastFeed.endTime || raw.lastFeed.time)
    : null;

  // wetDiapersLast24h / dirtyDiapersLast24h are a HYDRATION SIGNAL (urine and
  // stool output, used as an intake proxy) — NOT a diaper-usage statistic. A
  // pee is a pee whether it lands in a diaper or gets caught on the potty
  // during elimination communication (EC), so both sources are combined here.
  // This is deliberately different from diaper *counts* shown in daily stats
  // and reports, where a potty catch must never be counted as a diaper — see
  // src/lib/elimination.ts for the sibling case of mixing the two sources.
  // Do not "fix" this back to diaperLogs-only: that reintroduces a false
  // pediatrician-call alert for every family practicing EC (see engine.ts R-42).
  let wetDiapersLast24h: number | null = null;
  let dirtyDiapersLast24h: number | null = null;
  if (raw.diaperLogs.length > 0 || raw.pottyLogs.length > 0) {
    const cutoff = now.getTime() - 24 * 3600 * 1000;
    const isRecent = (t: string) => new Date(t).getTime() >= cutoff;
    const isWet = (t: 'WET' | 'DIRTY' | 'BOTH') => t === 'WET' || t === 'BOTH';
    const isDirty = (t: 'WET' | 'DIRTY' | 'BOTH') => t === 'DIRTY' || t === 'BOTH';
    const recentDiapers = raw.diaperLogs.filter(d => isRecent(d.time));
    const recentPotty = raw.pottyLogs.filter(d => isRecent(d.time));
    wetDiapersLast24h =
      recentDiapers.filter(d => isWet(d.type)).length + recentPotty.filter(d => isWet(d.type)).length;
    dirtyDiapersLast24h =
      recentDiapers.filter(d => isDirty(d.type)).length + recentPotty.filter(d => isDirty(d.type)).length;
  }

  const weights = raw.weights
    .map(w => ({ date: new Date(w.date), oz: weightToOz(w.value, w.unit) }))
    .filter((w): w is { date: Date; oz: number } => w.oz !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    lastWakeTime,
    napStartTime,
    lastFeedTime,
    wetDiapersLast24h,
    dirtyDiapersLast24h,
    latestWeight: weights[0] ?? null,
    previousWeight: weights[1] ?? null,
    birthDate: new Date(raw.birthDate),
  };
}
