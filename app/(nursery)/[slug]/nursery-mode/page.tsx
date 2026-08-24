'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect, useState } from 'react';

// Which nursery implementation renders. Ours is the default; upstream's is kept
// available so its ideas can be evaluated in place rather than reconstructed
// from a changelog. Device-local, matching upstream's own per-device nursery
// personalization — no schema change, no migration.
const NURSERY_VARIANT_KEY = 'nurseryModeVariant';

type NurseryVariant = 'ktn' | 'upstream';

function NurseryFallback() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a1a]">
      <div className="text-white/50 text-sm">Loading...</div>
    </div>
  );
}

const KtnNurseryMode = dynamic(
  () => import('@/src/components/NurseryMode').then((m) => m.NurseryMode),
  { ssr: false, loading: NurseryFallback }
);

const UpstreamNurseryMode = dynamic(
  () => import('@/src/components/features/nursery-mode/NurseryModeContainer').then((m) => m.NurseryModeContainer),
  { ssr: false, loading: NurseryFallback }
);

export default function NurseryModePage() {
  const [variant, setVariant] = useState<NurseryVariant | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('nursery');
    if (requested === 'upstream' || requested === 'ktn') {
      localStorage.setItem(NURSERY_VARIANT_KEY, requested);
    }
    setVariant(localStorage.getItem(NURSERY_VARIANT_KEY) === 'upstream' ? 'upstream' : 'ktn');
  }, []);

  return (
    <Suspense fallback={<NurseryFallback />}>
      {variant === null ? (
        <NurseryFallback />
      ) : variant === 'upstream' ? (
        <UpstreamNurseryMode />
      ) : (
        <KtnNurseryMode />
      )}
    </Suspense>
  );
}
