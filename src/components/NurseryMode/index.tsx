'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useBaby } from '@/app/context/baby';
import { useLocalization } from '@/src/context/localization';
import './NurseryMode.css';

type ToastKind = 'pend' | 'ok' | 'err';

interface ToastItem {
  id: number;
  label: string;
  kind: ToastKind;
  ms: number;
  undoable?: boolean;
  onUndo?: () => void;
}

interface FeedSnap {
  id: string;
  time: number;
  type: 'BREAST' | 'BOTTLE' | 'SOLIDS';
  side?: 'LEFT' | 'RIGHT' | null;
  amount?: number | null;
  unitAbbr?: string | null;
  bottleType?: string | null;
}
interface DiaperSnap {
  id: string;
  time: number;
  type: 'WET' | 'DIRTY' | 'BOTH';
}
interface OpenSessionSnap {
  id: string;
  startTime: number;
}
interface HueButton {
  id: string;
  label: string;
  sceneId: string;
  order: number;
}

const REFRESH_MS = 5 * 60 * 1000;
const CLOCK_MS = 30_000;
const QUICK_CANCEL_MS = 5_000;
const BOTTLE_TYPES = ['formula', 'breast milk', 'milk', 'other'];

const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
const fmtClock = (d = new Date()) => (d.getHours() % 12 || 12) + ':' + pad(d.getMinutes());
const fmtAgo = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return m + 'm ago';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago';
};
const fmtHM = (t: number) => {
  const d = new Date(t);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};
const fmtElapsed = (startMs: number) => {
  const s = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m + ':' + pad(rem);
};
// Combine "HH:MM" from a time input with today's date, returning an ISO string.
// If the chosen time is in the future relative to now, assume it was yesterday.
const hmToIso = (hm: string): string => {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, m);
  if (d.getTime() > Date.now() + 60_000) d.setDate(d.getDate() - 1);
  return d.toISOString();
};

