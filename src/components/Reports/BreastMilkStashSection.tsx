'use client';

import React, { useState, useEffect } from 'react';
import { Milk } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Card, CardContent } from '@/src/components/ui/card';
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/src/components/ui/accordion';
import { styles } from './reports.styles';
import { ActivityType, DateRange } from './reports.types';
import { useLocalization } from '@/src/context/localization';
import { useBaby } from '@/app/context/baby';
import { useUnit } from '@/src/hooks/useUnit';
import {
  averageBreastMilkPerDay,
  projectDaysOfSupply,
  sumBagsForDay,
  BreastMilkBagRow,
} from '@/src/utils/breastMilkBags';
import { BreastMilkFeedInventoryRow } from '@/src/utils/breastMilkInventory';

interface BreastMilkStashSectionProps {
  activities: ActivityType[];
  dateRange: DateRange;
  unit: string;
  enableBreastMilkTracking?: boolean;
}

/**
 * Days covered by the selected range. Duplicated from StatsTab's identical
 * one-liner rather than plumbed through: StatsTab's copy lives inside a useMemo
 * typed as CombinedStats, and widening that shared type to export one number
 * would touch every stats section for no benefit.
 */
function daysBetween(dateRange: DateRange): number {
  if (!dateRange.from || !dateRange.to) return 0;
  const startDate = new Date(dateRange.from);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(dateRange.to);
  endDate.setHours(23, 59, 59, 999);
  return Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
}

interface StashStatCardProps {
  value: React.ReactNode;
  label: string;
  subLabel?: React.ReactNode;
  valueClassName?: string;
}

/** A single stat card, styled like the rest of Reports. */
const StashStatCard: React.FC<StashStatCardProps> = ({ value, label, subLabel, valueClassName }) => (
  <Card className={cn(styles.statCard, 'reports-stat-card')}>
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
 * BreastMilkStashSection Component
 *
 * Two cards: current freezer contents with a days-of-supply projection, and the
 * average daily breast milk consumption that projection divides by.
 *
 * The freezer card is deliberately NOT scoped to the report date range — the
 * freezer is current state, not a windowed aggregate. The date range only affects
 * the consumption rate in the subline.
 */
const BreastMilkStashSection: React.FC<BreastMilkStashSectionProps> = ({
  activities,
  dateRange,
  unit,
  enableBreastMilkTracking = true,
}) => {
  const { t } = useLocalization();
  const { unitSymbol } = useUnit();
  const { selectedBaby } = useBaby();
  const [balance, setBalance] = useState<{ bags: number; amount: number } | null>(null);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!selectedBaby || enableBreastMilkTracking === false) {
        setBalance(null);
        return;
      }
      try {
        const authToken = localStorage.getItem('authToken');
        const response = await fetch(
          `/api/breast-milk-bag-balance?babyId=${selectedBaby.id}&unit=${unit}`,
          {
            cache: 'no-store',
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
          }
        );
        if (!response.ok) return;
        const data = await response.json();
        if (data.success && data.data) {
          setBalance({ bags: data.data.bags, amount: data.data.amount });
        }
      } catch (error) {
        console.error('Error fetching breast milk bag balance:', error);
      }
    };
    fetchBalance();
  }, [selectedBaby, unit, enableBreastMilkTracking, activities]);

  if (enableBreastMilkTracking === false) return null;

  const daysInRange = daysBetween(dateRange);

  // Bottle feeds only. `bottleType` is present on FeedActivity and on nothing else.
  const feedRows = activities.filter((activity) => 'bottleType' in activity) as BreastMilkFeedInventoryRow[];
  const avgPerDay = averageBreastMilkPerDay(feedRows, daysInRange, unit);

  const bagRows = activities.filter((activity) => 'bagCount' in activity) as BreastMilkBagRow[];
  const rangeBags = sumBagsForDay(bagRows, unit);
  const avgFrozenPerDay = daysInRange > 0
    ? Math.round((rangeBags.frozenAmount / daysInRange) * 100) / 100
    : 0;

  const daysOfSupply = balance ? projectDaysOfSupply(balance.amount, avgPerDay) : null;
  const symbol = unitSymbol(unit);

  return (
    <AccordionItem value="milkbag">
      <AccordionTrigger className={cn(styles.accordionTrigger, 'reports-accordion-trigger')}>
        <Milk className={cn(styles.accordionTriggerIcon, 'reports-accordion-trigger-icon text-cyan-600')} />
        <span>{t('Frozen Milk')}</span>
      </AccordionTrigger>
      <AccordionContent className={styles.accordionContent}>
        {balance === null ? (
          <div className={cn(styles.emptyContainer, 'reports-empty-container')}>
            <p className={cn(styles.emptyText, 'reports-empty-text')}>
              {t('No frozen milk logged yet')}
            </p>
          </div>
        ) : (
          <div className={styles.statsGrid}>
            <StashStatCard
              value={`${balance.bags} ${balance.bags === 1 ? t('bag') : t('bags')}`}
              label={t('In the Freezer')}
              subLabel={
                daysOfSupply === null
                  ? `${balance.amount} ${symbol}`
                  : `${balance.amount} ${symbol} · ~${daysOfSupply} ${t('days of supply')}`
              }
            />
            <StashStatCard
              value={avgPerDay === 0 ? '—' : `${avgPerDay} ${symbol}`}
              label={t('Breast Milk / Day')}
              subLabel={`${t('avg consumed')} · ${avgFrozenPerDay} ${symbol} ${t('frozen')}`}
            />
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
};

export default BreastMilkStashSection;
