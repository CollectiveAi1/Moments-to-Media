/**
 * Turns events, slots and assignments into the Operations board
 * (docs/ui/UI-SPEC.md section 5.1, PRD "Admin console").
 *
 * Pure on purpose: no database, no clock of its own, no React. What counts as
 * "needs attention" is a set of rules a producer will argue with, so they live
 * where they can be read in one place and tested without seeding anything.
 */

export type EventStatus = 'draft' | 'staffing' | 'staffed' | 'in_progress' | 'uploaded' | 'complete';

export interface AssignmentRow {
  id: string;
  userId: string;
  status: string;
  confirmDeadline: string | null;
  /** Shot list items this person has marked captured. */
  capturedShotIds: string[];
}

export interface SlotRow {
  id: string;
  role: string;
  staffingMode: 'direct_invite' | 'open_call';
  status: string;
  isRequired: boolean;
  callTime: string;
  /** The earliest deliverable due on this slot, if it has any. */
  earliestDueAt: string | null;
  assignments: AssignmentRow[];
}

export interface EventRow {
  id: string;
  title: string;
  status: EventStatus;
  startsAt: string;
  timeZone: string;
  producerId: string;
  hasBrief: boolean;
  shotIds: string[];
  slots: SlotRow[];
}

export type Tone = 'muted' | 'label' | 'warn' | 'positive';
export interface CardLine {
  text: string;
  tone: Tone;
}
export interface Card {
  id: string;
  title: string;
  meta: string;
  lines: CardLine[];
  /** Something on this card is waiting on the producer. */
  actionable: boolean;
}
export interface Column {
  status: EventStatus;
  label: string;
  /** Every event in the column, including any not drawn. */
  count: number;
  cards: Card[];
}
export interface AttentionItem {
  key: string;
  tone: 'danger' | 'warn';
  text: string;
}
export interface Board {
  columns: Column[];
  attention: AttentionItem[];
  activeCount: number;
}

export const COLUMNS: ReadonlyArray<{ status: EventStatus; label: string }> = [
  { status: 'draft', label: 'Draft' },
  { status: 'staffing', label: 'Staffing' },
  { status: 'staffed', label: 'Staffed' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'uploaded', label: 'Uploaded' },
  { status: 'complete', label: 'Complete' },
];

/** A confirm commits the contractor; everything from there on counts as booked. */
const COMMITTED = new Set([
  'confirmed', 'checked_in', 'checked_out', 'uploaded', 'changes_requested', 'approved', 'paid',
]);
const ON_SITE = new Set([
  'checked_in', 'checked_out', 'uploaded', 'changes_requested', 'approved', 'paid',
]);
const UPLOADED = new Set(['uploaded', 'changes_requested', 'approved', 'paid']);
/** Booked, and the footage has not arrived yet. */
const OWES_UPLOAD = new Set(['confirmed', 'checked_in', 'checked_out']);

const HOUR = 60 * 60 * 1000;
/** A missed call time stops being today's problem after this long. */
const NO_SHOW_WINDOW = 24 * HOUR;
/** The Complete column is history; show the most recent and count the rest. */
const COMPLETE_SHOWN = 8;
const MAX_LINES = 2;

// ------------------------------------------------------------------ dates

function parts(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone, ...options }).formatToParts(
    new Date(iso),
  )) {
    out[p.type] = p.value;
  }
  return out;
}

