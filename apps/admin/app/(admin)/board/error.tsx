'use client';

import { card, color, fonts, radius } from '@/lib/ui';

export default function BoardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" style={{ ...card(radius.lg), borderColor: color.warnBorder, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 22, fontWeight: 600 }}>The board could not load</h2>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: color.textBody }}>
        Nothing has been lost. This is usually a dropped connection; try again.
        {error.digest ? ` If it keeps happening, quote reference ${error.digest}.` : ''}
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          alignSelf: 'flex-start',
          height: 44,
          padding: '0 16px',
          borderRadius: radius.sm,
          border: 0,
          background: color.label,
          color: color.surface,
          fontFamily: fonts.label,
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </section>
  );
}
