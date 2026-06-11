# Day/Night Flip MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Day/Night Flip tool from the approved spec (`docs/superpowers/specs/2026-06-11-day-night-flip-design.md`): a "now" page under the app shell that resolves the current protocol block from live activity data, plus a per-baby config tab in Edit Baby.

**Architecture:** A pure, dependency-free engine (`resolveNow`) consumes a merged per-baby `FlipConfig` + an `ActivityFacts` snapshot derived from existing logs (with a localStorage manual override). React components render the result and tick on an interval. Config persists as a `dayNightFlipConfig` JSON-string column on `Baby`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 6 + SQLite, Tailwind + CVA conventions, `node:test` via the already-installed `tsx` (no new dependencies — **do NOT run plain `npm install`; it fails on a sharp install-script race;** if deps are ever needed: `npm ci --include=dev --ignore-scripts && npm rebuild sharp better-sqlite3`).

**Conventions:**
- Commits: `flip: <message>`, never add `Co-Authored-By`.
- All static user-facing strings go through `t()`; en.json keys ARE the English strings (key === value). Dynamic composed strings (timer text with embedded times) render as-is — documented MVP tradeoff.
- Tests run with: `npx tsx --test <files>` (Node 22 built-in test runner). Test files use **relative imports only** (no `@/` aliases — Node's loader won't resolve them).
- The local DB at `db/baby-tracker.db` is real prod-snapshot data (family `squire`, baby Sylvie). Back it up before the migration task.

---

### Task 1: protocol.ts — FlipConfig, defaults, merge, rule bank (TDD)

**Files:**
- Create: `src/components/DayNightFlip/protocol.ts`
- Test: `src/components/DayNightFlip/protocol.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/DayNightFlip/protocol.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FLIP_CONFIG, mergeFlipConfig, FLIP_RULES } from './protocol';

test('defaults match the source ruleset config block', () => {
  assert.equal(DEFAULT_FLIP_CONFIG.enabled, false);
  assert.equal(DEFAULT_FLIP_CONFIG.feedingMethod, 'bottle');
  assert.deepEqual(DEFAULT_FLIP_CONFIG.anchors, {
    dayStart: '08:00', bedtimeRoutine: '19:15', nightStart: '20:00',
  });
  assert.equal(DEFAULT_FLIP_CONFIG.dayMode.feedIntervalMaxHr, 3);
  assert.equal(DEFAULT_FLIP_CONFIG.dayMode.napCapHr, 2);
  assert.deepEqual(DEFAULT_FLIP_CONFIG.dayMode.wakeWindowTargetMin, [45, 60]);
  assert.equal(DEFAULT_FLIP_CONFIG.dayMode.wakeWindowCeilingMin, 75);
  assert.deepEqual(DEFAULT_FLIP_CONFIG.dayMode.catnapSlot, ['17:00', '18:30']);
  assert.equal(DEFAULT_FLIP_CONFIG.dayMode.lastWakeBy, '18:30');
  assert.deepEqual(DEFAULT_FLIP_CONFIG.nightMode.feedExpectedIntervalHr, [2.5, 4]);
  assert.deepEqual(DEFAULT_FLIP_CONFIG.nightMode.scheduledFeeds, ['23:00', '02:00', '05:00']);
  assert.deepEqual(DEFAULT_FLIP_CONFIG.feeding.dailyOzPerLb, [2.0, 2.5]);
  assert.deepEqual(DEFAULT_FLIP_CONFIG.feeding.growthOzPerDay, [0.5, 1.0]);
  assert.deepEqual(DEFAULT_FLIP_CONFIG.durations, {
    fussWaitMin: [5, 10], putdownAbandonMin: 20, rescueNapMaxMin: 90,
  });
});

test('mergeFlipConfig: null/garbage/partial all merge over defaults', () => {
  assert.deepEqual(mergeFlipConfig(null), DEFAULT_FLIP_CONFIG);
  assert.deepEqual(mergeFlipConfig(undefined), DEFAULT_FLIP_CONFIG);
  assert.deepEqual(mergeFlipConfig('not json {'), DEFAULT_FLIP_CONFIG);
  assert.deepEqual(mergeFlipConfig('"just a string"'), DEFAULT_FLIP_CONFIG);

  const partial = mergeFlipConfig(JSON.stringify({
    enabled: true,
    anchors: { dayStart: '07:30' },
    dayMode: { napCapHr: 1.5 },
  }));
  assert.equal(partial.enabled, true);
  assert.equal(partial.anchors.dayStart, '07:30');
  assert.equal(partial.anchors.bedtimeRoutine, '19:15'); // default survives
  assert.equal(partial.dayMode.napCapHr, 1.5);
  assert.equal(partial.dayMode.wakeWindowCeilingMin, 75); // default survives
});

test('rule bank covers all day and night mode rules', () => {
  const dayIds = FLIP_RULES.filter(r => r.mode === 'day').map(r => r.id);
  const nightIds = FLIP_RULES.filter(r => r.mode === 'night').map(r => r.id);
  assert.deepEqual(dayIds, ['D-1', 'D-2', 'D-3', 'D-4', 'D-5', 'D-6', 'D-7', 'D-8']);
  assert.deepEqual(nightIds, ['N-1', 'N-2', 'N-3', 'N-4', 'N-5', 'N-6', 'N-7']);
  for (const r of FLIP_RULES) {
    assert.ok(r.text.length > 10, `${r.id} has text`);
    assert.ok(r.why.length > 10, `${r.id} has why`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/components/DayNightFlip/protocol.test.ts`
Expected: FAIL — cannot find module `./protocol`

- [ ] **Step 3: Write the implementation**

```ts
// src/components/DayNightFlip/protocol.ts
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
} as const;

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/components/DayNightFlip/protocol.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/DayNightFlip/protocol.ts src/components/DayNightFlip/protocol.test.ts
git commit -m "flip: add protocol config, defaults, merge, and rule bank"
```

---

### Task 2: engine.ts — mode + block resolution (TDD)

