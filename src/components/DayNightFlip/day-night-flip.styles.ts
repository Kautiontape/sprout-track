export const flipStyles = {
  page: 'relative isolate flex flex-col gap-4 p-4 max-w-2xl mx-auto w-full',
  // day -> night gradient accent
  banner: {
    base: 'flip-now-banner rounded-xl border-2 p-4 shadow-md',
    day: 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-400 text-amber-950',
    night: 'bg-gradient-to-br from-indigo-950 to-slate-900 border-indigo-400 text-indigo-50',
    eyebrow: 'font-mono text-xs uppercase tracking-widest opacity-70',
    label: 'text-xl font-semibold mt-1',
    action: 'mt-2 text-base leading-snug',
    overrideRow: 'mt-4 flex flex-wrap gap-2',
  },
  timers: {
    grid: 'grid grid-cols-2 sm:grid-cols-3 gap-3',
    card: 'flip-timer-card rounded-lg border border-gray-200 bg-white p-3 shadow-sm',
    label: 'text-xs text-gray-500',
    value: 'font-mono text-2xl mt-1 tabular-nums',
    ok: 'text-emerald-600',
    warn: 'text-amber-600',
    over: 'text-red-600',
    sub: 'text-xs text-gray-400 mt-1',
  },
  rules: {
    wrap: 'flex flex-wrap gap-2',
    chip: 'flip-rule-chip inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium cursor-pointer bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100',
    chipOpen: 'bg-teal-50 border-teal-400 text-teal-800',
    why: 'flip-rule-why mt-2 rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700',
  },
  escalation: {
    banner: 'rounded-lg border-2 border-red-400 bg-red-50 p-3 text-sm text-red-800 font-medium',
    reference: 'flip-escalation-reference text-xs text-gray-500 mt-2',
    disclaimer: 'flip-disclaimer text-center text-xs text-gray-400 py-4',
  },
  nudge: 'flip-nudge rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900',
  section: 'flex flex-col gap-2',
  sectionTitle: 'flip-section-title text-sm font-semibold text-gray-600',
} as const;
