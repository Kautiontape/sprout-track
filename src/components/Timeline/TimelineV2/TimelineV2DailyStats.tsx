import React, { useState, useMemo, useCallback } from 'react';
import { 
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Moon,
  Sun,
  PillBottle,
  Pill,
  Edit,
  Bath,
  LampWallDown,
  Trophy,
  Ruler,
  Icon,
  Eye,
  EyeOff,
  Baby,
  Syringe,
  Info
} from 'lucide-react';
import { diaper, bottleBaby } from '@lucide/lab';
import { Button } from '@/src/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/src/components/ui/popover';
import { Calendar as CalendarComponent } from '@/src/components/ui/calendar';
import { FilterType } from '../types';
import { ActivityType } from '../types';
import TimelineV2Heatmap from './TimelineV2Heatmap';
import { useLocalization } from '@/src/context/localization';
import { useTimezone } from '@/app/context/timezone';
import { formatDateLong, formatTimeDisplay } from '@/src/utils/dateFormat';
import { getSymbol } from '@/src/hooks/useUnit';
import { computeDayStats } from './computeDayStats';

import './TimelineV2DailyStats.css';

interface TimelineV2DailyStatsProps {
  activities: ActivityType[];
  /** All activities for the fetched window (avgDays+1 back through +1 forward) — baseline for averages */
  windowActivities: ActivityType[];
  /** Running-average window length from family settings (clamped 2-14) */
  avgDays: number;
  heatmapActivities: ActivityType[];
  date: Date;
  isLoading?: boolean;
  activeFilter: FilterType;
  onDateChange: (days: number) => void;
  onDateSelection: (date: Date) => void;
  onFilterChange: (filter: FilterType) => void;
   isHeatmapVisible: boolean;
   onHeatmapToggle: () => void;
   breastMilkBalance?: string;
   defaultBottleUnit?: string;
   enableBreastMilkTracking?: boolean;
}

interface StatTile {
  filter: FilterType;
  label: string;
  value: string;
  icon: React.ReactNode;
  bgColor: string;
  iconColor: string;
  borderColor: string;
  bgActiveColor: string;
  // Optional breakdown shown in a popover (e.g. breast milk vs formula split)
  breakdown?: { label: string; value: string }[];
  // Running-average secondary line, e.g. "avg 6h 58m"
  avg?: string;
  // Today-only pace detail rendered in an (i) popover on the avg line
  pace?: { usuallyText: string; statusLabel: string };
}

interface CoreAverages {
  sleepMinutes: number;
  napCount: number;
  feedCount: number;
  bottleVolume: number;
  wetCount: number;
  poopCount: number;
}

