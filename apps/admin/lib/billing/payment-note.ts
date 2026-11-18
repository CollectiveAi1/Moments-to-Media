import { money } from '../money.ts';

const DISPUTE_LABEL: Record<string, string> = {
  won: 'dispute won',
  lost: 'dispute lost',
  warning_closed: 'inquiry closed',
  prevented: 'dispute prevented',
};

/**
 * What happened to a payment after it arrived, from Stripe refunds and
 * disputes, or null if nothing did. Shown next to the payment on invoices.
 */
export function paymentAfterNote(p: {
  amount_cents?: unknown;
  refunded_cents?: unknown;
  disputed_cents?: unknown;
  dispute_status?: unknown;
}): string | null {
  const notes: string[] = [];
  const amount = Number(p.amount_cents ?? 0);
  const refunded = Number(p.refunded_cents ?? 0);
  if (refunded > 0) notes.push(refunded >= amount ? 'Refunded in full' : `${money(refunded)} refunded`);
  if (p.dispute_status) {
    const status = String(p.dispute_status);
    const held = Number(p.disputed_cents ?? 0);
    notes.push(DISPUTE_LABEL[status] ? `Card ${DISPUTE_LABEL[status]}` : `Card dispute open${held > 0 ? `, ${money(held)} held` : ''}`);
  }
  return notes.length ? notes.join(' · ') : null;
}
