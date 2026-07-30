'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { DiaperType } from '@prisma/client';
import { PottyLogResponse } from '@/app/api/types';
import { POTTY_LOCATIONS } from '@/src/constants/potty-locations';
import { Settings } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
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

import './potty-form.css';

interface PottyFormProps {
  isOpen: boolean;
  onClose: () => void;
  babyId: string | undefined;
  initialTime: string;
  activity?: PottyLogResponse;
  onSuccess?: () => void;
}

export default function PottyForm({
  isOpen,
  onClose,
  babyId,
  initialTime,
  activity,
  onSuccess,
}: PottyFormProps) {
  const { t } = useLocalization();
  const { toUTCString } = useTimezone();
  const { showToast } = useToast();

  const [selectedDateTime, setSelectedDateTime] = useState<Date>(() => {
    const date = new Date(initialTime);
    return isNaN(date.getTime()) ? new Date() : date;
  });
  const [type, setType] = useState<DiaperType | ''>('');
  const [pottyLocation, setPottyLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [hiddenLocations, setHiddenLocations] = useState<string[]>([]);
  const [showLocationManager, setShowLocationManager] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load hidden receptacles so families never see options they don't use.
  useEffect(() => {
    if (!isOpen) return;
    const load = async () => {
      try {
        const authToken = localStorage.getItem('authToken');
        const response = await fetch('/api/potty-location-settings', {
          headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data.success && data.data) {
          setHiddenLocations(data.data.hiddenLocations || []);
        }
      } catch {
        // Non-fatal: fall back to showing every receptacle.
      }
    };
    load();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !isInitialized) {
      if (activity) {
        const activityDate = new Date(activity.time);
        if (!isNaN(activityDate.getTime())) setSelectedDateTime(activityDate);
        setType(activity.type);
        setPottyLocation(activity.pottyLocation || '');
        setNotes(activity.notes || '');
      } else {
        const date = new Date(initialTime);
        if (!isNaN(date.getTime())) setSelectedDateTime(date);
        setType('');
        setPottyLocation('');
        setNotes('');
      }
      setIsInitialized(true);
    } else if (!isOpen) {
      setIsInitialized(false);
    }
  }, [isOpen, activity, initialTime, isInitialized]);

  // A hidden receptacle is still shown when editing a record that uses it,
  // so hiding one never makes an existing record uneditable. Same rule as SleepForm.
  const visibleLocations = POTTY_LOCATIONS.filter(loc =>
    !hiddenLocations.includes(loc) || activity?.pottyLocation === loc
  );

  const saveHiddenLocations = useCallback(async (newHidden: string[]) => {
    setHiddenLocations(newHidden);
    try {
      const authToken = localStorage.getItem('authToken');
      await fetch('/api/potty-location-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken ? `Bearer ${authToken}` : '',
        },
        body: JSON.stringify({ hiddenLocations: newHidden }),
      });
    } catch (error) {
      console.error('Error saving potty location settings:', error);
    }
  }, []);

  const toggleLocationVisibility = useCallback((location: string) => {
    const newHidden = hiddenLocations.includes(location)
      ? hiddenLocations.filter(l => l !== location)
      : [...hiddenLocations, location];
    saveHiddenLocations(newHidden);
  }, [hiddenLocations, saveHiddenLocations]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!babyId || !type) return;
    if (!selectedDateTime || isNaN(selectedDateTime.getTime())) return;

    setLoading(true);
    try {
      const payload = {
        babyId,
        time: toUTCString(selectedDateTime),
        type,
        pottyLocation: pottyLocation || null,
        notes: notes || null,
      };

      const authToken = localStorage.getItem('authToken');
      const response = await fetch(`/api/potty-log${activity ? `?id=${activity.id}` : ''}`, {
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
            'tracking potty visits'
          );
          if (isExpirationError) return;
        }
        throw new Error(t('Failed to save potty log'));
      }

      onClose();
      onSuccess?.();
    } catch (error) {
      console.error('Error saving potty log:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormPage
      isOpen={isOpen}
      onClose={onClose}
      title={activity ? t('Edit Potty') : t('Log Potty')}
      description={activity ? t('Update details about this potty visit') : t('Celebrate a potty win')}
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
                placeholder={t('Select potty time...')}
              />
            </div>

            <div>
              <label className="form-label">{t('Type')}</label>
              <Select
                value={type || ''}
                onValueChange={(value: DiaperType) => setType(value)}
                disabled={loading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('Select type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WET">{t('Pee')}</SelectItem>
                  <SelectItem value="DIRTY">{t('Poop')}</SelectItem>
                  <SelectItem value="BOTH">{t('Pee and Poop')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="form-label">{t('Where')}</label>
                <button
                  type="button"
                  onClick={() => setShowLocationManager(!showLocationManager)}
                  className="potty-settings-button p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title={t('Manage visible locations')}
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
              {showLocationManager && (
                <div className="potty-location-manager mb-2 p-3 border border-gray-300 rounded-md bg-muted/50 space-y-1">
                  <p className="text-xs text-muted-foreground mb-2">{t('Toggle locations to show or hide them')}</p>
                  {POTTY_LOCATIONS.map(location => (
                    <label key={location} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        variant="primary"
                        size="sm"
                        checked={!hiddenLocations.includes(location)}
                        onCheckedChange={() => toggleLocationVisibility(location)}
                      />
                      {t(location)}
                    </label>
                  ))}
                </div>
              )}
              <Select
                value={pottyLocation}
                onValueChange={setPottyLocation}
                disabled={loading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('Select location')} />
                </SelectTrigger>
                <SelectContent>
                  {visibleLocations.map(loc => (
                    <SelectItem key={loc} value={loc}>{t(loc)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
          <Button onClick={handleSubmit} disabled={loading}>
            {activity ? t('Update') : t('Save')}
          </Button>
        </div>
      </FormPageFooter>
    </FormPage>
  );
}
