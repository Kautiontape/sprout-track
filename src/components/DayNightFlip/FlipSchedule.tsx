'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '@/src/lib/utils';
import { useLocalization } from '@/src/context/localization';
import { FlipConfig } from './protocol';
import { ActivityFacts, fmtClock, parseHHMM, minutesOfDay } from './engine';
import { projectDay, TodayLogs, ScheduleBlock } from './schedule';

interface FlipScheduleProps {
  config: FlipConfig;
  facts: ActivityFacts;
  todayLogs: TodayLogs;
  now: Date;
}

const NIGHT_KINDS = new Set(['night-sleep', 'night-feed', 'night-hold']);

function Row({ b, nowRef }: { b: ScheduleBlock; nowRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useLocalization();
  return (
    <div ref={b.isNow ? nowRef : undefined} className={cn('flip-sched-block', b.isNow && 'now')}>
      <div className="flip-sched-time">
        {b.kind === 'night-feed' ? '~' : ''}{fmtClock(b.start)}
      </div>
      <div>
        <div className="flip-sched-act">
          {b.source === 'actual' ? '✓ ' : ''}{t(b.label)}
          {b.isNow && <span className="flip-sched-nowtag">NOW</span>}
          {b.end && <span className="flip-sched-until"> → {fmtClock(b.end)}</span>}
        </div>
        {b.note && <div className="flip-sched-note">{t(b.note)}</div>}
      </div>
    </div>
  );
}

export default function FlipSchedule({ config, facts, todayLogs, now }: FlipScheduleProps) {
  const { t } = useLocalization();
  const nowRef = useRef<HTMLDivElement | null>(null);
  const { blocks, isTemplate } = projectDay(config, facts, todayLogs, now);

  const nightStartMin = parseHHMM(config.anchors.nightStart);
  const dayStartMin = parseHHMM(config.anchors.dayStart);
  const isNightBlock = (b: ScheduleBlock) =>
    NIGHT_KINDS.has(b.kind) ||
    minutesOfDay(b.start) >= nightStartMin || minutesOfDay(b.start) < dayStartMin;

  const dayBlocks = blocks.filter(b => !isNightBlock(b));
  const nightBlocks = blocks.filter(isNightBlock);

  const jump = () => nowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  useEffect(() => {
    const id = setTimeout(jump, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flip-sched-wrap">
      {isTemplate && (
        <div className="flip-sched-template-note">
          {t('Showing the template day — set the actual wake time on the Now tab and the schedule adapts to it.')}
        </div>
      )}
      <button type="button" className="flip-sched-nowbtn" onClick={jump}>
        <span className="dot" /> {t('Jump to now')}
      </button>

      <div className="flip-sched">
        <section className="flip-sched-day">
          <div className="flip-sched-eyebrow">{t('Day mode')}</div>
          <h3>{config.anchors.dayStart} – {config.anchors.nightStart}</h3>
          {dayBlocks.map((b, i) => <Row key={`d-${b.kind}-${i}`} b={b} nowRef={nowRef} />)}
        </section>

        <div className="flip-sched-dusk" />

        <section className="flip-sched-night">
          <div className="flip-sched-eyebrow">{t('Night mode')}</div>
          <h3>{config.anchors.nightStart} – {config.anchors.dayStart}</h3>
          {nightBlocks.map((b, i) => <Row key={`n-${b.kind}-${i}`} b={b} nowRef={nowRef} />)}
        </section>
      </div>
    </div>
  );
}
