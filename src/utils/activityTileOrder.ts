/**
 * Default log-entry activity tile order. Keep in sync with
 * app/api/activity-settings/route.ts consumers.
 */
export const DEFAULT_ACTIVITY_TILE_ORDER = [
  'sleep',
  'feed',
  'food',
  'diaper',
  'potty',
  'note',
  'photo',
  'bath',
  'pump',
  'play',
  'measurement',
  'milestone',
  'medicine',
  'vaccine',
] as const;

export type DefaultActivityTileType = (typeof DEFAULT_ACTIVITY_TILE_ORDER)[number];

type TilePlacement = { changed: boolean; order: string[]; visible: string[] };

/**
 * Place `tile` immediately after `anchor` when merging saved settings, falling
 * back to the end of the list when the anchor is absent or hidden.
 * No-op when the tile is already present (user custom order is preserved).
 */
function placeTileAfter(
  entry: { order?: string[]; visible?: string[] },
  tile: string,
  anchor: string
): TilePlacement {
  const order = Array.isArray(entry.order) ? [...entry.order] : [];
  const visible = Array.isArray(entry.visible) ? [...entry.visible] : [];
  let changed = false;

  if (!order.includes(tile)) {
    const anchorIndex = order.indexOf(anchor);
    if (anchorIndex !== -1 && visible.includes(anchor)) {
      order.splice(anchorIndex + 1, 0, tile);
    } else {
      order.push(tile);
    }
    changed = true;
  }
  if (!visible.includes(tile)) {
    visible.push(tile);
    changed = true;
  }

  return { changed, order, visible };
}

/**
 * Place the food tile immediately after feed when merging saved settings.
 */
export function placeFoodTile(entry: { order?: string[]; visible?: string[] }): TilePlacement {
  return placeTileAfter(entry, 'food', 'feed');
}

/**
 * Place the potty tile immediately after diaper when merging saved settings.
 */
export function placePottyTile(entry: { order?: string[]; visible?: string[] }): TilePlacement {
  return placeTileAfter(entry, 'potty', 'diaper');
}

/**
 * Append any activity types from the default list that are missing from saved settings.
 */
export function mergeMissingActivityTiles(entry: {
  order?: string[];
  visible?: string[];
}): { order: string[]; visible: string[] } {
  let order = Array.isArray(entry.order) ? [...entry.order] : [];
  let visible = Array.isArray(entry.visible) ? [...entry.visible] : [];

  if (order.length === 0) {
    return {
      order: [...DEFAULT_ACTIVITY_TILE_ORDER],
      visible: [...DEFAULT_ACTIVITY_TILE_ORDER],
    };
  }

  const missing = DEFAULT_ACTIVITY_TILE_ORDER.filter((activity) => !order.includes(activity));
  if (missing.length === 0) {
    return { order, visible };
  }

  if (missing.includes('food')) {
    const placed = placeFoodTile({ order, visible });
    order = placed.order;
    visible = placed.visible;
  }

  if (missing.includes('potty')) {
    const placed = placePottyTile({ order, visible });
    order = placed.order;
    visible = placed.visible;
  }

  const stillMissing = DEFAULT_ACTIVITY_TILE_ORDER.filter((activity) => !order.includes(activity));
  if (stillMissing.length > 0) {
    order.push(...stillMissing);
    for (const activity of stillMissing) {
      if (!visible.includes(activity)) {
        visible.push(activity);
      }
    }
  }

  return { order, visible };
}