/** "Thu Nov 12", in the event's own time zone (CLAUDE.md rule 5). */
export function formatDay(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${p.weekday} ${p.month} ${p.day}`;
}

/** "5:30 PM", or "9 PM" on the hour. */
export function formatTime(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true });
  const minutes = p.minute === '00' ? '' : `:${p.minute}`;
  return `${p.hour}${minutes} ${p.dayPeriod}`;
}

function sameDay(a: string, b: string, timeZone: string): boolean {
  const key = (iso: string) => {
    const p = parts(iso, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
    return `${p.year}-${p.month}-${p.day}`;
  };
  return key(a) === key(b);
}

function dayOrToday(event: EventRow, now: Date): string {
  if (!sameDay(event.startsAt, now.toISOString(), event.timeZone)) {
    return formatDay(event.startsAt, event.timeZone);
  }
  const hour = Number(parts(event.startsAt, event.timeZone, { hour: 'numeric', hour12: false }).hour);
  return hour >= 17 ? 'Tonight' : 'Today';
}

// ------------------------------------------------------------------ rules

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function liveSlots(event: EventRow): SlotRow[] {
  return event.slots.filter((s) => s.status !== 'cancelled');
}

/** The slots that have to be filled for the event to count as staffed. */
function slotsToFill(event: EventRow): SlotRow[] {
  const live = liveSlots(event);
  const required = live.filter((s) => s.isRequired);
  return required.length > 0 ? required : live;
}

const committedOn = (slot: SlotRow) => slot.assignments.filter((a) => COMMITTED.has(a.status));

function isOverdue(slot: SlotRow, assignment: AssignmentRow, now: Date): boolean {
  return (
    OWES_UPLOAD.has(assignment.status) &&
    slot.earliestDueAt !== null &&
    new Date(slot.earliestDueAt).getTime() < now.getTime()
  );
}

type NameOf = (userId: string) => string;

function staffingLines(event: EventRow, now: Date, nameOf: NameOf): CardLine[] {
  const warn: CardLine[] = [];
  const review: CardLine[] = [];
  const quiet: CardLine[] = [];

  for (const slot of slotsToFill(event)) {
    if (committedOn(slot).length > 0) continue;

    const selected = slot.assignments.find((a) => a.status === 'selected');
    if (selected) {
      const due = selected.confirmDeadline;
      const when =
        due === null
          ? 'waiting on a confirm'
          : new Date(due).getTime() < now.getTime()
            ? 'confirm overdue'
            : `confirm due ${formatTime(due, event.timeZone)}`;
      warn.push({ text: `${nameOf(selected.userId)} selected · ${when}`, tone: 'warn' });
      continue;
    }

    const interested = slot.assignments.filter((a) => a.status === 'interested').length;
    const invited = slot.assignments.filter((a) => a.status === 'invited').length;

    if (slot.staffingMode === 'open_call') {
      if (interested > 0) {
        review.push({ text: `${interested} interested in ${slot.role} · review`, tone: 'label' });
      } else {
        quiet.push({ text: `Open call · ${slot.role}`, tone: 'muted' });
      }
    } else if (invited > 0) {
      quiet.push({ text: `${plural(invited, 'invite')} out for ${slot.role}`, tone: 'muted' });
    } else {
      quiet.push({ text: `${slot.role} needs an invite`, tone: 'muted' });
    }
  }

  return [...warn, ...review, ...quiet].slice(0, MAX_LINES);
}

function card(event: EventRow, now: Date, nameOf: NameOf): Card {
  const day = formatDay(event.startsAt, event.timeZone);
  const toFill = slotsToFill(event);
  const filled = toFill.filter((s) => committedOn(s).length > 0).length;
  const committed = liveSlots(event).flatMap((s) => committedOn(s));
  const lines: CardLine[] = [];
  let meta = day;

  switch (event.status) {
    case 'draft': {
      const n = liveSlots(event).length;
      meta = `${day} · ${plural(n, 'slot')}`;
      if (!event.hasBrief) lines.push({ text: 'Brief missing', tone: 'muted' });
      if (n === 0) lines.push({ text: 'No slots yet', tone: 'muted' });
      break;
    }
    case 'staffing':
      meta = `${day} · ${filled} of ${toFill.length} confirmed`;
      lines.push(...staffingLines(event, now, nameOf));
      break;
    case 'staffed':
      meta = `${day} · ${filled} of ${toFill.length} confirmed`;
      break;
    case 'in_progress': {
      const onSite = committed.filter((a) => ON_SITE.has(a.status)).length;
      meta = `${dayOrToday(event, now)} · ${onSite} of ${committed.length} checked in`;
      if (event.shotIds.length > 0) {
        const captured = new Set(committed.flatMap((a) => a.capturedShotIds));
        const done = event.shotIds.filter((id) => captured.has(id)).length;
        lines.push({ text: `Shot list ${done} of ${event.shotIds.length}`, tone: 'muted' });
      }
      break;
    }
    case 'uploaded': {
      const uploaded = committed.filter((a) => UPLOADED.has(a.status)).length;
      meta = `${day} · ${uploaded} of ${committed.length} uploaded`;
      const ready = new Set<string>();
      let overdue = 0;
      for (const slot of liveSlots(event)) {
        for (const a of slot.assignments) {
          if (a.status === 'uploaded') ready.add(slot.role);
          if (isOverdue(slot, a, now)) overdue += 1;
        }
      }
      for (const role of ready) lines.push({ text: `${role} ready for review`, tone: 'label' });
      if (overdue > 0) lines.push({ text: `${overdue} overdue`, tone: 'warn' });
      break;
    }
    case 'complete': {
      const allPaid = committed.length > 0 && committed.every((a) => a.status === 'paid');
      meta = `${day} · ${allPaid ? 'paid' : 'payout pending'}`;
      break;
    }
  }

  const shown = lines.slice(0, MAX_LINES);
  return {
    id: event.id,
    title: event.title,
    meta,
    lines: shown,
    actionable: shown.some((l) => l.tone === 'label'),
  };
}

function attention(events: EventRow[], now: Date, nameOf: NameOf): AttentionItem[] {
  const danger: AttentionItem[] = [];
  const warn: AttentionItem[] = [];

  for (const event of events) {
    if (event.status === 'draft' || event.status === 'complete') continue;

    for (const slot of liveSlots(event)) {
      const sinceCall = now.getTime() - new Date(slot.callTime).getTime();

      for (const a of slot.assignments) {
        // Confirmed, the call time has passed, and they have not checked in.
        if (a.status === 'confirmed' && sinceCall >= 0 && sinceCall <= NO_SHOW_WINDOW) {
          danger.push({
            key: `noshow-${a.id}`,
            tone: 'danger',
            text: `${nameOf(a.userId)} not checked in · ${event.title}, call ${formatTime(slot.callTime, event.timeZone)}`,
          });
        }

        if (a.status === 'selected') {
          const due = a.confirmDeadline;
          warn.push({
            key: `selected-${a.id}`,
            tone: 'warn',
            text:
              due === null
                ? `${event.title} selection unconfirmed`
                : `${event.title} selection unconfirmed · due ${formatTime(due, event.timeZone)}`,
          });
        }

        if (isOverdue(slot, a, now)) {
          warn.push({
            key: `overdue-${a.id}`,
            tone: 'warn',
            text: `${event.title} upload overdue · ${nameOf(a.userId)}`,
          });
        }
      }
    }
  }

  return [...danger, ...warn];
}

export function buildBoard(events: EventRow[], now: Date, nameOf: NameOf): Board {
  const byTime = (a: EventRow, b: EventRow) =>
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();

  const columns = COLUMNS.map(({ status, label }): Column => {
    const inColumn = events.filter((e) => e.status === status).sort(byTime);
    // History reads newest first; everything else reads soonest first.
    const shown = status === 'complete' ? inColumn.reverse().slice(0, COMPLETE_SHOWN) : inColumn;
    return {
      status,
      label,
      count: inColumn.length,
      cards: shown.map((e) => card(e, now, nameOf)),
    };
  });

  return {
    columns,
    attention: attention(events, now, nameOf),
    activeCount: events.filter((e) => e.status !== 'complete').length,
  };
}
