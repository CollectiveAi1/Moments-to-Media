/** Design tokens from the approved prototype (CLAUDE.md "Design tokens"). */
export const color = {
  background: '#F7F4EF',
  surface: '#FFFDF9',
  chip: '#EFEAE2',
  border: '#D9D2C7',
  divider: '#E6E0D6',
  text: '#1F1F1F',
  textSecondary: '#3F3B35',
  textMuted: '#6B655A',
  buttonPrimary: '#1F1F1F',
  buttonPrimaryText: '#FFFDF9',
  adminAccent: '#7A7059',
  progressFill: '#6E7360',
  positiveText: '#5B6A4A',
  positiveBackground: '#EEF0E9',
  attentionText: '#9C5F5F',
  attentionBorder: '#D4A5A5',
} as const;

export const font = {
  heading: 'Cinzel',
  label: 'Montserrat',
  body: 'Lato',
} as const;

/** Accessibility floors: 44px touch targets, 4.5:1 text contrast. */
export const a11y = { minTouchTarget: 44, minTextContrast: 4.5 } as const;
