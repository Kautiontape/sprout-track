import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNow, rescueTiming, sleepState, ActivityFacts } from './engine';
import { DEFAULT_FLIP_CONFIG, FlipConfig } from './protocol';
import { deriveFacts, RawActivityData } from './facts';

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

test('R-24: routine guidance says down by the computed putdown, not night_start', () => {
  // R-21 night: wake 17:30 -> routine 18:30, putdown clamped to 17:30 + 75m = 18:45
  const f = facts({ lastWakeTime: at(17, 30), lastFeedTime: at(17, 45) });
  const s = resolveNow(CFG, f, at(18, 35));
  assert.equal(s.currentBlock, 'bedtime-routine');
  assert.match(s.nextAction, /18:45/);
  assert.ok(!s.nextAction.includes('20:00'), 'night_start is not a putdown target');
  // anchor night: wake 18:30 -> routine 19:15, putdown 19:45
  const f2 = facts({ lastWakeTime: at(18, 30), lastFeedTime: at(18, 30) });
  const s2 = resolveNow(CFG, f2, at(19, 20));
  assert.match(s2.nextAction, /19:45/);
});

test('R-23: evening crash after a feed reads as the night, with a nudge', () => {
  const f = facts({ napStartTime: at(18, 45), lastWakeTime: at(17, 45), lastFeedTime: at(18, 20) });
  const s = resolveNow(CFG, f, at(18, 50));
  assert.equal(s.currentBlock, 'night-sleep');
  assert.ok(s.nudges.some(n => n.id === 'R-23'));
});

