'use client';

import { useState } from 'react';
import { color, fonts, radius } from '@/lib/ui';

/** UI-SPEC `RatingButtons`: five squares, filled up to the score. */
export function RatingPicker({ name, label, initial }: { name: string; label: string; initial: number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <legend style={{ fontSize: 14, minWidth: 120, float: 'left', paddingTop: 8 }}>{label}</legend>
      <input type="hidden" name={name} value={value ?? ''} />
      <div style={{ display: 'flex', gap: 6 }} role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value !== null && n <= value;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} of 5`}
              onClick={() => setValue(n)}
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.xs,
                border: `1px solid ${on ? color.text : color.border}`,
                background: on ? color.text : color.surface,
                color: on ? color.surface : color.textSecondary,
                fontFamily: fonts.label,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
