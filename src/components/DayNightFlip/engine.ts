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

export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
export const parseHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
};
export const minutesBetween = (a: Date, b: Date) =>
  Math.floor((a.getTime() - b.getTime()) / 60000);
export const addMinutes = (d: Date, min: number) => new Date(d.getTime() + min * 60000);
export const fmtClock = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const fmtMin = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
const round1 = (n: number) => Math.round(n * 10) / 10;

export type SleepState = {
  sleeping: boolean;
  wakeKnown: boolean;
  napElapsedMin: number | null;
  rawWakeElapsed: number | null;
};

// Shared staleness/skew logic — resolveNow and projectDay must never disagree.
// A fact a couple of minutes ahead of `now` is clock skew (e.g. an override
// set between UI ticks), not bad data — clamp it to 0 rather than reject it.
export function sleepState(facts: ActivityFacts, now: Date): SleepState {
  const clampSkew = (min: number | null) =>
    min !== null && min >= -2 ? Math.max(0, min) : min;
  const rawNapElapsed = clampSkew(facts.napStartTime ? minutesBetween(now, facts.napStartTime) : null);
  const sleeping = rawNapElapsed !== null && rawNapElapsed >= 0 && rawNapElapsed < STALE_FACT_MIN;
  const rawWakeElapsed = clampSkew(facts.lastWakeTime ? minutesBetween(now, facts.lastWakeTime) : null);
  const wakeKnown = rawWakeElapsed !== null && rawWakeElapsed >= 0 && rawWakeElapsed < STALE_FACT_MIN;
  return { sleeping, wakeKnown, napElapsedMin: sleeping ? rawNapElapsed : null, rawWakeElapsed };
}

// R-24: the putdown time is decided by the awake window and the routine
// length, never by night_start (that anchor only flips the environment).
// Shared by resolveNow and projectDay so live guidance and the timeline
// can never disagree about when she goes down.
export function putdownTime(
  config: FlipConfig, finalWake: Date, routineStart: Date, bedtimeAnchor: Date,
): Date {
  let down = addMinutes(routineStart, config.durations.bedtimeRoutineMin);
  const anchorCap = addMinutes(bedtimeAnchor, 30);
  const ceilingCap = addMinutes(finalWake, config.dayMode.wakeWindowCeilingMin);
  if (down > anchorCap) down = anchorCap;
  if (down > ceilingCap) down = ceilingCap; // compress the routine, never stretch the window
  return down < routineStart ? routineStart : down;
}

const RESCUE_FINAL_NAP_AFTER_MIN = 16 * 60; // R-20: rescue at/after ~16:00

export type RescueTiming = {
  isFinalNap: boolean;
  wakeBy: Date | null;        // rescue nap cap (R-20)
  routineStart: Date | null;  // early bedtime (R-21)
};

export function rescueTiming(config: FlipConfig, now: Date): RescueTiming {
  if (minutesOfDay(now) < RESCUE_FINAL_NAP_AFTER_MIN) {
    return { isFinalNap: false, wakeBy: null, routineStart: null };
  }
  const wakeBy = addMinutes(now, config.durations.rescueNapMaxMin);
  const projected = addMinutes(wakeBy, config.dayMode.wakeWindowTargetMin[1]);
  const anchorMin = parseHHMM(config.anchors.bedtimeRoutine);
  const anchor = new Date(now);
  anchor.setHours(Math.floor(anchorMin / 60), anchorMin % 60, 0, 0);
  return { isFinalNap: true, wakeBy, routineStart: projected < anchor ? projected : anchor };
}

