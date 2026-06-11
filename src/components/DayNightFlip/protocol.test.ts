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