**Files:**
- Create: `src/components/DayNightFlip/engine.ts`
- Test: `src/components/DayNightFlip/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/DayNightFlip/engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNow, ActivityFacts } from './engine';
import { DEFAULT_FLIP_CONFIG, FlipConfig } from './protocol';

const CFG: FlipConfig = { ...DEFAULT_FLIP_CONFIG, enabled: true };

// All test times are built on a fixed local date.
const at = (h: number, m = 0, dayOffset = 0) =>
  new Date(2026, 5, 11 + dayOffset, h, m, 0, 0); // 2026-06-11 local

const BIRTH = new Date(2026, 4, 14); // ~4 weeks before — phase 'active'

function facts(over: Partial<ActivityFacts> = {}): ActivityFacts {
  return {
    lastWakeTime: null,
    napStartTime: null,
    lastFeedTime: null,
    wetDiapersLast24h: null,
    dirtyDiapersLast24h: null,
    latestWeight: null,
    previousWeight: null,
    birthDate: BIRTH,
    ...over,
  };
}

test('mode boundaries: day_start inclusive, night_start exclusive', () => {
  const f = facts({ lastWakeTime: at(7, 30) });
  assert.equal(resolveNow(CFG, f, at(8, 0)).mode, 'day');
  assert.equal(resolveNow(CFG, f, at(19, 59)).mode, 'day');
  assert.equal(resolveNow(CFG, facts({ lastWakeTime: at(19, 30) }), at(20, 0)).mode, 'night');
  assert.equal(resolveNow(CFG, facts({ lastWakeTime: at(7, 0) }), at(7, 59)).mode, 'night');
});

test('midnight crossing: 02:00 is night mode, night-feed/hold legs split on day_start', () => {
  const f = facts({ lastWakeTime: at(1, 30) });
  const s = resolveNow(CFG, f, at(2, 0));
  assert.equal(s.mode, 'night');
  assert.equal(s.currentBlock, 'night-hold'); // early-morning leg (before 08:00)
  const evening = resolveNow(CFG, facts({ lastWakeTime: at(20, 30) }), at(21, 0));
  assert.equal(evening.currentBlock, 'night-feed'); // evening leg (after 20:00)
});

test('needs-input when no facts or stale facts', () => {
  assert.equal(resolveNow(CFG, facts(), at(10, 0)).currentBlock, 'needs-input');
  // wake 13h ago is stale
  const stale = facts({ lastWakeTime: at(21, 0, -1) });
  assert.equal(resolveNow(CFG, stale, at(10, 0)).currentBlock, 'needs-input');
  // stale open sleep log is also unusable
  const staleNap = facts({ napStartTime: at(20, 0, -1) });
  assert.equal(resolveNow(CFG, staleNap, at(11, 0)).currentBlock, 'needs-input');
  // needs-input produces no fabricated timers
  const s = resolveNow(CFG, facts(), at(10, 0));
  assert.equal(s.timers.wakeWindowElapsedMin, null);
  assert.equal(s.timers.napElapsedMin, null);
});

test('sleeping: nap in day, night-sleep at night', () => {
  const napping = facts({ napStartTime: at(9, 30), lastWakeTime: at(8, 30) });
  assert.equal(resolveNow(CFG, napping, at(10, 0)).currentBlock, 'nap');
  const nightSleep = facts({ napStartTime: at(20, 30), lastWakeTime: at(19, 30) });
  assert.equal(resolveNow(CFG, nightSleep, at(23, 0)).currentBlock, 'night-sleep');
});

test('awake blocks: feed-due beats bedtime-routine beats awake', () => {
  // fed 3.5h ago in day mode -> feed-due
  const hungry = facts({ lastWakeTime: at(10, 0), lastFeedTime: at(7, 0) });
  assert.equal(resolveNow(CFG, hungry, at(10, 30)).currentBlock, 'feed-due');
  // 19:20 awake, fed recently -> bedtime-routine
  const evening = facts({ lastWakeTime: at(18, 25), lastFeedTime: at(18, 30) });
  assert.equal(resolveNow(CFG, evening, at(19, 20)).currentBlock, 'bedtime-routine');
  // plain awake mid-morning
  const plain = facts({ lastWakeTime: at(10, 0), lastFeedTime: at(10, 5) });
  assert.equal(resolveNow(CFG, plain, at(10, 30)).currentBlock, 'awake');
});

test('R-21 early bedtime: final wake at 17:30 pulls routine to ~18:30', () => {
  // wake at 17:30 (>= catnap slot start, so it is the day's final wake);
  // 17:30 + 60min target = 18:30 < 19:15 anchor -> at 18:35 we are in routine
  const f = facts({ lastWakeTime: at(17, 30), lastFeedTime: at(17, 45) });
  const s = resolveNow(CFG, f, at(18, 35));
  assert.equal(s.currentBlock, 'bedtime-routine');
  assert.ok(s.nudges.some(n => n.id === 'R-21'));
  // but a 10:00 wake does NOT trigger early bedtime at 11:05
  const mid = facts({ lastWakeTime: at(10, 0), lastFeedTime: at(10, 5) });
  assert.equal(resolveNow(CFG, mid, at(11, 5)).currentBlock, 'awake');
});

test('catnap slot labels the awake block', () => {
  const f = facts({ lastWakeTime: at(16, 50), lastFeedTime: at(16, 55) });
  const s = resolveNow(CFG, f, at(17, 10));
  assert.equal(s.currentBlock, 'awake');
  assert.match(s.blockLabel, /catnap/i);
});

test('R-12: early wake before day_start starts the window at actual wake', () => {
  const f = facts({ lastWakeTime: at(7, 30), lastFeedTime: at(7, 35) });
  const s = resolveNow(CFG, f, at(8, 15));
  assert.equal(s.timers.wakeWindowElapsedMin, 45); // from 7:30, not 8:00
  assert.ok(s.nudges.some(n => n.id === 'R-12'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/components/DayNightFlip/engine.test.ts`
Expected: FAIL — cannot find module `./engine`

- [ ] **Step 3: Write the engine (block resolution half)**

```ts
// src/components/DayNightFlip/engine.ts
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
  const rawNapElapsed = facts.napStartTime ? minutesBetween(now, facts.napStartTime) : null;
  const sleeping = rawNapElapsed !== null && rawNapElapsed >= 0 && rawNapElapsed < STALE_FACT_MIN;
  const napElapsedMin = sleeping ? rawNapElapsed : null;

  const rawWakeElapsed = facts.lastWakeTime ? minutesBetween(now, facts.lastWakeTime) : null;
  const wakeKnown = rawWakeElapsed !== null && rawWakeElapsed >= 0 && rawWakeElapsed < STALE_FACT_MIN;
  const wakeWindowElapsedMin = !sleeping && wakeKnown ? rawWakeElapsed : null;

  const sinceLastFeedMin = facts.lastFeedTime ? minutesBetween(now, facts.lastFeedTime) : null;

  const feedMaxMin = config.dayMode.feedIntervalMaxHr * 60;
  const feedDue = sinceLastFeedMin !== null && sinceLastFeedMin >= feedMaxMin;
  const napCapMin = config.dayMode.napCapHr * 60;
  const napCapHit = sleeping && napElapsedMin! >= napCapMin;
  const ceiling = config.dayMode.wakeWindowCeilingMin;
  const overtired = wakeWindowElapsedMin !== null && wakeWindowElapsedMin > ceiling;
  const [targetLo, targetHi] = config.dayMode.wakeWindowTargetMin;

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

  // --- escalations + intake: filled in by buildSafety/buildIntake below ---
  const escalations = buildEscalations(config, facts, now);
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

  // --- label + next action ---
  const { blockLabel, nextAction } = describeBlock({
    currentBlock, inCatnapSlot, config, facts, now,
    napElapsedMin, wakeWindowElapsedMin, sinceLastFeedMin,
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
  now: Date;
  napElapsedMin: number | null;
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

// Implemented in Task 3 — declared here so Task 2 compiles and tests pass.
function buildEscalations(config: FlipConfig, facts: ActivityFacts, now: Date): FlipNudge[] {
  return [];
}
function buildIntake(config: FlipConfig, facts: ActivityFacts, now: Date): FlipState['intake'] {
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/components/DayNightFlip/engine.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/DayNightFlip/engine.ts src/components/DayNightFlip/engine.test.ts
git commit -m "flip: add pure now-engine with block resolution"
```

---

### Task 3: engine.ts — escalations, weight sanity, intake (TDD)

**Files:**
- Modify: `src/components/DayNightFlip/engine.ts` (replace the `buildEscalations`/`buildIntake` stubs)
- Test: append to `src/components/DayNightFlip/engine.test.ts`

- [ ] **Step 1: Append the failing tests**

