import 'server-only';
import type { Viewer } from '../context';
import { isCommitted } from '../format';
import type { MyAssignment } from './home';

export interface MyJob extends MyAssignment {
  slotId: string;
  rateType: string;
  rateCents: number;
  callTime: string;
  endsAt: string;
  area: string | null;
  venue: string | null;
  address: string | null;
  note: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

type Row = {
  id: string; status: string; note: string | null; invite_expires_at: string | null; confirm_deadline: string | null;
  checked_in_at: string | null; checked_out_at: string | null; slot_id: string;
  slots: { id: string; role: string; rate_type: string; rate_amount_cents: number; call_time: string; event_id: string; deliverables: Array<{ due_at: string | null }> } | null;
};

/**
 * The contractor's own jobs. Rule 2 shapes this: once confirmed they read the
 * event itself; before that, only the coarse job_board projection, which
 * never carries the address. Both reads run as the contractor, so the
 * database enforces that whatever this code does.
 */
export async function loadMyJobs(viewer: Viewer): Promise<MyJob[]> {
  const db = viewer.supabase;
  const { data, error } = await db
    .from('assignments')
    .select('id, status, note, invite_expires_at, confirm_deadline, checked_in_at, checked_out_at, slot_id, slots!assignments_slot_id_fkey ( id, role, rate_type, rate_amount_cents, call_time, event_id, deliverables!deliverables_slot_id_fkey ( due_at ) )')
    .eq('user_id', viewer.userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load your jobs: ${error.message}`);
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.slots);

  const committedEvents = [...new Set(rows.filter((r) => isCommitted(r.status)).map((r) => r.slots!.event_id))];
  const pendingSlots = rows.filter((r) => !isCommitted(r.status)).map((r) => r.slot_id);

  const [events, board, reviews] = await Promise.all([
    committedEvents.length
      ? db.from('events').select('id, title, starts_at, ends_at, time_zone, area_label, venue_name, address').in('id', committedEvents)
      : { data: [] },
    pendingSlots.length
      ? db.from('job_board').select('slot_id, event_id, event_title, starts_at, ends_at, time_zone, area_label').in('slot_id', pendingSlots)
      : { data: [] },
    db.from('deliverable_reviews').select('assignment_id, decision, notes, created_at').eq('decision', 'changes_requested').order('created_at', { ascending: false }),
  ]);

  return rows.flatMap((r): MyJob[] => {
    const slot = r.slots!;
    const ev = (events.data ?? []).find((e) => String(e.id) === slot.event_id);
    const jb = (board.data ?? []).find((b) => String(b.slot_id) === r.slot_id);
    if (!ev && !jb) return []; // finished more than a week ago, or no longer visible
    const due = slot.deliverables.map((d) => d.due_at).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
    const review = (reviews.data ?? []).find((x) => String(x.assignment_id) === r.id);
    return [
      {
        id: r.id,
        status: r.status,
        role: slot.role,
        slotId: r.slot_id,
        eventId: slot.event_id,
        eventTitle: String(ev?.title ?? jb?.event_title ?? 'Event'),
        startsAt: String(ev?.starts_at ?? jb?.starts_at),
        endsAt: String(ev?.ends_at ?? jb?.ends_at),
        timeZone: String(ev?.time_zone ?? jb?.time_zone ?? 'UTC'),
        area: (ev?.area_label ?? jb?.area_label ?? null) as string | null,
        venue: (ev?.venue_name ?? null) as string | null,
        address: (ev?.address ?? null) as string | null,
        inviteExpiresAt: r.invite_expires_at,
        confirmDeadline: r.confirm_deadline,
        dueAt: due,
        changesNote: r.status === 'changes_requested' ? String(review?.notes ?? r.note ?? '') || null : null,
        rateType: slot.rate_type,
        rateCents: slot.rate_amount_cents,
        callTime: slot.call_time,
        note: r.note,
        checkedInAt: r.checked_in_at,
        checkedOutAt: r.checked_out_at,
      },
    ];
  });
}
