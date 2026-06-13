// Pure projection of the rest of the day from the baby's real current state.
// Past = actual logs; future = simulated protocol cycle; anchors never move (R-22).

import { FlipConfig } from './protocol';
import {
  ActivityFacts, sleepState, putdownTime, minutesOfDay, minutesBetween, parseHHMM, addMinutes,
} from './engine';

export type ScheduleBlock = {
  start: Date;
  end: Date | null;            // null => point event (feed) or open-ended
  kind: 'wake-feed' | 'awake' | 'nap' | 'catnap' | 'bedtime-routine' | 'putdown'
      | 'night-sleep' | 'night-feed' | 'night-hold' | 'feed';
  label: string;
  note?: string;
  source: 'actual' | 'projected' | 'anchor';
  isNow: boolean;
};

export type TodayLogs = {
  sleeps: { start: Date; end: Date | null }[];
  feeds: Date[];
};

export type ProjectedDay = { blocks: ScheduleBlock[]; isTemplate: boolean };

const atTime = (ref: Date, minOfDay: number, dayOffset = 0) => {
  const d = new Date(ref);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(minOfDay / 60), minOfDay % 60, 0, 0);
  return d;
};

export function projectDay(
  config: FlipConfig,
  facts: ActivityFacts,
  todayLogs: TodayLogs,
  now: Date,
): ProjectedDay {
  const dayStartMin = parseHHMM(config.anchors.dayStart);
  const nightStartMin = parseHHMM(config.anchors.nightStart);
  const bedtimeMin = parseHHMM(config.anchors.bedtimeRoutine);
  const targetHi = config.dayMode.wakeWindowTargetMin[1];
  const capMin = config.dayMode.napCapHr * 60;
  const feedMaxMin = config.dayMode.feedIntervalMaxHr * 60;
  const catnapStartMin = parseHHMM(config.dayMode.catnapSlot[0]);
  const lastWakeByMin = parseHHMM(config.dayMode.lastWakeBy);

  // The display window starts at the most recent day_start.
  const windowStart = minutesOfDay(now) >= dayStartMin
    ? atTime(now, dayStartMin)
    : atTime(now, dayStartMin, -1);
  const windowEnd = addMinutes(windowStart, 24 * 60); // next day_start
  const bedtimeAnchor = atTime(windowStart, bedtimeMin);
  const nightStart = atTime(windowStart, nightStartMin);

  const st = sleepState(facts, now);
  const isTemplate = !st.sleeping && !st.wakeKnown;

  const blocks: ScheduleBlock[] = [];

  // --- past: actual logs inside the window ---
  if (!isTemplate) {
    for (const sl of todayLogs.sleeps) {
      if ((sl.end ?? now) <= windowStart || sl.start >= now) continue;
      if (st.sleeping && facts.napStartTime && sl.start.getTime() === facts.napStartTime.getTime()) {
        continue; // the open log becomes the live "napping now" block below
      }
      const start = sl.start < windowStart ? windowStart : sl.start;
      const isNight = minutesOfDay(start) >= nightStartMin || minutesOfDay(start) < dayStartMin;
      blocks.push({
        start, end: sl.end ?? null,
        kind: isNight ? 'night-sleep' : 'nap',
        label: isNight ? 'Night sleep (logged)' : 'Nap (logged)',
        source: 'actual', isNow: false,
      });
    }
    for (const f of todayLogs.feeds) {
      if (f < windowStart || f > now) continue;
      blocks.push({ start: f, end: null, kind: 'feed', label: 'Feed (logged)', source: 'actual', isNow: false });
    }
  }

  // --- simulation seed ---
  let lastFeed: Date | null;
  let simWake: Date; // when the next awake stretch begins (sim "last wake")
  const lastWakeBound = atTime(windowStart, lastWakeByMin);
  let earlyNight = false;        // R-23: fed crash — tonight started at the crash
  let compressedRoutine = false; // R-23: unfed crash — micro-nap, then straight down

  if (isTemplate) {
    simWake = windowStart; // idealized day starts at the anchor
    lastFeed = windowStart;
    blocks.push({
      start: windowStart, end: null, kind: 'wake-feed',
      label: 'Wake + feed', note: 'Lights on, curtains open. The day starts now, however the night went.',
      source: 'anchor', isNow: false,
    });
  } else if (st.sleeping && facts.napStartTime) {
    lastFeed = facts.lastFeedTime;
    // current sleep: ends at cap or wake-to-feed (D-2), whichever first
    const capEnd = addMinutes(facts.napStartTime, capMin);
    const feedEnd = lastFeed ? addMinutes(lastFeed, feedMaxMin) : capEnd;
    const isNight = minutesOfDay(now) >= nightStartMin || minutesOfDay(now) < dayStartMin;
    // R-23: a crash past lastWakeBy, before night_start, ends the day early.
    const eveningCrash = !isNight && facts.napStartTime >= lastWakeBound;
    if (eveningCrash && lastFeed && minutesBetween(facts.napStartTime, lastFeed) <= 45) {
      // Fed within ~45min of the crash: this IS the night. The putdown is the
      // crash itself; night feed estimates shift earlier, the morning holds.
      earlyNight = true;
      blocks.push({
        start: facts.napStartTime, end: null, kind: 'putdown',
        label: 'Down for the night',
        note: 'She crashed early, fed and done — tonight starts here. Dark and white noise from now; the morning anchor does not move.',
        source: 'projected', isNow: false,
      });
      simWake = now;
    } else if (eveningCrash) {
      // Not fed: let it stay a 20–30 minute doze, then a compressed routine
      // with a full feed before she goes down for real.
      compressedRoutine = true;
      const microEnd = addMinutes(facts.napStartTime, 30);
      blocks.push({
        start: facts.napStartTime, end: microEnd, kind: 'nap',
        label: 'Micro-nap (keep it short)',
        note: 'She crashed before bedtime without a feed. Let her doze 20–30 minutes, then wake her for the routine.',
        source: 'projected', isNow: true,
      });
      simWake = microEnd > now ? microEnd : now;
    } else {
      // A sleep that began before night_start rolls into the night: clip it at
      // the anchor so the night carries the rest of the stretch, and leave NOW
      // placement to the marking pass (it belongs on the segment containing
      // `now`, not on the block's 18:xx start time).
      const startedBeforeNight = isNight && facts.napStartTime < nightStart;
      const end = isNight
        ? (startedBeforeNight ? nightStart : null)
        : (capEnd < feedEnd ? capEnd : feedEnd);
      blocks.push({
        start: facts.napStartTime < windowStart ? windowStart : facts.napStartTime,
        end,
        kind: isNight ? 'night-sleep' : 'nap',
        label: isNight
          ? (startedBeforeNight ? 'Asleep early, rolling into the night' : 'Night sleep')
          : 'Napping now',
        note: isNight ? undefined : 'Wake her by the end time shown, for the nap cap or the next feed.',
        source: 'projected', isNow: !isNight,
      });
      simWake = end && end > now ? end : now;
    }
  } else {
    simWake = facts.lastWakeTime!;
    lastFeed = facts.lastFeedTime;
    if (minutesOfDay(now) >= dayStartMin && minutesOfDay(now) < nightStartMin && simWake < bedtimeAnchor) {
      blocks.push({
        start: simWake, end: addMinutes(simWake, targetHi), kind: 'awake',
        label: 'Awake window', source: 'projected', isNow: true,
      });
    }
  }

  // --- simulate forward through the day ---
  let guard = 0;
  while (!earlyNight && !compressedRoutine && guard++ < 12) {
    // R-21: a final wake at/after the catnap slot pulls the routine early
    const wakeMin = minutesOfDay(simWake);
    const routineAt = wakeMin >= catnapStartMin && wakeMin + targetHi < bedtimeMin
      ? addMinutes(simWake, targetHi)
      : bedtimeAnchor;
    const napStart = addMinutes(simWake, targetHi);
    if (napStart >= routineAt || simWake >= bedtimeAnchor) break;

    // feed on wake (projected) when due before the nap
    const feedAt = lastFeed ? addMinutes(lastFeed, feedMaxMin) : simWake;
    if (feedAt <= napStart && feedAt > now) {
      const when = feedAt < simWake ? simWake : feedAt;
      blocks.push({ start: when, end: null, kind: 'feed', label: 'Feed', note: 'A full, unhurried feed.', source: 'projected', isNow: false });
      lastFeed = when;
    }

    const inCatnap = minutesOfDay(napStart) >= catnapStartMin;
    const capEnd = addMinutes(napStart, inCatnap ? 45 : capMin);
    const feedBound = lastFeed ? addMinutes(lastFeed, feedMaxMin) : capEnd;
    let napEnd = capEnd < feedBound ? capEnd : feedBound;
    if (inCatnap && napEnd > lastWakeBound) napEnd = lastWakeBound;
    if (napEnd > bedtimeAnchor) napEnd = bedtimeAnchor;

    if (napStart > now && napEnd > napStart) {
      blocks.push({
        start: napStart, end: napEnd,
        kind: inCatnap ? 'catnap' : 'nap',
        label: inCatnap ? 'Catnap (keep it short)' : 'Nap',
        note: inCatnap ? `Wake her by ${config.dayMode.lastWakeBy} so bedtime still lands.` : `Wake her after ${config.dayMode.napCapHr} hours at most.`,
        source: 'projected', isNow: false,
      });
    }
    simWake = napEnd;
    if (inCatnap) break;
  }

  // --- evening anchors + night ---
  if (!earlyNight) {
    const finalWakeMin = minutesOfDay(simWake);
    const earlyRoutine = finalWakeMin >= catnapStartMin && finalWakeMin + targetHi < bedtimeMin
      ? addMinutes(simWake, targetHi) : bedtimeAnchor;
    const routineStart = compressedRoutine
      ? simWake // R-23: straight from the micro-nap into the wind-down
      : (earlyRoutine < bedtimeAnchor ? earlyRoutine : bedtimeAnchor);
    // R-24: the putdown is its own event, computed from the wake window;
    // the routine ends at the putdown, never at night_start.
    const putdownAt = putdownTime(config, simWake, routineStart, bedtimeAnchor);
    if (routineStart >= now || isTemplate) {
      blocks.push({
        start: routineStart, end: putdownAt, kind: 'bedtime-routine',
        label: 'Bedtime routine',
        note: compressedRoutine
          ? 'Compressed tonight: a full feed, fresh swaddle, straight down.'
          : 'Feed, fresh swaddle, dim lights, white noise on.',
        source: 'anchor', isNow: false,
      });
    }
    if (putdownAt >= now || isTemplate) {
      blocks.push({
        start: putdownAt, end: null, kind: 'putdown',
        label: 'Down for the night',
        note: routineStart < bedtimeAnchor
          ? 'Earlier than usual tonight. The regular time returns tomorrow.'
          : undefined,
        source: 'projected', isNow: false,
      });
    }
  }
  blocks.push({
    start: nightStart, end: null, kind: 'night-sleep',
    label: 'Night mode',
    note: 'Robot mode: dark, silent, boring. Shifts start now.',
    source: 'anchor', isNow: false,
  });
  // R-23: when the night started at the crash, feed estimates shift earlier
  // by the same amount; the morning anchor never moves.
  const nightShiftMin = earlyNight && facts.napStartTime
    ? nightStartMin - minutesOfDay(facts.napStartTime) : 0;
  const feedEstimate = (hhmm: string) => {
    const m = parseHHMM(hhmm);
    return addMinutes(m >= nightStartMin ? atTime(windowStart, m) : atTime(windowStart, m, 1), -nightShiftMin);
  };
  for (const sf of config.nightMode.scheduledFeeds) {
    const when = feedEstimate(sf);
    if (when < now && !isTemplate) continue; // already past
    blocks.push({
      start: when, end: null, kind: 'night-feed',
      label: 'Night feed', note: 'An estimate, not an alarm. Feed when she asks.',
      source: 'projected', isNow: false,
    });
  }
  const lastSf = config.nightMode.scheduledFeeds[config.nightMode.scheduledFeeds.length - 1];
  const holdStart = lastSf ? feedEstimate(lastSf) : nightStart;
  blocks.push({
    start: holdStart, end: windowEnd, kind: 'night-hold',
    label: 'Hold the line',
    note: `Even if she fusses after a feed, keep it dark. The day starts at ${config.anchors.dayStart}, not before.`,
    source: 'anchor', isNow: false,
  });

  // --- sort, clip to window, mark NOW ---
  const sorted = blocks
    .filter(b => b.start >= windowStart && b.start < windowEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (!sorted.some(b => b.isNow)) {
    // mark the last range block whose span contains now
    for (let i = sorted.length - 1; i >= 0; i--) {
      const b = sorted[i];
      if (b.kind === 'feed' || b.kind === 'night-feed') continue;
      const end = b.end ?? (i + 1 < sorted.length ? sorted[i + 1].start : windowEnd);
      if (b.start <= now && now < end) {
        b.isNow = true;
        break;
      }
    }
  }
  if (!sorted.some(b => b.isNow)) {
    // boundary fallback: the most recent range block that has started
    for (let i = sorted.length - 1; i >= 0; i--) {
      const b = sorted[i];
      if (b.kind === 'feed' || b.kind === 'night-feed') continue;
      if (b.start <= now) { b.isNow = true; break; }
    }
  }

  return { blocks: sorted, isTemplate };
}