```ts
// append to src/components/DayNightFlip/engine.test.ts

test('R-42: <6 wet diapers in trailing 24h escalates; null suppresses', () => {
  const f = facts({ lastWakeTime: at(10, 0), wetDiapersLast24h: 4, dirtyDiapersLast24h: 2 });
  const s = resolveNow(CFG, f, at(10, 30));
  assert.ok(s.escalations.some(e => e.id === 'R-42-wet'));
  const noData = resolveNow(CFG, facts({ lastWakeTime: at(10, 0) }), at(10, 30));
  assert.equal(noData.escalations.length, 0);
  const fine = resolveNow(CFG, facts({ lastWakeTime: at(10, 0), wetDiapersLast24h: 7 }), at(10, 30));
  assert.ok(!fine.escalations.some(e => e.id === 'R-42-wet'));
});

test('R-42/R-33 weight: loss escalates, implausible gain flags', () => {
  const tenDaysAgo = at(10, 0, -10);
  // loss: 110oz -> 108oz
  const loss = facts({
    lastWakeTime: at(10, 0),
    latestWeight: { oz: 108, date: at(9, 0) },
    previousWeight: { oz: 110, date: tenDaysAgo },
  });
  assert.ok(resolveNow(CFG, loss, at(10, 30)).escalations.some(e => e.id === 'R-42-weight'));
  // implausible: +25oz in 10 days = 2.5 oz/day > 1.5
  const implausible = facts({
    lastWakeTime: at(10, 0),
    latestWeight: { oz: 135, date: at(9, 0) },
    previousWeight: { oz: 110, date: tenDaysAgo },
  });
  assert.ok(resolveNow(CFG, implausible, at(10, 30)).escalations.some(e => e.id === 'R-33'));
  // plausible: +8oz in 10 days -> no weight escalation
  const ok = facts({
    lastWakeTime: at(10, 0),
    latestWeight: { oz: 118, date: at(9, 0) },
    previousWeight: { oz: 110, date: tenDaysAgo },
  });
  const s = resolveNow(CFG, ok, at(10, 30));
  assert.ok(!s.escalations.some(e => e.id === 'R-42-weight' || e.id === 'R-33'));
});

test('intake: projected weight and daily target ranges from latest weight', () => {
  // 110oz five days ago, growth [0.5, 1.0] -> projected [112.5, 115]
  const f = facts({
    lastWakeTime: at(10, 0),
    latestWeight: { oz: 110, date: at(10, 0, -5) },
  });
  const s = resolveNow(CFG, f, at(10, 0));
  assert.ok(s.intake);
  assert.deepEqual(s.intake!.projectedWeightOz, [112.5, 115]);
  // daily target = projected_lb * [2.0, 2.5] -> [112.5/16*2, 115/16*2.5] = [14.1, 18.0] rounded 0.1
  assert.deepEqual(s.intake!.dailyTargetOz, [14.1, 18]);
  assert.equal(resolveNow(CFG, facts({ lastWakeTime: at(10, 0) }), at(10, 0)).intake, null);
});

test('R-43 sunset: age > 10 weeks', () => {
  const oldBaby = facts({ lastWakeTime: at(10, 0), birthDate: at(0, 0, -11 * 7) });
  assert.equal(resolveNow(CFG, oldBaby, at(10, 30)).phase, 'sunset');
  const young = facts({ lastWakeTime: at(10, 0), birthDate: at(0, 0, -10) });
  assert.equal(resolveNow(CFG, young, at(10, 30)).phase, 'pre');
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx tsx --test src/components/DayNightFlip/engine.test.ts`
Expected: first 8 PASS, new 4 FAIL

- [ ] **Step 3: Replace the two stubs in engine.ts**

```ts
// replace the buildEscalations + buildIntake stubs at the bottom of engine.ts

const round1 = (n: number) => Math.round(n * 10) / 10;

function buildEscalations(config: FlipConfig, facts: ActivityFacts, now: Date): FlipNudge[] {
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
```

- [ ] **Step 4: Run all engine + protocol tests**

Run: `npx tsx --test src/components/DayNightFlip/engine.test.ts src/components/DayNightFlip/protocol.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/DayNightFlip/engine.ts src/components/DayNightFlip/engine.test.ts
git commit -m "flip: add escalations, weight sanity, and intake math to engine"
```

---

### Task 4: facts.ts — derive ActivityFacts from raw API data + override (TDD)

**Files:**
- Create: `src/components/DayNightFlip/facts.ts`
- Test: `src/components/DayNightFlip/facts.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/DayNightFlip/facts.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFacts, weightToOz, RawActivityData, FlipOverride } from './facts';

const NOW = new Date('2026-06-11T15:00:00');
const iso = (s: string) => new Date(s).toISOString();

const EMPTY: RawActivityData = {
  sleepLogs: [], lastFeed: null, diaperLogs: [], weights: [],
  birthDate: iso('2026-05-14T12:00:00'),
};

test('weightToOz handles lb, kg, oz, unknown', () => {
  assert.equal(weightToOz(7, 'lb'), 112);
  assert.equal(weightToOz(1, 'oz'), 1);
  assert.ok(Math.abs(weightToOz(3, 'kg')! - 105.82) < 0.1);
  assert.equal(weightToOz(5, 'stone'), null);
});

test('wake = latest endTime; open log = napStartTime', () => {
  const raw: RawActivityData = {
    ...EMPTY,
    sleepLogs: [
      { startTime: iso('2026-06-11T09:00:00'), endTime: iso('2026-06-11T10:30:00') },
      { startTime: iso('2026-06-11T12:00:00'), endTime: iso('2026-06-11T13:15:00') },
      { startTime: iso('2026-06-11T14:30:00'), endTime: null },
    ],
  };
  const f = deriveFacts(raw, null, NOW);
  assert.equal(f.lastWakeTime!.getTime(), new Date('2026-06-11T13:15:00').getTime());
  assert.equal(f.napStartTime!.getTime(), new Date('2026-06-11T14:30:00').getTime());
});

test('override beats derived facts until a newer real log supersedes it', () => {
  const override: FlipOverride = {
    kind: 'wake', time: iso('2026-06-11T14:00:00'), setAt: iso('2026-06-11T14:01:00'),
  };
  // no logs at all -> override wins
  const f1 = deriveFacts(EMPTY, override, NOW);
  assert.equal(f1.lastWakeTime!.getTime(), new Date('2026-06-11T14:00:00').getTime());
  assert.equal(f1.napStartTime, null);
  // a wake logged AFTER setAt supersedes the override
  const raw: RawActivityData = {
    ...EMPTY,
    sleepLogs: [{ startTime: iso('2026-06-11T13:00:00'), endTime: iso('2026-06-11T14:30:00') }],
  };
  const f2 = deriveFacts(raw, override, NOW);
  assert.equal(f2.lastWakeTime!.getTime(), new Date('2026-06-11T14:30:00').getTime());
  // a 'down' override marks the baby as sleeping
  const down: FlipOverride = {
    kind: 'down', time: iso('2026-06-11T14:45:00'), setAt: iso('2026-06-11T14:46:00'),
  };
  const f3 = deriveFacts(raw, down, NOW);
  assert.equal(f3.napStartTime!.getTime(), new Date('2026-06-11T14:45:00').getTime());
});

test('diapers count in trailing 24h; BOTH counts as wet and dirty; no data -> null', () => {
  const raw: RawActivityData = {
    ...EMPTY,
    diaperLogs: [
      { time: iso('2026-06-11T10:00:00'), type: 'WET' },
      { time: iso('2026-06-11T08:00:00'), type: 'BOTH' },
      { time: iso('2026-06-10T20:00:00'), type: 'DIRTY' },
      { time: iso('2026-06-09T10:00:00'), type: 'WET' }, // outside 24h
    ],
  };
  const f = deriveFacts(raw, null, NOW);
  assert.equal(f.wetDiapersLast24h, 2);   // WET + BOTH
  assert.equal(f.dirtyDiapersLast24h, 2); // DIRTY + BOTH
  assert.equal(deriveFacts(EMPTY, null, NOW).wetDiapersLast24h, null);
});

test('two most recent parseable weights, normalized to oz', () => {
  const raw: RawActivityData = {
    ...EMPTY,
    weights: [
      { date: iso('2026-06-01T10:00:00'), value: 7.0, unit: 'lb' },
      { date: iso('2026-06-10T10:00:00'), value: 7.5, unit: 'lb' },
      { date: iso('2026-05-20T10:00:00'), value: 6.5, unit: 'lb' },
    ],
  };
  const f = deriveFacts(raw, null, NOW);
  assert.equal(f.latestWeight!.oz, 120);   // 7.5 lb
  assert.equal(f.previousWeight!.oz, 112); // 7.0 lb
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/components/DayNightFlip/facts.test.ts`
Expected: FAIL — cannot find module `./facts`

- [ ] **Step 3: Write the implementation**

```ts
// src/components/DayNightFlip/facts.ts
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
```

- [ ] **Step 4: Run the full test suite**

