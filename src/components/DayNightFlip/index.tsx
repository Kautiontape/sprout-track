'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/src/lib/utils';
import { useBaby } from '@/app/context/baby';
import { useLocalization } from '@/src/context/localization';
import { mergeFlipConfig } from './protocol';
import { resolveNow } from './engine';
import { WizardId } from './wizards';
import { useFlipData } from './useFlipData';
import NowBanner from './NowBanner';
import FlipTimers from './FlipTimers';
import ModeRules from './ModeRules';
import EscalationBanner from './EscalationBanner';
import WizardPanel from './WizardPanel';
import FlipSchedule from './FlipSchedule';
import FlipFaq from './FlipFaq';
import { flipStyles as s } from './day-night-flip.styles';
import './day-night-flip.css';

export default function DayNightFlip() {
  const { t } = useLocalization();
  const { selectedBaby } = useBaby();
  const { facts, todayLogs, loading, error, override, setOverride, clearOverride, alsoLogIt } = useFlipData();
  const [now, setNow] = useState<Date>(() => new Date());
  const [view, setView] = useState<'now' | 'schedule' | 'why'>('now');
  const [activeWizard, setActiveWizard] = useState<WizardId | null>(null);

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
    return <div className={s.page}>{t('Select a baby to use Rhythm')}</div>;
  }

  const config = mergeFlipConfig(
    (selectedBaby as { dayNightFlipConfig?: string | null }).dayNightFlipConfig,
  );

  if (!config.enabled) {
    return (
      <div className={s.page}>
        <div className={s.sectionTitle}>{t('Rhythm isn’t set up for this baby yet')}</div>
        <p className="text-sm text-gray-500">
          {t('Turn it on under Settings → Config → Manage Babies → Edit → Rhythm.')}
        </p>
      </div>
    );
  }

  if (loading && !facts) return <div className={s.page}>{t('Loading...')}</div>;
  if (error) return <div className={s.page}>{error}</div>;
  if (!facts) return <div className={s.page}>{t('No activity data yet')}</div>;

  const state = resolveNow(config, facts, now);

  const handleOverride = (kind: 'wake' | 'down', time: Date, alsoLog: boolean) => {
    setNow(new Date()); // don't wait for the next tick to reflect the override
    setOverride(kind, time);
    if (alsoLog) void alsoLogIt(kind, time);
  };

  return (
    <div className={s.page}>
      {state.phase === 'pre' && (
        <div className={s.nudge}>{t('This protocol is meant for babies about 2 weeks and older.')}</div>
      )}
      {state.phase === 'sunset' && (
        <div className={s.nudge}>
          {t('Past about 10 weeks the protocol winds down. The day/night contrast rules can relax, white noise can come back for naps, and the schedule can grow up with her.')}
        </div>
      )}

      <div className={s.toggle.row} role="tablist">
        {([['now', t('Now')], ['schedule', t('Schedule')], ['why', t('Why')]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={cn(s.toggle.btn, view === id && cn(s.toggle.btnActive, 'active-dark'))}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'schedule' && (
        <FlipSchedule config={config} facts={facts} todayLogs={todayLogs} now={now} />
      )}
      {view === 'why' && <FlipFaq />}
      {view === 'now' && (
        <>
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
                  {n.id === 'R-16' && (
                    <button
                      type="button"
                      className="underline ml-1 font-medium"
                      onClick={() => setActiveWizard('rescue')}
                    >
                      {t('Open the rescue guide')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {activeWizard ? (
            <WizardPanel
              wizardId={activeWizard}
              config={config}
              now={now}
              onClose={() => setActiveWizard(null)}
            />
          ) : (
            <div className={s.section}>
              <div className={s.sectionTitle}>{t('When it goes sideways')}</div>
              <div className={s.wizard.entryGrid}>
                <button type="button" className={s.wizard.entryBtn} onClick={() => setActiveWizard('rescue')}>
                  {t('Putdown isn’t working')}
                </button>
                <button type="button" className={s.wizard.entryBtn} onClick={() => setActiveWizard('pacifier')}>
                  {t('Pacifier keeps failing')}
                </button>
                <button type="button" className={s.wizard.entryBtn} onClick={() => setActiveWizard('gas')}>
                  {t('Gas check')}
                </button>
                <button type="button" className={s.wizard.entryBtn} onClick={() => setActiveWizard('bottle')}>
                  {t('Finished the bottle, still hungry?')}
                </button>
              </div>
            </div>
          )}
          <FlipTimers state={state} config={config} />
          <ModeRules mode={state.mode} />
          <EscalationBanner state={state} />
        </>
      )}
    </div>
  );
}
