'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBaby } from '@/app/context/baby';
import { useFamily } from '@/src/context/family';
import { deriveFacts, FlipOverride, RawActivityData } from './facts';
import { ActivityFacts } from './engine';
import { TodayLogs } from './schedule';

const authHeaders = (): HeadersInit => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const overrideKey = (familyId: string | undefined, babyId: string) =>
  `flipOverride_${familyId || 'nofamily'}_${babyId}`;

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return null;
  const body = await res.json();
  return body.success ? (body.data as T) : null;
}

export function useFlipData() {
  const { selectedBaby } = useBaby();
  const { family } = useFamily();
  const [facts, setFacts] = useState<ActivityFacts | null>(null);
  const [override, setOverrideState] = useState<FlipOverride | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawActivityData | null>(null);
  const [todayLogs, setTodayLogs] = useState<TodayLogs>({ sleeps: [], feeds: [] });

  const babyId = selectedBaby?.id;
  const familyId = family?.id;

  // load the persisted override for this baby
  useEffect(() => {
    if (!babyId) return;
    try {
      const stored = localStorage.getItem(overrideKey(familyId, babyId));
      setOverrideState(stored ? (JSON.parse(stored) as FlipOverride) : null);
    } catch {
      setOverrideState(null);
    }
  }, [babyId, familyId]);

  const refresh = useCallback(async () => {
    if (!babyId || !selectedBaby) return;
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 86400000).toISOString();
      const end = new Date(now.getTime() + 86400000).toISOString();
      const dStart = new Date(now.getTime() - 2 * 86400000).toISOString();
      const [sleepLogs, lastFeed, diaperLogs, weights, feedsRecent] = await Promise.all([
        getJson<{ startTime: string; endTime: string | null }[]>(
          `/api/sleep-log?babyId=${babyId}&startDate=${start}&endDate=${end}`),
        getJson<{ time: string; endTime?: string | null }>(
          `/api/feed-log/last?babyId=${babyId}`),
        getJson<{ time: string; type: 'WET' | 'DIRTY' | 'BOTH' }[]>(
          `/api/diaper-log?babyId=${babyId}&startDate=${dStart}&endDate=${end}`),
        getJson<{ date: string; value: number; unit: string }[]>(
          `/api/measurement-log?babyId=${babyId}&type=WEIGHT`),
        getJson<{ time: string }[]>(
          `/api/feed-log?babyId=${babyId}&startDate=${new Date(now.getTime() - 36 * 3600 * 1000).toISOString()}&endDate=${end}`),
      ]);
      setRaw({
        sleepLogs: sleepLogs ?? [],
        lastFeed: lastFeed ?? null,
        diaperLogs: diaperLogs ?? [],
        weights: weights ?? [],
        birthDate: String(selectedBaby.birthDate),
      });
      setTodayLogs({
        sleeps: (sleepLogs ?? []).map(l => ({
          start: new Date(l.startTime),
          end: l.endTime ? new Date(l.endTime) : null,
        })),
        feeds: (feedsRecent ?? []).map(f => new Date(f.time)),
      });
    } catch (e) {
      console.error('flip data fetch failed:', e);
      setError('Could not load activity data');
    } finally {
      setLoading(false);
    }
  }, [babyId, selectedBaby]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // re-derive facts whenever raw data or override changes
  useEffect(() => {
    if (!raw) return;
    setFacts(deriveFacts(raw, override, new Date()));
  }, [raw, override]);

  const setOverride = useCallback(
    (kind: 'wake' | 'down', time: Date) => {
      if (!babyId) return;
      const o: FlipOverride = {
        kind,
        time: time.toISOString(),
        setAt: new Date().toISOString(),
      };
      localStorage.setItem(overrideKey(familyId, babyId), JSON.stringify(o));
      setOverrideState(o);
    },
    [babyId, familyId],
  );

  const clearOverride = useCallback(() => {
    if (!babyId) return;
    localStorage.removeItem(overrideKey(familyId, babyId));
    setOverrideState(null);
  }, [babyId, familyId]);

  // "also log it": wake -> close the open sleep log; down -> create an open NAP
  const alsoLogIt = useCallback(
    async (kind: 'wake' | 'down', time: Date) => {
      if (!babyId) return;
      try {
        if (kind === 'down') {
          await fetch('/api/sleep-log', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              babyId,
              startTime: time.toISOString(),
              type: 'NAP',
            }),
          });
        } else {
          // close the most recent open log, if any
          const open = await getJson<{ id: string; endTime: string | null }[]>(
            `/api/sleep-log?babyId=${babyId}&startDate=${new Date(time.getTime() - 86400000).toISOString()}&endDate=${new Date(time.getTime() + 60000).toISOString()}`);
          const target = (open ?? []).find(l => !l.endTime);
          if (target) {
            await fetch(`/api/sleep-log?id=${target.id}`, {
              method: 'PUT',
              headers: authHeaders(),
              body: JSON.stringify({ endTime: time.toISOString() }),
            });
          }
        }
        await refresh();
      } catch (e) {
        console.error('also-log-it failed:', e);
      }
    },
    [babyId, refresh],
  );

  return { facts, todayLogs, loading, error, override, setOverride, clearOverride, alsoLogIt, refresh };
}