Run: `npx tsx --test src/components/DayNightFlip/*.test.ts`
Expected: PASS (20 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/DayNightFlip/facts.ts src/components/DayNightFlip/facts.test.ts
git commit -m "flip: add pure facts derivation with override supersede logic"
```

---

### Task 5: Prisma column, migration, API types

**Files:**
- Modify: `prisma/schema.prisma` (Baby model, ~L217-257)
- Modify: `app/api/types.ts` (BabyResponse ~L58, BabyCreate ~L67)
- Modify: `app/api/baby/route.ts` (validation in handlePost ~L19 and handlePut ~L85)
- Create: `prisma/migrations/<generated>_add_baby_day_night_flip_config/migration.sql` (generated)

- [ ] **Step 1: Back up the local DB**

```bash
cp db/baby-tracker.db db/baby-tracker.db.pre-flip-$(date +%Y%m%d-%H%M%S).bak
```

- [ ] **Step 2: Add the column to the Baby model**

In `prisma/schema.prisma`, after `diaperWarningTime String @default("02:00")` (L225) add:

```prisma
  dayNightFlipConfig String? // JSON FlipConfig — see src/components/DayNightFlip/protocol.ts
```

- [ ] **Step 3: Generate + apply the migration, regenerate clients**

```bash
npx prisma migrate dev --name add_baby_day_night_flip_config
npm run prisma:generate && npm run prisma:generate:log
```

Expected: new folder in `prisma/migrations/` containing `ALTER TABLE "Baby" ADD COLUMN "dayNightFlipConfig" TEXT;` and "Your database is now in sync". If `migrate dev` proposes a **reset, ABORT** (answer no) and stop — the local DB is real data.

- [ ] **Step 4: Extend the API types**

In `app/api/types.ts`:
- `BabyResponse` (L58-65): no change needed — it derives from the Prisma `Baby` type, which now includes the field. Verify by reading the type.
- `BabyCreate` (L67-75): add `dayNightFlipConfig?: string;`

- [ ] **Step 5: Validate the field in the baby route**

In `app/api/baby/route.ts`, add this helper above `handlePost` (~L8):

```ts
// dayNightFlipConfig must be absent, null, or a JSON-object string
function invalidFlipConfig(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string') return true;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed !== 'object' || parsed === null || Array.isArray(parsed);
  } catch {
    return true;
  }
}
```

In `handlePost` after `const body: BabyCreate = babyData;` (~L21) and in `handlePut` after `const body: BabyUpdate = { id, ...updateData };` (~L87) add:

```ts
    if (invalidFlipConfig((body as Record<string, unknown>).dayNightFlipConfig)) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'dayNightFlipConfig must be a JSON object string' },
        { status: 400 },
      );
    }
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors (run it before the change too if unsure of the baseline).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations app/api/types.ts app/api/baby/route.ts
git commit -m "flip: add Baby.dayNightFlipConfig column, migration, API validation"
```

---

### Task 6: useFlipData hook

**Files:**
- Create: `src/components/DayNightFlip/useFlipData.ts`

No unit tests (thin fetch/state glue over the tested `deriveFacts`); verified end-to-end in Task 10.

- [ ] **Step 1: Write the hook**

```ts
// src/components/DayNightFlip/useFlipData.ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBaby } from '@/app/context/baby';
import { useFamily } from '@/src/context/family';
import { deriveFacts, FlipOverride, RawActivityData } from './facts';
import { ActivityFacts } from './engine';

const authHeaders = (): HeadersInit => {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const overrideKey = (familyId: string | undefined, babyId: string) =>
  `flipOverride_${familyId || 'nofamily'}_${babyId}`;

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return null;
  const body = await res.json();
  return body.success ? (body.data as T) : null;
}

export function useFlipData() {
  const { selectedBaby } = useBaby();
  const { family } = useFamily();
  const [facts, setFacts] = useState<ActivityFacts | null>(null);
  const [override, setOverrideState] = useState<FlipOverride | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawActivityData | null>(null);

  const babyId = selectedBaby?.id;
  const familyId = family?.id;

  // load the persisted override for this baby
  useEffect(() => {
    if (!babyId) return;
    try {
      const stored = localStorage.getItem(overrideKey(familyId, babyId));
      setOverrideState(stored ? (JSON.parse(stored) as FlipOverride) : null);
    } catch {
      setOverrideState(null);
    }
  }, [babyId, familyId]);

  const refresh = useCallback(async () => {
    if (!babyId || !selectedBaby) return;
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 86400000).toISOString();
      const end = new Date(now.getTime() + 86400000).toISOString();
      const dStart = new Date(now.getTime() - 2 * 86400000).toISOString();
      const [sleepLogs, lastFeed, diaperLogs, weights] = await Promise.all([
        getJson<{ startTime: string; endTime: string | null }[]>(
          `/api/sleep-log?babyId=${babyId}&startDate=${start}&endDate=${end}`),
        getJson<{ time: string; endTime?: string | null }>(
          `/api/feed-log/last?babyId=${babyId}`),
        getJson<{ time: string; type: 'WET' | 'DIRTY' | 'BOTH' }[]>(
          `/api/diaper-log?babyId=${babyId}&startDate=${dStart}&endDate=${end}`),
        getJson<{ date: string; value: number; unit: string }[]>(
          `/api/measurement-log?babyId=${babyId}&type=WEIGHT`),
      ]);
      setRaw({
        sleepLogs: sleepLogs ?? [],
        lastFeed: lastFeed ?? null,
        diaperLogs: diaperLogs ?? [],
        weights: weights ?? [],
        birthDate: String(selectedBaby.birthDate),
      });
    } catch (e) {
      console.error('flip data fetch failed:', e);
      setError('Could not load activity data');
    } finally {
      setLoading(false);
    }
  }, [babyId, selectedBaby]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // re-derive facts whenever raw data or override changes
  useEffect(() => {
    if (!raw) return;
    setFacts(deriveFacts(raw, override, new Date()));
  }, [raw, override]);

  const setOverride = useCallback(
    (kind: 'wake' | 'down', time: Date) => {
      if (!babyId) return;
      const o: FlipOverride = {
        kind,
        time: time.toISOString(),
        setAt: new Date().toISOString(),
      };
      localStorage.setItem(overrideKey(familyId, babyId), JSON.stringify(o));
      setOverrideState(o);
    },
    [babyId, familyId],
  );

  const clearOverride = useCallback(() => {
    if (!babyId) return;
    localStorage.removeItem(overrideKey(familyId, babyId));
    setOverrideState(null);
  }, [babyId, familyId]);

  // "also log it": wake -> close the open sleep log; down -> create an open NAP
  const alsoLogIt = useCallback(
    async (kind: 'wake' | 'down', time: Date) => {
      if (!babyId || !raw) return;
      try {
        if (kind === 'down') {
          await fetch('/api/sleep-log', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              babyId,
              startTime: time.toISOString(),
              type: 'NAP',
            }),
          });
        } else {
          // close the most recent open log, if any
          const open = await getJson<{ id: string; endTime: string | null }[]>(
            `/api/sleep-log?babyId=${babyId}&startDate=${new Date(time.getTime() - 86400000).toISOString()}&endDate=${new Date(time.getTime() + 60000).toISOString()}`);
          const target = (open ?? []).find(l => !l.endTime);
          if (target) {
            await fetch(`/api/sleep-log?id=${target.id}`, {
              method: 'PUT',
              headers: authHeaders(),
              body: JSON.stringify({ endTime: time.toISOString() }),
            });
          }
        }
        await refresh();
      } catch (e) {
        console.error('also-log-it failed:', e);
      }
    },
    [babyId, raw, refresh],
  );

  return { facts, loading, error, override, setOverride, clearOverride, alsoLogIt, refresh };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` — expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DayNightFlip/useFlipData.ts
git commit -m "flip: add useFlipData hook (derive + override + also-log-it)"
```

---

### Task 7: UI components — NowBanner, FlipTimers, ModeRules, EscalationBanner + styles

**Files:**
- Create: `src/components/DayNightFlip/day-night-flip.styles.ts`
- Create: `src/components/DayNightFlip/day-night-flip.css`
- Create: `src/components/DayNightFlip/NowBanner.tsx`
- Create: `src/components/DayNightFlip/FlipTimers.tsx`
- Create: `src/components/DayNightFlip/ModeRules.tsx`
- Create: `src/components/DayNightFlip/EscalationBanner.tsx`

- [ ] **Step 1: Styles object**

