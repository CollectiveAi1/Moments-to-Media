'use client';

import { useEffect, useState } from 'react';
import { color, radius } from '@/lib/ui';

/** Shows the last action's success message until it is dismissed. */
export function FlashNotice({ message }: { message: string | null }) {
  const [shown, setShown] = useState(message);
  useEffect(() => {
    setShown(message);
    if (!message) return;
    // Stays until dismissed or the next page: a message that vanishes on a
    // timer can be gone before someone has read it (WCAG 2.2.1).
    document.cookie = 'mtm_flash=; path=/; max-age=0; samesite=lax';
  }, [message]);
  if (!shown) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        // In the page flow, not floating over it, so it never covers the
        // element that has keyboard focus (WCAG 2.4.11).
        position: 'relative',
        margin: '12px auto',
        width: 'fit-content',
        maxWidth: 'min(560px, calc(100vw - 32px))',
        padding: '12px 16px',
        borderRadius: radius.md,
        border: `1px solid ${color.positiveBorder}`,
        background: color.positiveBg,
        color: color.positiveStrong,
        fontSize: 14,
        lineHeight: 1.45,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <span>{shown}</span>
      <button type="button" onClick={() => setShown(null)} aria-label="Dismiss" style={{ background: 'transparent', border: 0, color: color.positiveStrong, fontSize: 18, lineHeight: 1, cursor: 'pointer', minWidth: 32, minHeight: 32 }}>
        ×
      </button>
    </div>
  );
}
