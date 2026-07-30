'use client';

import React, { useMemo } from 'react';
import { cn } from '@/src/lib/utils';
import { Modal, ModalContent } from '@/src/components/ui/modal';
import { growthChartStyles } from './growth-chart.styles';
import { styles } from './reports.styles';
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { PottyStats, DateRange } from './reports.types';
import { useLocalization } from '@/src/context/localization';
import { useTimezone } from '@/app/context/timezone';
import { formatDateShort, formatDateDisplay } from '@/src/utils/dateFormat';

export type PottyChartMetric = 'daily' | 'scoreboard' | 'hours';

interface PottyChartModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metric: PottyChartMetric | null;
  stats: PottyStats;
  dateRange: DateRange;
}

// Fuchsia identity palette (see docs/superpowers/specs/2026-07-30-ec-potty-stats-phase-2-design.md).
const PEE_COLOR = '#f0abfc'; // fuchsia-300
const POOP_COLOR = '#c026d3'; // fuchsia-600
const LINE_COLOR = '#701a75'; // fuchsia-900
const DIAPERED_COLOR = '#94a3b8'; // slate-400 — deliberately not fuchsia: this series is diaper data

// Weekly label helper, matching the BathChartModal convention (Monday-start ISO week).
function formatWeekLabel(weekStart: string, dateFormat: Parameters<typeof formatDateShort>[1]): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${formatDateShort(start, dateFormat)} - ${formatDateShort(end, dateFormat)}`;
}

function formatHourLabel(hour: number, timeFormat: '12h' | '24h'): string {
  if (timeFormat === '24h') {
    return `${String(hour % 24).padStart(2, '0')}:00`;
  }
  const h = hour % 24;
  const period = h < 12 ? 'a' : 'p';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${period}`;
}

/**
 * PottyChartModal Component
 *
 * Tap-through charts for the Potty Statistics section. Consumes the
 * already-computed PottyStats — no recomputation from raw activities, per the
 * potty-stats.utils.ts data contract.
 */