```ts
// src/components/DayNightFlip/day-night-flip.styles.ts
export const flipStyles = {
  page: 'relative isolate flex flex-col gap-4 p-4 max-w-2xl mx-auto w-full',
  // day -> night gradient accent strip
  banner: {
    base: 'flip-now-banner rounded-xl border-2 p-4 shadow-md',
    day: 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-400',
    night: 'bg-gradient-to-br from-indigo-950 to-slate-900 border-indigo-400 text-indigo-50',
    eyebrow: 'font-mono text-xs uppercase tracking-widest opacity-70',
    label: 'text-xl font-semibold mt-1',
    action: 'mt-2 text-base leading-snug',
    overrideRow: 'mt-4 flex flex-wrap gap-2',
  },
  timers: {
    grid: 'grid grid-cols-2 sm:grid-cols-3 gap-3',
    card: 'flip-timer-card rounded-lg border bg-white p-3 shadow-sm',
    label: 'text-xs text-gray-500',
    value: 'font-mono text-2xl mt-1 tabular-nums',
    ok: 'text-emerald-600',
    warn: 'text-amber-600',
    over: 'text-red-600',
    sub: 'text-xs text-gray-400 mt-1',
  },
  rules: {
    wrap: 'flex flex-wrap gap-2',
    chip: 'flip-rule-chip inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium cursor-pointer bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100',
    chipOpen: 'bg-teal-50 border-teal-400 text-teal-800',
    why: 'flip-rule-why mt-2 rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700',
  },
  escalation: {
    banner: 'rounded-lg border-2 border-red-400 bg-red-50 p-3 text-sm text-red-800 font-medium',
    reference: 'text-xs text-gray-500 mt-2',
    disclaimer: 'flip-disclaimer text-center text-xs text-gray-400 py-4',
  },
  nudge: 'rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900',
  section: 'flex flex-col gap-2',
  sectionTitle: 'text-sm font-semibold text-gray-600',
} as const;
```

- [ ] **Step 2: Dark-mode CSS**

```css
/* src/components/DayNightFlip/day-night-flip.css */
/* Dark mode overrides for the Day/Night Flip page */

html.dark .flip-timer-card {
  background-color: #1f2937 !important; /* gray-800 */
  border-color: #374151 !important;
}
html.dark .flip-timer-card .text-xs { color: #9ca3af !important; }

html.dark .flip-rule-chip {
  background-color: #1f2937 !important;
  border-color: #4b5563 !important;
  color: #e5e7eb !important;
}
html.dark .flip-rule-why {
  background-color: #111827 !important;
  border-color: #374151 !important;
  color: #d1d5db !important;
}
html.dark .flip-disclaimer { color: #6b7280 !important; }
```

- [ ] **Step 3: NowBanner**

```tsx
// src/components/DayNightFlip/NowBanner.tsx
'use client';

import React, { useState } from 'react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useLocalization } from '@/src/context/localization';
import { FlipState } from './engine';
import { FlipOverride } from './facts';
import { flipStyles as s } from './day-night-flip.styles';

interface NowBannerProps {
  state: FlipState;
  override: FlipOverride | null;
  onOverride: (kind: 'wake' | 'down', time: Date, alsoLog: boolean) => void;
  onClearOverride: () => void;
}

export default function NowBanner({ state, override, onOverride, onClearOverride }: NowBannerProps) {
  const { t } = useLocalization();
  const [editing, setEditing] = useState(false);
  const [timeValue, setTimeValue] = useState('');
  const [alsoLog, setAlsoLog] = useState(true);

  const sleeping = state.currentBlock === 'nap' || state.currentBlock === 'night-sleep';

  const submitCustomWake = () => {
    if (!/^\d{1,2}:\d{2}$/.test(timeValue)) return;
    const [h, m] = timeValue.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1); // "22:30" said at 01:00 means yesterday
    onOverride('wake', d, alsoLog);
    setEditing(false);
  };

  return (
    <div className={cn(s.banner.base, state.mode === 'day' ? s.banner.day : s.banner.night)}>
      <div className={s.banner.eyebrow}>
        {state.mode === 'day' ? t('Day mode') : t('Night mode')} · NOW
      </div>
      <div className={s.banner.label}>{state.blockLabel}</div>
      <div className={s.banner.action}>{state.nextAction}</div>

      <div className={s.banner.overrideRow}>
        {!editing && (
          <>
            {sleeping ? (
              <Button size="sm" variant="outline" onClick={() => onOverride('wake', new Date(), alsoLog)}>
                {t('Mark awake now')}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => onOverride('down', new Date(), alsoLog)}>
                {t('Mark down now')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('Set actual wake time')}
            </Button>
            {override && (
              <Button size="sm" variant="ghost" onClick={onClearOverride}>
                {t('Clear override')}
              </Button>
            )}
          </>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="HH:MM"
              value={timeValue}
              onChange={e => setTimeValue(e.target.value)}
              className="w-24 font-mono"
            />
            <Button size="sm" onClick={submitCustomWake}>{t('Set')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('Cancel')}</Button>
          </div>
        )}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs opacity-80 cursor-pointer">
        <input type="checkbox" checked={alsoLog} onChange={e => setAlsoLog(e.target.checked)} />
        {t('Also write it to the sleep log')}
      </label>
    </div>
  );
}
```

- [ ] **Step 4: FlipTimers**

```tsx
// src/components/DayNightFlip/FlipTimers.tsx
'use client';

import React from 'react';
import { cn } from '@/src/lib/utils';
import { useLocalization } from '@/src/context/localization';
import { FlipState } from './engine';
import { FlipConfig } from './protocol';
import { flipStyles as s } from './day-night-flip.styles';

const fmtMin = (min: number | null): string => {
  if (min === null) return '--';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtClock = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function FlipTimers({ state, config }: { state: FlipState; config: FlipConfig }) {
  const { t } = useLocalization();
  const { timers, intake } = state;

  const ww = timers.wakeWindowElapsedMin;
  const [targetLo, targetHi] = config.dayMode.wakeWindowTargetMin;
  const wwClass =
    ww === null ? '' :
    ww > config.dayMode.wakeWindowCeilingMin ? s.timers.over :
    ww >= targetLo ? s.timers.warn : s.timers.ok;

  const nap = timers.napElapsedMin;
  const napCap = config.dayMode.napCapHr * 60;
  const napClass = nap === null ? '' : nap >= napCap ? s.timers.over : nap >= napCap - 15 ? s.timers.warn : s.timers.ok;

  const feedEst = timers.nextFeedEstimate;

  return (
    <div className={s.section}>
      <div className={s.timers.grid}>
        <div className={s.timers.card}>
          <div className={s.timers.label}>{t('Wake window')}</div>
          <div className={cn(s.timers.value, wwClass)}>{fmtMin(ww)}</div>
          <div className={s.timers.sub}>
            {t('target')} {targetLo}–{targetHi}m · {t('ceiling')} {config.dayMode.wakeWindowCeilingMin}m
          </div>
        </div>
        <div className={s.timers.card}>
          <div className={s.timers.label}>{t('Nap so far')}</div>
          <div className={cn(s.timers.value, napClass)}>{fmtMin(nap)}</div>
          <div className={s.timers.sub}>{t('cap')} {config.dayMode.napCapHr}h</div>
        </div>
        <div className={s.timers.card}>
          <div className={s.timers.label}>{t('Since last feed')}</div>
          <div className={s.timers.value}>{fmtMin(timers.sinceLastFeedMin)}</div>
          <div className={s.timers.sub}>
            {feedEst
              ? `${t('next')} ${feedEst.to ? '~' : ''}${fmtClock(feedEst.from)}${feedEst.to ? `–${fmtClock(feedEst.to)}` : ''}`
              : t('no feeds logged')}
          </div>
        </div>
      </div>
      {intake && (
        <div className={s.timers.sub}>
          {config.feedingMethod !== 'nursing' && (
            <>
              {t('Daily intake estimate')}: {intake.dailyTargetOz[0]}–{intake.dailyTargetOz[1]} oz
              {' · '}
              {t('projected weight')} {Math.round(intake.projectedWeightOz[0] / 1.6) / 10}–{Math.round(intake.projectedWeightOz[1] / 1.6) / 10} lb
              {t(' — starting estimates, not ceilings')}
            </>
          )}
          {config.feedingMethod !== 'bottle' && (
            <div>
              {t('Output check (nursing)')}: {state.timers.sinceLastFeedMin !== null ? '' : ''}
              {t('wet')} {state.escalations.some(e => e.id === 'R-42-wet') ? '⚠' : '✓'}
              {' '}— {t('aim for 6+ wet, 3+ dirty per day')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: ModeRules**

```tsx
// src/components/DayNightFlip/ModeRules.tsx
'use client';

import React, { useState } from 'react';
import { cn } from '@/src/lib/utils';
import { useLocalization } from '@/src/context/localization';
import { FLIP_RULES } from './protocol';
import { flipStyles as s } from './day-night-flip.styles';

