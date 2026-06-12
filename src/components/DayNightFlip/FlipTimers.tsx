'use client';

import React from 'react';
import { cn } from '@/src/lib/utils';
import { useLocalization } from '@/src/context/localization';
import { FlipState } from './engine';
import { FlipConfig } from './protocol';
import { flipStyles as s } from './day-night-flip.styles';

const fmtMin = (min: number | null): string => {
  if (min === null) return '--';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtClock = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const ozToLb = (oz: number) => Math.round((oz / 16) * 10) / 10;

export default function FlipTimers({ state, config }: { state: FlipState; config: FlipConfig }) {
  const { t } = useLocalization();
  const { timers, intake } = state;

  const ww = timers.wakeWindowElapsedMin;
  const [targetLo, targetHi] = config.dayMode.wakeWindowTargetMin;
  const wwClass =
    ww === null ? '' :
    ww > config.dayMode.wakeWindowCeilingMin ? s.timers.over :
    ww >= targetLo ? s.timers.warn : s.timers.ok;

  const nap = timers.napElapsedMin;
  const napCap = config.dayMode.napCapHr * 60;
  // The nap cap is a DAY rule (D-3). At night a long stretch is the goal —
  // never color it as over-cap.
  const nightSleeping = state.currentBlock === 'night-sleep';
  const napClass =
    nap === null ? '' :
    nightSleeping ? s.timers.ok :
    nap >= napCap ? s.timers.over :
    nap >= napCap - 15 ? s.timers.warn : s.timers.ok;

  const feedEst = timers.nextFeedEstimate;

  return (
    <div className={s.section}>
      <div className={s.timers.grid}>
        <div className={s.timers.card}>
          <div className={s.timers.label}>{t('Wake window')}</div>
          <div className={cn(s.timers.value, wwClass)}>{fmtMin(ww)}</div>
          <div className={s.timers.sub}>
            {t('target')} {targetLo}–{targetHi}m · {t('ceiling')} {config.dayMode.wakeWindowCeilingMin}m
          </div>
        </div>
        <div className={s.timers.card}>
          <div className={s.timers.label}>{nightSleeping ? t('Night sleep') : t('Nap so far')}</div>
          <div className={cn(s.timers.value, napClass)}>{fmtMin(nap)}</div>
          {!nightSleeping && (
            <div className={s.timers.sub}>{t('cap')} {config.dayMode.napCapHr}h</div>
          )}
        </div>
        <div className={s.timers.card}>
          <div className={s.timers.label}>{t('Since last feed')}</div>
          <div className={s.timers.value}>{fmtMin(timers.sinceLastFeedMin)}</div>
          <div className={s.timers.sub}>
            {feedEst
              ? feedEst.to
                ? `${t('next around')} ${fmtClock(feedEst.from)}–${fmtClock(feedEst.to)}`
                : `${t('feed by')} ${fmtClock(feedEst.from)}`
              : t('no feeds logged')}
          </div>
        </div>
      </div>
      {intake && config.feedingMethod !== 'nursing' && (
        <div className={s.timers.sub}>
          {t('Rough daily intake')}: {intake.dailyTargetOz[0]}–{intake.dailyTargetOz[1]} oz, {t('based on a projected weight of')}{' '}
          {ozToLb(intake.projectedWeightOz[0])}–{ozToLb(intake.projectedWeightOz[1])} lb. {t('A starting point, not a limit.')}
        </div>
      )}
      {config.feedingMethod !== 'bottle' && (
        <div className={s.timers.sub}>
          {t('Nursing check: aim for at least 6 wet and 3 dirty diapers a day.')}
        </div>
      )}
    </div>
  );
}
