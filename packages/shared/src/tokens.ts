/**
 * Design tokens. The source is docs/ui/UI-SPEC.md section 1, which is taken
 * from the approved prototype in docs/ui/prototype. Components use these and
 * nothing else: no raw hex values, radii or font names in a component
 * (UI-SPEC "Acceptance checklist", first item).
 *
 * Light theme only. There is no dark mode in v1.
 */
export const color = {
  bg: '#F7F4EF', // app background
  surface: '#FFFDF9', // cards, tab bar, sidebar
  surfaceAlt: '#EFEAE2', // chips, secondary buttons, avatar, active sidebar item
  border: '#D9D2C7', // card borders and dividers (decorative)
  inputBorder: '#857D6E', // form field and control outlines: 4:1 on surface (WCAG 1.4.11)
  divider: '#E6E0D6', // list row dividers, progress track, disabled fills
  text: '#1F1F1F',
  textSecondary: '#3F3B35',
  textBody: '#2E2B27', // long-form paragraphs
  textMuted: '#6B655A',
  primary: '#1F1F1F', // primary buttons
  onPrimary: '#FFFDF9',
  label: '#70664F', // eyebrow labels, links, admin accent (darkened from #7A7059 for 4.5:1 text contrast, WCAG 1.4.3)
  labelHover: '#5C5443',
  done: '#666B58', // checked boxes, booked days, progress fill
  checkboxBorder: '#8A8273', // 3.7:1 on surface (WCAG 1.4.11)
  positive: '#5B6A4A',
  positiveBg: '#EEF0E9',
  positiveBorder: '#C9CEBF',
  positiveStrong: '#3F4A33',
  attention: '#935757', // deadlines, warnings, must-have label (4.5:1 on every background)
  attentionBorder: '#D4A5A5',
  // admin status tags
  dangerBg: '#F6E4E2',
  dangerText: '#8E3B3B',
  warnBg: '#F5E9E4',
  warnText: '#8A5543',
  warnBorder: '#E6CFC6',
  adminBg: '#F7F4EF',
  adminRowDivider: '#ECE6DC',
} as const;

export const font = {
  heading: 'Cinzel', // 600; h1 24-28, h2 22, big numbers 40
  label: 'Montserrat', // 500/600; eyebrows, buttons, tabs, chips
  body: 'Lato', // 400/700; everything else
} as const;

export const radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  xxl: 16,
  pill: 18,
  round: 22,
} as const;

export const space = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32] as const;

/**
 * Fills and borders only. Pale sage and pale rose are on the client's brand
 * board but fail 4.5:1 as text on the cream background.
 */
export const brandFillOnly = { sage: '#B6BCAD', rose: '#D4A5A5' } as const;

/** Accessibility floors: 44px touch targets, 4.5:1 text contrast. */
export const a11y = { minTouchTarget: 44, minTextContrast: 4.5 } as const;

/** Icons are line icons on a 24 grid at this stroke width (lucide). */
export const icon = { strokeWidth: 1.8 } as const;
