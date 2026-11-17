/**
 * Which installments of an invoice are paid. Payments are not matched to an
 * installment by hand: money received pays the earliest-due installment
 * first, the same rule the portal and the console both show.
 */
export interface Installment {
  id: string;
  label: string;
  amountCents: number;
  /** YYYY-MM-DD */
  dueOn: string;
}

export type InstallmentState = 'paid' | 'partly_paid' | 'overdue' | 'due' | 'upcoming';

export interface ScheduledInstallment extends Installment {
  paidCents: number;
  remainingCents: number;
  state: InstallmentState;
}

export function allocate(installments: Installment[], paidCents: number, today: string): ScheduledInstallment[] {
  let left = Math.max(0, paidCents);
  return [...installments]
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.label.localeCompare(b.label))
    .map((i) => {
      const paid = Math.min(i.amountCents, left);
      left -= paid;
      const remaining = i.amountCents - paid;
      const state: InstallmentState =
        remaining === 0 ? 'paid' : i.dueOn < today ? 'overdue' : i.dueOn === today ? 'due' : paid > 0 ? 'partly_paid' : 'upcoming';
      return { ...i, paidCents: paid, remainingCents: remaining, state };
    });
}

/** What the client should pay now: everything due today or earlier, else the next installment. */
export function amountDueNow(schedule: ScheduledInstallment[]): { cents: number; label: string } | null {
  const owing = schedule.filter((i) => i.remainingCents > 0);
  if (owing.length === 0) return null;
  const due = owing.filter((i) => i.state === 'overdue' || i.state === 'due');
  if (due.length) {
    return { cents: due.reduce((n, i) => n + i.remainingCents, 0), label: due.length === 1 ? (due[0] as ScheduledInstallment).label : 'Amount due now' };
  }
  const next = owing[0] as ScheduledInstallment;
  return { cents: next.remainingCents, label: next.label };
}

/** A schedule for an invoice: a deposit today and the balance on a date, or one payment. */
export function splitDeposit(totalCents: number, depositPercent: number): { deposit: number; balance: number } {
  const pct = Math.min(100, Math.max(0, Math.round(depositPercent)));
  const deposit = Math.round((totalCents * pct) / 100);
  return { deposit, balance: totalCents - deposit };
}

/** Today in an IANA zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export interface PricedItem {
  priceCents: number;
  quantity: number;
  optional: boolean;
  selected: boolean;
}

/**
 * Totals for a proposal, with the same rounding as app.proposal_totals in the
 * database, so the live total the client sees while picking add-ons is the
 * total they are invoiced.
 */
export function proposalTotals(items: PricedItem[], discountCents: number, taxRateBp: number, depositPercent: number) {
  const subtotal = items.filter((i) => i.selected || !i.optional).reduce((n, i) => n + i.priceCents * i.quantity, 0);
  const base = Math.max(subtotal - discountCents, 0);
  const tax = Math.round((base * taxRateBp) / 10000);
  const total = base + tax;
  return { subtotal, discount: subtotal - base, tax, total, deposit: Math.round((total * depositPercent) / 100) };
}
