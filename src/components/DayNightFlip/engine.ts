// Pure "now" resolver for the Day/Night Flip protocol. No React, no fetch,
// no Date.now() — `now` is always injected so the engine is deterministic.

import { FlipConfig, FLIP_RULES } from './protocol';

export type ActivityFacts = {
  lastWakeTime: Date | null;
  napStartTime: Date | null; // non-null => currently sleeping
  lastFeedTime: Date | null;
  wetDiapersLast24h: number | null; // null => no diaper data at all
  dirtyDiapersLast24h: number | null;
  latestWeight: { oz: number; date: Date } | null;
  previousWeight: { oz: number; date: Date } | null;
  birthDate: Date;
};

export type FlipBlock =
  | 'needs-input' | 'nap' | 'night-sleep' | 'awake' | 'feed-due'
  | 'bedtime-routine' | 'night-feed' | 'night-hold';

export type FlipPhase = 'pre' | 'active' | 'sunset';
export type FlipNudge = { id: string; text: string };

export type FlipState = {
  mode: 'day' | 'night';
  phase: FlipPhase;
  ageWeeks: number;
  currentBlock: FlipBlock;
  blockLabel: string;
  nextAction: string;
  timers: {
    wakeWindowElapsedMin: number | null;
    napElapsedMin: number | null;
    sinceLastFeedMin: number | null;
    nextFeedEstimate: { from: Date; to: Date | null } | null;
  };
  intake: {
    projectedWeightOz: [number, number];
    dailyTargetOz: [number, number];
  } | null;
  activeRuleIds: string[];
  nudges: FlipNudge[];
  escalations: FlipNudge[];
};

const STALE_FACT_MIN = 12 * 60;

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const parseHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
};
const minutesBetween = (a: Date, b: Date) =>
  Math.floor((a.getTime() - b.getTime()) / 60000);