export default function ModeRules({ mode }: { mode: 'day' | 'night' }) {
  const { t } = useLocalization();
  const [openId, setOpenId] = useState<string | null>(null);
  const rules = FLIP_RULES.filter(r => r.mode === mode);
  const open = rules.find(r => r.id === openId);

  return (
    <div className={s.section}>
      <div className={s.sectionTitle}>
        {mode === 'day' ? t('Day mode rules') : t('Night mode rules')}
      </div>
      <div className={s.rules.wrap}>
        {rules.map(r => (
          <button
            key={r.id}
            type="button"
            className={cn(s.rules.chip, openId === r.id && s.rules.chipOpen)}
            onClick={() => setOpenId(openId === r.id ? null : r.id)}
          >
            <span className="font-mono opacity-60">{r.id}</span>
            {t(r.text)}
            <span className="opacity-50">{openId === r.id ? '×' : '?'}</span>
          </button>
        ))}
      </div>
      {open && <div className={s.rules.why}><strong>{t('Why')}:</strong> {t(open.why)}</div>}
    </div>
  );
}
```

- [ ] **Step 6: EscalationBanner**

```tsx
// src/components/DayNightFlip/EscalationBanner.tsx
'use client';

import React from 'react';
import { useLocalization } from '@/src/context/localization';
import { FlipState } from './engine';
import { flipStyles as s } from './day-night-flip.styles';

