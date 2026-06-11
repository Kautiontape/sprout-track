'use client';

import React from 'react';
import { Input } from '@/src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/src/components/ui/select';
import { useLocalization } from '@/src/context/localization';
import { FlipConfig } from '@/src/components/DayNightFlip/protocol';

interface DayNightFlipTabProps {
  config: FlipConfig;
  onChange: (config: FlipConfig) => void;
  birthDate?: Date;
}

const TIME_RE = /^\d{1,2}:\d{2}$/;

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      type="text"
      pattern="[0-9]{1,2}:[0-9]{2}"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-24 font-mono"
      placeholder="HH:MM"
    />
  );
}

function NumberInput({ value, onChange, step = 0.5 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <Input
      type="number"
      step={step}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-24"
    />
  );
}

function RangeInput({ value, onChange, step = 1 }: { value: [number, number]; onChange: (v: [number, number]) => void; step?: number }) {
  return (
    <div className="flex items-center gap-2">
      <NumberInput value={value[0]} onChange={v => onChange([v, value[1]])} step={step} />
      <span className="text-gray-400">–</span>
      <NumberInput value={value[1]} onChange={v => onChange([value[0], v])} step={step} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <label className="form-label mb-0">{label}</label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="rounded-lg border border-gray-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-gray-600">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export default function DayNightFlipTab({ config, onChange, birthDate }: DayNightFlipTabProps) {
  const { t } = useLocalization();
  const set = (patch: Partial<FlipConfig>) => onChange({ ...config, ...patch });

  const ageWeeks = birthDate
    ? Math.floor((Date.now() - birthDate.getTime()) / (7 * 86400000))
    : null;
  const ageBadge =
    ageWeeks === null ? '' :
    ageWeeks < 2 ? t('protocol starts ~2 weeks') :
    ageWeeks > 10 ? t('past the ~10 week sunset') : t('in the active window (2–10 weeks)');

  return (
    <div className="space-y-3">
      <Row label={t('Enable Day/Night Flip')}>
        <input
          type="checkbox"
          className="form-checkbox h-4 w-4 text-teal-600 rounded border-gray-300"
          checked={config.enabled}
          onChange={e => set({ enabled: e.target.checked })}
        />
      </Row>
      {ageWeeks !== null && (
        <p className="text-xs text-gray-500">
          {t('Age')}: {ageWeeks} {t('weeks')} — {ageBadge}
        </p>
      )}

      <Row label={t('Feeding method')}>
        <Select
          value={config.feedingMethod}
          onValueChange={v => set({ feedingMethod: v as FlipConfig['feedingMethod'] })}
        >
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="bottle">{t('Bottle')}</SelectItem>
            <SelectItem value="nursing">{t('Nursing')}</SelectItem>
            <SelectItem value="combo">{t('Combo')}</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Section title={t('Anchors')}>
        <Row label={t('Day start (lights on)')}>
          <TimeInput value={config.anchors.dayStart} onChange={v => set({ anchors: { ...config.anchors, dayStart: v } })} />
        </Row>
        <Row label={t('Bedtime routine')}>
          <TimeInput value={config.anchors.bedtimeRoutine} onChange={v => set({ anchors: { ...config.anchors, bedtimeRoutine: v } })} />
        </Row>
        <Row label={t('Night start')}>
          <TimeInput value={config.anchors.nightStart} onChange={v => set({ anchors: { ...config.anchors, nightStart: v } })} />
        </Row>
      </Section>

      <Section title={t('Day mode')}>
        <Row label={t('Max feed interval (hours)')}>
          <NumberInput value={config.dayMode.feedIntervalMaxHr} onChange={v => set({ dayMode: { ...config.dayMode, feedIntervalMaxHr: v } })} />
        </Row>
        <Row label={t('Nap cap (hours)')}>
          <NumberInput value={config.dayMode.napCapHr} onChange={v => set({ dayMode: { ...config.dayMode, napCapHr: v } })} />
        </Row>
        <Row label={t('Wake window target (minutes)')}>
          <RangeInput value={config.dayMode.wakeWindowTargetMin} onChange={v => set({ dayMode: { ...config.dayMode, wakeWindowTargetMin: v } })} />
        </Row>
        <Row label={t('Wake window ceiling (minutes)')}>
          <NumberInput value={config.dayMode.wakeWindowCeilingMin} step={5} onChange={v => set({ dayMode: { ...config.dayMode, wakeWindowCeilingMin: v } })} />
        </Row>
        <Row label={t('Catnap slot')}>
          <div className="flex items-center gap-2">
            <TimeInput value={config.dayMode.catnapSlot[0]} onChange={v => set({ dayMode: { ...config.dayMode, catnapSlot: [v, config.dayMode.catnapSlot[1]] } })} />
            <span className="text-gray-400">–</span>
            <TimeInput value={config.dayMode.catnapSlot[1]} onChange={v => set({ dayMode: { ...config.dayMode, catnapSlot: [config.dayMode.catnapSlot[0], v] } })} />
          </div>
        </Row>
        <Row label={t('Last wake by')}>
          <TimeInput value={config.dayMode.lastWakeBy} onChange={v => set({ dayMode: { ...config.dayMode, lastWakeBy: v } })} />
        </Row>
      </Section>

      <Section title={t('Night mode')}>
        <Row label={t('Expected feed interval (hours)')}>
          <RangeInput value={config.nightMode.feedExpectedIntervalHr} step={0.5} onChange={v => set({ nightMode: { ...config.nightMode, feedExpectedIntervalHr: v } })} />
        </Row>
        <Row label={t('Scheduled feeds (estimates)')}>
          <Input
            type="text"
            defaultValue={config.nightMode.scheduledFeeds.join(', ')}
            onBlur={e => set({ nightMode: { ...config.nightMode, scheduledFeeds: e.target.value.split(',').map(v => v.trim()).filter(v => TIME_RE.test(v)) } })}
            className="w-44 font-mono"
            placeholder="23:00, 02:00, 05:00"
          />
        </Row>
      </Section>

      <Section title={t('Feeding estimates')}>
        <Row label={t('Daily oz per lb')}>
          <RangeInput value={config.feeding.dailyOzPerLb} step={0.1} onChange={v => set({ feeding: { ...config.feeding, dailyOzPerLb: v } })} />
        </Row>
        <Row label={t('Expected growth (oz/day)')}>
          <RangeInput value={config.feeding.growthOzPerDay} step={0.1} onChange={v => set({ feeding: { ...config.feeding, growthOzPerDay: v } })} />
        </Row>
      </Section>

      <Section title={t('Durations')}>
        <Row label={t('Fuss wait (minutes)')}>
          <RangeInput value={config.durations.fussWaitMin} onChange={v => set({ durations: { ...config.durations, fussWaitMin: v } })} />
        </Row>
        <Row label={t('Abandon putdown after (minutes)')}>
          <NumberInput value={config.durations.putdownAbandonMin} step={5} onChange={v => set({ durations: { ...config.durations, putdownAbandonMin: v } })} />
        </Row>
        <Row label={t('Rescue nap max (minutes)')}>
          <NumberInput value={config.durations.rescueNapMaxMin} step={5} onChange={v => set({ durations: { ...config.durations, rescueNapMaxMin: v } })} />
        </Row>
      </Section>
    </div>
  );
}
