import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectDay, ScheduleBlock } from './schedule';
import { DEFAULT_FLIP_CONFIG, FlipConfig } from './protocol';
import { ActivityFacts } from './engine';

const CFG: FlipConfig = { ...DEFAULT_FLIP_CONFIG, enabled: true };
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 5, 12 + dayOffset, h, m, 0, 0);
const BIRTH = new Date(2026, 4, 14);

function facts(over: Partial<ActivityFacts> = {}): ActivityFacts {
  return {
    lastWakeTime: null, napStartTime: null, lastFeedTime: null,
    wetDiapersLast24h: null, dirtyDiapersLast24h: null,
    latestWeight: null, previousWeight: null, birthDate: BIRTH, ...over,
  };
}
const noLogs = { sleeps: [], feeds: [] };
const kindAt = (blocks: ScheduleBlock[], kind: string) => blocks.filter(b => b.kind === kind);

test('awake at 10:00 (woke 9:40): nap projected at 10:40, anchors hold', () => {
  const f = facts({ lastWakeTime: at(9, 40), lastFeedTime: at(9, 45) });
  const { blocks, isTemplate } = projectDay(CFG, f, noLogs, at(10, 0));
  assert.equal(isTemplate, false);
  const nap = kindAt(blocks, 'nap').find(b => b.source === 'projected')!;
  assert.equal(nap.start.getHours(), 10);
  assert.equal(nap.start.getMinutes(), 40); // 9:40 + 60m target
  const routine = kindAt(blocks, 'bedtime-routine')[0];
  assert.equal(routine.start.getHours(), 19);
  assert.equal(routine.start.getMinutes(), 15); // anchor holds
  const night = kindAt(blocks, 'night-sleep').find(b => b.source === 'anchor')!;
  assert.equal(night.start.getHours(), 20);
});

test('D-2 bounds a projected nap: wake-to-feed beats the cap', () => {
  // sleeping since 9:30, last feed 7:30 -> feed due 10:30 < cap 11:30
  const f = facts({ napStartTime: at(9, 30), lastWakeTime: at(9, 0), lastFeedTime: at(7, 30) });
  const { blocks } = projectDay(CFG, f, { sleeps: [{ start: at(9, 30), end: null }], feeds: [at(7, 30)] }, at(10, 0));
  const current = blocks.find(b => b.isNow)!;
  assert.equal(current.kind, 'nap');
  assert.equal(current.end!.getHours(), 10);
  assert.equal(current.end!.getMinutes(), 30);
});

test('late final wake pulls the routine early (R-21)', () => {
  const f = facts({ lastWakeTime: at(17, 30), lastFeedTime: at(17, 40) });
  const { blocks } = projectDay(CFG, f, noLogs, at(17, 45));
  const routine = kindAt(blocks, 'bedtime-routine')[0];
  assert.equal(routine.start.getHours(), 18);
  assert.equal(routine.start.getMinutes(), 30); // 17:30 + 60m < 19:15
});

test('R-24 screenshot regression: nap ending 17:03 puts her down 18:15–19:00, not 20:00', () => {
  // the logged day from the bug report: awake 14:03, fed 14:20, now 14:21
  const f = facts({ lastWakeTime: at(14, 3), lastFeedTime: at(14, 20) });
  const { blocks } = projectDay(CFG, f, noLogs, at(14, 21));
  const putdown = kindAt(blocks, 'putdown');
  assert.equal(putdown.length, 1, 'putdown is an explicit timeline event');
  const downMin = putdown[0].start.getHours() * 60 + putdown[0].start.getMinutes();
  assert.ok(downMin >= 18 * 60 + 15 && downMin <= 19 * 60,
    `putdown lands 18:15–19:00, got ${Math.floor(downMin / 60)}:${downMin % 60}`);
  // the routine block ends at the putdown, never at night_start
  const routine = kindAt(blocks, 'bedtime-routine')[0];
  assert.equal(routine.end!.getTime(), putdown[0].start.getTime());
});