const PottyChartModal: React.FC<PottyChartModalProps> = ({ open, onOpenChange, metric, stats, dateRange }) => {
  const { t } = useLocalization();
  const { dateFormat, timeFormat } = useTimezone();

  const dailyData = useMemo(() => {
    if (metric !== 'daily') return [];
    return stats.dailySeries.map((entry, idx) => ({
      date: entry.day,
      label: formatDateShort(new Date(entry.day + 'T00:00:00'), dateFormat),
      pees: entry.pees,
      poops: entry.poops,
      rolling: stats.rollingAvg7[idx]?.value ?? 0,
    }));
  }, [metric, stats.dailySeries, stats.rollingAvg7, dateFormat]);

  const scoreboardData = useMemo(() => {
    if (metric !== 'scoreboard') return { rows: [], weeksWithData: 0 };
    const weeksWithData = stats.scoreboard.weekly.filter((w) => w.share !== null).length;
    const rows = stats.scoreboard.weekly.map((w) => ({
      week: w.weekStart,
      label: formatWeekLabel(w.weekStart, dateFormat),
      caught: w.caught,
      diapered: w.diapered,
      sharePercent: w.share === null ? null : Math.round(w.share * 100),
    }));
    return { rows, weeksWithData };
  }, [metric, stats.scoreboard.weekly, dateFormat]);

  const hourData = useMemo(() => {
    if (metric !== 'hours') return [];
    return stats.hourHistogram.bins.map((bin) => ({
      hour: bin.startHour,
      label: formatHourLabel(bin.startHour, timeFormat),
      pees: bin.pees,
      poops: bin.poops,
    }));
  }, [metric, stats.hourHistogram.bins, timeFormat]);

  const getTitle = (): string => {
    switch (metric) {
      case 'daily':
        return t('Potty Catches Over Time');
      case 'scoreboard':
        return t('Poop Scoreboard by Week');
      case 'hours':
        return t('Potty Catches by Time of Day');
      default:
        return '';
    }
  };

  const getDescription = (): string | undefined => {
    if (!dateRange.from || !dateRange.to) return undefined;
    return `${formatDateDisplay(dateRange.from, dateFormat)} -> ${formatDateDisplay(dateRange.to, dateFormat)}`;
  };

  if (!metric) return null;

  return (
    <Modal open={open && !!metric} onOpenChange={onOpenChange} title={getTitle()} description={getDescription()}>
      <ModalContent>
        {metric === 'daily' && (
          dailyData.length === 0 ? (
            <div className={cn(styles.emptyContainer, 'reports-empty-container')}>
              <p className={cn(styles.emptyText, 'reports-empty-text')}>
                {t('No potty catches in this range yet')}
              </p>
            </div>
          ) : (
            <div className={cn(growthChartStyles.chartWrapper, 'growth-chart-wrapper')}>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={dailyData} margin={{ top: 20, right: 24, left: 8, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="growth-chart-grid" />
                  <XAxis dataKey="label" tickMargin={6} className="growth-chart-axis" />
                  <YAxis
                    type="number"
                    domain={[0, 'auto']}
                    tickMargin={6}
                    tickFormatter={(value) => value.toFixed(0)}
                    label={{ value: t('Count'), angle: -90, position: 'insideLeft', offset: -10 }}
                    className="growth-chart-axis"
                  />
                  <RechartsTooltip labelFormatter={(label: any) => `${t('Date:')} ${label}`} />
                  <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 4 }} />
                  <Bar dataKey="pees" stackId="catches" fill={PEE_COLOR} name={t('Pees Caught')} />
                  <Bar dataKey="poops" stackId="catches" fill={POOP_COLOR} name={t('Poops Caught')} />
                  <Line
                    type="monotone"
                    dataKey="rolling"
                    stroke={LINE_COLOR}
                    strokeWidth={2}
                    dot={false}
                    name={t('7-Day Avg')}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )
        )}

        {metric === 'scoreboard' && (
          scoreboardData.weeksWithData < 2 ? (
            <div className={cn(styles.emptyContainer, 'reports-empty-container')}>
              <p className={cn(styles.emptyText, 'reports-empty-text')}>
                {t('Not enough weekly data yet to show the poop scoreboard trend.')}
              </p>
            </div>
          ) : (
            <div className={cn(growthChartStyles.chartWrapper, 'growth-chart-wrapper')}>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={scoreboardData.rows} margin={{ top: 20, right: 24, left: 8, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="growth-chart-grid" />
                  <XAxis dataKey="label" tickMargin={6} className="growth-chart-axis" />
                  <YAxis
                    yAxisId="count"
                    type="number"
                    domain={[0, 'auto']}
                    tickMargin={6}
                    tickFormatter={(value) => value.toFixed(0)}
                    label={{ value: t('Count'), angle: -90, position: 'insideLeft' }}
                    className="growth-chart-axis"
                  />
                  <YAxis
                    yAxisId="percent"
                    orientation="right"
                    type="number"
                    domain={[0, 100]}
                    tickMargin={6}
                    tickFormatter={(value) => `${value}%`}
                    label={{ value: t('Share Caught'), angle: -90, position: 'insideRight' }}
                    className="growth-chart-axis"
                  />
                  <RechartsTooltip
                    formatter={(value: any, name?: string) => {
                      if (name === t('Share Caught')) return [value === null ? '-' : `${value}%`, name];
                      return [`${value}`, name || ''];
                    }}
                    labelFormatter={(label: any) => `${t('Week:')} ${label}`}
                  />
                  <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 4 }} />
                  <Bar yAxisId="count" dataKey="caught" stackId="poop" fill={POOP_COLOR} name={t('Poops Caught')} />
                  <Bar yAxisId="count" dataKey="diapered" stackId="poop" fill={DIAPERED_COLOR} name={t('Poopy Diapers')} />
                  <Line
                    yAxisId="percent"
                    type="monotone"
                    dataKey="sharePercent"
                    stroke={LINE_COLOR}
                    strokeWidth={2}
                    dot={{ r: 4, fill: LINE_COLOR }}
                    connectNulls
                    name={t('Share Caught')}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )
        )}

        {metric === 'hours' && (
          hourData.every((b) => b.pees === 0 && b.poops === 0) ? (
            <div className={cn(styles.emptyContainer, 'reports-empty-container')}>
              <p className={cn(styles.emptyText, 'reports-empty-text')}>
                {t('No potty catches in this range yet')}
              </p>
            </div>
          ) : (
            <div className={cn(growthChartStyles.chartWrapper, 'growth-chart-wrapper')}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={hourData} margin={{ top: 20, right: 24, left: 8, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="growth-chart-grid" />
                  <XAxis dataKey="label" tickMargin={6} className="growth-chart-axis" />
                  <YAxis
                    type="number"
                    domain={[0, 'auto']}
                    tickMargin={6}
                    tickFormatter={(value) => value.toFixed(0)}
                    label={{ value: t('Count'), angle: -90, position: 'insideLeft', offset: -10 }}
                    className="growth-chart-axis"
                  />
                  <RechartsTooltip labelFormatter={(label: any) => `${t('Time:')} ${label}`} />
                  <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 4 }} />
                  <Bar dataKey="pees" stackId="hour" fill={PEE_COLOR} name={t('Pees Caught')} />
                  <Bar dataKey="poops" stackId="hour" fill={POOP_COLOR} name={t('Poops Caught')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )
        )}
      </ModalContent>
    </Modal>
  );
};

export default PottyChartModal;
