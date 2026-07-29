/**
 * Canonical potty receptacles. Stored verbatim in PottyLog.pottyLocation,
 * mirroring how SleepLog.location stores human-readable strings.
 *
 * Shared by PottyForm and NurseryMode — do not duplicate this list.
 */
export const POTTY_LOCATIONS = [
  'Potty Chair',
  'Toilet',
  'Sink',
  'Tub',
  'Outside',
  'Other',
] as const;

export type PottyLocation = (typeof POTTY_LOCATIONS)[number];