const addMinutes = (d: Date, min: number) => new Date(d.getTime() + min * 60000);
const fmt = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtMin = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function resolveNow(config: FlipConfig, facts: ActivityFacts, now: Date): FlipState {
  const nowMin = minutesOfDay(now);
  const dayStartMin = parseHHMM(config.anchors.dayStart);
  const nightStartMin = parseHHMM(config.anchors.nightStart);
  const bedtimeMin = parseHHMM(config.anchors.bedtimeRoutine);
  const mode: 'day' | 'night' =
    nowMin >= dayStartMin && nowMin < nightStartMin ? 'day' : 'night';

  const ageWeeks = Math.floor(minutesBetween(now, facts.birthDate) / (60 * 24 * 7));
  const phase: FlipPhase = ageWeeks < 2 ? 'pre' : ageWeeks > 10 ? 'sunset' : 'active';

  // --- timers (stale facts are treated as unknown) ---
  // A fact a couple of minutes ahead of `now` is clock skew (e.g. an override
  // set between UI ticks), not bad data — clamp it to 0 rather than reject it.
  const clampSkew = (min: number | null) =>
    min !== null && min >= -2 ? Math.max(0, min) : min;
  const rawNapElapsed = clampSkew(facts.napStartTime ? minutesBetween(now, facts.napStartTime) : null);
  const sleeping = rawNapElapsed !== null && rawNapElapsed >= 0 && rawNapElapsed < STALE_FACT_MIN;
  const napElapsedMin = sleeping ? rawNapElapsed : null;

  const rawWakeElapsed = clampSkew(facts.lastWakeTime ? minutesBetween(now, facts.lastWakeTime) : null);
  const wakeKnown = rawWakeElapsed !== null && rawWakeElapsed >= 0 && rawWakeElapsed < STALE_FACT_MIN;
  const wakeWindowElapsedMin = !sleeping && wakeKnown ? rawWakeElapsed : null;

  const sinceLastFeedMin = facts.lastFeedTime ? minutesBetween(now, facts.lastFeedTime) : null;

  const feedMaxMin = config.dayMode.feedIntervalMaxHr * 60;
  const feedDue = sinceLastFeedMin !== null && sinceLastFeedMin >= feedMaxMin;
  const napCapMin = config.dayMode.napCapHr * 60;
  const napCapHit = sleeping && napElapsedMin! >= napCapMin;
  const ceiling = config.dayMode.wakeWindowCeilingMin;
  const overtired = wakeWindowElapsedMin !== null && wakeWindowElapsedMin > ceiling;
  const targetHi = config.dayMode.wakeWindowTargetMin[1];

  // R-21: only when the last wake is the day's FINAL wake (at/after catnap slot start)
  const catnapStartMin = parseHHMM(config.dayMode.catnapSlot[0]);
  const catnapEndMin = parseHHMM(config.dayMode.catnapSlot[1]);
  let r21RoutineStartMin: number | null = null;
  if (!sleeping && wakeKnown && facts.lastWakeTime) {
    const wakeMin = minutesOfDay(facts.lastWakeTime);
    const projected = wakeMin + targetHi;
    if (wakeMin >= catnapStartMin && projected < bedtimeMin) r21RoutineStartMin = projected;
  }

  // --- block resolution (spec section 5 order) ---
  let currentBlock: FlipBlock;
  if (!sleeping && !wakeKnown) currentBlock = 'needs-input';
  else if (sleeping) currentBlock = mode === 'day' ? 'nap' : 'night-sleep';
  else if (mode === 'night') currentBlock = nowMin < dayStartMin ? 'night-hold' : 'night-feed';
  else if (feedDue) currentBlock = 'feed-due';
  else if (nowMin >= bedtimeMin || (r21RoutineStartMin !== null && nowMin >= r21RoutineStartMin)) {
    currentBlock = 'bedtime-routine';
  } else currentBlock = 'awake';

  const inCatnapSlot =
    currentBlock === 'awake' && nowMin >= catnapStartMin && nowMin < catnapEndMin;

  // --- nudges ---
  const nudges: FlipNudge[] = [];
  if (mode === 'day' && sleeping && feedDue) {
    nudges.push({ id: 'D-2', text: `Wake to feed — over ${config.dayMode.feedIntervalMaxHr}h since last feed` });
  }
  if (napCapHit && mode === 'day') {
    nudges.push({ id: 'D-3', text: `Nap cap reached (${config.dayMode.napCapHr}h) — wake her now` });
  }
  if (overtired) {
    nudges.push({ id: 'R-16', text: `Overtired (${fmtMin(wakeWindowElapsedMin!)} awake, ceiling ${ceiling}m) — more help, not more patience. Skip the wait; go straight to active soothing.` });
  }
  if (
    mode === 'day' && !sleeping && wakeKnown && facts.lastWakeTime &&
    minutesOfDay(facts.lastWakeTime) < dayStartMin && rawWakeElapsed! < nowMin // woke today, before anchor
  ) {
    nudges.push({ id: 'R-12', text: `Window started at the actual wake (${fmt(facts.lastWakeTime)}), not ${config.anchors.dayStart} — nap 1 comes earlier.` });
  }
  if (r21RoutineStartMin !== null && currentBlock === 'bedtime-routine' && nowMin < bedtimeMin) {
    nudges.push({ id: 'R-21', text: 'Early bedtime tonight — never stretch an overtired baby to hit a clock time. Normal anchor resumes tomorrow.' });
  }

  const escalations = buildEscalations(config, facts);
  const intake = buildIntake(config, facts, now);

  // --- next feed estimate ---
  let nextFeedEstimate: FlipState['timers']['nextFeedEstimate'] = null;
  if (facts.lastFeedTime) {
    if (mode === 'day') {
      nextFeedEstimate = { from: addMinutes(facts.lastFeedTime, feedMaxMin), to: null };
    } else {
      const [lo, hi] = config.nightMode.feedExpectedIntervalHr;
      nextFeedEstimate = {
        from: addMinutes(facts.lastFeedTime, lo * 60),
        to: addMinutes(facts.lastFeedTime, hi * 60),
      };
    }
  }

  const { blockLabel, nextAction } = describeBlock({
    currentBlock, inCatnapSlot, config, facts,
    wakeWindowElapsedMin, sinceLastFeedMin,
    napCapHit, feedDue, overtired,
  });

  return {
    mode, phase, ageWeeks, currentBlock, blockLabel, nextAction,
    timers: { wakeWindowElapsedMin, napElapsedMin, sinceLastFeedMin, nextFeedEstimate },
    intake,
    activeRuleIds: FLIP_RULES.filter(r => r.mode === mode).map(r => r.id),
    nudges,
    escalations,
  };
}

type DescribeInput = {
  currentBlock: FlipBlock;
  inCatnapSlot: boolean;
  config: FlipConfig;
  facts: ActivityFacts;
  wakeWindowElapsedMin: number | null;
  sinceLastFeedMin: number | null;
  napCapHit: boolean;
  feedDue: boolean;
  overtired: boolean;
};

