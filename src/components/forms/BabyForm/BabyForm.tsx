'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Calendar } from 'lucide-react';
import { Baby, Gender } from '@prisma/client';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Calendar as CalendarComponent } from '@/src/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/src/components/ui/select';
import {
  FormPage,
  FormPageFooter
} from '@/src/components/ui/form-page';
import { FormPageTab } from '@/src/components/ui/form-page/form-page.types';
import DayNightFlipTab from './DayNightFlipTab';
import {
  FlipConfig,
  DEFAULT_FLIP_CONFIG,
  mergeFlipConfig,
} from '@/src/components/DayNightFlip/protocol';
import { cn } from '@/src/lib/utils';
import { babyFormStyles } from './baby-form.styles';
import { useToast } from '@/src/components/ui/toast';
import { handleExpirationError } from '@/src/lib/expiration-error-handler';
import { useLocalization } from '@/src/context/localization';
import { useTimezone } from '@/app/context/timezone';
import { formatDateLong } from '@/src/utils/dateFormat';

interface BabyFormProps {
  isOpen: boolean;
  onClose: () => void;
  isEditing: boolean;
  baby: Baby | null;
  onBabyChange?: () => void;
}

const defaultFormData = {
  firstName: '',
  lastName: '',
  birthDate: undefined as Date | undefined,
  gender: '',
  inactive: false,
  feedWarningTime: '03:00',
  diaperWarningTime: '02:00',
};

export default function BabyForm({
  isOpen,
  onClose,
  isEditing,
  baby,
  onBabyChange,
}: BabyFormProps) {
  const { t } = useLocalization();
  const { dateFormat } = useTimezone();
  const { showToast } = useToast();
  const [formData, setFormData] = useState(defaultFormData);
  const [flipConfig, setFlipConfig] = useState<FlipConfig>(DEFAULT_FLIP_CONFIG);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when form opens/closes or baby changes
  useEffect(() => {
    if (baby && isOpen && !isSubmitting) {
      const birthDate = baby.birthDate instanceof Date 
        ? baby.birthDate
        : new Date(baby.birthDate as string);

      setFormData({
        firstName: baby.firstName,
        lastName: baby.lastName,
        birthDate,
        gender: baby.gender || '',
        inactive: baby.inactive || false,
        feedWarningTime: baby.feedWarningTime || '03:00',
        diaperWarningTime: baby.diaperWarningTime || '02:00',
      });
      setFlipConfig(mergeFlipConfig((baby as { dayNightFlipConfig?: string | null }).dayNightFlipConfig));
    } else if (!isOpen && !isSubmitting) {
      setFormData(defaultFormData);
      setFlipConfig(DEFAULT_FLIP_CONFIG);
    }
  }, [baby?.id, isOpen, isSubmitting]); // Use baby.id instead of full baby object to prevent unnecessary resets

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!formData.firstName || !formData.lastName || !formData.birthDate) {
      showToast({
        variant: 'error',
        title: t('Error'),
        message: t('Please fill in name and birth date'),
        duration: 5000,
      });
      return;
    }

    try {
      setIsSubmitting(true);
      
      // Get auth token for API request
      const authToken = localStorage.getItem('authToken');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch('/api/baby', {
        method: isEditing ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify({
          ...formData,
          id: baby?.id,
          birthDate: formData.birthDate,
          gender: formData.gender as Gender,
          ...(isEditing ? { dayNightFlipConfig: JSON.stringify(flipConfig) } : {}),
        }),
      });

      if (!response.ok) {
        // Check if this is an account expiration error
        if (response.status === 403) {
          const { isExpirationError } = await handleExpirationError(
            response, 
            showToast, 
            'managing babies'
          );
          if (isExpirationError) {
            // Don't close the form, let user see the error
            return;
          }
        }
        
        // For other errors, throw as before
        throw new Error('Failed to save baby');
      }

      if (onBabyChange) {
        onBabyChange();
      }
      
      onClose();
    } catch (error) {
      console.error('Error saving baby:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const basicInfoContent = (
    <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label">{t('First Name')}</label>
              <Input
                value={formData.firstName}
                onChange={(e) =>
                  setFormData({ ...formData, firstName: e.target.value })
                }
                className="w-full"
                placeholder={t("Enter first name")}
                required
              />
            </div>
            <div>
              <label className="form-label">{t('Last Name')}</label>
              <Input
                value={formData.lastName}
                onChange={(e) =>
                  setFormData({ ...formData, lastName: e.target.value })
                }
                className="w-full"
                placeholder={t("Enter last name")}
                required
              />
            </div>
          </div>
          <div>
            <label className="form-label">{t('Birth Date')}</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="input"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !formData.birthDate && "text-muted-foreground"
                  )}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {formData.birthDate ? formatDateLong(formData.birthDate, dateFormat) : t("Select date")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-[100]" align="start">
                <CalendarComponent
                  mode="single"
                  selected={formData.birthDate}
                  onSelect={(date) => setFormData({ ...formData, birthDate: date })}
                  maxDate={new Date()} // Can't select future dates
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label className="form-label">{t('Gender')}</label>
            <Select
              value={formData.gender}
              onValueChange={(value) =>
                setFormData({ ...formData, gender: value })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("Select gender")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MALE">{t('Male')}</SelectItem>
                <SelectItem value="FEMALE">{t('Female')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label">{t('Feed Warning Time (hh:mm)')}</label>
              <Input
                type="text"
                pattern="[0-9]{2}:[0-9]{2}"
                value={formData.feedWarningTime}
                onChange={(e) =>
                  setFormData({ ...formData, feedWarningTime: e.target.value })
                }
                className="w-full"
                placeholder="03:00"
                required
              />
            </div>
            <div>
              <label className="form-label">{t('Diaper Warning Time (hh:mm)')}</label>
              <Input
                type="text"
                pattern="[0-9]{2}:[0-9]{2}"
                value={formData.diaperWarningTime}
                onChange={(e) =>
                  setFormData({ ...formData, diaperWarningTime: e.target.value })
                }
                className="w-full"
                placeholder="02:00"
                required
              />
            </div>
          </div>
          {isEditing && (
            <div className="flex items-center space-x-2 mt-4">
              <label className="form-label flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="form-checkbox h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  checked={formData.inactive}
                  onChange={(e) =>
                    setFormData({ ...formData, inactive: e.target.checked })
                  }
                />
                <span className="ml-2">{t('Mark as inactive')}</span>
              </label>
            </div>
          )}
    </div>
  );

  const tabs: FormPageTab[] = [
    { id: 'basic', label: t('Basic Info'), content: basicInfoContent },
    ...(isEditing
      ? [{
          id: 'flip',
          label: t('Rhythm'),
          content: (
            <DayNightFlipTab
              config={flipConfig}
              onChange={setFlipConfig}
              birthDate={formData.birthDate}
            />
          ),
        }]
      : []),
  ];

  return (
    <FormPage
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? t('Edit Baby') : t('Add New Baby')}
      description={isEditing
        ? t("Update your baby's information")
        : t("Enter your baby's information to start tracking")
      }
      tabs={tabs}
    >
      <FormPageFooter>
        <div className="flex justify-end space-x-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t('Cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? t('Saving...') : isEditing ? t('Update') : t('Save')}
          </Button>
        </div>
      </FormPageFooter>
    </FormPage>
  );
}
