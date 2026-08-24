/**
 * Bottle type normalization
 *
 * The app stores FeedLog.bottleType as a free string, but every read site
 * (reports, timeline, daily summary breakdown, breast-milk balance) matches the
 * canonical capitalized values exactly. Normalizing on write keeps all clients —
 * the main feed form, nursery mode, and the external hooks API — consistent.
 */

// Maps any-case input to the canonical value used across the app.
const CANONICAL_BOTTLE_TYPES: Record<string, string> = {
  'formula': 'Formula',
  'breast milk': 'Breast Milk',
  'formula\\breast': 'Formula/Breast',
  'formula/breast': 'Formula/Breast',
  'milk': 'Milk',
  'other': 'Other',
};

/**
 * Coerce a bottleType to its canonical form. Empty/blank becomes null; unknown
 * values are preserved (trimmed) rather than dropped.
 */
export function normalizeBottleType(value?: string | null): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  return CANONICAL_BOTTLE_TYPES[trimmed.toLowerCase()] ?? trimmed;
}
