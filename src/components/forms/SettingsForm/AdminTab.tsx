'use client';

import React from 'react';
import { Baby, Caretaker } from '@prisma/client';
import { Settings } from '@/app/api/types';
import { Edit, Plus } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/src/components/ui/select';
import { useLocalization } from '@/src/context/localization';
import ApiKeyManager from './ApiKeyManager';
import ApiGuide from './ApiGuide';

type AuthType = 'SYSTEM' | 'CARETAKER' | 'CARETAKER_PIN';

interface AdminTabProps {
  settings: Settings | null;
  caretakers: Caretaker[];
  babies: Baby[];
  loading: boolean;
  familyId?: string;
  localAuthType: AuthType;
  onSettingsChange: (updates: Partial<Settings>) => Promise<void>;
  onAuthTypeChange: (authType: AuthType) => void;
  // Caretaker management
  selectedCaretaker: Caretaker | null;
  onSelectedCaretakerChange: (caretaker: Caretaker | null) => void;
  onCaretakerFormOpen: (isEditing: boolean) => void;
  onChangePinOpen: () => void;
}

export default function AdminTab({
  settings,
  caretakers,
  babies,
  loading,
  familyId,
  localAuthType,
  onSettingsChange,
  onAuthTypeChange,
  selectedCaretaker,
  onSelectedCaretakerChange,
  onCaretakerFormOpen,
  onChangePinOpen,
}: AdminTabProps) {
  const { t } = useLocalization();

  return (
    <div className="space-y-6">
      {/* API Keys / Integrations Section */}
      <ApiKeyManager babies={babies} familyId={familyId} />

      {/* API Integration Guide */}
      <div className="border-t border-slate-200 pt-6">
        <ApiGuide babies={babies} />
      </div>

      {/* Authentication Settings */}
      <div className="border-t border-slate-200 pt-6">
        <h3 className="form-label mb-4">{t('Authentication Settings')}</h3>

        <div className="space-y-4">
          <div>
            <Label className="form-label mb-1">{t('Login Mode')}</Label>
            <Select
              value={localAuthType}
              onValueChange={(v) => onAuthTypeChange(v as AuthType)}
              disabled={loading}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SYSTEM">{t('System PIN')}</SelectItem>
                <SelectItem value="CARETAKER">{t('Caretaker ID + PIN')}</SelectItem>
                <SelectItem value="CARETAKER_PIN">{t('Caretaker PIN only')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-sm text-gray-500">
              {localAuthType === 'CARETAKER'
                ? t('Use individual caretaker login IDs and PINs')
                : localAuthType === 'CARETAKER_PIN'
                ? t('Use individual caretaker PINs only — each caretaker is identified by their PIN.')
                : t('Use shared system PIN for all users')
              }
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Label className="form-label">{t('Security PIN')}</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              disabled
              value="••••••"
              className="w-full font-mono"
            />
            <Button
              variant="outline"
              onClick={onChangePinOpen}
              disabled={loading}
            >
              {t('Change PIN')}
            </Button>
          </div>
          {localAuthType !== 'SYSTEM' ? (
            <p className="text-sm text-red-500 mt-1">{t('System PIN is disabled when using caretaker authentication.')}</p>
          ) : (
            <p className="text-sm text-gray-500 mt-1">{t('PIN must be between 4 and 10 digits')}</p>
          )}
        </div>

        {/* Caretaker Management */}
        <div className="mt-4">
          <div className="mb-4">
            <Label className="form-label">{t('Manage Caretakers')}</Label>
            {localAuthType === 'SYSTEM' && (
              <p className="text-sm text-red-500 mt-1">{t('Caretaker logins are disabled in System PIN mode')}</p>
            )}
          </div>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 w-full">
              <div className="flex-1 min-w-[200px]">
                <Select
                  value={selectedCaretaker?.id || ''}
                  onValueChange={(caretakerId) => {
                    const caretaker = caretakers.find(c => c.id === caretakerId);
                    onSelectedCaretakerChange(caretaker || null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("Select a caretaker")} />
                  </SelectTrigger>
                  <SelectContent>
                    {caretakers.map((caretaker) => (
                      <SelectItem key={caretaker.id} value={caretaker.id}>
                        {caretaker.name} {caretaker.type ? `(${caretaker.type})` : ''}{caretaker.inactive ? ' (Inactive)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                disabled={!selectedCaretaker}
                onClick={() => onCaretakerFormOpen(true)}
              >
                <Edit className="h-4 w-4 mr-2" />
                {t('Edit')}
              </Button>
              <Button variant="outline" onClick={() => {
                onSelectedCaretakerChange(null);
                onCaretakerFormOpen(false);
              }}>
                <Plus className="h-4 w-4 mr-2" />
                {t('Add')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Debug Settings */}
      <div className="border-t border-slate-200 pt-6">
        <h3 className="form-label mb-4">{t('Debug Settings')}</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="form-label">{t('Enable Debug Session Timer')}</Label>
              <p className="text-sm text-gray-500">{t('Shows JWT token expiration and user idle time')}</p>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="enableDebugTimer"
                checked={(settings as any)?.enableDebugTimer || false}
                onChange={(e) => onSettingsChange({ enableDebugTimer: e.target.checked } as any)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="form-label">{t('Enable Debug Timezone Tool')}</Label>
              <p className="text-sm text-gray-500">{t('Shows timezone information and DST status')}</p>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="enableDebugTimezone"
                checked={(settings as any)?.enableDebugTimezone || false}
                onChange={(e) => onSettingsChange({ enableDebugTimezone: e.target.checked } as any)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
