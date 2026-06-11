'use client';

import React, { useState } from 'react';
import { cn } from '@/src/lib/utils';
import { useLocalization } from '@/src/context/localization';
import { FLIP_RULES } from './protocol';
import { flipStyles as s } from './day-night-flip.styles';

export default function ModeRules({ mode }: { mode: 'day' | 'night' }) {
  const { t } = useLocalization();
  const [openId, setOpenId] = useState<string | null>(null);
  const rules = FLIP_RULES.filter(r => r.mode === mode);
  const open = rules.find(r => r.id === openId);

  return (
    <div className={s.section}>
      <div className={s.sectionTitle}>
        {mode === 'day' ? t('Day mode rules') : t('Night mode rules')}
      </div>
      <div className={s.rules.wrap}>
        {rules.map(r => (
          <button
            key={r.id}
            type="button"
            className={cn(s.rules.chip, openId === r.id && s.rules.chipOpen)}
            onClick={() => setOpenId(openId === r.id ? null : r.id)}
          >
            <span className="font-mono opacity-60">{r.id}</span>
            {t(r.text)}
            <span className="opacity-50">{openId === r.id ? '×' : '?'}</span>
          </button>
        ))}
      </div>
      {open && (
        <div className={s.rules.why}>
          <strong>{t('Why')}:</strong> {t(open.why)}
        </div>
      )}
    </div>
  );
}
