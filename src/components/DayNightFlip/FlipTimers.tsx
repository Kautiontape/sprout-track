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
  const napClass =
    nap === null ? '' :
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
          <div className={s.timers.label}>{t('Nap so far')}</div>
          <div className={cn(s.timers.value, napClass)}>{fmtMin(nap)}</div>
          <div className={s.timers.sub}>{t('cap')} {config.dayMode.napCapHr}h</div>
        </div>
        <div className={s.timers.card}>
          <div className={s.timers.label}>{t('Since last feed')}</div>
          <div className={s.timers.value}>{fmtMin(timers.sinceLastFeedMin)}</div>
          <div className={s.timers.sub}>
            {feedEst
              ? `${t('next')} ${feedEst.to ? '~' : ''}${fmtClock(feedEst.from)}${feedEst.to ? `–${fmtClock(feedEst.to)}` : ''}`
              : t('no feeds logged')}
          </div>
        </div>
      </div>
      {intake && config.feedingMethod !== 'nursing' && (
        <div className={s.timers.sub}>
          {t('Daily intake estimate')}: {intake.dailyTargetOz[0]}–{intake.dailyTargetOz[1]} oz
          {' · '}
          {t('projected weight')} {ozToLb(intake.projectedWeightOz[0])}–{ozToLb(intake.projectedWeightOz[1])} lb
          {' — '}{t('starting estimates, not ceilings')}
        </div>
      )}
      {config.feedingMethod !== 'bottle' && (
        <div className={s.timers.sub}>
          {t('Output check (nursing)')}: {t('aim for 6+ wet and 3+ dirty diapers per day')}
        </div>
      )}
    </div>
  );
}