test('R-23: evening crash without a feed plans a 30-minute micro-nap', () => {
  const f = facts({ napStartTime: at(18, 45), lastWakeTime: at(17, 45), lastFeedTime: at(16, 30) });
  const s = resolveNow(CFG, f, at(18, 50));
  assert.equal(s.currentBlock, 'nap');
  assert.ok(s.nudges.some(n => n.id === 'R-23'));
  assert.match(s.nextAction, /19:15/); // wake her at crash + 30m, not at the 2h cap
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

test('R-42: <6 wet diapers in trailing 24h escalates; null suppresses', () => {
  const f = facts({ lastWakeTime: at(10, 0), wetDiapersLast24h: 4, dirtyDiapersLast24h: 2 });
  const s = resolveNow(CFG, f, at(10, 30));
  assert.ok(s.escalations.some(e => e.id === 'R-42-wet'));
  const noData = resolveNow(CFG, facts({ lastWakeTime: at(10, 0) }), at(10, 30));
  assert.equal(noData.escalations.length, 0);
  const fine = resolveNow(CFG, facts({ lastWakeTime: at(10, 0), wetDiapersLast24h: 7 }), at(10, 30));
  assert.ok(!fine.escalations.some(e => e.id === 'R-42-wet'));
});

test('R-42 wording covers potty catches too, not just diapers (EC families)', () => {
  const f = facts({ lastWakeTime: at(10, 0), wetDiapersLast24h: 4 });
  const esc = resolveNow(CFG, f, at(10, 30)).escalations.find(e => e.id === 'R-42-wet');
  assert.ok(esc, 'expected the low-void escalation to fire');
  assert.match(esc!.text, /potty/i);
});

// A pee is a pee whether it lands in a diaper or gets caught on the potty
// during EC — the escalation threshold must be judged against the TRUE
// combined total, not diaper logs alone. These go through deriveFacts (not
// the local `facts()` fixture builder) so the raw-log-to-escalation pipeline
// is exercised end to end.
test('R-42 + EC: 4 diapers + 3 potty catches (7 combined) must NOT escalate', () => {
  const isoAt = (h: number, m: number) => at(h, m).toISOString();
  const raw: RawActivityData = {
    sleepLogs: [], lastFeed: null, weights: [],
    birthDate: BIRTH.toISOString(),
    diaperLogs: [
      { time: isoAt(1, 0), type: 'WET' },
      { time: isoAt(3, 0), type: 'WET' },
      { time: isoAt(5, 0), type: 'WET' },
      { time: isoAt(7, 0), type: 'WET' },
    ],
    pottyLogs: [
      { time: isoAt(2, 0), type: 'WET' },
      { time: isoAt(4, 0), type: 'WET' },
      { time: isoAt(6, 0), type: 'WET' },
    ],
  };
  const derived = deriveFacts(raw, null, at(10, 30));
  const f = { ...derived, lastWakeTime: at(9, 0) };
  const s = resolveNow(CFG, f, at(10, 30));
  assert.ok(!s.escalations.some(e => e.id === 'R-42-wet'), '7 combined voids must not trigger the pediatrician call');
});

test('R-42 + EC: 2 diapers + 1 potty catch (3 combined) still escalates', () => {
  const isoAt = (h: number, m: number) => at(h, m).toISOString();
  const raw: RawActivityData = {
    sleepLogs: [], lastFeed: null, weights: [],
    birthDate: BIRTH.toISOString(),
    diaperLogs: [
      { time: isoAt(1, 0), type: 'WET' },
      { time: isoAt(3, 0), type: 'WET' },
    ],
    pottyLogs: [
      { time: isoAt(2, 0), type: 'WET' },
    ],
  };
  const derived = deriveFacts(raw, null, at(10, 30));
  const f = { ...derived, lastWakeTime: at(9, 0) };
  const s = resolveNow(CFG, f, at(10, 30));
  assert.ok(s.escalations.some(e => e.id === 'R-42-wet'), '3 combined voids must still escalate');
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
  // daily target = projected_lb * [2.0, 2.5] -> [112.5/16*2, 115/16*2.5] = [14.1, 18.0]
  assert.deepEqual(s.intake!.dailyTargetOz, [14.1, 18]);
  assert.equal(resolveNow(CFG, facts({ lastWakeTime: at(10, 0) }), at(10, 0)).intake, null);
});

test('wake time slightly ahead of a stale now still counts as awake (clock skew)', () => {
  // "Mark awake now" can land a wake time a few seconds after the last UI tick
  const wake = new Date(at(10, 0).getTime() + 30_000); // 10:00:30
  const s = resolveNow(CFG, facts({ lastWakeTime: wake }), at(10, 0));
  assert.equal(s.currentBlock, 'awake');
  assert.equal(s.timers.wakeWindowElapsedMin, 0);
  // same for a just-started nap
  const nap = new Date(at(10, 0).getTime() + 30_000);
  const s2 = resolveNow(CFG, facts({ napStartTime: nap, lastWakeTime: at(9, 0) }), at(10, 0));
  assert.equal(s2.currentBlock, 'nap');
});

test('R-43 sunset: age > 10 weeks', () => {
  const oldBaby = facts({ lastWakeTime: at(10, 0), birthDate: at(0, 0, -11 * 7) });
  assert.equal(resolveNow(CFG, oldBaby, at(10, 30)).phase, 'sunset');
  const young = facts({ lastWakeTime: at(10, 0), birthDate: at(0, 0, -10) });
  assert.equal(resolveNow(CFG, young, at(10, 30)).phase, 'pre');
});

test('rescueTiming: before 16:00 is not the final nap', () => {
  const r = rescueTiming(CFG, at(11, 0));
  assert.equal(r.isFinalNap, false);
  assert.equal(r.wakeBy, null);
});

test('rescueTiming: after 16:00 caps the nap and computes early bedtime', () => {
  const r = rescueTiming(CFG, at(16, 30));
  assert.equal(r.isFinalNap, true);
  // wakeBy = 16:30 + 90m = 18:00
  assert.equal(r.wakeBy!.getHours(), 18);
  assert.equal(r.wakeBy!.getMinutes(), 0);
  // routineStart = min(18:00 + 60m target, 19:15 anchor) = 19:00
  assert.equal(r.routineStart!.getHours(), 19);
  assert.equal(r.routineStart!.getMinutes(), 0);
});

test('sleepState matches resolveNow semantics', () => {
  const napping = sleepState(facts({ napStartTime: at(9, 30), lastWakeTime: at(8, 30) }), at(10, 0));
  assert.equal(napping.sleeping, true);
  const stale = sleepState(facts({ lastWakeTime: at(21, 0, -1) }), at(10, 0));
  assert.equal(stale.wakeKnown, false);
});