export function resolveNow(config: FlipConfig, facts: ActivityFacts, now: Date): FlipState {
  const nowMin = minutesOfDay(now);
  const dayStartMin = parseHHMM(config.anchors.dayStart);
  const nightStartMin = parseHHMM(config.anchors.nightStart);
  const bedtimeMin = parseHHMM(config.anchors.bedtimeRoutine);
  const mode: 'day' | 'night' =
    nowMin >= dayStartMin && nowMin < nightStartMin ? 'day' : 'night';

  const ageWeeks = Math.floor(minutesBetween(now, facts.birthDate) / (60 * 24 * 7));
  const phase: FlipPhase = ageWeeks < 2 ? 'pre' : ageWeeks > 10 ? 'sunset' : 'active';

  // --- timers (stale facts are treated as unknown; see sleepState) ---
  const { sleeping, wakeKnown, napElapsedMin, rawWakeElapsed } = sleepState(facts, now);
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

  // R-23: a crash past lastWakeBy, before night_start, ends the day early —
  // fed within ~45min it converts to the night; unfed it stays a micro-nap.
  const lastWakeByMin = parseHHMM(config.dayMode.lastWakeBy);
  const eveningCrash = sleeping && mode === 'day' && facts.napStartTime !== null
    && minutesOfDay(facts.napStartTime) >= lastWakeByMin;
  const crashFed = eveningCrash && facts.lastFeedTime !== null
    && minutesBetween(facts.napStartTime!, facts.lastFeedTime) <= 45;

  // --- block resolution (spec section 5 order) ---
  let currentBlock: FlipBlock;
  if (!sleeping && !wakeKnown) currentBlock = 'needs-input';
  else if (sleeping) currentBlock = mode === 'day' && !crashFed ? 'nap' : 'night-sleep';
  else if (mode === 'night') currentBlock = nowMin < dayStartMin ? 'night-hold' : 'night-feed';
  else if (feedDue) currentBlock = 'feed-due';
  else if (nowMin >= bedtimeMin || (r21RoutineStartMin !== null && nowMin >= r21RoutineStartMin)) {
    currentBlock = 'bedtime-routine';
  } else currentBlock = 'awake';

  // R-24: the live "down by" target is the computed putdown, never night_start.
  let putdownAt: Date | null = null;
  if (currentBlock === 'bedtime-routine' && facts.lastWakeTime) {
    const timeOn = (m: number) => {
      const d = new Date(now);
      d.setHours(Math.floor(m / 60), m % 60, 0, 0);
      return d;
    };
    const routineMin = r21RoutineStartMin !== null && r21RoutineStartMin < bedtimeMin
      ? r21RoutineStartMin : bedtimeMin;
    putdownAt = putdownTime(config, facts.lastWakeTime, timeOn(routineMin), timeOn(bedtimeMin));
  }

  const inCatnapSlot =
    currentBlock === 'awake' && nowMin >= catnapStartMin && nowMin < catnapEndMin;

  // --- nudges ---
  const nudges: FlipNudge[] = [];
  if (mode === 'day' && sleeping && feedDue) {
    nudges.push({ id: 'D-2', text: `It has been over ${config.dayMode.feedIntervalMaxHr} hours since she ate. Wake her for a feed.` });
  }
  if (napCapHit && mode === 'day') {
    nudges.push({ id: 'D-3', text: `This nap hit its ${config.dayMode.napCapHr}-hour cap. Wake her up.` });
  }
  if (overtired) {
    nudges.push({ id: 'R-16', text: `She has been awake ${fmtMin(wakeWindowElapsedMin!)}, past the ${ceiling}-minute ceiling. Overtired needs more help, not more patience: skip the waiting and go straight to active soothing.` });
  }
  if (
    mode === 'day' && !sleeping && wakeKnown && facts.lastWakeTime &&
    minutesOfDay(facts.lastWakeTime) < dayStartMin && rawWakeElapsed! < nowMin // woke today, before anchor
  ) {
    nudges.push({ id: 'R-12', text: `She woke at ${fmtClock(facts.lastWakeTime)}, so her clock started then, not at ${config.anchors.dayStart}. The first nap comes earlier today.` });
  }
  if (r21RoutineStartMin !== null && currentBlock === 'bedtime-routine' && nowMin < bedtimeMin) {
    nudges.push({ id: 'R-21', text: 'Bedtime comes early tonight. Don\'t stretch her to hit the usual clock time; the normal schedule picks back up tomorrow.' });
  }
  if (eveningCrash) {
    nudges.push({
      id: 'R-23',
      text: crashFed
        ? 'She crashed for the night early, fed and done. Keep it dark with white noise from now; the morning anchor does not move.'
        : `She crashed before bedtime without a full feed. Wake her by ${fmtClock(addMinutes(facts.napStartTime!, 30))} for a compressed routine and a full feed, then down for the night.`,
    });
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
    putdownAt, r23MicroNap: eveningCrash && !crashFed,
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
  putdownAt: Date | null;
  r23MicroNap: boolean;
};

function describeBlock(i: DescribeInput): { blockLabel: string; nextAction: string } {
  const c = i.config;
  switch (i.currentBlock) {
    case 'needs-input':
      return {
        blockLabel: 'Needs a starting point',
        nextAction: 'There is no recent sleep data. Set her last wake time below to get started.',
      };
    case 'nap': {
      if (i.r23MicroNap) {
        const wakeBy = i.facts.napStartTime ? fmtClock(addMinutes(i.facts.napStartTime, 30)) : '';
        return { blockLabel: 'Micro-nap (keep it short)', nextAction: `Keep this a 20–30 minute doze. Wake her by ${wakeBy}, then a compressed routine with a full feed, and down for the night.` };
      }
      if (i.napCapHit) return { blockLabel: 'Nap (cap reached)', nextAction: `Wake her up. This nap hit its ${c.dayMode.napCapHr}-hour cap.` };
      if (i.feedDue) return { blockLabel: 'Nap (feed overdue)', nextAction: `Wake her for a feed. It has been over ${c.dayMode.feedIntervalMaxHr} hours.` };
      const wakeBy = i.facts.napStartTime ? fmtClock(addMinutes(i.facts.napStartTime, c.dayMode.napCapHr * 60)) : '';
      return { blockLabel: 'Napping', nextAction: `Wake her by ${wakeBy}. Keep the room bright with normal household noise.` };
    }
    case 'night-sleep':
      return { blockLabel: 'Night sleep', nextAction: 'Leave her be. Dark, white noise on. Feed on demand when she wakes.' };
    case 'night-hold':
      return { blockLabel: 'Night hold', nextAction: `Keep it dark until ${c.anchors.dayStart}. If she's hungry, feed her in the dark. Don't stall with a pacifier, and don't start the day early.` };
    case 'night-feed':
      return { blockLabel: 'Robot mode', nextAction: 'Feed when she asks. Keep it dark and quiet, handle her as little as possible, and only change a poopy diaper.' };
    case 'feed-due':
      return { blockLabel: 'Feed due', nextAction: `Time to feed. It has been ${i.sinceLastFeedMin !== null ? fmtMin(i.sinceLastFeedMin) : 'a while'} (the daytime max is ${c.dayMode.feedIntervalMaxHr} hours).` };
    case 'bedtime-routine':
      return { blockLabel: 'Bedtime routine', nextAction: `Start the wind-down: feed, fresh swaddle, dim room. Down by ${i.putdownAt ? fmtClock(i.putdownAt) : c.anchors.bedtimeRoutine}.` };
    case 'awake': {
      if (i.overtired) {
        return { blockLabel: 'Awake (overtired)', nextAction: `She has been up ${fmtMin(i.wakeWindowElapsedMin!)}, past the ${c.dayMode.wakeWindowCeilingMin}-minute ceiling. Rescue the nap now: hold her, use motion, or feed her down, whatever works fastest.` };
      }
      const downBy = i.facts.lastWakeTime ? fmtClock(addMinutes(i.facts.lastWakeTime, c.dayMode.wakeWindowTargetMin[1])) : '';
      if (i.inCatnapSlot) {
        return { blockLabel: 'Catnap window', nextAction: `Keep this catnap short, 30–45 minutes. Have her up by ${c.dayMode.lastWakeBy} so bedtime still lands.` };
      }
      return { blockLabel: 'Awake window', nextAction: `Put her down by ${downBy}. She has been up ${i.wakeWindowElapsedMin !== null ? fmtMin(i.wakeWindowElapsedMin) : 'a while'} of a ${c.dayMode.wakeWindowTargetMin[0]}–${c.dayMode.wakeWindowTargetMin[1]} minute window.` };
    }
  }
}

function buildEscalations(config: FlipConfig, facts: ActivityFacts): FlipNudge[] {
  const out: FlipNudge[] = [];
  if (facts.wetDiapersLast24h !== null && facts.wetDiapersLast24h < 6) {
    out.push({
      id: 'R-42-wet',
      text: `Only ${facts.wetDiapersLast24h} wet diapers in the last 24 hours, under the minimum of 6. Call your pediatrician.`,
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
        text: 'Her weight is flat or down since the last measurement. Call your pediatrician.',
      });
    } else if (ozPerDay > 1.5) {
      out.push({
        id: 'R-33',
        text: `The latest weight works out to ${round1(ozPerDay)} oz/day of gain, well above the usual ${config.feeding.growthOzPerDay[0]}–${config.feeding.growthOzPerDay[1]}. Double-check the measurement, since feeding targets are based on it.`,
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
