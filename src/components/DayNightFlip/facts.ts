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
  let lastWakeTime = wakes[0] ?? null;

  const opens = raw.sleepLogs
    .filter(l => !l.endTime)
    .map(l => new Date(l.startTime))
    .sort(byTimeDesc);
  let napStartTime = opens[0] ?? null;

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

  let wetDiapersLast24h: number | null = null;
  let dirtyDiapersLast24h: number | null = null;
  if (raw.diaperLogs.length > 0) {
    const cutoff = now.getTime() - 24 * 3600 * 1000;
    const recent = raw.diaperLogs.filter(d => new Date(d.time).getTime() >= cutoff);
    wetDiapersLast24h = recent.filter(d => d.type === 'WET' || d.type === 'BOTH').length;
    dirtyDiapersLast24h = recent.filter(d => d.type === 'DIRTY' || d.type === 'BOTH').length;
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
