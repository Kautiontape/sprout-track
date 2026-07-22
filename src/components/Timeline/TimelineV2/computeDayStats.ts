import { ActivityType } from '../types';
import { convertVolume } from '@/src/utils/unit-conversion';

export interface DayStatsOptions {
  preferredUnit: string;
  /** Absolute timestamp; stats only count activity through min(end of day, cutoff).
   *  Ongoing sleep (no endTime) is credited up to this bound. Omit for full days. */
  cutoff?: Date;
  /** Unit display mapper (the useUnit hook's unitSymbol) — passed in to keep this pure. */
  unitSymbol: (unitAbbr?: string | null) => string;
}

export interface MedicineStat {
  count: number;
  total: number;
  unit: string;
}

export interface DayStats {
  totalSleepMinutes: number;
  napCount: number;
  awakeMinutes: number;
  totalFeedCount: number;
  bottleFeedTotal: number;
  breastMilkBottleTotal: number;
  formulaBottleTotal: number;
  otherBottleTotal: number;
  leftBreastFeedMinutes: number;
  rightBreastFeedMinutes: number;
  solidsAmounts: Record<string, number>;
  wetCount: number;
  dirtyCount: number;
  poopCount: number;
  medicineStats: Record<string, MedicineStat>;
  supplementStats: Record<string, MedicineStat>;
  noteCount: number;
  bathCount: number;
  pumpCount: number;
  pumpTotal: number;
  milestoneCount: number;
  measurementCount: number;
  playCount: number;
  totalPlayMinutes: number;
  vaccineCount: number;
  /** False when zero activities of any type touched this day — treated as "not tracked". */
  hasAnyActivity: boolean;
}

const PLAY_TYPES = ['TUMMY_TIME', 'INDOOR_PLAY', 'OUTDOOR_PLAY', 'WALK', 'CUSTOM'];

