// Source of truth for the Day/Night Flip protocol: config shape, source-run
// defaults, and the rule bank. Derived from day-night-flip-rules.md.

export type FlipConfig = {
  enabled: boolean;
  feedingMethod: 'bottle' | 'nursing' | 'combo';
  anchors: { dayStart: string; bedtimeRoutine: string; nightStart: string };
  dayMode: {
    feedIntervalMaxHr: number;
    napCapHr: number;
    wakeWindowTargetMin: [number, number];
    wakeWindowCeilingMin: number;
    catnapSlot: [string, string];
    lastWakeBy: string;
  };
  nightMode: {
    feedExpectedIntervalHr: [number, number];
    scheduledFeeds: string[];
  };
  feeding: {
    dailyOzPerLb: [number, number];
    growthOzPerDay: [number, number];
  };
  durations: {
    fussWaitMin: [number, number];
    putdownAbandonMin: number;
    rescueNapMaxMin: number;
  };
};

export const DEFAULT_FLIP_CONFIG: FlipConfig = {
  enabled: false,
  feedingMethod: 'bottle',
  anchors: { dayStart: '08:00', bedtimeRoutine: '19:15', nightStart: '20:00' },
  dayMode: {
    feedIntervalMaxHr: 3,
    napCapHr: 2,
    wakeWindowTargetMin: [45, 60],
    wakeWindowCeilingMin: 75,
    catnapSlot: ['17:00', '18:30'],
    lastWakeBy: '18:30',
  },
  nightMode: {
    feedExpectedIntervalHr: [2.5, 4],
    scheduledFeeds: ['23:00', '02:00', '05:00'],
  },
  feeding: { dailyOzPerLb: [2.0, 2.5], growthOzPerDay: [0.5, 1.0] },
  durations: { fussWaitMin: [5, 10], putdownAbandonMin: 20, rescueNapMaxMin: 90 },
};

// A missing or partial column merges over the defaults so old babies and
// newly added fields are always safe.
export function mergeFlipConfig(raw: string | null | undefined): FlipConfig {
  if (!raw) return DEFAULT_FLIP_CONFIG;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_FLIP_CONFIG;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_FLIP_CONFIG;
  }
  const p = parsed as Partial<FlipConfig>;
  return {
    ...DEFAULT_FLIP_CONFIG,
    ...p,
    anchors: { ...DEFAULT_FLIP_CONFIG.anchors, ...p.anchors },
    dayMode: { ...DEFAULT_FLIP_CONFIG.dayMode, ...p.dayMode },
    nightMode: { ...DEFAULT_FLIP_CONFIG.nightMode, ...p.nightMode },
    feeding: { ...DEFAULT_FLIP_CONFIG.feeding, ...p.feeding },
    durations: { ...DEFAULT_FLIP_CONFIG.durations, ...p.durations },
  };
}

export type FlipRule = {
  id: string;
  mode: 'day' | 'night';
  text: string;
  why: string;
};

// Chip text + WHY copy. These strings are also en.json keys (key === value),
// so render them through t().
export const FLIP_RULES: FlipRule[] = [
  { id: 'D-1', mode: 'day',
    text: 'Bright rooms, curtains open, normal household noise',
    why: 'Daytime sleep should be lighter than night sleep. The day/night contrast is the entire training mechanism.' },
  { id: 'D-2', mode: 'day',
    text: 'Wake to feed if it has been over the max feed interval',
    why: 'Shifts calories into daytime so night hunger decreases. "Never wake a sleeping baby" is wrong for this problem at this age.' },
  { id: 'D-3', mode: 'day',
    text: 'Cap every nap — wake the baby at the cap',
    why: 'Daytime sleep displaced into night is the disease being treated.' },
  { id: 'D-4', mode: 'day',
    text: 'Unswaddle for awake time and feeds; fresh swaddle only at putdown',
    why: 'Makes the swaddle a sleep cue (only worn for sleep) and keeps baby alert enough to take full feeds.' },
  { id: 'D-5', mode: 'day',
    text: 'No white noise for daytime naps (rescue naps excepted)',
    why: 'White noise is reserved as a night cue; "worse" daytime naps are the goal during the flip.' },
  { id: 'D-6', mode: 'day',
    text: 'Feeds are full, unhurried, paced — keep baby stimulated while eating',
    why: 'Front-loading daytime calories is the lever that reduces night feeding.' },
  { id: 'D-7', mode: 'day',
    text: 'Cycle order: unswaddle, feed, awake time, diaper change, re-swaddle, down',
    why: 'Change-last gives a fresh diaper for the nap and makes the change part of the wind-down sequence.' },
  { id: 'D-8', mode: 'day',
    text: 'Feeding time counts as awake time — never extend the window for more activity',
    why: 'The window is total time out of sleep, not a play quota. A slow feed can be a complete window.' },
  { id: 'N-1', mode: 'night',
    text: 'Pitch dark, silent, no talking, no eye contact — robot mode',
    why: 'Boring nights plus stimulating days create the contrast that flips the clock.' },
  { id: 'N-2', mode: 'night',
    text: 'Feed on demand — scheduled night feeds are estimates, never alarms',
    why: 'You cannot withhold food from a hungry newborn; the protocol works through environment, not restriction.' },
  { id: 'N-3', mode: 'night',
    text: 'Swaddle stays on through night feeds if dry',
    why: 'Unswaddling at 2am wakes the baby up more — the opposite of the goal.' },
  { id: 'N-4', mode: 'night',
    text: 'Change diapers only if poopy',
    why: 'Minimize stimulation and handling.' },
  { id: 'N-5', mode: 'night',
    text: 'White noise on all night',
    why: 'A night cue that also masks transfer noise.' },
  { id: 'N-6', mode: 'night',
    text: 'Hold dark until day start, even after an early feed',
    why: 'The consistent morning light-on time is what trains the circadian clock.' },
  { id: 'N-7', mode: 'night',
    text: 'Parents run shifts; off-duty parent sleeps out of earshot',
    why: 'Two people with four-plus consolidated hours each beats two people with fragmented sleep. If holding the baby, stay fully awake — dozing while holding is the actual danger.' },
];
