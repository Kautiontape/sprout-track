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
