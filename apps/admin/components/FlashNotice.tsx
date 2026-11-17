'use client';

import { useEffect, useState } from 'react';
import { color, radius } from '@/lib/ui';

/** Shows the last action's success message, then clears it. */
export function FlashNotice({ message }: { message: string | null }) {
  const [shown, setShown] = useState(message);
  useEffect(() => {
    setShown(message);
    if (!message) return;
    document.cookie = 'mtm_flash=; path=/; max-age=0; samesite=lax';
    const t = window.setTimeout(() => setShown(null), 7000);
    return () => window.clearTimeout(t);
  }, [message]);
  if (!shown) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
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
      <button type="button" onClick={() => setShown(null)} aria-label="Dismiss" style={{ background: 'transparent', border: 0, color: color.positiveStrong, fontSize: 18, lineHeight: 1, cursor: 'pointer', minWidth: 24, minHeight: 24 }}>
        ×
      </button>
    </div>
  );
}
