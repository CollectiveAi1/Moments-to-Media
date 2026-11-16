import { color, font, radius } from '@mtm/shared';
import type { CSSProperties } from 'react';

export { color, radius };

/**
 * Font stacks. The first entry is the variable next/font defines in
 * app/layout.tsx; the family name from the tokens is the fallback if that
 * variable is ever missing.
 */
export const fonts = {
  heading: `var(--font-heading), '${font.heading}', serif`,
  label: `var(--font-label), '${font.label}', sans-serif`,
  body: `var(--font-body), '${font.body}', system-ui, sans-serif`,
} as const;

/** UI-SPEC section 3, `Card`: surface, 1px border. */
export const card = (r: number = radius.lg): CSSProperties => ({
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: r,
});

/** Status tones used across the admin screens. Always paired with text. */
export type Tone = 'muted' | 'label' | 'warn' | 'positive';

export const toneColor: Record<Tone, string> = {
  muted: color.textMuted,
  label: color.label,
  warn: color.warnText,
  positive: color.positive,
};