export function computeDayStats(
  activities: ActivityType[],
  dayDate: Date,
  options: DayStatsOptions
): DayStats {
  const { preferredUnit, cutoff, unitSymbol } = options;

  const startOfDay = new Date(dayDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(dayDate);
  endOfDay.setHours(23, 59, 59, 999);
  const endBound = cutoff && cutoff < endOfDay ? cutoff : endOfDay;

  const stats: DayStats = {
    totalSleepMinutes: 0,
    napCount: 0,
    awakeMinutes: 0,
    totalFeedCount: 0,
    bottleFeedTotal: 0,
    breastMilkBottleTotal: 0,
    formulaBottleTotal: 0,
    otherBottleTotal: 0,
    leftBreastFeedMinutes: 0,
    rightBreastFeedMinutes: 0,
    solidsAmounts: {},
    wetCount: 0,
    dirtyCount: 0,
    poopCount: 0,
    medicineStats: {},
    supplementStats: {},
    noteCount: 0,
    bathCount: 0,
    pumpCount: 0,
    pumpTotal: 0,
    milestoneCount: 0,
    measurementCount: 0,
    playCount: 0,
    totalPlayMinutes: 0,
    vaccineCount: 0,
    hasAnyActivity: false,
  };

  activities.forEach(activity => {
    // Play activities - check before sleep since both have duration, startTime, type
    if ('activities' in activity && 'type' in activity && PLAY_TYPES.includes((activity as any).type)) {
      const time = new Date((activity as any).startTime);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.playCount++;
        if ((activity as any).duration) {
          stats.totalPlayMinutes += (activity as any).duration;
        }
      }
      return; // Skip further checks for this activity
    }

    // Sleep activities (exclude pump activities which also have duration and startTime)
    if ('duration' in activity && 'startTime' in activity &&
        'type' in activity && // Sleep activities have type (NAP or NIGHT_SLEEP)
        !('leftAmount' in activity || 'rightAmount' in activity)) { // Exclude pump activities
      const startTime = new Date(activity.startTime);
      const endTime = 'endTime' in activity && activity.endTime ? new Date(activity.endTime) : null;

      // Count naps by the day they start (mirrors the Reports nap-per-day convention)
      if ((activity as any).type === 'NAP' && startTime >= startOfDay && startTime <= endBound) {
        stats.hasAnyActivity = true;
        stats.napCount++;
      }

      if (endTime) {
        const overlapStart = Math.max(startTime.getTime(), startOfDay.getTime());
        const overlapEnd = Math.min(endTime.getTime(), endBound.getTime());

        if (overlapEnd > overlapStart) {
          stats.hasAnyActivity = true;
          stats.totalSleepMinutes += Math.floor((overlapEnd - overlapStart) / (1000 * 60));
        }
      } else if (startTime >= startOfDay && startTime <= endBound) {
        // Ongoing sleep (no endTime): credit up to the end bound
        stats.hasAnyActivity = true;
        const activeMinutes = Math.floor((endBound.getTime() - startTime.getTime()) / (1000 * 60));
        if (activeMinutes > 0) {
          stats.totalSleepMinutes += activeMinutes;
        }
      }
    }

    // Feed activities - track all types together
    if ('amount' in activity && 'type' in activity) {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        if (activity.type === 'BOTTLE') {
          stats.hasAnyActivity = true;
          stats.totalFeedCount++;
          const entryUnit = activity.unitAbbr || 'OZ';
          const amount = activity.amount || 0;
          const converted = convertVolume(amount, entryUnit, preferredUnit);
          stats.bottleFeedTotal += converted;
          // Split the measured amount into breast milk vs formula by bottle type
          const bottleType = (activity as any).bottleType;
          if (bottleType === 'Breast Milk') {
            stats.breastMilkBottleTotal += converted;
          } else if (bottleType === 'Formula') {
            stats.formulaBottleTotal += converted;
          } else if (bottleType === 'Formula\\Breast') {
            const bmConverted = convertVolume((activity as any).breastMilkAmount || 0, entryUnit, preferredUnit);
            stats.breastMilkBottleTotal += bmConverted;
            stats.formulaBottleTotal += Math.max(0, converted - bmConverted);
          } else {
            // Milk, Other, or uncategorized
            stats.otherBottleTotal += converted;
          }
        } else if (activity.type === 'SOLIDS') {
          stats.hasAnyActivity = true;
          stats.totalFeedCount++;
          // Track solids amounts by unit
          const unit = activity.unitAbbr || 'g';
          if (!stats.solidsAmounts[unit]) {
            stats.solidsAmounts[unit] = 0;
          }
          stats.solidsAmounts[unit] += activity.amount || 0;
        }
      }
    }

    // Breast feed activities - track duration separately for left and right
    if ('type' in activity && activity.type === 'BREAST') {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.totalFeedCount++;
        // Track duration: prefer feedDuration (in seconds), fall back to amount (in minutes)
        let feedMinutes = 0;
        if ('feedDuration' in activity && activity.feedDuration) {
          // Convert seconds to minutes
          feedMinutes = Math.floor(activity.feedDuration / 60);
        } else if ('amount' in activity && activity.amount) {
          // Amount is already in minutes for older records
          feedMinutes = activity.amount;
        }

        // Track by side if available
        if ('side' in activity && activity.side) {
          if (activity.side === 'LEFT') {
            stats.leftBreastFeedMinutes += feedMinutes;
          } else if (activity.side === 'RIGHT') {
            stats.rightBreastFeedMinutes += feedMinutes;
          }
        }
        // Note: If no side specified, we don't track it separately to avoid inaccuracy
        // The feed is still counted in totalFeedCount
      }
    }

    // Diaper activities
    if ('condition' in activity && 'type' in activity) {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        // Count wet and dirty diapers exclusively
        if (activity.type === 'WET') {
          stats.wetCount++;
        } else if (activity.type === 'DIRTY') {
          stats.dirtyCount++;
          stats.poopCount++;
        } else if (activity.type === 'BOTH') {
          // BOTH counts as both wet and dirty
          stats.wetCount++;
          stats.dirtyCount++;
          stats.poopCount++;
        }
      }
    }

    // Medicine and supplement activities
    if ('doseAmount' in activity && 'medicineId' in activity) {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        // Determine if supplement
        const isSupplement = 'medicine' in activity && activity.medicine && typeof activity.medicine === 'object' && 'isSupplement' in activity.medicine && (activity.medicine as any).isSupplement;
        const targetStats = isSupplement ? stats.supplementStats : stats.medicineStats;

        // Get medicine/supplement name (display fallback resolved by the component)
        let medicineName = 'unknown';
        if ('medicine' in activity && activity.medicine && typeof activity.medicine === 'object' && 'name' in activity.medicine) {
          medicineName = (activity.medicine as { name?: string }).name || medicineName;
        }

        // Initialize record if it doesn't exist
        if (!targetStats[medicineName]) {
          targetStats[medicineName] = {
            count: 0,
            total: 0,
            unit: unitSymbol(activity.unitAbbr)
          };
        }

        // Increment count and add to total
        targetStats[medicineName].count += 1;
        if (activity.doseAmount && typeof activity.doseAmount === 'number') {
          targetStats[medicineName].total += activity.doseAmount;
        }
      }
    }

    // Note activities
    if ('content' in activity) {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.noteCount++;
      }
    }

    // Bath activities
    if ('soapUsed' in activity) {
      const time = new Date(activity.time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.bathCount++;
      }
    }

    // Pump activities
    if ('leftAmount' in activity || 'rightAmount' in activity) {
      let time: Date | null = null;
      if ('startTime' in activity && activity.startTime) {
        time = new Date(activity.startTime);
      } else if ('time' in activity && activity.time) {
        time = new Date(activity.time);
      }
      if (time && time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.pumpCount++;
        const total = (activity as any).totalAmount || 0;
        if (total > 0) {
          const entryUnit = (activity as any).unitAbbr || 'OZ';
          stats.pumpTotal += convertVolume(total, entryUnit, preferredUnit);
        }
      }
    }

    // Vaccine activities
    if ('vaccineName' in activity) {
      const time = new Date((activity as any).time);
      if (time >= startOfDay && time <= endBound) {
        stats.hasAnyActivity = true;
        stats.vaccineCount++;
      }
      return;
    }

    // Milestone activities
    if ('title' in activity && 'category' in activity) {
      const activityDate = new Date(activity.date);
      if (activityDate >= startOfDay && activityDate <= endBound) {
        stats.hasAnyActivity = true;
        stats.milestoneCount++;
      }
    }

    // Measurement activities
    if ('value' in activity && 'unit' in activity) {
      const activityDate = new Date(activity.date);
      if (activityDate >= startOfDay && activityDate <= endBound) {
        stats.hasAnyActivity = true;
        stats.measurementCount++;
      }
    }
  });

  // Awake time: elapsed time (to the end bound) minus sleep
  const elapsedMinutes = Math.floor((endBound.getTime() - startOfDay.getTime()) / (1000 * 60));
  stats.awakeMinutes = Math.max(0, elapsedMinutes - stats.totalSleepMinutes);

  return stats;
}
