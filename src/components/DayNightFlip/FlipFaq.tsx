'use client';

import React from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/src/components/ui/accordion';
import { useLocalization } from '@/src/context/localization';
import { FLIP_FAQ } from './protocol';
import { flipStyles as s } from './day-night-flip.styles';

export default function FlipFaq() {
  const { t } = useLocalization();
  return (
    <div className={s.section}>
      <div className={s.sectionTitle}>{t('Why does this work?')}</div>
      <Accordion type="single" collapsible>
        {FLIP_FAQ.map(f => (
          <AccordionItem key={f.id} value={f.id}>
            <AccordionTrigger>
              <span className="text-sm font-medium text-left">{t(f.question)}</span>
            </AccordionTrigger>
            <AccordionContent>
              <p className="flip-faq-answer text-sm text-gray-600 leading-relaxed">{t(f.answer)}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