function describeBlock(i: DescribeInput): { blockLabel: string; nextAction: string } {
  const c = i.config;
  switch (i.currentBlock) {
    case 'needs-input':
      return {
        blockLabel: 'Needs a starting point',
        nextAction: 'No recent sleep data — set the actual last wake time below to start.',
      };
    case 'nap': {
      if (i.napCapHit) return { blockLabel: 'Nap (cap reached)', nextAction: `Wake her now — nap cap ${c.dayMode.napCapHr}h reached.` };
      if (i.feedDue) return { blockLabel: 'Nap (feed overdue)', nextAction: `Wake to feed — over ${c.dayMode.feedIntervalMaxHr}h since last feed.` };
      const wakeBy = i.facts.napStartTime ? fmt(addMinutes(i.facts.napStartTime, c.dayMode.napCapHr * 60)) : '';
      return { blockLabel: 'Napping', nextAction: `Wake by ${wakeBy} (nap cap ${c.dayMode.napCapHr}h). Bright room, no white noise.` };
    }
    case 'night-sleep':
      return { blockLabel: 'Night sleep', nextAction: 'Leave her be. Dark, white noise on. Feed on demand when she wakes.' };
    case 'night-hold':
      return { blockLabel: 'Night hold', nextAction: `Hold dark and boring until ${c.anchors.dayStart}. If hungry, feed in the dark — do not stall with a pacifier, do not start the day early.` };
    case 'night-feed':
      return { blockLabel: 'Night — robot mode', nextAction: 'Feed on demand. Dark, silent, minimal handling, change only if poopy.' };
    case 'feed-due':
      return { blockLabel: 'Feed due', nextAction: `Feed now — ${i.sinceLastFeedMin !== null ? fmtMin(i.sinceLastFeedMin) : 'long'} since last feed (max ${c.dayMode.feedIntervalMaxHr}h). Big daytime feeds are the lever.` };
    case 'bedtime-routine':
      return { blockLabel: 'Bedtime routine', nextAction: `Start the wind-down now — feed, fresh swaddle, dark room. Down by ${c.anchors.nightStart}.` };
    case 'awake': {
      if (i.overtired) {
        return { blockLabel: 'Awake (overtired)', nextAction: `Rescue now — ${fmtMin(i.wakeWindowElapsedMin!)} awake (ceiling ${c.dayMode.wakeWindowCeilingMin}m). Contact nap, motion, feeding down — whatever is fastest.` };
      }
      const downBy = i.facts.lastWakeTime ? fmt(addMinutes(i.facts.lastWakeTime, c.dayMode.wakeWindowTargetMin[1])) : '';
      if (i.inCatnapSlot) {
        return { blockLabel: 'Catnap window', nextAction: `Short catnap only (30-45m) — last wake by ${c.dayMode.lastWakeBy} to protect bedtime.` };
      }
      return { blockLabel: 'Awake window', nextAction: `Put down by ${downBy} — window ${i.wakeWindowElapsedMin !== null ? fmtMin(i.wakeWindowElapsedMin) : '?'} of target ${c.dayMode.wakeWindowTargetMin[0]}-${c.dayMode.wakeWindowTargetMin[1]}m.` };
    }
  }
}

function buildEscalations(config: FlipConfig, facts: ActivityFacts): FlipNudge[] {
  const out: FlipNudge[] = [];
  if (facts.wetDiapersLast24h !== null && facts.wetDiapersLast24h < 6) {
    out.push({
      id: 'R-42-wet',
      text: `Only ${facts.wetDiapersLast24h} wet diapers in the last 24h (minimum 6) — contact your pediatrician.`,
    });
  }
  if (facts.latestWeight && facts.previousWeight) {
    const deltaOz = facts.latestWeight.oz - facts.previousWeight.oz;
    const days = Math.max(
      1,
      (facts.latestWeight.date.getTime() - facts.previousWeight.date.getTime()) / 86400000,
    );
    const ozPerDay = deltaOz / days;
    if (deltaOz <= 0) {
      out.push({
        id: 'R-42-weight',
        text: 'No weight gain (or a loss) since the last measurement — contact your pediatrician.',
      });
    } else if (ozPerDay > 1.5) {
      out.push({
        id: 'R-33',
        text: `Latest weight implies ${round1(ozPerDay)} oz/day gain (plausible is ${config.feeding.growthOzPerDay[0]}-${config.feeding.growthOzPerDay[1]}). Double-check the measurement — a bad weight corrupts every feeding target.`,
      });
    }
  }
  return out;
}

function buildIntake(config: FlipConfig, facts: ActivityFacts, now: Date): FlipState['intake'] {
  if (!facts.latestWeight) return null;
  const days = Math.max(0, (now.getTime() - facts.latestWeight.date.getTime()) / 86400000);
  const [gLo, gHi] = config.feeding.growthOzPerDay;
  const projected: [number, number] = [
    round1(facts.latestWeight.oz + days * gLo),
    round1(facts.latestWeight.oz + days * gHi),
  ];
  const [iLo, iHi] = config.feeding.dailyOzPerLb;
  const dailyTarget: [number, number] = [
    round1((projected[0] / 16) * iLo),
    round1((projected[1] / 16) * iHi),
  ];
  return { projectedWeightOz: projected, dailyTargetOz: dailyTarget };
}
