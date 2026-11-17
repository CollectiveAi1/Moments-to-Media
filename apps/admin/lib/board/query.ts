import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssignmentRow, EventRow, EventStatus, SlotRow } from './build';

/**
 * Everything the board needs, in one round trip, as the signed-in person.
 * Row-level security decides which events come back: an owner or producer
 * sees their organization's, and nobody else sees any.
 */
// Every embed names its foreign key. Each child table has two to its parent:
// the plain one, and a composite (id, org_id) one that makes a cross-tenant
// reference impossible. PostgREST refuses to guess between them.
const SELECT = `
  id, title, status, starts_at, time_zone, producer_id,
  briefs!briefs_event_id_fkey ( id ),
  shot_list_items!shot_list_items_event_id_fkey ( id ),
  slots!slots_event_id_fkey (
    id, role, staffing_mode, status, is_required, call_time,
    deliverables!deliverables_slot_id_fkey ( due_at ),
    assignments!assignments_slot_id_fkey (
      id, user_id, status, confirm_deadline,
      shot_checks!shot_checks_assignment_id_fkey ( shot_list_item_id, outcome )
    )
  )
`;

// The generated database types are not in the repo yet (`pnpm db:types` needs
// the Supabase CLI), so the response is read defensively instead of trusted.
type Json = Record<string, unknown>;
const list = (v: unknown): Json[] =>
  Array.isArray(v) ? (v as Json[]) : v && typeof v === 'object' ? [v as Json] : [];
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const STATUSES: readonly EventStatus[] = [
  'draft', 'staffing', 'staffed', 'in_progress', 'uploaded', 'complete',
];

function toAssignment(row: Json): AssignmentRow {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    status: text(row.status),
    confirmDeadline: textOrNull(row.confirm_deadline),
    capturedShotIds: list(row.shot_checks)
      .filter((c) => c.outcome === 'captured')
      .map((c) => text(c.shot_list_item_id)),
  };
}

function toSlot(row: Json): SlotRow {
  const due = list(row.deliverables)
    .map((d) => textOrNull(d.due_at))
    .filter((d): d is string => d !== null)
    .sort();
  return {
    id: text(row.id),
    role: text(row.role),
    staffingMode: row.staffing_mode === 'open_call' ? 'open_call' : 'direct_invite',
    status: text(row.status),
    isRequired: row.is_required !== false,
    callTime: text(row.call_time),
    earliestDueAt: due[0] ?? null,
    assignments: list(row.assignments).map(toAssignment),
  };
}

export interface BoardData {
  events: EventRow[];
  names: Map<string, string>;
  /** Everyone who produces at least one event the caller can see. */
  producers: Array<{ id: string; name: string }>;
}

export async function loadBoard(
  supabase: SupabaseClient,
  producerId: string | null,
): Promise<BoardData> {
  const { data, error } = await supabase
    .from('events')
    .select(SELECT)
    .neq('status', 'cancelled')
    .order('starts_at', { ascending: true });

  if (error) throw new Error(`Could not load events: ${error.message}`);

  const all: EventRow[] = list(data)
    .filter((row) => STATUSES.includes(row.status as EventStatus))
    .map((row) => ({
      id: text(row.id),
      title: text(row.title),
      status: row.status as EventStatus,
      startsAt: text(row.starts_at),
      timeZone: text(row.time_zone) || 'UTC',
      producerId: text(row.producer_id),
      hasBrief: list(row.briefs).length > 0,
      shotIds: list(row.shot_list_items).map((s) => text(s.id)),
      slots: list(row.slots).map(toSlot),
    }));

  // Names for the producer filter and for the people the board mentions.
  const ids = new Set<string>();
  for (const e of all) {
    ids.add(e.producerId);
    for (const s of e.slots) for (const a of s.assignments) ids.add(a.userId);
  }

  const names = new Map<string, string>();
  if (ids.size > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .in('user_id', [...ids]);
    if (profileError) throw new Error(`Could not load names: ${profileError.message}`);
    for (const p of list(profiles)) names.set(text(p.user_id), text(p.full_name));
  }

  const producers = [...new Set(all.map((e) => e.producerId))]
    .map((id) => ({ id, name: names.get(id) ?? 'Unnamed producer' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // The filter is applied here, after the producer list is built, so choosing
  // one producer does not empty the list of producers to choose from.
  const events = producerId ? all.filter((e) => e.producerId === producerId) : all;

  return { events, names, producers };
}