const TimelineV2DailyStats: React.FC<TimelineV2DailyStatsProps> = ({
  activities,
  windowActivities,
  avgDays,
  heatmapActivities,
  date, 
  isLoading = false,
  activeFilter,
  onDateChange,
  onDateSelection,
  onFilterChange,
  isHeatmapVisible,
  onHeatmapToggle,
  breastMilkBalance,
  defaultBottleUnit,
  enableBreastMilkTracking = true
}) => {
  const { t } = useLocalization();
  const unitSymbol = useCallback((unitAbbr?: string | null) => getSymbol(unitAbbr, t), [t]);
  const { dateFormat, timeFormat } = useTimezone();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Helper function to format minutes into hours and minutes
  const formatMinutes = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}${t('min')}`;
  };

  // Compact H:MM form for dense secondary lines, e.g. "16:09"
  const formatMinutesCompact = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${String(mins).padStart(2, '0')}`;
  };

  // Baseline averages over the avgDays days preceding the viewed day.
  // Depends on `activities` (not just windowActivities) so the 30s polling
  // re-truncates today's expected-by-now with a fresh "now".
  const averages = useMemo(() => {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const preferredUnit = defaultBottleUnit || 'OZ';

    const fullDays: ReturnType<typeof computeDayStats>[] = [];
    const truncatedDays: ReturnType<typeof computeDayStats>[] = [];

    for (let i = 1; i <= avgDays; i++) {
      const day = new Date(date);
      day.setDate(day.getDate() - i);
      const full = computeDayStats(windowActivities, day, { preferredUnit, unitSymbol });
      if (!full.hasAnyActivity) continue; // untracked day — excluded from the baseline
      fullDays.push(full);
      if (isToday) {
        const cutoff = new Date(day);
        cutoff.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 999);
        truncatedDays.push(computeDayStats(windowActivities, day, { preferredUnit, unitSymbol, cutoff }));
      }
    }

    if (fullDays.length === 0) return null;

    const avgOf = (list: typeof fullDays): CoreAverages => {
      const mean = (pick: (s: (typeof list)[number]) => number) =>
        list.reduce((sum, s) => sum + pick(s), 0) / list.length;
      return {
        sleepMinutes: mean(s => s.totalSleepMinutes),
        napCount: mean(s => s.napCount),
        feedCount: mean(s => s.totalFeedCount),
        bottleVolume: mean(s => s.bottleFeedTotal),
        wetCount: mean(s => s.wetCount),
        poopCount: mean(s => s.poopCount),
      };
    };

    return {
      full: avgOf(fullDays),
      expectedByNow: isToday && truncatedDays.length > 0 ? avgOf(truncatedDays) : null,
      asOf: now,
    };
  }, [windowActivities, activities, date, avgDays, defaultBottleUnit, unitSymbol]);

  // Calculate stats and create dynamic tiles
  const statTiles = useMemo(() => {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const preferredUnit = defaultBottleUnit || 'OZ';

    const dayStats = computeDayStats(activities, date, {
      preferredUnit,
      unitSymbol,
      cutoff: isToday ? now : undefined,
    });

    const {
      totalSleepMinutes, awakeMinutes, totalFeedCount,
      bottleFeedTotal, breastMilkBottleTotal, formulaBottleTotal, otherBottleTotal,
      leftBreastFeedMinutes, rightBreastFeedMinutes, solidsAmounts,
      wetCount, poopCount, noteCount, bathCount, pumpCount, pumpTotal,
      milestoneCount, measurementCount, playCount, totalPlayMinutes, vaccineCount,
    } = dayStats;

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const roundAmount = (n: number) => Math.round(n * 100) / 100;

    const buildPace = (
      actual: number,
      expected: number | undefined,
      fmt: (n: number) => string,
      isCount = false
    ): StatTile['pace'] => {
      if (!averages?.expectedByNow || expected === undefined) return undefined;
      let status: 'ahead' | 'behind' | 'on-pace';
      if (expected <= 0) {
        status = actual > 0 ? 'ahead' : 'on-pace';
      } else if (isCount) {
        // Small counts round ambiguously; treat [floor, ceil] of expected as on pace
        status = actual < Math.floor(expected) ? 'behind' : actual > Math.ceil(expected) ? 'ahead' : 'on-pace';
      } else if (actual >= expected * 1.1) {
        status = 'ahead';
      } else if (actual <= expected * 0.9) {
        status = 'behind';
      } else {
        status = 'on-pace';
      }
      return {
        usuallyText: `${t('Usually')} ${fmt(expected)} ${t('by')} ${formatTimeDisplay(averages.asOf, timeFormat)}`,
        statusLabel: status === 'ahead' ? t('Ahead of pace') : status === 'behind' ? t('Behind pace') : t('On pace'),
      };
    };

    const tiles: StatTile[] = [];

    // Awake Time tile - always first
    if (awakeMinutes > 0) {
      tiles.push({
        filter: null,
        label: t('Awake Time'),
        value: formatMinutes(awakeMinutes),
        icon: <Sun className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-amber-600',
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }

    // Sleep tile
    const sleepAvg = averages ? averages.full.sleepMinutes : null;
    if (totalSleepMinutes > 0 || (sleepAvg ?? 0) > 0) {
      tiles.push({
        filter: 'sleep',
        label: t('Total Sleep'),
        value: formatMinutes(totalSleepMinutes),
        icon: <Moon className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#9ca3af]', // gray-400 - matches timeline
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100',
        avg: sleepAvg !== null
          ? `${t('avg')} ${round1(averages!.full.napCount) > 0 ? `${round1(averages!.full.napCount)} · ` : ''}${formatMinutesCompact(Math.round(sleepAvg))}`
          : undefined,
        pace: buildPace(totalSleepMinutes, averages?.expectedByNow?.sleepMinutes, (n) => formatMinutes(Math.round(n))),
      });
    }

    // Combined feed tile (bottle, breast, and solids)
    const feedAvg = averages ? averages.full.feedCount : null;
    if (totalFeedCount > 0 || (feedAvg ?? 0) > 0) {
      // Format bottle feed amounts. The tile stays compact (total only); when more
      // than one bottle type is present, the breast milk vs formula split is shown
      // in a popover instead of widening the tile.
      let formattedBottleAmounts = '';
      let feedBreakdown: { label: string; value: string }[] | undefined;
      if (bottleFeedTotal > 0) {
        const unitLabel = preferredUnit.toLowerCase();
        const total = roundAmount(bottleFeedTotal);
        const buckets = [
          { amount: breastMilkBottleTotal, label: t('breast') },
          { amount: formulaBottleTotal, label: t('formula') },
          { amount: otherBottleTotal, label: t('other'), isOther: true },
        ].filter(b => b.amount > 0);
        if (buckets.length >= 2) {
          formattedBottleAmounts = `${total} ${unitLabel}`;
          feedBreakdown = buckets.map(b => ({
            label: b.label,
            value: `${roundAmount(b.amount)} ${unitLabel}`,
          }));
        } else if (buckets.length === 1 && !buckets[0].isOther) {
          formattedBottleAmounts = `${total} ${unitLabel} ${buckets[0].label}`;
        } else {
          formattedBottleAmounts = `${total} ${unitLabel}`;
        }
      }
      
      // Format solids amounts
      const formattedSolidsAmounts = Object.entries(solidsAmounts)
        .map(([unit, amount]) => `${amount} ${unit.toLowerCase()}`)
        .join(', ');
      
      // Format breast feed amounts separately for left and right
      const breastFeedParts: string[] = [];
      if (leftBreastFeedMinutes > 0 && rightBreastFeedMinutes > 0) {
        breastFeedParts.push(`${t('L:')} ${formatMinutes(leftBreastFeedMinutes)}`);
        breastFeedParts.push(`${t('R:')} ${formatMinutes(rightBreastFeedMinutes)}`);
      } else if (leftBreastFeedMinutes > 0) {
        breastFeedParts.push(`${t('Left:')} ${formatMinutes(leftBreastFeedMinutes)}`);
      } else if (rightBreastFeedMinutes > 0) {
        breastFeedParts.push(`${t('Right:')} ${formatMinutes(rightBreastFeedMinutes)}`);
      }
      const formattedBreastFeed = breastFeedParts.length > 0 ? breastFeedParts.join(', ') : '';
      
      // Build combined label
      const labelParts: string[] = [];
      if (formattedBottleAmounts) {
        labelParts.push(formattedBottleAmounts);
      }
      if (formattedBreastFeed) {
        labelParts.push(formattedBreastFeed);
      }
      if (formattedSolidsAmounts) {
        labelParts.push(formattedSolidsAmounts);
      }
      
      const combinedLabel = labelParts.length > 0 
        ? labelParts.join(' • ')
        : t('Feeds');
      
      tiles.push({
        filter: 'feed',
        label: combinedLabel,
        value: totalFeedCount.toString(),
        icon: <Icon iconNode={bottleBaby} className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#7dd3fc]', // sky-300 - matches timeline
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100',
        breakdown: feedBreakdown,
        avg: feedAvg !== null
          ? `${t('avg')} ${round1(feedAvg)}${averages!.full.bottleVolume > 0 ? ` · ${roundAmount(averages!.full.bottleVolume)} ${preferredUnit.toLowerCase()}` : ''}`
          : undefined,
        pace: averages && averages.full.bottleVolume > 0
          ? buildPace(bottleFeedTotal, averages?.expectedByNow?.bottleVolume, (n) => `${roundAmount(n)} ${preferredUnit.toLowerCase()}`)
          : buildPace(totalFeedCount, averages?.expectedByNow?.feedCount, (n) => String(round1(n)), true),
      });
    }

    // Wet diaper tile
    const wetAvg = averages ? averages.full.wetCount : null;
    if (wetCount > 0 || (wetAvg ?? 0) > 0) {
      tiles.push({
        filter: 'diaper',
        label: t('Wet Diapers'),
        value: wetCount.toString(),
        icon: <Icon iconNode={diaper} className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#0d9488]', // teal-600 (green) - matches timeline for wet
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100',
        avg: wetAvg !== null ? `${t('avg')} ${round1(wetAvg)}` : undefined,
        pace: buildPace(wetCount, averages?.expectedByNow?.wetCount, (n) => String(round1(n)), true),
      });
    }

    // Poop tile
    const poopAvg = averages ? averages.full.poopCount : null;
    if (poopCount > 0 || (poopAvg ?? 0) > 0) {
      tiles.push({
        filter: 'poop',
        label: t('Poops'),
        value: poopCount.toString(),
        icon: <Icon iconNode={diaper} className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-amber-700', // amber-700 for poops
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100',
        avg: poopAvg !== null ? `${t('avg')} ${round1(poopAvg)}` : undefined,
        pace: buildPace(poopCount, averages?.expectedByNow?.poopCount, (n) => String(round1(n)), true),
      });
    }

    // Medicine tiles
    const medicineEntries = Object.entries(dayStats.medicineStats).filter(([_, stats]) => stats.count > 0);
    if (medicineEntries.length > 0) {
      if (medicineEntries.length === 1) {
        const [medicineName, stats] = medicineEntries[0];
        tiles.push({
          filter: 'medicine',
          label: `${medicineName === 'unknown' ? t('unknown') : medicineName}: ${stats.count}x (${stats.total} ${stats.unit})`,
          value: stats.count.toString(),
          icon: <PillBottle className="h-full w-full" />,
          bgColor: 'bg-gray-50',
          iconColor: 'text-[#43B755]', // green - matches timeline
          borderColor: 'border-gray-500',
          bgActiveColor: 'bg-gray-100'
        });
      } else {
        const totalCount = medicineEntries.reduce((sum, [_, stats]) => sum + stats.count, 0);
        const label = medicineEntries
          .map(([name, stats]) => `${name === 'unknown' ? t('unknown') : name}: ${stats.count}x (${stats.total} ${stats.unit})`)
          .join(', ');
        tiles.push({
          filter: 'medicine',
          label: label,
          value: totalCount.toString(),
          icon: <PillBottle className="h-full w-full" />,
          bgColor: 'bg-gray-50',
          iconColor: 'text-[#43B755]', // green - matches timeline
          borderColor: 'border-gray-500',
          bgActiveColor: 'bg-gray-100'
        });
      }
    }

    // Supplement tiles
    const supplementEntries = Object.entries(dayStats.supplementStats).filter(([_, stats]) => stats.count > 0);
    if (supplementEntries.length > 0) {
      if (supplementEntries.length === 1) {
        const [supplementName, stats] = supplementEntries[0];
        tiles.push({
          filter: 'medicine',
          label: `${supplementName === 'unknown' ? t('unknown') : supplementName}: ${stats.count}x (${stats.total} ${stats.unit})`,
          value: stats.count.toString(),
          icon: <Pill className="h-full w-full" />,
          bgColor: 'bg-gray-50',
          iconColor: 'text-[#43B755]', // green - matches timeline
          borderColor: 'border-gray-500',
          bgActiveColor: 'bg-gray-100'
        });
      } else {
        const totalCount = supplementEntries.reduce((sum, [_, stats]) => sum + stats.count, 0);
        const label = supplementEntries
          .map(([name, stats]) => `${name === 'unknown' ? t('unknown') : name}: ${stats.count}x (${stats.total} ${stats.unit})`)
          .join(', ');
        tiles.push({
          filter: 'medicine',
          label: label,
          value: totalCount.toString(),
          icon: <Pill className="h-full w-full" />,
          bgColor: 'bg-gray-50',
          iconColor: 'text-[#43B755]', // green - matches timeline
          borderColor: 'border-gray-500',
          bgActiveColor: 'bg-gray-100'
        });
      }
    }

    // Note tile
    if (noteCount > 0) {
      tiles.push({
        filter: 'note',
        label: t('Notes'),
        value: noteCount.toString(),
        icon: <Edit className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#fef08a]', // yellow-200 - matches timeline
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }

    // Bath tile
    if (bathCount > 0) {
      tiles.push({
        filter: 'bath',
        label: t('Baths'),
        value: bathCount.toString(),
        icon: <Bath className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#fb923c]', // orange-400 - matches timeline
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }

    // Pump tile
    if (pumpCount > 0) {
      const formattedPumpAmounts = pumpTotal > 0
        ? `${Math.round(pumpTotal * 100) / 100} ${preferredUnit.toLowerCase()}`
        : '';
      tiles.push({
        filter: 'pump',
        label: formattedPumpAmounts || t('Pump'),
        value: pumpCount.toString(),
        icon: <LampWallDown className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#c084fc]', // purple-400 - matches timeline
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }

    // Breast milk stored balance tile (only when tracking is enabled)
    if (breastMilkBalance && enableBreastMilkTracking !== false) {
      tiles.push({
        filter: null,
        label: t('Breast Milk Stored'),
        value: breastMilkBalance,
        icon: <LampWallDown className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#c084fc]', // purple-400 - matches pump
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }

    // Vaccine tile
    if (vaccineCount > 0) {
      tiles.push({
        filter: 'vaccine',
        label: t('Vaccines'),
        value: vaccineCount.toString(),
        icon: <Syringe className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#EF4444]',
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }

    // Milestone tile
    if (milestoneCount > 0) {
      tiles.push({
        filter: 'milestone',
        label: t('Milestones'),
        value: milestoneCount.toString(),
        icon: <Trophy className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#4875EC]', // blue - matches timeline
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }

    // Measurement tile
    if (measurementCount > 0) {
      tiles.push({
        filter: 'measurement',
        label: t('Measurements'),
        value: measurementCount.toString(),
        icon: <Ruler className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#EA6A5E]', // red - matches timeline
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }

    // Play/Activity tile
    if (playCount > 0) {
      const playLabel = totalPlayMinutes > 0 ? formatMinutes(totalPlayMinutes) : t('Play Time');
      tiles.push({
        filter: 'play',
        label: playLabel,
        value: playCount.toString(),
        icon: <Baby className="h-full w-full" />,
        bgColor: 'bg-gray-50',
        iconColor: 'text-[#F3C4A2]', // peach - matches play activity
        borderColor: 'border-gray-500',
        bgActiveColor: 'bg-gray-100'
      });
    }

    return tiles;
  }, [activities, date, t, defaultBottleUnit, unitSymbol, averages, timeFormat]);

  const formatDateDisplay = (date: Date): string => {
    return formatDateLong(date, dateFormat);
  };

  return (
    <div className="overflow-hidden border-0 bg-white timeline-v2-daily-stats relative z-10">
      <div className="px-5 py-1 relative z-10">
        {/* Date Navigation Header */}
        <div className="flex items-center justify-center mb-2">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDateChange(-1)}
              className="h-8 w-8 text-gray-700 hover:bg-gray-100"
              aria-label={t('Previous day')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="h-8 px-3 text-sm font-medium text-gray-800 hover:bg-gray-100 min-w-[140px]"
                >
                  {formatDateDisplay(date)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-auto" align="start">
                <CalendarComponent
                  selected={date}
                  onSelect={(selectedDate) => {
                    if (selectedDate) {
                      selectedDate.setHours(0, 0, 0, 0);
                      onDateSelection(selectedDate);
                      setCalendarOpen(false);
                    }
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDateChange(1)}
              className="h-8 w-8 text-gray-700 hover:bg-gray-100"
              aria-label={t('Next day')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Daily Summary Title with Collapse Toggle + Heatmap Toggle */}
        <div className="flex items-center justify-between mb-1">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-3 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
            aria-label={isCollapsed ? t('Expand daily summary') : t('Collapse daily summary')}
          >
            <span>{t('Daily Summary')}</span>
            {isCollapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>

          <div className="flex items-center gap-2">
            {/* Mobile toggle */}
            <button
              type="button"
              className="text-xs inline-flex md:hidden items-center gap-1 text-teal-600 hover:text-teal-700"
              onClick={onHeatmapToggle}
            >
              {isHeatmapVisible ? (
                <>
                  <EyeOff className="h-3 w-3" />
                  <span>{t('Hide heatmap')}</span>
                </>
              ) : (
                <>
                  <Eye className="h-3 w-3" />
                  <span>{t('Show heatmap')}</span>
                </>
              )}
            </button>

            {/* Desktop toggle */}
            <button
              type="button"
              className="ml-2 text-xs hidden md:inline-flex items-center gap-1 text-teal-600 hover:text-teal-700 underline underline-offset-2"
              onClick={onHeatmapToggle}
            >
              {isHeatmapVisible ? (
                <>
                  <EyeOff className="h-3 w-3" />
                  <span>{t('Hide heatmap')}</span>
                </>
              ) : (
                <>
                  <Eye className="h-3 w-3" />
                  <span>{t('Show heatmap')}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        {!isCollapsed && (
          <>
            {statTiles.length > 0 ? (
              <div className="flex flex-wrap gap-0.5">
                {statTiles.map((tile) => {
                  const isFilterable = tile.filter !== null;
                  const activate = () => {
                    if (isFilterable) {
                      onFilterChange(tile.filter === activeFilter ? null : tile.filter);
                    }
                  };
                  return (
                  // Rendered as a div (not a button) so the breakdown popover trigger can nest validly
                  <div
                    key={tile.filter ? `${tile.filter}-${tile.label.toLowerCase().replace(/\s+/g, '-')}` : tile.label.toLowerCase().replace(/\s+/g, '-')}
                    role={isFilterable ? 'button' : undefined}
                    tabIndex={isFilterable ? 0 : undefined}
                    onClick={activate}
                    onKeyDown={(e) => {
                      // Only act when the tile itself is focused, not a nested control (the popover trigger)
                      if (isFilterable && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        activate();
                      }
                    }}
                    className={`relative rounded-xl text-left transition-all duration-200 overflow-hidden ${
                      // Never show awake time tile as selected, only show selected state for filterable tiles
                      tile.filter !== null && activeFilter === tile.filter
                        ? 'bg-gray-100 cursor-pointer scale-105'
                        : tile.filter !== null
                        ? 'bg-transparent cursor-pointer'
                        : 'bg-transparent cursor-default'
                    }`}
                  >
                    {/* Horizontal layout: icon left, text right */}
                    <div className="flex items-center gap-2.5 px-2 py-1">
                      {/* Icon */}
                      <div className={`flex-shrink-0 ${tile.iconColor}`}>
                        <div className="w-5 h-5">
                          {tile.icon}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex flex-col min-w-0">
                        <div className="text-base font-bold text-gray-800 leading-tight">{tile.value}</div>
                        <div className="flex items-center gap-1 text-xs text-gray-600 font-medium leading-tight">
                          <span>{tile.label}</span>
                          {tile.breakdown && tile.breakdown.length > 0 && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex-shrink-0 text-gray-400 hover:opacity-70 transition-opacity"
                                  aria-label={t('Feed breakdown')}
                                >
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-auto p-2">
                                <div className="flex flex-col gap-1 text-xs">
                                  {tile.breakdown.map((part) => (
                                    <div key={part.label} className="flex items-center justify-between gap-4">
                                      <span className="text-gray-500 capitalize">{part.label}</span>
                                      <span className="font-semibold text-gray-800 whitespace-nowrap">{part.value}</span>
                                    </div>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                        {tile.avg && (
                          <div className="flex items-center gap-1 text-[10px] text-gray-400 font-medium leading-tight">
                            <span>{tile.avg}</span>
                            {tile.pace && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex-shrink-0 text-gray-400 hover:opacity-70 transition-opacity"
                                    aria-label={t('Pace details')}
                                  >
                                    <Info className="h-3 w-3" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-auto p-2">
                                  <div className="flex flex-col gap-1 text-xs">
                                    <span className="text-gray-500">{tile.pace.usuallyText}</span>
                                    <span className="font-semibold text-gray-800">{tile.pace.statusLabel}</span>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-gray-500 text-center py-4">
                {t('No activities recorded for this day')}
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile heatmap slide-out panel (right side, similar to FormPage) */}
      <div className="fixed inset-0 z-40 md:hidden pointer-events-none">
        {/* Overlay */}
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
            isHeatmapVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          onClick={onHeatmapToggle}
        />

        {/* Slide-out panel */}
        <div
          className={`
            absolute inset-y-0 right-0 w-24 bg-white shadow-xl
            transform transition-transform duration-300
            timeline-v2-heatmap-panel
            ${isHeatmapVisible ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'}
          `}
        >
          <div className="flex justify-end px-3 pt-2 mb-2">
            <button
              type="button"
              className="text-xs inline-flex items-center gap-1 text-teal-600 hover:text-teal-700 underline underline-offset-2"
              onClick={onHeatmapToggle}
            >
              <EyeOff className="h-3 w-3" />
              <span>{t('Hide')}</span>
            </button>
          </div>
          <div className="h-full px-1 py-2">
            <TimelineV2Heatmap
              activities={heatmapActivities}
              selectedDate={date}
              isVisible={isHeatmapVisible}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimelineV2DailyStats;