function isAuthed(): boolean {
  if (typeof window === 'undefined') return false;
  const t = localStorage.getItem('authToken');
  if (!t) return false;
  try {
    const payload = JSON.parse(atob(t.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) return false;
    // PIN-based caretakers also need unlockTime (handleLogout clears it
    // alongside the token); we deliberately skip the idle-window check
    // since this kiosk view doesn't refresh unlockTime on activity.
    const isAccountAuth = !!payload.isAccountAuth;
    const isSysAdmin = !!payload.isSysAdmin;
    if (!isAccountAuth && !isSysAdmin && !localStorage.getItem('unlockTime')) return false;
    return true;
  } catch {
    return false;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || json?.success === false) {
    const msg = json?.error || `${res.status} error`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return json.data as T;
}

interface BabyLite { id: string; firstName: string }

export function NurseryMode() {
  const router = useRouter();
  const params = useParams();
  const slug = (params?.slug as string) || '';
  const { selectedBaby, setSelectedBaby } = useBaby();
  const { t } = useLocalization();

  const [authChecked, setAuthChecked] = useState(false);
  const [clock, setClock] = useState('--:--');
  const [, setTick] = useState(0); // bump to refresh "ago" badges
  const [batt, setBatt] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState(t('ready'));

  const [babies, setBabies] = useState<BabyLite[]>([]);
  const [babyMenuOpen, setBabyMenuOpen] = useState(false);

  const [lastFeed, setLastFeed] = useState<FeedSnap | null>(null);
  const [lastDiaper, setLastDiaper] = useState<DiaperSnap | null>(null);
  const [openSleep, setOpenSleep] = useState<OpenSessionSnap | null>(null);
  const [openPump, setOpenPump] = useState<OpenSessionSnap | null>(null);
  const [openBreast, setOpenBreast] = useState<{ id: string; side: 'LEFT' | 'RIGHT'; startTime: number } | null>(null);
  const [, setBreastTick] = useState(0); // 1s tick while a breast session is open
  const [hueButtons, setHueButtons] = useState<HueButton[]>([]);
  const [hueBusy, setHueBusy] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const toastTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // bottle modal
  const [bottleOpen, setBottleOpen] = useState(false);
  const [bottleAmount, setBottleAmount] = useState('0');
  const [bottleType, setBottleType] = useState('formula');
  const [bottleUnit, setBottleUnit] = useState<'OZ' | 'ML'>('OZ');

  // edit modal
  const [editKind, setEditKind] = useState<null | 'feed' | 'diaper'>(null);
  const [editTime, setEditTime] = useState('');
  const [editDiaperType, setEditDiaperType] = useState<'WET' | 'DIRTY' | 'BOTH'>('WET');
  const [editFeedKind, setEditFeedKind] = useState<'BREAST' | 'BOTTLE'>('BREAST');
  const [editFeedSide, setEditFeedSide] = useState<'LEFT' | 'RIGHT'>('LEFT');
  const [editFeedAmount, setEditFeedAmount] = useState('');
  const [editFeedUnit, setEditFeedUnit] = useState<'OZ' | 'ML'>('OZ');
  const [editFeedBottleType, setEditFeedBottleType] = useState('formula');

  // --- auth gate ---
  // Re-checks every 5s so mid-session invalidation (server blacklist, logout
  // from another tab) flips to the PIN screen instead of leaving the page
  // stuck on "Loading…". Uses window.location.replace so we exit the
  // (nursery) route group cleanly even if the router is in a stuck state.
  const redirectingRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !slug) return;

    const check = () => {
      if (redirectingRef.current) return;
      if (!isAuthed()) {
        redirectingRef.current = true;
        const target = `/${slug}/nursery-mode`;
        window.location.replace(`/${slug}?redirect=${encodeURIComponent(target)}`);
        return;
      }
      setAuthChecked(true);
    };

    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [slug]);

  // --- clock + ago refresh ---
  useEffect(() => {
    setClock(fmtClock());
    const id = setInterval(() => {
      setClock(fmtClock());
      setTick((n) => (n + 1) & 0x7fffffff);
    }, CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  // --- 1s tick while a breast session is in progress (drives the live timer label) ---
  useEffect(() => {
    if (!openBreast) return;
    const id = setInterval(() => setBreastTick((n) => (n + 1) & 0x7fffffff), 1000);
    return () => clearInterval(id);
  }, [openBreast]);

  // --- battery ---
  useEffect(() => {
    const nav = navigator as any;
    if (typeof nav.getBattery !== 'function') return;
    let detach: (() => void) | undefined;
    nav.getBattery().then((b: any) => {
      const render = () => {
        const pct = Math.round(b.level * 100);
        setBatt((b.charging ? '⚡ ' : '🔋 ') + pct + '%');
      };
      render();
      b.addEventListener('levelchange', render);
      b.addEventListener('chargingchange', render);
      detach = () => {
        b.removeEventListener('levelchange', render);
        b.removeEventListener('chargingchange', render);
      };
    }).catch(() => {});
    return () => { detach?.(); };
  }, []);

  // --- load babies + auto-select first if none selected ---
  useEffect(() => {
    if (!authChecked) return;
    api<BabyLite[]>('/api/baby').then((list) => {
      const active = (list || []).filter((b: any) => !b.inactive);
      setBabies(active.map((b) => ({ id: b.id, firstName: b.firstName })));
      if (!selectedBaby && active.length > 0) {
        setSelectedBaby(active[0] as any);
      }
    }).catch(() => {
      // ignore — page works in degraded state
    });
  }, [authChecked, selectedBaby, setSelectedBaby]);

  // --- refresh status for current baby ---
  const refreshStatus = useCallback(async () => {
    if (!selectedBaby?.id) return;
    try {
      const [feeds, diapers, sleeps, pumps] = await Promise.all([
        api<any[]>(`/api/feed-log?babyId=${selectedBaby.id}`),
        api<any[]>(`/api/diaper-log?babyId=${selectedBaby.id}`),
        api<any[]>(`/api/sleep-log?babyId=${selectedBaby.id}`),
        api<any[]>(`/api/pump-log?babyId=${selectedBaby.id}`),
      ]);
      // An open breast session is type=BREAST + startTime set + endTime null.
      const breastOpen = (feeds || []).find((x: any) =>
        x.type === 'BREAST' && x.startTime && !x.endTime
      );
      setOpenBreast(breastOpen ? {
        id: breastOpen.id,
        side: breastOpen.side as 'LEFT' | 'RIGHT',
        startTime: new Date(breastOpen.startTime).getTime(),
      } : null);
      // Most recent COMPLETED feed (skip the open breast session if any).
      const f = (feeds || []).find((x: any) => !(x.type === 'BREAST' && x.startTime && !x.endTime));
      setLastFeed(f ? {
        id: f.id, time: new Date(f.time).getTime(), type: f.type,
        side: f.side, amount: f.amount, unitAbbr: f.unitAbbr, bottleType: f.bottleType,
      } : null);
      const d = diapers?.[0];
      setLastDiaper(d ? { id: d.id, time: new Date(d.time).getTime(), type: d.type } : null);
      const sOpen = (sleeps || []).find((x: any) => !x.endTime);
      setOpenSleep(sOpen ? { id: sOpen.id, startTime: new Date(sOpen.startTime).getTime() } : null);
      const pOpen = (pumps || []).find((x: any) => !x.endTime);
      setOpenPump(pOpen ? { id: pOpen.id, startTime: new Date(pOpen.startTime).getTime() } : null);
      setStatusMsg(t('synced') + ' ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    } catch {
      setStatusMsg(t('offline'));
    }
  }, [selectedBaby?.id, t]);

  useEffect(() => {
    if (!authChecked || !selectedBaby?.id) return;
    refreshStatus();
    const id = setInterval(refreshStatus, REFRESH_MS);
    return () => clearInterval(id);
  }, [authChecked, selectedBaby?.id, refreshStatus]);

  // --- toasts ---
  const pushToast = useCallback((label: string, kind: ToastKind, opts?: { ms?: number; undoable?: boolean; onUndo?: () => void }) => {
    const id = ++toastSeq.current;
    const ms = opts?.ms ?? 2500;
    const item: ToastItem = { id, label, kind, ms, undoable: opts?.undoable, onUndo: opts?.onUndo };
    setToasts((cur) => [...cur, item]);
    const timer = setTimeout(() => {
      setToasts((cur) => cur.filter((x) => x.id !== id));
      toastTimers.current.delete(id);
    }, ms + 100);
    toastTimers.current.set(id, timer);
    return id;
  }, []);

  const removeToast = useCallback((id: number) => {
    const tm = toastTimers.current.get(id);
    if (tm) { clearTimeout(tm); toastTimers.current.delete(id); }
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  useEffect(() => () => {
    toastTimers.current.forEach(clearTimeout);
    toastTimers.current.clear();
  }, []);

  // --- load Hue config (scene buttons) once after auth ---
  useEffect(() => {
    if (!authChecked) return;
    api<{ paired: boolean; buttons: HueButton[] }>('/api/hue')
      .then((cfg) => setHueButtons(cfg?.buttons ?? []))
      .catch(() => setHueButtons([]));
  }, [authChecked]);

  const activateScene = useCallback(async (btn: HueButton) => {
    if (hueBusy) return;
    setHueBusy(btn.id);
    try {
      await api('/api/hue/activate', {
        method: 'POST',
        body: JSON.stringify({ buttonId: btn.id }),
      });
      pushToast(btn.label, 'ok', { ms: 1500 });
    } catch (e: any) {
      pushToast(e?.message || t('Light failed'), 'err', { ms: 4000 });
    } finally {
      setHueBusy(null);
    }
  }, [hueBusy, pushToast, t]);

  // --- commit: immediate POST; undo = DELETE the created record ---
  const commitFeed = useCallback(async (body: any, label: string) => {
    if (!selectedBaby?.id) return;
    try {
      const data = await api<any>('/api/feed-log', {
        method: 'POST',
        body: JSON.stringify({ ...body, babyId: selectedBaby.id, time: new Date().toISOString() }),
      });
      const snap: FeedSnap = {
        id: data.id, time: new Date(data.time).getTime(), type: data.type,
        side: data.side, amount: data.amount, unitAbbr: data.unitAbbr, bottleType: data.bottleType,
      };
      setLastFeed(snap);
      let toastId = 0;
      toastId = pushToast(label, 'ok', {
        ms: 5000, undoable: true,
        onUndo: async () => {
          removeToast(toastId);
          try {
            await api(`/api/feed-log?id=${data.id}`, { method: 'DELETE' });
            pushToast(t('undone'), 'ok', { ms: 1500 });
            await refreshStatus();
          } catch (e: any) {
            pushToast(e.message || t('undo failed'), 'err', { ms: 4000 });
          }
        },
      });
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 5000 });
    }
  }, [selectedBaby?.id, pushToast, removeToast, refreshStatus, t]);

  const commitDiaper = useCallback(async (type: 'WET' | 'DIRTY' | 'BOTH', label: string) => {
    if (!selectedBaby?.id) return;
    try {
      const data = await api<any>('/api/diaper-log', {
        method: 'POST',
        body: JSON.stringify({ babyId: selectedBaby.id, time: new Date().toISOString(), type }),
      });
      setLastDiaper({ id: data.id, time: new Date(data.time).getTime(), type: data.type });
      let toastId = 0;
      toastId = pushToast(label, 'ok', {
        ms: 5000, undoable: true,
        onUndo: async () => {
          removeToast(toastId);
          try {
            await api(`/api/diaper-log?id=${data.id}`, { method: 'DELETE' });
            pushToast(t('undone'), 'ok', { ms: 1500 });
            await refreshStatus();
          } catch (e: any) {
            pushToast(e.message || t('undo failed'), 'err', { ms: 4000 });
          }
        },
      });
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 5000 });
    }
  }, [selectedBaby?.id, pushToast, removeToast, refreshStatus, t]);

  // --- breast feed timer: tap to start; tap same side to stop; tap other side to switch ---
  const startBreast = useCallback(async (side: 'LEFT' | 'RIGHT') => {
    if (!selectedBaby?.id) return null;
    try {
      const now = new Date().toISOString();
      const data = await api<any>('/api/feed-log', {
        method: 'POST',
        body: JSON.stringify({ babyId: selectedBaby.id, type: 'BREAST', side, time: now, startTime: now }),
      });
      setOpenBreast({ id: data.id, side, startTime: new Date(data.startTime ?? data.time).getTime() });
      return data.id as string;
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 5000 });
      return null;
    }
  }, [selectedBaby?.id, pushToast]);

  const stopBreast = useCallback(async (opts?: { silent?: boolean }) => {
    if (!openBreast) return;
    const { id, side, startTime } = openBreast;
    const nowMs = Date.now();
    const elapsedMs = nowMs - startTime;
    // <5s = mistap, discard silently
    if (elapsedMs < QUICK_CANCEL_MS) {
      try {
        await api(`/api/feed-log?id=${id}`, { method: 'DELETE' });
        setOpenBreast(null);
      } catch (e: any) {
        pushToast(e.message || 'error', 'err', { ms: 5000 });
      }
      return;
    }
    const endIso = new Date(nowMs).toISOString();
    const durationSec = Math.round(elapsedMs / 1000);
    try {
      const data = await api<any>(`/api/feed-log?id=${id}`, {
        method: 'PUT',
        body: JSON.stringify({ endTime: endIso, feedDuration: durationSec }),
      });
      setOpenBreast(null);
      // The just-ended session is now the most recent completed feed.
      setLastFeed({
        id: data.id, time: new Date(data.time).getTime(), type: 'BREAST',
        side, amount: null, unitAbbr: null, bottleType: null,
      });
      if (opts?.silent) return;
      const mins = Math.floor(durationSec / 60);
      const secs = durationSec % 60;
      const durLabel = mins > 0 ? `${mins}m${secs ? ' ' + secs + 's' : ''}` : `${secs}s`;
      const label = `${side === 'LEFT' ? t('Breast L') : t('Breast R')} · ${durLabel}`;
      let toastId = 0;
      toastId = pushToast(label, 'ok', {
        ms: 5000, undoable: true,
        onUndo: async () => {
          removeToast(toastId);
          try {
            await api(`/api/feed-log?id=${id}`, {
              method: 'PUT', body: JSON.stringify({ endTime: null, feedDuration: null }),
            });
            setOpenBreast({ id, side, startTime });
            pushToast(t('undone'), 'ok', { ms: 1500 });
            await refreshStatus();
          } catch (e: any) {
            pushToast(e.message || t('undo failed'), 'err', { ms: 4000 });
          }
        },
      });
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 5000 });
    }
  }, [openBreast, pushToast, removeToast, refreshStatus, t]);

  const tapBreast = useCallback(async (side: 'LEFT' | 'RIGHT') => {
    if (openBreast && openBreast.side === side) {
      await stopBreast();
      return;
    }
    if (openBreast) {
      // Switching sides: silently close the current (5s rule still applies inside stopBreast)
      await stopBreast({ silent: true });
    }
    await startBreast(side);
  }, [openBreast, startBreast, stopBreast]);

  const startSleep = useCallback(async () => {
    if (!selectedBaby?.id) return;
    try {
      const data = await api<any>('/api/sleep-log', {
        method: 'POST',
        body: JSON.stringify({ babyId: selectedBaby.id, startTime: new Date().toISOString(), type: 'NAP' }),
      });
      setOpenSleep({ id: data.id, startTime: new Date(data.startTime).getTime() });
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 5000 });
    }
  }, [selectedBaby?.id, pushToast]);

  const endSleep = useCallback(async () => {
    if (!openSleep) return;
    const sleepId = openSleep.id;
    const prevStart = openSleep.startTime;
    // If "end" comes within QUICK_CANCEL_MS of "start", treat as a mistap and discard the record.
    if (Date.now() - prevStart < QUICK_CANCEL_MS) {
      try {
        await api(`/api/sleep-log?id=${sleepId}`, { method: 'DELETE' });
        setOpenSleep(null);
      } catch (e: any) {
        pushToast(e.message || 'error', 'err', { ms: 5000 });
      }
      return;
    }
    try {
      await api(`/api/sleep-log?id=${sleepId}`, {
        method: 'PUT',
        body: JSON.stringify({ endTime: new Date().toISOString() }),
      });
      setOpenSleep(null);
      let toastId = 0;
      toastId = pushToast(t('Sleep end'), 'ok', {
        ms: 5000, undoable: true,
        onUndo: async () => {
          removeToast(toastId);
          try {
            await api(`/api/sleep-log?id=${sleepId}`, {
              method: 'PUT', body: JSON.stringify({ endTime: null }),
            });
            setOpenSleep({ id: sleepId, startTime: prevStart });
            pushToast(t('undone'), 'ok', { ms: 1500 });
            await refreshStatus();
          } catch (e: any) {
            pushToast(e.message || t('undo failed'), 'err', { ms: 4000 });
          }
        },
      });
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 5000 });
    }
  }, [openSleep, pushToast, removeToast, refreshStatus, t]);

  const startPump = useCallback(async () => {
    if (!selectedBaby?.id) return;
    try {
      const data = await api<any>('/api/pump-log', {
        method: 'POST',
        body: JSON.stringify({ babyId: selectedBaby.id, startTime: new Date().toISOString() }),
      });
      setOpenPump({ id: data.id, startTime: new Date(data.startTime).getTime() });
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 5000 });
    }
  }, [selectedBaby?.id, pushToast]);

  const endPump = useCallback(async () => {
    if (!openPump) return;
    const pumpId = openPump.id;
    const prevStart = openPump.startTime;
    if (Date.now() - prevStart < QUICK_CANCEL_MS) {
      try {
        await api(`/api/pump-log?id=${pumpId}`, { method: 'DELETE' });
        setOpenPump(null);
      } catch (e: any) {
        pushToast(e.message || 'error', 'err', { ms: 5000 });
      }
      return;
    }
    try {
      await api(`/api/pump-log?id=${pumpId}`, {
        method: 'PUT',
        body: JSON.stringify({ endTime: new Date().toISOString() }),
      });
      setOpenPump(null);
      let toastId = 0;
      toastId = pushToast(t('Pump end'), 'ok', {
        ms: 5000, undoable: true,
        onUndo: async () => {
          removeToast(toastId);
          try {
            await api(`/api/pump-log?id=${pumpId}`, {
              method: 'PUT', body: JSON.stringify({ endTime: null }),
            });
            setOpenPump({ id: pumpId, startTime: prevStart });
            pushToast(t('undone'), 'ok', { ms: 1500 });
            await refreshStatus();
          } catch (e: any) {
            pushToast(e.message || t('undo failed'), 'err', { ms: 4000 });
          }
        },
      });
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 5000 });
    }
  }, [openPump, pushToast, removeToast, refreshStatus, t]);

  // Esc closes any open modal
  useEffect(() => {
    if (!bottleOpen && !editKind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (bottleOpen) setBottleOpen(false);
      else if (editKind) setEditKind(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bottleOpen, editKind]);

  // --- bottle modal ---
  const openBottle = () => {
    setBottleAmount('0');
    setBottleType('formula');
    setBottleUnit('OZ');
    setBottleOpen(true);
  };
  const closeBottle = () => setBottleOpen(false);
  const bottlePad = (n: string) => {
    setBottleAmount((cur) => {
      if (n === 'bs') {
        if (cur.length <= 1) return '0';
        const next = cur.slice(0, -1);
        return next === '' ? '0' : next;
      }
      if (n === '.') return cur.includes('.') ? cur : cur + '.';
      const next = cur === '0' ? n : cur + n;
      return next.length > 5 ? next.slice(0, 5) : next;
    });
  };
  const submitBottle = () => {
    const amt = parseFloat(bottleAmount);
    const body: any = { type: 'BOTTLE', bottleType };
    if (!Number.isNaN(amt) && amt > 0) { body.amount = amt; body.unitAbbr = bottleUnit; }
    closeBottle();
    const label = 'Bottle' + (body.amount ? ' ' + body.amount + (bottleUnit === 'OZ' ? 'oz' : 'mL') : '') + ' (' + bottleType + ')';
    void commitFeed(body, label);
  };

  // --- edit modal ---
  const openEdit = (kind: 'feed' | 'diaper') => {
    if (kind === 'feed' && lastFeed) {
      setEditFeedKind(lastFeed.type === 'BOTTLE' ? 'BOTTLE' : 'BREAST');
      setEditFeedSide((lastFeed.side as 'LEFT' | 'RIGHT') || 'LEFT');
      setEditFeedAmount(lastFeed.amount != null ? String(lastFeed.amount) : '');
      setEditFeedUnit((lastFeed.unitAbbr as 'OZ' | 'ML') || 'OZ');
      setEditFeedBottleType(lastFeed.bottleType || 'formula');
      setEditTime(fmtHM(lastFeed.time));
      setEditKind('feed');
    } else if (kind === 'diaper' && lastDiaper) {
      setEditDiaperType(lastDiaper.type);
      setEditTime(fmtHM(lastDiaper.time));
      setEditKind('diaper');
    }
  };
  const closeEdit = () => setEditKind(null);

  const saveEdit = async () => {
    try {
      if (editKind === 'feed' && lastFeed) {
        const body: any = {
          time: hmToIso(editTime),
          type: editFeedKind,
        };
        if (editFeedKind === 'BREAST') {
          body.side = editFeedSide;
          body.amount = null;
          body.unitAbbr = null;
          body.bottleType = '';
        } else {
          const amt = parseFloat(editFeedAmount);
          body.amount = Number.isNaN(amt) ? null : amt;
          body.unitAbbr = editFeedUnit;
          body.side = null;
          body.bottleType = editFeedBottleType;
        }
        await api(`/api/feed-log?id=${lastFeed.id}`, { method: 'PUT', body: JSON.stringify(body) });
        pushToast(t('Saved'), 'ok', { ms: 2000 });
      } else if (editKind === 'diaper' && lastDiaper) {
        const body = { time: hmToIso(editTime), type: editDiaperType };
        await api(`/api/diaper-log?id=${lastDiaper.id}`, { method: 'PUT', body: JSON.stringify(body) });
        pushToast(t('Saved'), 'ok', { ms: 2000 });
      }
      closeEdit();
      await refreshStatus();
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 4000 });
    }
  };

  const deleteEdit = async () => {
    // Strip server-managed fields so we can re-POST the body verbatim on Undo.
    const cleanForRePost = (rec: any) => {
      if (!rec) return rec;
      const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, caretakerId: _k, familyId: _f, ...rest } = rec;
      return rest;
    };
    try {
      if (editKind === 'feed' && lastFeed) {
        // Snapshot the full record before deleting so Undo can recreate it.
        const full = await api<any>(`/api/feed-log?id=${lastFeed.id}`);
        const body = cleanForRePost(full);
        await api(`/api/feed-log?id=${lastFeed.id}`, { method: 'DELETE' });
        setLastFeed(null);
        closeEdit();
        let toastId = 0;
        toastId = pushToast(t('Deleted'), 'ok', {
          ms: 5000, undoable: true,
          onUndo: async () => {
            removeToast(toastId);
            try {
              await api('/api/feed-log', { method: 'POST', body: JSON.stringify(body) });
              pushToast(t('undone'), 'ok', { ms: 1500 });
              await refreshStatus();
            } catch (e: any) {
              pushToast(e.message || t('undo failed'), 'err', { ms: 4000 });
            }
          },
        });
      } else if (editKind === 'diaper' && lastDiaper) {
        const full = await api<any>(`/api/diaper-log?id=${lastDiaper.id}`);
        const body = cleanForRePost(full);
        await api(`/api/diaper-log?id=${lastDiaper.id}`, { method: 'DELETE' });
        setLastDiaper(null);
        closeEdit();
        let toastId = 0;
        toastId = pushToast(t('Deleted'), 'ok', {
          ms: 5000, undoable: true,
          onUndo: async () => {
            removeToast(toastId);
            try {
              await api('/api/diaper-log', { method: 'POST', body: JSON.stringify(body) });
              pushToast(t('undone'), 'ok', { ms: 1500 });
              await refreshStatus();
            } catch (e: any) {
              pushToast(e.message || t('undo failed'), 'err', { ms: 4000 });
            }
          },
        });
      }
      await refreshStatus();
    } catch (e: any) {
      pushToast(e.message || 'error', 'err', { ms: 4000 });
    }
  };

  // --- topbar ---
  const goFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch { /* WebView may not support */ }
  };
  const goHome = () => router.push(`/${slug}/log-entry`);

  if (!authChecked) {
    return (
      <div className="nursery-kiosk" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--ink-dim)' }}>{t('Loading')}…</div>
      </div>
    );
  }

  const babyName = selectedBaby?.firstName || babies[0]?.firstName || '';
  const hasMultipleBabies = babies.length > 1;

  return (
    <div className="nursery-kiosk">
      <div className="nk-header">
        <div className="nk-clock">{clock}</div>
        <div className="nk-topright">
          <button
            type="button"
            className="nk-name"
            onClick={() => hasMultipleBabies && setBabyMenuOpen((v) => !v)}
            disabled={!hasMultipleBabies}
            title={hasMultipleBabies ? t('Switch baby') : babyName}
          >
            {babyName}{hasMultipleBabies ? ' ▾' : ''}
          </button>
          <button type="button" className="nk-iconbtn" onClick={goFull} title={t('Fullscreen')}>⛶</button>
          <button type="button" className="nk-iconbtn" onClick={goHome} title={t('Open full app')}>⌂</button>
        </div>
      </div>

      {babyMenuOpen && hasMultipleBabies && (
        <div className="nk-babymenu" role="menu">
          {babies.map((b) => (
            <button
              key={b.id}
              type="button"
              className={selectedBaby?.id === b.id ? 'on' : ''}
              onClick={() => { setSelectedBaby(b as any); setBabyMenuOpen(false); }}
            >
              {b.firstName}
            </button>
          ))}
        </div>
      )}

      <div className="nk-since">
        {lastFeed && (
          <button type="button" className="nk-badge" onClick={() => openEdit('feed')}>
            {t('fed')} {fmtAgo(lastFeed.time)}
          </button>
        )}
        {lastDiaper && (
          <button type="button" className="nk-badge" onClick={() => openEdit('diaper')}>
            {t('diaper')} {fmtAgo(lastDiaper.time)}
          </button>
        )}
      </div>

      <h2 className="nk-h2">{t('Feed')}</h2>
      <div className="nk-grid">
        <button
          type="button"
          className={'nk-btn' + (openBreast?.side === 'LEFT' ? ' active' : '')}
          onClick={() => { void tapBreast('LEFT'); }}
        >
          {t('Breast L')}{openBreast?.side === 'LEFT' ? ' · ' + fmtElapsed(openBreast.startTime) : ''}
        </button>
        <button
          type="button"
          className={'nk-btn' + (openBreast?.side === 'RIGHT' ? ' active' : '')}
          onClick={() => { void tapBreast('RIGHT'); }}
        >
          {t('Breast R')}{openBreast?.side === 'RIGHT' ? ' · ' + fmtElapsed(openBreast.startTime) : ''}
        </button>
        <button type="button" className="nk-btn" onClick={openBottle}>{t('Bottle')}…</button>
      </div>

      <h2 className="nk-h2">{t('Diaper')}</h2>
      <div className="nk-grid">
        <button type="button" className="nk-btn" onClick={() => commitDiaper('WET', t('Diaper wet'))}>{t('Wet')}</button>
        <button type="button" className="nk-btn" onClick={() => commitDiaper('DIRTY', t('Diaper dirty'))}>{t('Dirty')}</button>
        <button type="button" className="nk-btn" onClick={() => commitDiaper('BOTH', t('Diaper both'))}>{t('Both')}</button>
      </div>

      <div className="nk-grid two nk-h-grid">
        <h2 className="nk-h2">{t('Sleep')}</h2>
        <h2 className="nk-h2">{t('Pump')}</h2>
      </div>
      <div className="nk-grid two">
        <button
          type="button"
          className={'nk-btn' + (openSleep ? ' active' : '')}
          onClick={openSleep ? endSleep : startSleep}
        >
          {openSleep ? t('End Sleep') : t('Start Nap')}
        </button>
        <button
          type="button"
          className={'nk-btn' + (openPump ? ' active' : '')}
          onClick={openPump ? endPump : startPump}
        >
          {openPump ? t('End Pump') : t('Start Pump')}
        </button>
      </div>

      {hueButtons.length > 0 && (
        <>
          <h2 className="nk-h2">{t('Scenes')}</h2>
          <div className="nk-scenes" role="group" aria-label={t('Nursery scenes')}>
            {hueButtons.map((btn) => (
              <button
                key={btn.id}
                type="button"
                className={'nk-scene-btn' + (hueBusy === btn.id ? ' busy' : '')}
                onClick={() => activateScene(btn)}
                disabled={hueBusy !== null && hueBusy !== btn.id}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="nk-status">
        <span className="text">{statusMsg}</span>
        <span className="batt">{batt}</span>
      </div>

      <div className="nk-toasts">
        {toasts.map((tt) => (
          <div key={tt.id} className={'nk-toast ' + tt.kind} style={{ ['--ms' as any]: tt.ms + 'ms' }}>
            <div className="lbl">{tt.label}</div>
            {tt.undoable ? (
              <button type="button" className="undo" onClick={() => tt.onUndo?.()}>{t('Undo')}</button>
            ) : <span />}
            <span className="bar" />
          </div>
        ))}
      </div>

      {bottleOpen && (
        <div className="nk-modal">
          <div className="nk-sheet">
            <h3>{t('Bottle Feed')}</h3>
            <div className="nk-amount-row">
              <div className="nk-amount">{bottleAmount}</div>
              <div className="nk-unit-picker">
                <button type="button" className={bottleUnit === 'OZ' ? 'on' : ''} onClick={() => setBottleUnit('OZ')}>oz</button>
                <button type="button" className={bottleUnit === 'ML' ? 'on' : ''} onClick={() => setBottleUnit('ML')}>mL</button>
              </div>
            </div>
            <div className="nk-types">
              {BOTTLE_TYPES.map((bt) => (
                <button key={bt} type="button" className={'nk-chip' + (bottleType === bt ? ' on' : '')} onClick={() => setBottleType(bt)}>
                  {t(bt === 'breast milk' ? 'Breast milk' : bt === 'formula' ? 'Formula' : bt === 'milk' ? 'Milk' : 'Other')}
                </button>
              ))}
            </div>
            <div className="nk-numpad">
              {['1','2','3','4','5','6','7','8','9','.','0','bs'].map((n) => (
                <button key={n} type="button" onClick={() => bottlePad(n)}>{n === 'bs' ? '⌫' : n}</button>
              ))}
            </div>
            <div className="nk-modal-actions">
              <button type="button" onClick={closeBottle}>{t('Cancel')}</button>
              <button type="button" className="primary" onClick={submitBottle}>{t('Log Bottle')}</button>
            </div>
          </div>
        </div>
      )}

      {editKind === 'feed' && lastFeed && (
        <div className="nk-modal">
          <div className="nk-sheet">
            <h3>{t('Edit feed')}</h3>
            <div className="nk-field">
              <label>{t('Time')}</label>
              <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
            </div>
            <div className="nk-field">
              <label>{t('Type')}</label>
              <div className="nk-row">
                <button type="button" className={'nk-chip' + (editFeedKind === 'BREAST' ? ' on' : '')} onClick={() => setEditFeedKind('BREAST')}>{t('Breast')}</button>
                <button type="button" className={'nk-chip' + (editFeedKind === 'BOTTLE' ? ' on' : '')} onClick={() => setEditFeedKind('BOTTLE')}>{t('Bottle')}</button>
              </div>
            </div>
            {editFeedKind === 'BREAST' ? (
              <div className="nk-field">
                <label>{t('Side')}</label>
                <div className="nk-row">
                  <button type="button" className={'nk-chip' + (editFeedSide === 'LEFT' ? ' on' : '')} onClick={() => setEditFeedSide('LEFT')}>{t('Left')}</button>
                  <button type="button" className={'nk-chip' + (editFeedSide === 'RIGHT' ? ' on' : '')} onClick={() => setEditFeedSide('RIGHT')}>{t('Right')}</button>
                </div>
              </div>
            ) : (
              <>
                <div className="nk-field">
                  <label>{t('Amount')}</label>
                  <div className="nk-amount-row">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={editFeedAmount}
                      onChange={(e) => setEditFeedAmount(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <div className="nk-unit-picker">
                      <button type="button" className={editFeedUnit === 'OZ' ? 'on' : ''} onClick={() => setEditFeedUnit('OZ')}>oz</button>
                      <button type="button" className={editFeedUnit === 'ML' ? 'on' : ''} onClick={() => setEditFeedUnit('ML')}>mL</button>
                    </div>
                  </div>
                </div>
                <div className="nk-field">
                  <label>{t('Bottle type')}</label>
                  <div className="nk-types">
                    {BOTTLE_TYPES.map((bt) => (
                      <button key={bt} type="button" className={'nk-chip' + (editFeedBottleType === bt ? ' on' : '')} onClick={() => setEditFeedBottleType(bt)}>
                        {t(bt === 'breast milk' ? 'Breast milk' : bt === 'formula' ? 'Formula' : bt === 'milk' ? 'Milk' : 'Other')}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div className="nk-modal-actions three">
              <button type="button" onClick={closeEdit}>{t('Cancel')}</button>
              <button type="button" className="danger" onClick={deleteEdit}>{t('Delete')}</button>
              <button type="button" className="primary" onClick={saveEdit}>{t('Save')}</button>
            </div>
          </div>
        </div>
      )}

      {editKind === 'diaper' && lastDiaper && (
        <div className="nk-modal">
          <div className="nk-sheet">
            <h3>{t('Edit diaper')}</h3>
            <div className="nk-field">
              <label>{t('Time')}</label>
              <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
            </div>
            <div className="nk-field">
              <label>{t('Type')}</label>
              <div className="nk-row">
                {(['WET', 'DIRTY', 'BOTH'] as const).map((dt) => (
                  <button key={dt} type="button" className={'nk-chip' + (editDiaperType === dt ? ' on' : '')} onClick={() => setEditDiaperType(dt)}>
                    {t(dt === 'WET' ? 'Wet' : dt === 'DIRTY' ? 'Dirty' : 'Both')}
                  </button>
                ))}
              </div>
            </div>
            <div className="nk-modal-actions three">
              <button type="button" onClick={closeEdit}>{t('Cancel')}</button>
              <button type="button" className="danger" onClick={deleteEdit}>{t('Delete')}</button>
              <button type="button" className="primary" onClick={saveEdit}>{t('Save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default NurseryMode;
