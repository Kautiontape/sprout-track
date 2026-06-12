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
    text: 'Cap every nap, and wake her when it hits',
    why: 'Daytime sleep displaced into night is the disease being treated.' },
  { id: 'D-4', mode: 'day',
    text: 'Unswaddle for awake time and feeds; fresh swaddle only at putdown',
    why: 'Makes the swaddle a sleep cue (only worn for sleep) and keeps baby alert enough to take full feeds.' },
  { id: 'D-5', mode: 'day',
    text: 'No white noise for daytime naps (rescue naps excepted)',
    why: 'White noise is reserved as a night cue; "worse" daytime naps are the goal during the flip.' },
  { id: 'D-6', mode: 'day',
    text: 'Feeds are full, unhurried, and paced. Keep her stimulated while she eats.',
    why: 'Every ounce she takes during the day is an ounce she won’t demand at 2am.' },
  { id: 'D-7', mode: 'day',
    text: 'Cycle order: unswaddle, feed, awake time, diaper change, re-swaddle, down',
    why: 'Change-last gives a fresh diaper for the nap and makes the change part of the wind-down sequence.' },
  { id: 'D-8', mode: 'day',
    text: 'Feeding counts as awake time; don’t stretch the window to fit in play',
    why: 'The window is total time out of sleep, not a play quota. A slow feed can be a complete window.' },
  { id: 'N-1', mode: 'night',
    text: 'Pitch dark, silent, no talking, no eye contact — robot mode',
    why: 'Boring nights plus stimulating days create the contrast that flips the clock.' },
  { id: 'N-2', mode: 'night',
    text: 'Feed on demand. The scheduled night feeds are estimates, not alarms.',
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

export type FlipFaqEntry = { id: string; question: string; answer: string };

// Ruleset section 5 — the rationale bank. Strings double as en.json keys.
export const FLIP_FAQ: FlipFaqEntry[] = [
  { id: 'faq-1', question: 'Why does this work at all?',
    answer: 'No circadian rhythm exists before ~6–10 weeks; the baby’s clock is trained by environmental contrast — light, noise, stimulation, and calorie timing. Day/night confusion is the most fixable newborn sleep problem.' },
  { id: 'faq-2', question: 'Why wake a sleeping baby?',
    answer: 'Daytime sleep and daytime calories displace nighttime wakefulness and night hunger. The nap cap and forced day feeds are the two levers doing the flipping; skip them and the night stays broken.' },
  { id: 'faq-3', question: 'Why are worse daytime naps good?',
    answer: 'Light, noisy, shallow day sleep sharpens the contrast with deep night sleep. It feels backwards, but the contrast is the whole mechanism.' },
  { id: 'faq-4', question: 'Why no sleep training yet?',
    answer: 'Self-settling emerges around 3–4 months. Before that, “letting her figure it out” isn’t on the menu — and you can’t spoil a newborn, so helping is free.' },
  { id: 'faq-5', question: 'Why swaddle only for sleep?',
    answer: 'Cues work by exclusivity. Swaddle-only-for-sleep makes wrapping mean “we’re going down now.” The same logic gates white noise to nights.' },
  { id: 'faq-6', question: 'Why does she scream in the crib but sleep on my chest?',
    answer: 'Flat position worsens gas discomfort; a chest is upright with warm belly pressure. Add normal newborn contact preference and the Moro reflex on transfer. Counters: deep-sleep transfer via the limp-arm test, feet-first lay-down, a pre-warmed bassinet, and a hand on her chest for 30 seconds.' },
  { id: 'faq-7', question: 'Won’t early bedtime cause a 5am start?',
    answer: 'Sleep isn’t a fixed tank. Overtired produces a fragmented night; well-rested produces a better night. Sleep begets sleep at this age.' },
  { id: 'faq-8', question: 'Why does the pacifier keep failing?',
    answer: 'It needs active sucking; an overtired baby can’t sustain it, so you get the spit, cry, replace loop. It’s a soothing tool, not a stalling tool, and it should never be used to delay a hungry baby.' },
  { id: 'faq-9', question: 'Why does eating count as awake time?',
    answer: 'The window measures time out of sleep, not play. A 40-minute feed plus a change is a complete window for a slow eater.' },
  { id: 'faq-10', question: 'Why estimates instead of exact feed amounts?',
    answer: 'Intake targets derive from weight, vary feed to feed, and the growth curve — the pediatrician’s data — always outranks rules of thumb.' },
  { id: 'faq-11', question: 'Why anchors AND windows?',
    answer: 'Two independent systems: anchors (fixed clock times) train the circadian rhythm via light; windows (elapsed timers) prevent overtiredness via sleep pressure. They drift apart on early-wake days — the window wins for when, the anchor wins for environment.' },
];
