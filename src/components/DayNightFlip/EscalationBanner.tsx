'use client';

import React from 'react';
import { useLocalization } from '@/src/context/localization';
import { FlipState } from './engine';
import { flipStyles as s } from './day-night-flip.styles';

export default function EscalationBanner({ state }: { state: FlipState }) {
  const { t } = useLocalization();
  return (
    <div className={s.section}>
      {state.escalations.length > 0 && (
        <div className={s.escalation.banner} role="alert">
          {state.escalations.map(e => (
            <div key={e.id}>⚠ {e.text}</div>
          ))}
        </div>
      )}
      <details className={s.escalation.reference}>
        <summary className="cursor-pointer">{t('Call your pediatrician if…')}</summary>
        <ul className="list-disc ml-5 mt-1 space-y-0.5">
          <li>{t('Fewer than 6 wet diapers or potty catches a day, or no weight gain')}</li>
          <li>{t('Lethargy, or persistent frantic feeding')}</li>
          <li>{t('Feeding becomes a struggle (same-day call)')}</li>
          <li>{t('Constant gas battle with arching and hard mid-feed crying across days')}</li>
          <li>{t('Feelings of regret or hopelessness as a baseline, not just a 3am low — postpartum mood affects both parents')}</li>
        </ul>
      </details>
      <div className={s.escalation.disclaimer}>
        {t('Not medical advice. The app advises on schedules; growth curves and diagnoses belong to your pediatrician.')}
      </div>
    </div>
  );
}
