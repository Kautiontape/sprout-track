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

test('needs-input facts fall back to the template', () => {
  const { blocks, isTemplate } = projectDay(CFG, facts(), noLogs, at(10, 0));
  assert.equal(isTemplate, true);
  assert.equal(blocks[0].start.getHours(), 8); // template opens at day_start
  assert.ok(blocks.every(b => b.source !== 'actual'));
});
