// Pure projection of the rest of the day from the baby's real current state.
// Past = actual logs; future = simulated protocol cycle; anchors never move (R-22).

import { FlipConfig } from './protocol';
import {
  ActivityFacts, sleepState, minutesOfDay, parseHHMM, addMinutes,
} from './engine';

export type ScheduleBlock = {
  start: Date;
  end: Date | null;            // null => point event (feed) or open-ended
  kind: 'wake-feed' | 'awake' | 'nap' | 'catnap' | 'bedtime-routine'
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

  if (isTemplate) {
    simWake = windowStart; // idealized day starts at the anchor
    lastFeed = windowStart;
    blocks.push({
      start: windowStart, end: null, kind: 'wake-feed',
      label: 'Wake + feed', note: 'Lights on, curtains open — the day starts now no matter how the night went.',
      source: 'anchor', isNow: false,
    });
  } else if (st.sleeping && facts.napStartTime) {
    lastFeed = facts.lastFeedTime;
    // current sleep: ends at cap or wake-to-feed (D-2), whichever first
    const capEnd = addMinutes(facts.napStartTime, capMin);
    const feedEnd = lastFeed ? addMinutes(lastFeed, feedMaxMin) : capEnd;
    const isNight = minutesOfDay(now) >= nightStartMin || minutesOfDay(now) < dayStartMin;
    // A sleep that began before night_start rolls into the night: clip it at
    // the anchor so "Down for the night" carries the rest of the stretch, and
    // leave NOW placement to the marking pass (it belongs on the segment
    // containing `now`, not on the block's 18:xx start time).
    const startedBeforeNight = isNight && facts.napStartTime < nightStart;
    const end = isNight
      ? (startedBeforeNight ? nightStart : null)
      : (capEnd < feedEnd ? capEnd : feedEnd);
    blocks.push({
      start: facts.napStartTime < windowStart ? windowStart : facts.napStartTime,
      end,
      kind: isNight ? 'night-sleep' : 'nap',
      label: isNight
        ? (startedBeforeNight ? 'Asleep — rolling into the night' : 'Night sleep')
        : 'Napping now',
      note: isNight ? undefined : 'Wake her at the marked time — cap or feed, whichever comes first.',
      source: 'projected', isNow: !isNight,
    });
    simWake = end && end > now ? end : now;
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
  while (guard++ < 12) {
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
      blocks.push({ start: when, end: null, kind: 'feed', label: 'Feed', note: 'Full, unhurried, paced — daytime calories are the lever.', source: 'projected', isNow: false });
      lastFeed = when;
    }

    const inCatnap = minutesOfDay(napStart) >= catnapStartMin;
    const capEnd = addMinutes(napStart, inCatnap ? 45 : capMin);
    const feedBound = lastFeed ? addMinutes(lastFeed, feedMaxMin) : capEnd;
    const lastWakeBound = atTime(windowStart, lastWakeByMin);
    let napEnd = capEnd < feedBound ? capEnd : feedBound;
    if (inCatnap && napEnd > lastWakeBound) napEnd = lastWakeBound;
    if (napEnd > bedtimeAnchor) napEnd = bedtimeAnchor;

    if (napStart > now && napEnd > napStart) {
      blocks.push({
        start: napStart, end: napEnd,
        kind: inCatnap ? 'catnap' : 'nap',
        label: inCatnap ? 'Catnap — short!' : 'Nap',
        note: inCatnap ? `Wake by ${config.dayMode.lastWakeBy} to protect bedtime.` : `Cap ${config.dayMode.napCapHr}h — wake her.`,
        source: 'projected', isNow: false,
      });
    }
    simWake = napEnd;
    if (inCatnap) break;
  }

  // --- evening anchors + night ---
  const finalWakeMin = minutesOfDay(simWake);
  const earlyRoutine = finalWakeMin >= catnapStartMin && finalWakeMin + targetHi < bedtimeMin
    ? addMinutes(simWake, targetHi) : bedtimeAnchor;
  const routineStart = earlyRoutine < bedtimeAnchor ? earlyRoutine : bedtimeAnchor;
  if (routineStart >= now || isTemplate) {
    blocks.push({
      start: routineStart, end: nightStart, kind: 'bedtime-routine',
      label: 'Bedtime routine',
      note: routineStart < bedtimeAnchor
        ? 'Early tonight (R-21) — never stretch an overtired baby to a clock time. Normal anchor resumes tomorrow.'
        : 'Feed, fresh swaddle, dim lights, white noise on.',
      source: 'anchor', isNow: false,
    });
  }
  blocks.push({
    start: nightStart, end: null, kind: 'night-sleep',
    label: 'Down for the night',
    note: 'Robot mode — dark, silent, boring. Shifts start.',
    source: 'anchor', isNow: false,
  });
  for (const sf of config.nightMode.scheduledFeeds) {
    const m = parseHHMM(sf);
    const when = m >= nightStartMin ? atTime(windowStart, m) : atTime(windowStart, m, 1);
    if (when < now && !isTemplate) continue; // already past
    blocks.push({
      start: when, end: null, kind: 'night-feed',
      label: 'Night feed', note: 'Estimate, never an alarm — feed when she asks.',
      source: 'projected', isNow: false,
    });
  }
  const lastSf = config.nightMode.scheduledFeeds[config.nightMode.scheduledFeeds.length - 1];
  const holdStart = lastSf
    ? (parseHHMM(lastSf) >= nightStartMin ? atTime(windowStart, parseHHMM(lastSf)) : atTime(windowStart, parseHHMM(lastSf), 1))
    : nightStart;
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
