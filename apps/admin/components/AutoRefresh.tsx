'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { color, fonts } from '@/lib/ui';

/**
 * Re-reads the page's server data on an interval, while the tab is visible.
 * WCAG 2.2.2: anything that updates on its own can be paused, so the page
 * shows a small control to stop and restart it.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds, paused]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: color.textMuted }}>
      <span>{paused ? 'Live updates paused.' : `Updates every ${seconds} seconds.`}</span>
      <button
        type="button"
        onClick={() => setPaused(!paused)}
        aria-pressed={paused}
        style={{ minHeight: 32, minWidth: 44, padding: '0 10px', borderRadius: 6, border: `1px solid ${color.inputBorder}`, background: 'transparent', color: color.text, fontFamily: fonts.label, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
      >
        {paused ? 'Resume' : 'Pause'}
      </button>
    </div>
  );
}