export default function EscalationBanner({ state }: { state: FlipState }) {
  const { t } = useLocalization();
  return (
    <div className={s.section}>
      {state.escalations.length > 0 && (
        <div className={s.escalation.banner} role="alert">
          {state.escalations.map(e => (
            <div key={e.id}>⚠ {e.text}</div>
          ))}
        </div>
      )}
      <details className={s.escalation.reference}>
        <summary className="cursor-pointer">{t('Call your pediatrician if…')}</summary>
        <ul className="list-disc ml-5 mt-1 space-y-0.5">
          <li>{t('Fewer than 6 wet diapers a day, or no weight gain')}</li>
          <li>{t('Lethargy, or persistent frantic feeding')}</li>
          <li>{t('Feeding becomes a struggle (same-day call)')}</li>
          <li>{t('Constant gas battle with arching and hard mid-feed crying across days')}</li>
          <li>{t('Feelings of regret or hopelessness as a baseline, not just a 3am low — postpartum mood affects both parents')}</li>
        </ul>
      </details>
      <div className={s.escalation.disclaimer}>
        {t('Not medical advice. The app advises on schedules; growth curves and diagnoses belong to your pediatrician.')}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/DayNightFlip/
git commit -m "flip: add NowBanner, FlipTimers, ModeRules, EscalationBanner components"
```

---

### Task 8: Page shell, route, sidebar item, header title

**Files:**
- Create: `src/components/DayNightFlip/index.tsx`
- Create: `src/components/DayNightFlip/README.md`
- Create: `app/(app)/[slug]/day-night-flip/page.tsx`
- Modify: `src/components/ui/side-nav/index.tsx` (after the Nursery Mode item, ~L443)
- Modify: `app/(app)/[slug]/client-layout.tsx` (title chain ~L850)

- [ ] **Step 1: Page shell component**

```tsx
// src/components/DayNightFlip/index.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useBaby } from '@/app/context/baby';
import { useLocalization } from '@/src/context/localization';
import { mergeFlipConfig } from './protocol';
import { resolveNow } from './engine';
import { useFlipData } from './useFlipData';
import NowBanner from './NowBanner';
import FlipTimers from './FlipTimers';
import ModeRules from './ModeRules';
import EscalationBanner from './EscalationBanner';
import { flipStyles as s } from './day-night-flip.styles';
import './day-night-flip.css';

export default function DayNightFlip() {
  const { t } = useLocalization();
  const { selectedBaby } = useBaby();
  const { facts, loading, error, override, setOverride, clearOverride, alsoLogIt } = useFlipData();
  const [now, setNow] = useState<Date>(() => new Date());

  // live tick — ActiveFeedBanner pattern (interval + visibilitychange)
  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = setInterval(tick, 15000);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!selectedBaby) {
    return <div className={s.page}>{t('Select a baby to use Day/Night Flip')}</div>;
  }

  const config = mergeFlipConfig(
    (selectedBaby as { dayNightFlipConfig?: string | null }).dayNightFlipConfig,
  );

  if (!config.enabled) {
    return (
      <div className={s.page}>
        <div className={s.sectionTitle}>{t('Day/Night Flip is not enabled for this baby')}</div>
        <p className="text-sm text-gray-500">
          {t('Turn it on under Settings → Config → Manage Babies → Edit → Day/Night Flip.')}
        </p>
      </div>
    );
  }

  if (loading && !facts) return <div className={s.page}>{t('Loading...')}</div>;
  if (error) return <div className={s.page}>{error}</div>;
  if (!facts) return <div className={s.page}>{t('No activity data yet')}</div>;

  const state = resolveNow(config, facts, now);

  const handleOverride = (kind: 'wake' | 'down', time: Date, alsoLog: boolean) => {
    setOverride(kind, time);
    if (alsoLog) void alsoLogIt(kind, time);
  };

  return (
    <div className={s.page}>
      {state.phase === 'pre' && (
        <div className={s.nudge}>{t('The protocol becomes relevant around 2 weeks of age.')}</div>
      )}
      {state.phase === 'sunset' && (
        <div className={s.nudge}>
          {t('Past ~10 weeks the protocol sunsets: relax the contrast rules, white noise may return for naps, and the schedule can mature. (R-43)')}
        </div>
      )}
      <NowBanner
        state={state}
        override={override}
        onOverride={handleOverride}
        onClearOverride={clearOverride}
      />
      {state.nudges.length > 0 && (
        <div className={s.section}>
          {state.nudges.map(n => (
            <div key={n.id} className={s.nudge}>
              <span className="font-mono text-xs opacity-60">{n.id}</span> {n.text}
            </div>
          ))}
        </div>
      )}
      <FlipTimers state={state} config={config} />
      <ModeRules mode={state.mode} />
      <EscalationBanner state={state} />
    </div>
  );
}
```

- [ ] **Step 2: README**

```md
<!-- src/components/DayNightFlip/README.md -->
# DayNightFlip

In-app tool guiding parents through the newborn day/night-confusion protocol
(spec: docs/superpowers/specs/2026-06-11-day-night-flip-design.md).

- `engine.ts` — pure `resolveNow(config, facts, now)`; no React, no fetch.
- `facts.ts` — pure derivation of ActivityFacts from raw API data + manual override.
- `protocol.ts` — FlipConfig type, source-run defaults, merge, rule bank.
- `useFlipData.ts` — fetches sleep/feed/diaper/weight data, manages the
  localStorage override (`flipOverride_<familyId>_<babyId>`).
- `NowBanner` / `FlipTimers` / `ModeRules` / `EscalationBanner` — UI sections.

Tests: `npx tsx --test src/components/DayNightFlip/*.test.ts`
Config persists per-baby as `Baby.dayNightFlipConfig` (JSON string), edited via
the Day/Night Flip tab in the Edit Baby form.
```

- [ ] **Step 3: Route page**

```tsx
// app/(app)/[slug]/day-night-flip/page.tsx
'use client';

import DayNightFlip from '@/src/components/DayNightFlip';

export default function DayNightFlipPage() {
  return <DayNightFlip />;
}
```

- [ ] **Step 4: Sidebar item**

In `src/components/ui/side-nav/index.tsx`, directly after the Nursery Mode `<SideNavItem ... path="/nursery-mode" ... />` (~L437-443), add:

```tsx
          <SideNavItem
            path="/day-night-flip"
            label={t('Day/Night Flip')}
            isActive={currentPath === '/day-night-flip'}
            onClick={onNavigate}
            className="side-nav-item"
          />
```

- [ ] **Step 5: Header title**

In `app/(app)/[slug]/client-layout.tsx` (~L850), extend the ternary chain — insert before the final fallback:

```tsx
                          : pathname?.includes('/day-night-flip')
                          ? t('Day/Night Flip')
```

so the chain reads `/log-entry → /calendar → /reports → /day-night-flip → Full Log`.

- [ ] **Step 6: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/DayNightFlip/ "app/(app)/[slug]/day-night-flip" src/components/ui/side-nav/index.tsx "app/(app)/[slug]/client-layout.tsx"
git commit -m "flip: add page shell, route, sidebar item, header title"
```

---

### Task 9: BabyForm tabs + Day/Night Flip settings tab

**Files:**
- Create: `src/components/forms/BabyForm/DayNightFlipTab.tsx`
- Modify: `src/components/forms/BabyForm/BabyForm.tsx` (convert to FormPage `tabs`)

- [ ] **Step 1: Build the settings tab component**

```tsx
// src/components/forms/BabyForm/DayNightFlipTab.tsx
'use client';

import React from 'react';
import { Input } from '@/src/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/src/components/ui/select';
import { useLocalization } from '@/src/context/localization';
import { FlipConfig } from '@/src/components/DayNightFlip/protocol';

interface DayNightFlipTabProps {
  config: FlipConfig;
  onChange: (config: FlipConfig) => void;
  birthDate?: Date;
}

const TIME_RE = /^\d{1,2}:\d{2}$/;

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      type="text"
      pattern="[0-9]{1,2}:[0-9]{2}"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-24 font-mono"
      placeholder="HH:MM"
    />
  );
}

function NumberInput({ value, onChange, step = 0.5 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <Input
      type="number"
      step={step}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-24"
    />
  );
}

function RangeInput({ value, onChange, step = 1 }: { value: [number, number]; onChange: (v: [number, number]) => void; step?: number }) {
  return (
    <div className="flex items-center gap-2">
      <NumberInput value={value[0]} onChange={v => onChange([v, value[1]])} step={step} />
      <span className="text-gray-400">–</span>
      <NumberInput value={value[1]} onChange={v => onChange([value[0], v])} step={step} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <label className="form-label mb-0">{label}</label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="rounded-lg border border-gray-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-gray-600">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export default function DayNightFlipTab({ config, onChange, birthDate }: DayNightFlipTabProps) {
  const { t } = useLocalization();
  const set = (patch: Partial<FlipConfig>) => onChange({ ...config, ...patch });

  const ageWeeks = birthDate
    ? Math.floor((Date.now() - birthDate.getTime()) / (7 * 86400000))
    : null;
  const ageBadge =
    ageWeeks === null ? '' :
    ageWeeks < 2 ? t('protocol starts ~2 weeks') :
    ageWeeks > 10 ? t('past the ~10 week sunset') : t('in the active window (2–10 weeks)');

  return (
    <div className="space-y-3">
      <Row label={t('Enable Day/Night Flip')}>
        <input
          type="checkbox"
          className="form-checkbox h-4 w-4 text-teal-600 rounded border-gray-300"
          checked={config.enabled}
          onChange={e => set({ enabled: e.target.checked })}
        />
      </Row>
      {ageWeeks !== null && (
        <p className="text-xs text-gray-500">
          {t('Age')}: {ageWeeks} {t('weeks')} — {ageBadge}
        </p>
      )}

      <Row label={t('Feeding method')}>
        <Select
          value={config.feedingMethod}
          onValueChange={v => set({ feedingMethod: v as FlipConfig['feedingMethod'] })}
        >
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="bottle">{t('Bottle')}</SelectItem>
            <SelectItem value="nursing">{t('Nursing')}</SelectItem>
            <SelectItem value="combo">{t('Combo')}</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Section title={t('Anchors')}>
        <Row label={t('Day start (lights on)')}>
          <TimeInput value={config.anchors.dayStart} onChange={v => set({ anchors: { ...config.anchors, dayStart: v } })} />
        </Row>
        <Row label={t('Bedtime routine')}>
          <TimeInput value={config.anchors.bedtimeRoutine} onChange={v => set({ anchors: { ...config.anchors, bedtimeRoutine: v } })} />
        </Row>
        <Row label={t('Night start')}>
          <TimeInput value={config.anchors.nightStart} onChange={v => set({ anchors: { ...config.anchors, nightStart: v } })} />
        </Row>
      </Section>

      <Section title={t('Day mode')}>
        <Row label={t('Max feed interval (hours)')}>
          <NumberInput value={config.dayMode.feedIntervalMaxHr} onChange={v => set({ dayMode: { ...config.dayMode, feedIntervalMaxHr: v } })} />
        </Row>
        <Row label={t('Nap cap (hours)')}>
          <NumberInput value={config.dayMode.napCapHr} onChange={v => set({ dayMode: { ...config.dayMode, napCapHr: v } })} />
        </Row>
        <Row label={t('Wake window target (minutes)')}>
          <RangeInput value={config.dayMode.wakeWindowTargetMin} onChange={v => set({ dayMode: { ...config.dayMode, wakeWindowTargetMin: v } })} />
        </Row>
        <Row label={t('Wake window ceiling (minutes)')}>
          <NumberInput value={config.dayMode.wakeWindowCeilingMin} step={5} onChange={v => set({ dayMode: { ...config.dayMode, wakeWindowCeilingMin: v } })} />
        </Row>
        <Row label={t('Catnap slot')}>
          <div className="flex items-center gap-2">
            <TimeInput value={config.dayMode.catnapSlot[0]} onChange={v => set({ dayMode: { ...config.dayMode, catnapSlot: [v, config.dayMode.catnapSlot[1]] } })} />
            <span className="text-gray-400">–</span>
            <TimeInput value={config.dayMode.catnapSlot[1]} onChange={v => set({ dayMode: { ...config.dayMode, catnapSlot: [config.dayMode.catnapSlot[0], v] } })} />
          </div>
        </Row>
        <Row label={t('Last wake by')}>
          <TimeInput value={config.dayMode.lastWakeBy} onChange={v => set({ dayMode: { ...config.dayMode, lastWakeBy: v } })} />
        </Row>
      </Section>

      <Section title={t('Night mode')}>
        <Row label={t('Expected feed interval (hours)')}>
          <RangeInput value={config.nightMode.feedExpectedIntervalHr} step={0.5} onChange={v => set({ nightMode: { ...config.nightMode, feedExpectedIntervalHr: v } })} />
        </Row>
        <Row label={t('Scheduled feeds (estimates)')}>
          <Input
            type="text"
            value={config.nightMode.scheduledFeeds.join(', ')}
            onChange={e => set({ nightMode: { ...config.nightMode, scheduledFeeds: e.target.value.split(',').map(s => s.trim()).filter(s => TIME_RE.test(s)) } })}
            className="w-44 font-mono"
            placeholder="23:00, 02:00, 05:00"
          />
        </Row>
      </Section>

      <Section title={t('Feeding estimates')}>
        <Row label={t('Daily oz per lb')}>
          <RangeInput value={config.feeding.dailyOzPerLb} step={0.1} onChange={v => set({ feeding: { ...config.feeding, dailyOzPerLb: v } })} />
        </Row>
        <Row label={t('Expected growth (oz/day)')}>
          <RangeInput value={config.feeding.growthOzPerDay} step={0.1} onChange={v => set({ feeding: { ...config.feeding, growthOzPerDay: v } })} />
        </Row>
      </Section>

      <Section title={t('Durations')}>
        <Row label={t('Fuss wait (minutes)')}>
          <RangeInput value={config.durations.fussWaitMin} onChange={v => set({ durations: { ...config.durations, fussWaitMin: v } })} />
        </Row>
        <Row label={t('Abandon putdown after (minutes)')}>
          <NumberInput value={config.durations.putdownAbandonMin} step={5} onChange={v => set({ durations: { ...config.durations, putdownAbandonMin: v } })} />
        </Row>
        <Row label={t('Rescue nap max (minutes)')}>
          <NumberInput value={config.durations.rescueNapMaxMin} step={5} onChange={v => set({ durations: { ...config.durations, rescueNapMaxMin: v } })} />
        </Row>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Convert BabyForm to tabs**

In `src/components/forms/BabyForm/BabyForm.tsx`:

1. Add imports:
```tsx
import DayNightFlipTab from './DayNightFlipTab';
import { FlipConfig, DEFAULT_FLIP_CONFIG, mergeFlipConfig } from '@/src/components/DayNightFlip/protocol';
import { FormPageTab } from '@/src/components/ui/form-page/form-page.types';
```
(verify the `FormPageTab` export path — it is imported in `form-page/index.tsx` from `./form-page.types`).

2. Add flip-config state next to `formData` (~L60):
```tsx
  const [flipConfig, setFlipConfig] = useState<FlipConfig>(DEFAULT_FLIP_CONFIG);
```

3. In the reset `useEffect` (~L63-81): inside the `if (baby && isOpen ...)` branch add
```tsx
      setFlipConfig(mergeFlipConfig((baby as { dayNightFlipConfig?: string | null }).dayNightFlipConfig));
```
and in the `else if (!isOpen ...)` branch add `setFlipConfig(DEFAULT_FLIP_CONFIG);`.

4. Change `handleSubmit` signature from `(e: React.FormEvent)` to `()` (no event; remove `e.preventDefault()`), and add the config to the body:
```tsx
        body: JSON.stringify({
          ...formData,
          id: baby?.id,
          birthDate: formData.birthDate,
          gender: formData.gender as Gender,
          ...(isEditing ? { dayNightFlipConfig: JSON.stringify(flipConfig) } : {}),
        }),
```
Also guard required fields at the top (the `<form required>` attributes no longer apply):
```tsx
    if (!formData.firstName || !formData.lastName || !formData.birthDate) {
      showToast({ title: t('Please fill in name and birth date'), variant: 'error' } as any);
      return;
    }
```
(check the actual `useToast` `showToast` signature in `src/components/ui/toast` and match it — if it takes `(message, options)` adapt accordingly; if unsure use `console.warn` + early return only.)

5. Replace the render: remove the `<form>` wrapper; build tabs and pass the footer as children:
```tsx
  const basicInfoContent = (
    <div className="space-y-4">
      {/* EXACT same field JSX that previously sat inside FormPageContent:
          first/last name grid, birth date popover, gender select,
          feed/diaper warning time grid, inactive checkbox */}
    </div>
  );

  const tabs: FormPageTab[] = [
    { id: 'basic', label: t('Basic Info'), content: basicInfoContent },
    ...(isEditing
      ? [{
          id: 'flip',
          label: t('Day/Night Flip'),
          content: (
            <DayNightFlipTab
              config={flipConfig}
              onChange={setFlipConfig}
              birthDate={formData.birthDate}
            />
          ),
        }]
      : []),
  ];

  return (
    <FormPage
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? t('Edit Baby') : t('Add New Baby')}
      description={isEditing
        ? t("Update your baby's information")
        : t("Enter your baby's information to start tracking")}
      tabs={tabs}
    >
      <FormPageFooter>
        <div className="flex justify-end space-x-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? t('Saving...') : isEditing ? t('Update') : t('Save')}
          </Button>
        </div>
      </FormPageFooter>
    </FormPage>
  );
