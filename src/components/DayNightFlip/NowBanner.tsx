'use client';

import React, { useState } from 'react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useLocalization } from '@/src/context/localization';
import { FlipState } from './engine';
import { FlipOverride } from './facts';
import { flipStyles as s } from './day-night-flip.styles';

interface NowBannerProps {
  state: FlipState;
  override: FlipOverride | null;
  onOverride: (kind: 'wake' | 'down', time: Date, alsoLog: boolean) => void;
  onClearOverride: () => void;
}

export default function NowBanner({ state, override, onOverride, onClearOverride }: NowBannerProps) {
  const { t } = useLocalization();
  const [editing, setEditing] = useState(false);
  const [timeValue, setTimeValue] = useState('');
  const [alsoLog, setAlsoLog] = useState(true);

  const sleeping = state.currentBlock === 'nap' || state.currentBlock === 'night-sleep';

  const submitCustomWake = () => {
    if (!/^\d{1,2}:\d{2}$/.test(timeValue)) return;
    const [h, m] = timeValue.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1); // "22:30" said at 01:00 means yesterday
    onOverride('wake', d, alsoLog);
    setEditing(false);
  };

  return (
    <div className={cn(s.banner.base, state.mode === 'day' ? s.banner.day : s.banner.night)}>
      <div className={s.banner.eyebrow}>
        {state.mode === 'day' ? t('Day mode') : t('Night mode')} · NOW
      </div>
      <div className={s.banner.label}>{state.blockLabel}</div>
      <div className={s.banner.action}>{state.nextAction}</div>

      <div className={s.banner.overrideRow}>
        {!editing && (
          <>
            {sleeping ? (
              <Button size="sm" variant="outline" onClick={() => onOverride('wake', new Date(), alsoLog)}>
                {t('Mark awake now')}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => onOverride('down', new Date(), alsoLog)}>
                {t('Mark down now')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('Set actual wake time')}
            </Button>
            {override && (
              <Button size="sm" variant="ghost" onClick={onClearOverride}>
                {t('Clear override')}
              </Button>
            )}
          </>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="HH:MM"
              value={timeValue}
              onChange={e => setTimeValue(e.target.value)}
              className="w-24 font-mono"
            />
            <Button size="sm" onClick={submitCustomWake}>{t('Set')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('Cancel')}</Button>
          </div>
        )}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs opacity-80 cursor-pointer">
        <input type="checkbox" checked={alsoLog} onChange={e => setAlsoLog(e.target.checked)} />
        {t('Also write it to the sleep log')}
      </label>
    </div>
  );
}