test('R-24: night_start is an environment boundary, never the putdown target', () => {
  // nominal night: catnap ended at lastWakeBy 18:30, fed 18:00
  const f = facts({ lastWakeTime: at(18, 30), lastFeedTime: at(18, 0) });
  const { blocks } = projectDay(CFG, f, noLogs, at(18, 40));
  const putdown = kindAt(blocks, 'putdown')[0];
  assert.equal(putdown.start.getHours(), 19);
  assert.equal(putdown.start.getMinutes(), 45); // anchor 19:15 + 30m routine = wake + 75m
  assert.equal(putdown.label, 'Down for the night');
  // the 20:00 anchor block is the mode flip, not the putdown
  const modeBlock = blocks.find(b => b.source === 'anchor' && b.start.getHours() === 20)!;
  assert.equal(modeBlock.label, 'Night mode');
});

test('R-24: the early-night note rides on the putdown event (R-21 night)', () => {
  const f = facts({ lastWakeTime: at(17, 30), lastFeedTime: at(17, 40) });
  const { blocks } = projectDay(CFG, f, noLogs, at(17, 45));
  const putdown = kindAt(blocks, 'putdown')[0];
  assert.match(putdown.note ?? '', /Earlier than usual tonight/);
  // routine 18:30 (R-21), putdown clamped to wake 17:30 + 75m ceiling = 18:45
  assert.equal(putdown.start.getHours(), 18);
  assert.equal(putdown.start.getMinutes(), 45);
});

test('R-24: a too-early final wake gets a catnap, not a stretched window', () => {
  const f = facts({ lastWakeTime: at(16, 30), lastFeedTime: at(16, 30) });
  const { blocks } = projectDay(CFG, f, noLogs, at(16, 35));
  assert.equal(kindAt(blocks, 'catnap').length, 1);
  // catnap 17:30–18:15, routine at anchor 19:15, down 19:30 (= 18:15 wake + 75m)
  const putdown = kindAt(blocks, 'putdown')[0];
  assert.equal(putdown.start.getHours(), 19);
  assert.equal(putdown.start.getMinutes(), 30);
});

test('R-24 validation: no projected awake stretch exceeds the ceiling', () => {
  const fmt = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  for (let wakeMin = 12 * 60; wakeMin <= 18 * 60 + 30; wakeMin += 7) {
    const wake = at(Math.floor(wakeMin / 60), wakeMin % 60);
    const f = facts({ lastWakeTime: wake, lastFeedTime: wake });
    const { blocks } = projectDay(CFG, f, noLogs, new Date(wake.getTime() + 5 * 60000));
    assert.equal(kindAt(blocks, 'putdown').length, 1, `wake ${fmt(wake)}: exactly one putdown`);
    let currentWake = wake;
    for (const b of blocks) {
      if (b.kind !== 'putdown' && !((b.kind === 'nap' || b.kind === 'catnap') && b.source === 'projected' && b.end)) continue;
      const stretch = (b.start.getTime() - currentWake.getTime()) / 60000;
      assert.ok(stretch <= CFG.dayMode.wakeWindowCeilingMin,
        `wake ${fmt(wake)}: ${stretch}min awake before ${b.kind} at ${fmt(b.start)}`);
      if (b.end) currentWake = b.end;
    }
  }
});

test('R-23: evening crash after a full feed converts to night start', () => {
  // fed 18:20, crashed 18:45 (past lastWakeBy 18:30), now 18:50
  const f = facts({ napStartTime: at(18, 45), lastWakeTime: at(17, 45), lastFeedTime: at(18, 20) });
  const logs = { sleeps: [{ start: at(18, 45), end: null }], feeds: [at(18, 20)] };
  const { blocks } = projectDay(CFG, f, logs, at(18, 50));
  // the putdown IS the crash — no routine, no second putdown
  const putdown = kindAt(blocks, 'putdown');
  assert.equal(putdown.length, 1);
  assert.equal(putdown[0].start.getTime(), at(18, 45).getTime());
  assert.equal(kindAt(blocks, 'bedtime-routine').length, 0);
  // night feed estimates shift 75min earlier (night effectively began 18:45)
  const nightFeeds = kindAt(blocks, 'night-feed');
  assert.equal(nightFeeds[0].start.getHours(), 21);
  assert.equal(nightFeeds[0].start.getMinutes(), 45);
  assert.equal(nightFeeds[1].start.getDate(), 13); // 00:45 lands tomorrow
  // the morning anchor does not move
  const hold = kindAt(blocks, 'night-hold')[0];
  assert.equal(hold.end!.getHours(), 8);
  assert.equal(hold.end!.getDate(), 13);
});

