'use client';

import React, { useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { useLocalization } from '@/src/context/localization';
import { FLIP_WIZARDS, WizardId } from './wizards';
import { FlipConfig } from './protocol';
import { rescueTiming, fmtClock } from './engine';
import { flipStyles as s } from './day-night-flip.styles';

interface WizardPanelProps {
  wizardId: WizardId;
  config: FlipConfig;
  now: Date;
  onClose: () => void;
}

type Pos = { wizard: WizardId; node: string };

export default function WizardPanel({ wizardId, config, now, onClose }: WizardPanelProps) {
  const { t } = useLocalization();
  const [stack, setStack] = useState<Pos[]>([
    { wizard: wizardId, node: FLIP_WIZARDS[wizardId].entry },
  ]);

  const pos = stack[stack.length - 1];
  const wizard = FLIP_WIZARDS[pos.wizard];
  const node = wizard.nodes[pos.node];

  const go = (to: string) => {
    if (to.startsWith('@')) {
      const w = to.slice(1) as WizardId;
      setStack(st => [...st, { wizard: w, node: FLIP_WIZARDS[w].entry }]);
    } else {
      setStack(st => [...st, { wizard: pos.wizard, node: to }]);
    }
  };
  const back = () => setStack(st => (st.length > 1 ? st.slice(0, -1) : st));

  const timing = node.kind === 'outcome' && node.dynamic === 'rescue-timing'
    ? rescueTiming(config, now)
    : null;

  return (
    <div className={s.wizard.panel}>
      <div className={s.wizard.header}>
        <span className={s.wizard.title}>{t(wizard.title)}</span>
        <div className="flex gap-2">
          {stack.length > 1 && (
            <Button size="sm" variant="ghost" onClick={back}>{t('Back')}</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>{t('Close')}</Button>
        </div>
      </div>

      {node.kind === 'question' ? (
        <div>
          <p className={s.wizard.prompt}>{t(node.prompt)}</p>
          {node.help && <p className={s.wizard.help}>{t(node.help)}</p>}
          <div className={s.wizard.options}>
            {node.options.map(o => (
              <button key={o.label} type="button" className={s.wizard.option} onClick={() => go(o.to)}>
                {t(o.label)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <p className={s.wizard.outcomeTitle}>{t(node.title)}</p>
          <ul className={s.wizard.actions}>
            {node.actions.map(a => <li key={a}>{t(a)}</li>)}
          </ul>
          {timing?.isFinalNap && timing.wakeBy && timing.routineStart && (
            <p className={s.wizard.timing}>
              {t('This late, the rescue nap becomes the day’s final nap.')}{' '}
              {t('Wake her by')} <strong>{fmtClock(timing.wakeBy)}</strong>{' '}
              ({config.durations.rescueNapMaxMin}m {t('max')}), {t('then start the bedtime routine around')}{' '}
              <strong>{fmtClock(timing.routineStart)}</strong>. {t('One-night adjustment — the normal anchor resumes tomorrow.')}
            </p>
          )}
          <p className={s.wizard.why}><strong>{t('Why')}:</strong> {t(node.why)}</p>
          <div className={s.wizard.ruleRow}>
            {node.ruleIds.map(id => <span key={id} className={s.wizard.ruleChip}>{id}</span>)}
          </div>
          {(node.links ?? []).map(l => (
            <Button key={l.label} size="sm" variant="outline" className="mt-2 mr-2" onClick={() => go(l.to)}>
              {t(l.label)}
            </Button>
          ))}
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={onClose}>{t('Done')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
