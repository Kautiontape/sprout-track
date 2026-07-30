'use client';

import React, { useState } from 'react';
import { Toilet } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Card, CardContent } from '@/src/components/ui/card';
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/src/components/ui/accordion';
import { styles } from './reports.styles';
import { PottyStats, DateRange } from './reports.types';
import PottyChartModal, { PottyChartMetric } from './PottyChartModal';
import { useLocalization } from '@/src/context/localization';

interface PottyStatsSectionProps {
  stats: PottyStats;
  dateRange: DateRange;
}

interface PottyStatCardProps {
  value: React.ReactNode;
  label: string;
  subLabel?: React.ReactNode;
  onClick?: () => void;
  /** Downsizes the value slot for long phrase values (see VaccineStatsSection's Last Vaccine Date card). */
  valueClassName?: string;
}

/** A single tappable (or plain) stat card, styled like the rest of Reports. */
const PottyStatCard: React.FC<PottyStatCardProps> = ({ value, label, subLabel, onClick, valueClassName }) => (
  <Card className={cn(styles.statCard, 'reports-stat-card', onClick && 'cursor-pointer')} onClick={onClick}>
    <CardContent className="p-4">
      <div className={cn(styles.statCardValue, 'reports-stat-card-value', valueClassName)}>{value}</div>
      <div className={cn(styles.statCardLabel, 'reports-stat-card-label')}>{label}</div>
      {subLabel !== undefined && (
        <div className={cn(styles.statCardSubLabel, 'reports-stat-card-sublabel')}>{subLabel}</div>
      )}
    </CardContent>
  </Card>
);

/**
 * PottyStatsSection Component
 *
 * Displays EC potty-catch statistics (Phase 2). Consumes only the precomputed
 * PottyStats from potty-stats.utils.ts — no recomputation happens here.
 *
 * The wake-up panel deliberately never divides wakeUpCatches by
 * (napCoverage.hit + nightCoverage.hit): those numbers do not decompose (see
 * the module's test #18 / the design doc's binding rules). Coverage is shown
 * as its own "N of M wake-ups followed by a catch" lines instead.
 */
const PottyStatsSection: React.FC<PottyStatsSectionProps> = ({ stats, dateRange }) => {
  const { t } = useLocalization();
  const [chartModalOpen, setChartModalOpen] = useState(false);
  const [chartMetric, setChartMetric] = useState<PottyChartMetric | null>(null);

  const openChart = (metric: PottyChartMetric) => {
    setChartMetric(metric);
    setChartModalOpen(true);
  };

  const { wakeUp, scoreboard } = stats;
  const hasCoverageLines = wakeUp.napCoverage.total > 0 || wakeUp.nightCoverage.total > 0;

  return (
    <>
      <AccordionItem value="potty">
        <AccordionTrigger className={cn(styles.accordionTrigger, 'reports-accordion-trigger')}>
          <Toilet className={cn(styles.accordionTriggerIcon, 'reports-accordion-trigger-icon reports-icon-potty text-fuchsia-600')} />
          <span>{t('Potty Statistics')}</span>
        </AccordionTrigger>
        <AccordionContent className={styles.accordionContent}>
          {stats.totalCatches === 0 ? (
            <div className={cn(styles.emptyContainer, 'reports-empty-container')}>
              <p className={cn(styles.emptyText, 'reports-empty-text')}>
                {t('No potty catches in this range yet')}
              </p>
            </div>
          ) : (
            <>
              <div className={styles.statsGrid}>
                <PottyStatCard
                  value={stats.totalCatches}
                  label={t('Total Catches')}
                  onClick={() => openChart('daily')}
                />
                <PottyStatCard
                  value={stats.avgCatchesPerDay}
                  label={t('Catches/Day')}
                  subLabel={t('avg')}
                  onClick={() => openChart('daily')}
                />
                <PottyStatCard
                  value={stats.peesCaught}
                  label={t('Pees Caught')}
                  onClick={() => openChart('hours')}
                />
                <PottyStatCard
                  value={stats.poopsCaught}
                  label={t('Poops Caught')}
                  onClick={() => openChart('hours')}
                />
                <PottyStatCard
                  value={`${scoreboard.poopsCaught} ${t('caught')} · ${scoreboard.poopyDiapers} ${t('in diaper')}`}
                  valueClassName="text-base"
                  label={t('Poops Caught vs Diapered')}
                  subLabel={
                    scoreboard.shareCaught === null
                      ? t('No poop data yet')
                      : `${Math.round(scoreboard.shareCaught * 100)}% ${t('caught')}`
                  }
                  onClick={() => openChart('scoreboard')}
                />
                <PottyStatCard
                  value={wakeUp.wakeUpCatches}
                  label={t('Wake-Up Catches')}
                  subLabel={
                    wakeUp.shareOfAllCatches === null
                      ? undefined
                      : `${Math.round(wakeUp.shareOfAllCatches * 100)}% ${t('of catches')}`
                  }
                />
                {wakeUp.medianGapMinutes !== null && (
                  <PottyStatCard
                    value={`${Math.round(wakeUp.medianGapMinutes)} ${t('min')}`}
                    label={t('Typical Gap After Waking')}
                  />
                )}
              </div>

              {hasCoverageLines && (
                <div className="mt-4 space-y-1">
                  {wakeUp.napCoverage.total > 0 && (
                    <p className={cn('text-sm text-gray-600', 'reports-potty-coverage-line')}>
                      {wakeUp.napCoverage.hit} {t('of')} {wakeUp.napCoverage.total}{' '}
                      {t('nap wake-ups followed by a catch')}
                    </p>
                  )}
                  {wakeUp.nightCoverage.total > 0 && (
                    <p className={cn('text-sm text-gray-600', 'reports-potty-coverage-line')}>
                      {wakeUp.nightCoverage.hit} {t('of')} {wakeUp.nightCoverage.total}{' '}
                      {t('night wake-ups followed by a catch')}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </AccordionContent>
      </AccordionItem>

      <PottyChartModal
        open={chartModalOpen}
        onOpenChange={(open) => {
          setChartModalOpen(open);
          if (!open) {
            setChartMetric(null);
          }
        }}
        metric={chartMetric}
        stats={stats}
        dateRange={dateRange}
      />
    </>
  );
};

export default PottyStatsSection;