```
Move the existing field JSX verbatim into `basicInfoContent` (drop the `required` attributes since there is no form element now). `FormPageContent` import becomes unused — remove it.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/forms/BabyForm/
git commit -m "flip: convert BabyForm to tabs with Day/Night Flip config editor"
```

---

### Task 10: Localization strings

**Files:**
- Modify: `src/localization/translations/en.json` (+ the 8 generated language files via script)

- [ ] **Step 1: Collect every `t('...')` string introduced by this feature**

```bash
grep -rhoP "t\('([^']+)'\)" src/components/DayNightFlip src/components/forms/BabyForm/DayNightFlipTab.tsx "app/(app)/[slug]/day-night-flip" src/components/ui/side-nav/index.tsx "app/(app)/[slug]/client-layout.tsx" | sort -u
```

Also collect the rule strings (they pass through `t(r.text)` / `t(r.why)`): every `text` and `why` value in `FLIP_RULES` in `protocol.ts`.

- [ ] **Step 2: Add each string to en.json as key === value**

For every collected string add `"<string>": "<string>"` to `src/localization/translations/en.json` (keep the file's existing alphabetical-ish ordering; exact position doesn't matter functionally). Use a small node script if easier:

```bash
node -e "
const fs = require('fs');
const p = 'src/localization/translations/en.json';
const en = JSON.parse(fs.readFileSync(p, 'utf8'));
const strings = [/* paste collected strings as a JS array */];
for (const s of strings) if (!en[s]) en[s] = s;
fs.writeFileSync(p, JSON.stringify(en, Object.keys(en).sort(), 2) + '\n');
"
```

- [ ] **Step 3: Back-fill the other language files**

Run: `node scripts/check-missing-translations.js`
Expected: reports the new keys added to es/fr/de/it/nl/pt-br/pt-pt/ro.

- [ ] **Step 4: Commit**

```bash
git add src/localization/translations/
git commit -m "flip: add localization strings for Day/Night Flip"
```

---

### Task 11: Full verification — tests, types, dev server, Playwright E2E

**Files:** none new (fixes as needed)

- [ ] **Step 1: Run the full unit suite + type-check**

```bash
npx tsx --test src/components/DayNightFlip/*.test.ts && npx tsc --noEmit
```
Expected: all tests pass, no type errors.

- [ ] **Step 2: Start the dev server (background)**

```bash
npm run dev
```
Expected: ready on http://localhost:3000 (watch output for compile errors).

- [ ] **Step 3: Playwright — login**

Using the Playwright MCP tools:
1. `browser_navigate` → `http://localhost:3000/squire/login`
2. `browser_snapshot` to see the login UI; enter loginId `01` and PIN `1724` using the visible controls (the security screen takes the 2-digit ID then the PIN digits).

- [ ] **Step 4: Playwright — sidebar + disabled state**

1. Open the sidebar (hamburger) — verify a **Day/Night Flip** item sits below Nursery Mode.
2. Click it → URL becomes `/squire/day-night-flip`, header reads "Day/Night Flip".
3. Expect the disabled-state prompt ("not enabled for this baby").
4. `browser_take_screenshot` → save as `flip-disabled.png`.

- [ ] **Step 5: Playwright — enable via settings tab**

1. Open Settings (sidebar → Settings) → **Config** tab → Manage Babies → select Sylvie → **Edit**.
2. Verify the form now has **Basic Info | Day/Night Flip** tabs.
3. Open the Day/Night Flip tab, check **Enable Day/Night Flip**, verify the age badge shows the active window, then **Update**.
4. `browser_take_screenshot` → `flip-settings-tab.png`.

- [ ] **Step 6: Playwright — live page**

1. Navigate back to `/squire/day-night-flip`.
2. Expect either `needs-input` (stale sleep data — only 4 sleep logs in the snapshot) or a live block.
3. If needs-input: click **Mark awake now** (leave "also write it" checked) → banner flips to the awake block, wake-window timer starts at 0m.
4. Verify: mode chip row renders day rules (D-1..D-8) — click one chip → WHY text expands.
5. Verify timers card shows since-last-feed (real data: 299 feeds) and the intake estimate line (real weight measurements exist or not — if none, no intake line is correct behavior).
6. `browser_take_screenshot` → `flip-live.png`.

- [ ] **Step 7: Verify the dark/night rendering**

In the browser, toggle the app's dark mode (or wait-free: evaluate `document.documentElement.classList.add('dark')` via `browser_evaluate`) and screenshot → `flip-dark.png`. Check chips/timers remain legible.

- [ ] **Step 8: Fix anything found, re-run unit tests, then commit**

```bash
npx tsx --test src/components/DayNightFlip/*.test.ts && npx tsc --noEmit
git add -A && git commit -m "flip: E2E fixes from Playwright verification"
```

- [ ] **Step 9: Lint**

```bash
npm run lint -- --max-warnings=0 2>&1 | tail -20
```
Fix any new errors introduced by this feature (pre-existing warnings out of scope).

---

## Self-review checklist (run after all tasks)

1. Every spec section maps to a task: §4 routing → Task 8; §5 engine → Tasks 2-3; §6 data/override → Tasks 4, 6; §7 components → Tasks 7-8; §8 safety → Tasks 3, 7 (EscalationBanner); §9 settings → Task 9; §10 data/API/localization → Tasks 5, 10; §12 testing → Tasks 1-4, 11.
2. The deferred list (§11) stays deferred: no wizards, no FAQ surface, no HA ingest, no push notifications.
3. Engine strings: static copy goes through `t()`; dynamic composed strings (times embedded) intentionally don't — noted in Task 10.
