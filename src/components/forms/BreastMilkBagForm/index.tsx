'use client';

import React, { useState, useEffect } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Textarea } from '@/src/components/ui/textarea';
import { DateTimePicker } from '@/src/components/ui/date-time-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/src/components/ui/select';
import { FormPage, FormPageContent, FormPageFooter } from '@/src/components/ui/form-page';
import { useTimezone } from '@/app/context/timezone';
import { useToast } from '@/src/components/ui/toast';
import { handleExpirationError } from '@/src/lib/expiration-error-handler';
import { useLocalization } from '@/src/context/localization';
import { useUnit } from '@/src/hooks/useUnit';
import { BreastMilkBagFormProps, BAG_REMOVAL_REASONS } from './breast-milk-bag-form.types';

import './breast-milk-bag-form.css';

const DEFAULT_AMOUNT_PER_BAG = 4;

export default function BreastMilkBagForm({
  isOpen,
  onClose,
  babyId,
  initialTime,
  activity,
  onSuccess,
}: BreastMilkBagFormProps) {
  const { t } = useLocalization();
  const { toUTCString } = useTimezone();
  const { showToast } = useToast();
  const { unitSymbol } = useUnit();

  const [selectedDateTime, setSelectedDateTime] = useState<Date>(() => {
    const date = new Date(initialTime);
    return isNaN(date.getTime()) ? new Date() : date;
  });
  const [isRemoval, setIsRemoval] = useState(false);
  const [bagCount, setBagCount] = useState(1);
  const [amountPerBag, setAmountPerBag] = useState(String(DEFAULT_AMOUNT_PER_BAG));
  const [unitAbbr, setUnitAbbr] = useState('OZ');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Prefill the per-bag amount from the last freeze, so the common case is one tap.
  // Only for new entries — editing must show what was actually recorded.
  useEffect(() => {
    if (!isOpen || activity || !babyId) return;
    const load = async () => {
      try {
        const authToken = localStorage.getItem('authToken');
        const response = await fetch(`/api/breast-milk-bag-balance?babyId=${babyId}`, {
          cache: 'no-store',
          headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data.success && data.data?.lastAmountPerBag != null) {
          setAmountPerBag(String(data.data.lastAmountPerBag));
        }
      } catch {
        // Non-fatal: fall back to the default amount.
      }
    };
    load();
  }, [isOpen, activity, babyId]);

  useEffect(() => {
    if (isOpen && !isInitialized) {
      if (activity) {
        const activityDate = new Date(activity.time);
        if (!isNaN(activityDate.getTime())) setSelectedDateTime(activityDate);
        setIsRemoval(activity.bagCount < 0);
        setBagCount(Math.abs(activity.bagCount));
        setAmountPerBag(String(activity.amountPerBag));
        setUnitAbbr(activity.unitAbbr || 'OZ');
        setReason(activity.reason || '');
        setNotes(activity.notes || '');
      } else {
        const date = new Date(initialTime);
        if (!isNaN(date.getTime())) setSelectedDateTime(date);
        setIsRemoval(false);
        setBagCount(1);
        setReason('');
        setNotes('');
      }
      setIsInitialized(true);
    } else if (!isOpen) {
      setIsInitialized(false);
    }
  }, [isOpen, activity, initialTime, isInitialized]);

  const parsedAmountPerBag = parseFloat(amountPerBag);
  const amountIsValid = !isNaN(parsedAmountPerBag) && parsedAmountPerBag > 0;
  const derivedTotal = amountIsValid
    ? Math.round(bagCount * parsedAmountPerBag * 100) / 100
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!babyId || bagCount < 1 || !amountIsValid) return;
    if (!selectedDateTime || isNaN(selectedDateTime.getTime())) return;

    setLoading(true);
    try {
      const payload = {
        babyId,
        time: toUTCString(selectedDateTime),
        bagCount: isRemoval ? -bagCount : bagCount,
        amountPerBag: parsedAmountPerBag,
        unitAbbr,
        reason: reason || null,
        notes: notes || null,
      };

      const authToken = localStorage.getItem('authToken');
      const response = await fetch(`/api/breast-milk-bag-log${activity ? `?id=${activity.id}` : ''}`, {
        method: activity ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken ? `Bearer ${authToken}` : '',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (response.status === 403) {
          const { isExpirationError } = await handleExpirationError(
            response,
            showToast,
            'tracking frozen milk'
          );
          if (isExpirationError) return;
        }
        throw new Error(t('Failed to save frozen milk log'));
      }

      onClose();
      onSuccess?.();
    } catch (error) {
      console.error('Error saving breast milk bag log:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormPage
      isOpen={isOpen}
      onClose={onClose}
      title={activity ? t('Edit Frozen Milk') : t('Log Frozen Milk')}
      description={activity ? t('Update this freezer entry') : t('Add or remove bags from the freezer')}
    >
      <FormPageContent>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="form-label">{t('Time')}</label>
              <DateTimePicker
                value={selectedDateTime}
                onChange={setSelectedDateTime}
                disabled={loading}
                placeholder={t('Select time...')}
              />
            </div>

            <div>
              <label className="form-label">{t('Direction')}</label>
              <div className="milkbag-direction-toggle flex rounded-md border border-gray-300 overflow-hidden">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => { setIsRemoval(false); setReason(''); }}
                  className={cn(
                    'milkbag-direction-option flex-1 py-2 text-sm font-medium transition-colors',
                    !isRemoval
                      ? 'milkbag-direction-option-active bg-cyan-600 text-white'
                      : 'text-gray-600'
                  )}
                >
                  {t('Froze')}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => { setIsRemoval(true); setReason(''); }}
                  className={cn(
                    'milkbag-direction-option flex-1 py-2 text-sm font-medium transition-colors',
                    isRemoval
                      ? 'milkbag-direction-option-active bg-cyan-600 text-white'
                      : 'text-gray-600'
                  )}
                >
                  {t('Used')}
                </button>
              </div>
            </div>

            <div>
              <label className="form-label">{t('Bags')}</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={loading || bagCount <= 1}
                  onClick={() => setBagCount((count) => Math.max(1, count - 1))}
                  aria-label={t('Decrease bag count')}
                  className="milkbag-stepper-button flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 bg-gray-50 text-gray-700 disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="milkbag-stepper-value w-10 text-center text-xl font-semibold text-gray-900">
                  {bagCount}
                </span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setBagCount((count) => count + 1)}
                  aria-label={t('Increase bag count')}
                  className="milkbag-stepper-button flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 bg-gray-50 text-gray-700"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div>
              <label className="form-label" htmlFor="milkbag-amount-per-bag">
                {t('Amount Per Bag')}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="milkbag-amount-per-bag"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={amountPerBag}
                  onChange={(e) => setAmountPerBag(e.target.value)}
                  disabled={loading}
                  className="w-32"
                />
                <span className="text-sm text-gray-600">{unitSymbol(unitAbbr)}</span>
              </div>
            </div>

            <div
              className="milkbag-derived-total rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              aria-live="polite"
            >
              {derivedTotal === null
                ? t('Enter an amount per bag')
                : `${bagCount} ${bagCount === 1 ? t('bag') : t('bags')} × ${parsedAmountPerBag} ${unitSymbol(unitAbbr)} = ${derivedTotal} ${unitSymbol(unitAbbr)}`}
            </div>

            {isRemoval && (
              <div>
                <label className="form-label">{t('Reason')}</label>
                <Select value={reason} onValueChange={setReason} disabled={loading}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('Select reason')} />
                  </SelectTrigger>
                  <SelectContent>
                    {BAG_REMOVAL_REASONS.map((option) => (
                      <SelectItem key={option} value={option}>{t(option)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="form-label">{t('Notes')}</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={loading}
                placeholder={t('Optional notes')}
              />
            </div>
          </div>
        </form>
      </FormPageContent>
      <FormPageFooter>
        <div className="flex justify-end space-x-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !amountIsValid}>
            {activity ? t('Update') : t('Save')}
          </Button>
        </div>
      </FormPageFooter>
    </FormPage>
  );
}
