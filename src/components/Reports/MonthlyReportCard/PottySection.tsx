'use client';

import React from 'react';
import { cn } from '@/src/lib/utils';
import { useLocalization } from '@/src/context/localization';
import { reportCardStyles as s } from './monthly-report-card.styles';
import type { PottySectionProps } from './monthly-report-card.types';

const PottySection: React.FC<PottySectionProps> = ({ potty }) => {
  const { t } = useLocalization();

  // A monthly report full of potty zeros for a pre-EC month is noise — hide entirely.
  if (potty.totalCatches === 0) return null;

  const sharePercent = potty.poopCatchShare !== null ? Math.round(potty.poopCatchShare * 100) : null;

  return (
    <>
      <p className={cn(s.sectionHeading, 'report-card-section-heading')}>{t('Potty')}</p>

      <div className={cn(s.metricGrid3)}>
        <div className={cn(s.metricCard, 'report-card-metric')}>
          <p className={cn(s.metricLabel, 'report-card-metric-label')}>{t('Total catches')}</p>
          <p className={cn(s.metricValue, 'report-card-metric-value')}>{potty.totalCatches}</p>
        </div>
        <div className={cn(s.metricCard, 'report-card-metric')}>
          <p className={cn(s.metricLabel, 'report-card-metric-label')}>{t('Catches/day')}</p>
          <p className={cn(s.metricValue, 'report-card-metric-value')}>{potty.avgCatchesPerDay}</p>
        </div>
        {sharePercent !== null && (
          <div className={cn(s.metricCard, 'report-card-metric')}>
            <p className={cn(s.metricLabel, 'report-card-metric-label')}>{t('Poop catch rate')}</p>
            <p className={cn(s.metricValue, 'text-fuchsia-600', 'report-card-metric-value-potty')}>{sharePercent}%</p>
            <p className={cn(s.metricSub, s.metricSubNeutral, 'report-card-metric-sub-neutral')}>{t('of poops caught')}</p>
          </div>
        )}
      </div>

      {potty.locationDistribution.length > 0 && (
        <div className={cn(s.card, 'report-card-card')}>
          <p className={cn(s.cardTitle, 'report-card-card-title')}>{t('Potty locations')}</p>
          <table className={s.healthTable}>
            <tbody>
              {potty.locationDistribution.map((loc, i) => (
                <tr
                  key={loc.location}
                  className={cn(i < potty.locationDistribution.length - 1 ? s.healthRow : s.healthRowLast, 'report-card-health-row')}
                >
                  <td className={cn(s.healthCellName, 'report-card-health-cell-name')}>{t(loc.location)}</td>
                  <td className={cn(s.healthCellValue, 'report-card-health-cell-value')}>{loc.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default PottySection;
