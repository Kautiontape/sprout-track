import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ACTIVITY_TILE_ORDER,
  mergeMissingActivityTiles,
  placeFoodTile,
  placePottyTile,
  placeMilkBagTile,
} from '@/src/utils/activityTileOrder';

describe('DEFAULT_ACTIVITY_TILE_ORDER', () => {
  it('places food immediately after feed and before note', () => {
    const feedIndex = DEFAULT_ACTIVITY_TILE_ORDER.indexOf('feed');
    const foodIndex = DEFAULT_ACTIVITY_TILE_ORDER.indexOf('food');
    const noteIndex = DEFAULT_ACTIVITY_TILE_ORDER.indexOf('note');

    expect(foodIndex).toBe(feedIndex + 1);
    expect(foodIndex).toBeLessThan(noteIndex);
  });
});

describe('placeFoodTile', () => {
  it('inserts food immediately after feed', () => {
    const result = placeFoodTile({
      order: ['sleep', 'feed', 'diaper', 'note'],
      visible: ['sleep', 'feed', 'diaper'],
    });
    expect(result.order).toEqual(['sleep', 'feed', 'food', 'diaper', 'note']);
  });
});

describe('placePottyTile', () => {
  it('inserts potty immediately after diaper', () => {
    const result = placePottyTile({
      order: ['sleep', 'feed', 'diaper', 'note'],
      visible: ['sleep', 'feed', 'diaper'],
    });
    expect(result.order).toEqual(['sleep', 'feed', 'diaper', 'potty', 'note']);
  });
});

describe('mergeMissingActivityTiles', () => {
  it('inserts missing food after feed and appends other missing tiles', () => {
    const result = mergeMissingActivityTiles({
      order: ['sleep', 'feed', 'diaper', 'note'],
      visible: ['sleep', 'feed', 'diaper', 'note'],
    });
    expect(result.order.slice(0, 6)).toEqual(['sleep', 'feed', 'food', 'milkbag', 'diaper', 'potty']);
    expect(result.order).toEqual([...DEFAULT_ACTIVITY_TILE_ORDER]);
    expect(result.visible).toContain('food');
  });

  it('returns the default order when arrays are empty', () => {
    const result = mergeMissingActivityTiles({ order: [], visible: [] });
    expect(result.order).toEqual([...DEFAULT_ACTIVITY_TILE_ORDER]);
    expect(result.visible).toEqual([...DEFAULT_ACTIVITY_TILE_ORDER]);
  });
});

describe('DEFAULT_ACTIVITY_TILE_ORDER milkbag placement', () => {
  it('places milkbag immediately after food and before diaper', () => {
    const foodIndex = DEFAULT_ACTIVITY_TILE_ORDER.indexOf('food' as any);
    const milkbagIndex = DEFAULT_ACTIVITY_TILE_ORDER.indexOf('milkbag' as any);
    const diaperIndex = DEFAULT_ACTIVITY_TILE_ORDER.indexOf('diaper' as any);

    expect(milkbagIndex).toBe(foodIndex + 1);
    expect(milkbagIndex).toBeLessThan(diaperIndex);
  });
});

describe('placeMilkBagTile', () => {
  it('inserts milkbag immediately after food', () => {
    const result = placeMilkBagTile({
      order: ['sleep', 'feed', 'food', 'diaper'],
      visible: ['sleep', 'feed', 'food', 'diaper'],
    });
    expect(result.order).toEqual(['sleep', 'feed', 'food', 'milkbag', 'diaper']);
    expect(result.visible).toContain('milkbag');
  });

  it('appends to the end when food is hidden, rather than burying it mid-list', () => {
    const result = placeMilkBagTile({
      order: ['sleep', 'feed', 'food', 'diaper'],
      visible: ['sleep', 'feed', 'diaper'],
    });
    expect(result.order[result.order.length - 1]).toBe('milkbag');
  });

  it('leaves a custom position alone when milkbag is already present', () => {
    const result = placeMilkBagTile({
      order: ['milkbag', 'sleep', 'feed', 'food'],
      visible: ['milkbag', 'sleep', 'feed', 'food'],
    });
    expect(result.order).toEqual(['milkbag', 'sleep', 'feed', 'food']);
    expect(result.changed).toBe(false);
  });
});

describe('mergeMissingActivityTiles with milkbag', () => {
  it('adds milkbag after food for a family that predates the feature', () => {
    const result = mergeMissingActivityTiles({
      order: ['sleep', 'feed', 'food', 'diaper', 'potty', 'note'],
      visible: ['sleep', 'feed', 'food', 'diaper', 'potty', 'note'],
    });
    expect(result.order.slice(0, 5)).toEqual(['sleep', 'feed', 'food', 'milkbag', 'diaper']);
    expect(result.visible).toContain('milkbag');
  });
});
