'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Lightbulb, Plus, RefreshCw, Trash2, Unlink } from 'lucide-react';
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
import { useToast } from '@/src/components/ui/toast';
import { useLocalization } from '@/src/context/localization';

interface HueButton {
  id: string;
  label: string;
  sceneId: string;
  order: number;
}

interface PublicConfig {
  paired: boolean;
  bridgeIp?: string;
  buttons: HueButton[];
}

interface DiscoveredBridge {
  id: string;
  internalipaddress: string;
}

interface SceneOption {
  id: string;
  name: string;
  room?: string;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `${res.status} error`);
  }
  return json.data as T;
}

export default function NurseryLightsSection() {
  const { t } = useLocalization();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [paired, setPaired] = useState(false);
  const [bridgeIp, setBridgeIp] = useState<string>('');
  const [buttons, setButtons] = useState<HueButton[]>([]);
  const [scenes, setScenes] = useState<SceneOption[] | null>(null);
  const [scenesLoading, setScenesLoading] = useState(false);

  // Pairing state
  const [discovered, setDiscovered] = useState<DiscoveredBridge[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [selectedIp, setSelectedIp] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairMessage, setPairMessage] = useState('');

  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const cfg = await api<PublicConfig>('/api/hue');
      setPaired(cfg.paired);
      setBridgeIp(cfg.bridgeIp ?? '');
      setButtons(cfg.buttons);
    } catch (err) {
      console.error('Failed to load Hue config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadScenes = useCallback(async () => {
    setScenesLoading(true);
    try {
      const list = await api<SceneOption[]>('/api/hue/scenes');
      setScenes(list);
    } catch (err) {
      showToast({ variant: 'error', message: t('Failed to load scenes') + ': ' + (err as Error).message });
    } finally {
      setScenesLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    if (paired && scenes === null) loadScenes();
  }, [paired, scenes, loadScenes]);

  const discoverBridges = async () => {
    setDiscovering(true);
    try {
      const list = await api<DiscoveredBridge[]>('/api/hue/discover', { method: 'POST' });
      setDiscovered(list);
      if (list.length === 1) setSelectedIp(list[0].internalipaddress);
      if (list.length === 0) showToast({ variant: 'info', message: t('No bridges found on the network') });
    } catch (err) {
      showToast({ variant: 'error', message: (err as Error).message });
    } finally {
      setDiscovering(false);
    }
  };

  const tryPair = async (ip: string) => {
    setPairing(true);
    setPairMessage(t('Press the link button on top of your Hue Bridge, then we’ll keep trying for 30 seconds…'));
    const deadline = Date.now() + 30_000;
    let lastError = '';
    while (Date.now() < deadline) {
      try {
        const result = await api<{ paired: true; bridgeIp: string }>('/api/hue/pair', {
          method: 'POST',
          body: JSON.stringify({ bridgeIp: ip }),
        });
        setPaired(true);
        setBridgeIp(result.bridgeIp);
        setPairMessage('');
        showToast({ variant: 'success', message: t('Paired with Hue Bridge') });
        setScenes(null); // force reload
        setPairing(false);
        return;
      } catch (err) {
        lastError = (err as Error).message;
        // 428 = link button not pressed; keep polling
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    setPairing(false);
    setPairMessage('');
    showToast({ variant: 'error', message: t('Pairing timed out') + (lastError ? `: ${lastError}` : '') });
  };

  const forgetBridge = async () => {
    if (!confirm(t('Forget the paired Hue Bridge? Scene buttons will stop working until re-paired.'))) return;
    try {
      await api('/api/hue/forget', { method: 'POST' });
      setPaired(false);
      setBridgeIp('');
      setScenes(null);
      setButtons([]);
      showToast({ variant: 'success', message: t('Bridge forgotten') });
    } catch (err) {
      showToast({ variant: 'error', message: (err as Error).message });
    }
  };

  const addButton = () => {
    if (!scenes || scenes.length === 0) {
      showToast({ variant: 'info', message: t('No scenes available — create scenes in the Hue app first') });
      return;
    }
    const first = scenes[0];
    setButtons((prev) => [
      ...prev,
      {
        id: `btn_${Date.now()}_${prev.length}`,
        label: first.name,
        sceneId: first.id,
        order: prev.length,
      },
    ]);
  };

  const updateButton = (idx: number, patch: Partial<HueButton>) => {
    setButtons((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const removeButton = (idx: number) => {
    setButtons((prev) => prev.filter((_, i) => i !== idx).map((b, i) => ({ ...b, order: i })));
  };

  const moveButton = (idx: number, dir: -1 | 1) => {
    setButtons((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((b, i) => ({ ...b, order: i }));
    });
  };

  const testScene = async (sceneId: string) => {
    try {
      await api('/api/hue/activate', { method: 'POST', body: JSON.stringify({ sceneId }) });
    } catch (err) {
      showToast({ variant: 'error', message: (err as Error).message });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/hue', { method: 'PUT', body: JSON.stringify({ buttons }) });
      showToast({ variant: 'success', message: t('Nursery lights saved') });
    } catch (err) {
      showToast({ variant: 'error', message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="border-t border-slate-200 pt-6">
        <h3 className="form-label mb-4 flex items-center gap-2">
          <Lightbulb className="h-4 w-4" /> {t('Nursery Lights')}
        </h3>
        <p className="text-sm text-gray-500">{t('Loading…')}</p>
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200 pt-6">
      <h3 className="form-label mb-4 flex items-center gap-2">
        <Lightbulb className="h-4 w-4" /> {t('Nursery Lights')}
      </h3>
      <p className="text-sm text-gray-500 mb-4">
        {t('Pair a Philips Hue Bridge to add scene buttons to the Nursery Kiosk.')}
      </p>

      {!paired ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <Button variant="outline" onClick={discoverBridges} disabled={discovering || pairing}>
              {discovering ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              {t('Discover bridges')}
            </Button>
            {discovered && discovered.length > 0 && (
              <div className="flex-1 min-w-[200px]">
                <Select value={selectedIp} onValueChange={setSelectedIp}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('Select a bridge')} />
                  </SelectTrigger>
                  <SelectContent>
                    {discovered.map((b) => (
                      <SelectItem key={b.id} value={b.internalipaddress}>
                        {b.internalipaddress} ({b.id.slice(-6)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <Label className="form-label mb-1">{t('Or enter Bridge IP manually')}</Label>
            <Input
              placeholder="192.168.1.100"
              value={manualIp}
              onChange={(e) => setManualIp(e.target.value)}
              disabled={pairing}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => tryPair(manualIp.trim() || selectedIp)}
              disabled={pairing || (!manualIp.trim() && !selectedIp)}
            >
              {pairing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t('Pair with Bridge')}
            </Button>
            {pairMessage && <span className="text-sm text-gray-600">{pairMessage}</span>}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm">
              <span className="text-gray-500">{t('Paired bridge')}: </span>
              <span className="font-mono">{bridgeIp}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadScenes} disabled={scenesLoading}>
                {scenesLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {t('Refresh scenes')}
              </Button>
              <Button variant="outline" size="sm" onClick={forgetBridge}>
                <Unlink className="h-4 w-4 mr-2" />
                {t('Forget bridge')}
              </Button>
            </div>
          </div>

          <div>
            <Label className="form-label mb-2 block">{t('Kiosk scene buttons')}</Label>
            {buttons.length === 0 && (
              <p className="text-sm text-gray-500 mb-2">
                {t('No scene buttons yet. Add one to show it on the nursery kiosk.')}
              </p>
            )}
            <div className="space-y-2">
              {buttons.map((btn, idx) => (
                <div key={btn.id} className="flex flex-wrap items-center gap-2 p-2 rounded border border-slate-200">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="p-1 hover:bg-slate-100 rounded disabled:opacity-30"
                      onClick={() => moveButton(idx, -1)}
                      disabled={idx === 0}
                      aria-label={t('Move up')}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="p-1 hover:bg-slate-100 rounded disabled:opacity-30"
                      onClick={() => moveButton(idx, 1)}
                      disabled={idx === buttons.length - 1}
                      aria-label={t('Move down')}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                  <Input
                    className="flex-1 min-w-[120px]"
                    placeholder={t('Label')}
                    value={btn.label}
                    onChange={(e) => updateButton(idx, { label: e.target.value })}
                    maxLength={40}
                  />
                  <div className="flex-1 min-w-[200px]">
                    <Select value={btn.sceneId} onValueChange={(v) => updateButton(idx, { sceneId: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('Pick a scene')} />
                      </SelectTrigger>
                      <SelectContent>
                        {(scenes ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.room ? `${s.room} — ${s.name}` : s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => testScene(btn.sceneId)} disabled={!btn.sceneId}>
                    {t('Test')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => removeButton(idx)} aria-label={t('Remove')}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" onClick={addButton} disabled={scenesLoading}>
                <Plus className="h-4 w-4 mr-2" />
                {t('Add scene button')}
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {t('Save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