test('R-23: evening crash without a feed becomes a 30-minute micro-nap, then down', () => {
  // last feed 16:30 (not within 45min of the crash), crashed 18:45, now 18:50
  const f = facts({ napStartTime: at(18, 45), lastWakeTime: at(17, 45), lastFeedTime: at(16, 30) });
  const logs = { sleeps: [{ start: at(18, 45), end: null }], feeds: [at(16, 30)] };
  const { blocks } = projectDay(CFG, f, logs, at(18, 50));
  // the live sleep is planned as a micro-nap, woken at +30
  const live = blocks.find(b => b.kind === 'nap' && b.source === 'projected')!;
  assert.equal(live.end!.getTime(), at(19, 15).getTime());
  // then a compressed routine with a full feed, and down
  const routine = kindAt(blocks, 'bedtime-routine')[0];
  assert.equal(routine.start.getTime(), at(19, 15).getTime());
  assert.match(routine.note ?? '', /full feed/i);
  const putdown = kindAt(blocks, 'putdown')[0];
  assert.equal(putdown.start.getHours(), 19);
  assert.equal(putdown.start.getMinutes(), 45);
  // night feed estimates do not shift — she still gets the 23:00 estimate
  assert.equal(kindAt(blocks, 'night-feed')[0].start.getHours(), 23);
});

test('actual logged sleeps and feeds appear as actual blocks', () => {
  const logs = {
    sleeps: [{ start: at(9, 0), end: at(10, 30) }],
    feeds: [at(8, 5), at(11, 0)],
  };
  const f = facts({ lastWakeTime: at(13, 0), lastFeedTime: at(11, 0) });
  const { blocks } = projectDay(CFG, f, logs, at(13, 30));
  const actualNaps = blocks.filter(b => b.kind === 'nap' && b.source === 'actual');
  assert.equal(actualNaps.length, 1);
  assert.equal(blocks.filter(b => b.kind === 'feed' && b.source === 'actual').length, 2);
});

test('night scheduled feeds render as projected estimates and wrap midnight', () => {
  const f = facts({ lastWakeTime: at(19, 0), lastFeedTime: at(19, 0) });
  const { blocks } = projectDay(CFG, f, noLogs, at(19, 30));
  const nightFeeds = kindAt(blocks, 'night-feed');
  assert.equal(nightFeeds.length, 3); // ~23:00, ~02:00, ~05:00
  assert.equal(nightFeeds[1].start.getDate(), 13); // 02:00 lands tomorrow
  const hold = kindAt(blocks, 'night-hold')[0];
  assert.equal(hold.end!.getHours(), 8); // until tomorrow's day_start
});

test('early-morning now (02:00): window starts at yesterday’s day_start, isNow in the night', () => {
  const f = facts({ lastWakeTime: at(1, 30), lastFeedTime: at(1, 30) });
  const { blocks } = projectDay(CFG, f, noLogs, at(2, 0));
  assert.equal(blocks[0].start.getDate(), 11); // window began yesterday 08:00
  const nowBlock = blocks.find(b => b.isNow)!;
  assert.ok(['night-hold', 'night-feed', 'night-sleep'].includes(nowBlock.kind));
});

test('open sleep from before night start: NOW lands on the night-mode block', () => {
  // went down 18:20, fed 21:24 (still logged as asleep), now 22:27
  const f = facts({ napStartTime: at(18, 20), lastWakeTime: at(17, 30), lastFeedTime: at(21, 24) });
  const logs = { sleeps: [{ start: at(18, 20), end: null }], feeds: [at(21, 24)] };
  const { blocks } = projectDay(CFG, f, logs, at(22, 27));
  const live = blocks.find(b => b.kind === 'night-sleep' && b.source === 'projected')!;
  assert.equal(live.end!.getHours(), 20); // early sleep clips at night start
  assert.equal(live.isNow, false);
  const nowBlock = blocks.find(b => b.isNow)!;
  assert.equal(nowBlock.label, 'Night mode');
});

test('needs-input facts fall back to the template', () => {
  const { blocks, isTemplate } = projectDay(CFG, facts(), noLogs, at(10, 0));
  assert.equal(isTemplate, true);
  assert.equal(blocks[0].start.getHours(), 8); // template opens at day_start
  assert.ok(blocks.every(b => b.source !== 'actual'));
});
