'use client';

import React, { useEffect, useState } from 'react';
import { useBaby } from '@/app/context/baby';
import { useLocalization } from '@/src/context/localization';
import { mergeFlipConfig } from './protocol';
import { resolveNow } from './engine';
import { useFlipData } from './useFlipData';
import NowBanner from './NowBanner';
import FlipTimers from './FlipTimers';
import ModeRules from './ModeRules';
import EscalationBanner from './EscalationBanner';
import { flipStyles as s } from './day-night-flip.styles';
import './day-night-flip.css';

export default function DayNightFlip() {
  const { t } = useLocalization();
  const { selectedBaby } = useBaby();
  const { facts, loading, error, override, setOverride, clearOverride, alsoLogIt } = useFlipData();
  const [now, setNow] = useState<Date>(() => new Date());

  // live tick — ActiveFeedBanner pattern (interval + visibilitychange)
  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = setInterval(tick, 15000);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!selectedBaby) {
    return <div className={s.page}>{t('Select a baby to use Day/Night Flip')}</div>;
  }

  const config = mergeFlipConfig(
    (selectedBaby as { dayNightFlipConfig?: string | null }).dayNightFlipConfig,
  );

  if (!config.enabled) {
    return (
      <div className={s.page}>
        <div className={s.sectionTitle}>{t('Day/Night Flip is not enabled for this baby')}</div>
        <p className="text-sm text-gray-500">
          {t('Turn it on under Settings → Config → Manage Babies → Edit → Day/Night Flip.')}
        </p>
      </div>
    );
  }

  if (loading && !facts) return <div className={s.page}>{t('Loading...')}</div>;
  if (error) return <div className={s.page}>{error}</div>;
  if (!facts) return <div className={s.page}>{t('No activity data yet')}</div>;

  const state = resolveNow(config, facts, now);

  const handleOverride = (kind: 'wake' | 'down', time: Date, alsoLog: boolean) => {
    setOverride(kind, time);
    if (alsoLog) void alsoLogIt(kind, time);
  };

  return (
    <div className={s.page}>
      {state.phase === 'pre' && (
        <div className={s.nudge}>{t('The protocol becomes relevant around 2 weeks of age.')}</div>
      )}
      {state.phase === 'sunset' && (
        <div className={s.nudge}>
          {t('Past ~10 weeks the protocol sunsets: relax the contrast rules, white noise may return for naps, and the schedule can mature. (R-43)')}
        </div>
      )}
      <NowBanner
        state={state}
        override={override}
        onOverride={handleOverride}
        onClearOverride={clearOverride}
      />
      {state.nudges.length > 0 && (
        <div className={s.section}>
          {state.nudges.map(n => (
            <div key={n.id} className={s.nudge}>
              <span className="font-mono text-xs opacity-60">{n.id}</span> {n.text}
            </div>
          ))}
        </div>
      )}
      <FlipTimers state={state} config={config} />
      <ModeRules mode={state.mode} />
      <EscalationBanner state={state} />
    </div>
  );
}
