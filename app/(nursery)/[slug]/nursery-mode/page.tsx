'use client';

import { Suspense } from 'react';
import { NurseryMode } from '@/src/components/NurseryMode';

export default function NurseryModePage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a1a]">
          <div className="text-white/50 text-sm">Loading...</div>
        </div>
      }
    >
      <NurseryMode />
    </Suspense>
  );
}
