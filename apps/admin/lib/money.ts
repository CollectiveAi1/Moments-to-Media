/** Dollars from integer cents (CLAUDE.md rule 5): "$2,500", or "$12.50" when there are cents. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
