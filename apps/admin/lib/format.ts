/**
 * Formatting shared by every screen. Times are always written in the event's
 * own time zone (CLAUDE.md rule 5); money is always integer cents in.
 */
export { formatDay, formatTime } from './board/build';
import { formatDay, formatTime } from './board/build';

export { money } from './money.ts';
import { money } from './money.ts';

export function rate(rateType: string, centsAmount: number): string {
  const amount = money(centsAmount);
  if (rateType === 'hourly') return `${amount}/hr`;
  if (rateType === 'day') return `${amount}/day`;
  return `${amount} flat`;
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** "Sat Nov 21, 5:30 PM" in the given zone. */
export function dateTime(iso: string, timeZone: string): string {
  return `${formatDay(iso, timeZone)}, ${formatTime(iso, timeZone)}`;
}

/** "5:30 PM – 9 PM". */
export function timeRange(startIso: string, endIso: string, timeZone: string): string {
  return `${formatTime(startIso, timeZone)} – ${formatTime(endIso, timeZone)}`;
}

/** Whole hours between two instants, to one decimal place. */
export function hours(startIso: string, endIso: string): string {
  const h = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hours`;
}

/** "2h 15m", "45m", "3 days". Never negative: past instants read as "now". */
export function duration(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 48) return minutes % 60 === 0 ? `${h}h` : `${h}h ${minutes % 60}m`;
  return `${Math.round(h / 24)} days`;
}

// ------------------------------------------------- zoned date and time inputs

function zoneParts(date: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = zoneParts(date, timeZone);
  const asUtc = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * A wall-clock date and time in a zone, as a UTC instant: what a producer
 * types into "Date" and "Call time" for an event in Phoenix means Phoenix
 * time, whatever zone their own laptop is in.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  let utc = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  // Near a DST change the first guess can land on the wrong side of it.
  const second = guess - offsetMinutes(new Date(utc), timeZone) * 60_000;
  if (second !== utc) utc = second;
  return new Date(utc);
}

/** The reverse, for filling an edit form: { date: '2026-11-21', time: '17:30' }. */
export function utcToZoned(iso: string, timeZone: string): { date: string; time: string } {
  const p = zoneParts(new Date(iso), timeZone);
  const pad = (n: number | undefined) => String(n ?? 0).padStart(2, '0');
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour === 24 ? 0 : p.hour)}:${pad(p.minute)}`,
  };
}

/** The calendar date of an instant in a zone, as YYYY-MM-DD. */
export function zonedDate(iso: string, timeZone: string): string {
  return utcToZoned(iso, timeZone).date;
}

export const TIME_ZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
];

// ------------------------------------------------------------------ statuses

export type Tone = 'muted' | 'label' | 'warn' | 'positive' | 'danger';

export const EVENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  staffing: { label: 'Staffing', tone: 'label' },
  staffed: { label: 'Staffed', tone: 'positive' },
  in_progress: { label: 'In progress', tone: 'label' },
  uploaded: { label: 'Uploaded', tone: 'label' },
  complete: { label: 'Complete', tone: 'positive' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export const ASSIGNMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  invited: { label: 'Invited', tone: 'warn' },
  interested: { label: 'Interested', tone: 'label' },
  selected: { label: 'Selected', tone: 'warn' },
  confirmed: { label: 'Confirmed', tone: 'positive' },
  checked_in: { label: 'Checked in', tone: 'positive' },
  checked_out: { label: 'Checked out', tone: 'label' },
  uploaded: { label: 'Uploaded', tone: 'label' },
  changes_requested: { label: 'Changes requested', tone: 'warn' },
  approved: { label: 'Approved', tone: 'positive' },
  paid: { label: 'Paid', tone: 'positive' },
  declined: { label: 'Declined', tone: 'muted' },
  not_selected: { label: 'Not selected', tone: 'muted' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  dropped: { label: 'Dropped', tone: 'danger' },
};

export const PAYOUT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  submitted: { label: 'Awaiting approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'label' },
  sent: { label: 'Sent', tone: 'label' },
  paid: { label: 'Paid', tone: 'positive' },
  failed: { label: 'Failed', tone: 'danger' },
  reversed: { label: 'Reversed', tone: 'danger' },
};

export const LEAD_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'warn' },
  contacted: { label: 'Contacted', tone: 'label' },
  proposal_sent: { label: 'Proposal sent', tone: 'label' },
  booked: { label: 'Booked', tone: 'positive' },
  lost: { label: 'Lost', tone: 'muted' },
};

export const PROPOSAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  sent: { label: 'Sent', tone: 'label' },
  viewed: { label: 'Viewed', tone: 'warn' },
  accepted: { label: 'Signed', tone: 'positive' },
  declined: { label: 'Declined', tone: 'danger' },
  void: { label: 'Void', tone: 'muted' },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  open: { label: 'Open', tone: 'warn' },
  partially_paid: { label: 'Partly paid', tone: 'label' },
  paid: { label: 'Paid', tone: 'positive' },
  void: { label: 'Void', tone: 'muted' },
};

export const PAYMENT_METHOD: Record<string, string> = {
  card: 'Card',
  ach: 'Bank (ACH)',
  check: 'Check',
  cash: 'Cash',
  bank_transfer: 'Bank transfer / Zelle',
  other: 'Other',
};

export { paymentAfterNote } from './billing/payment-note.ts';

/** Statuses that mean the contractor is booked on the slot. */
export const COMMITTED = [
  'confirmed', 'checked_in', 'checked_out', 'uploaded', 'changes_requested', 'approved', 'paid',
] as const;

export const isCommitted = (status: string) => (COMMITTED as readonly string[]).includes(status);

export const firstName = (fullName: string | null | undefined) =>
  (fullName ?? '').trim().split(/\s+/)[0] || 'there';

export const initials = (fullName: string | null | undefined) =>
  (fullName ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('') || '?';
