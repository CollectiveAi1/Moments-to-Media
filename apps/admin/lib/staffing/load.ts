import 'server-only';
import type { Viewer } from '../context';
import { COMMITTED } from '../format';
import type { AvailabilityRow, Candidate } from './rank';

interface Window {
  startsAt: string;
  endsAt: string;
  eventId: string;
  clientId: string | null;
}

/**
 * Everything ranking needs about every contractor in the organization, read
 * as the producer. RLS lets an admin read the roster's details, gear,
 * availability, documents, assignments and ratings; nothing here needs a
 * service key.
 */
export async function loadCandidates(viewer: Viewer, orgId: string, forEvent: Window): Promise<Candidate[]> {
  const db = viewer.supabase;
  const { data: members } = await db
    .from('memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .eq('role', 'contractor');
  const ids = [...new Set((members ?? []).map((m) => String(m.user_id)))];
  if (ids.length === 0) return [];

  const [profiles, details, gear, availability, docs, org, booked, ratings] = await Promise.all([
    db.from('profiles').select('user_id, full_name').in('user_id', ids),
    db.from('contractor_details').select('user_id, home_base_label, home_base_latitude, home_base_longitude, travel_radius_miles').in('user_id', ids),
    db.from('equipment').select('user_id, category').in('user_id', ids),
    db.from('availability').select('user_id, starts_on, ends_on, is_available, recurrence_days').in('user_id', ids),
    db.from('compliance_documents').select('user_id, doc_type, status, expires_on').eq('org_id', orgId).in('user_id', ids),
    db.from('organizations').select('settings').eq('id', orgId).maybeSingle(),
    db
      .from('assignments')
      .select('id, user_id, status, slots!assignments_slot_id_fkey ( event_id, events!slots_event_id_fkey ( id, starts_at, ends_at, client_id ) )')
      .eq('org_id', orgId)
      .in('user_id', ids)
      .in('status', [...COMMITTED]),
    db.from('ratings').select('assignment_id, quality, punctuality, communication, assignments!ratings_assignment_id_fkey!inner ( user_id )').eq('org_id', orgId),
  ]);

  const required: string[] = ((org.data?.settings as { required_compliance_documents?: string[] } | null)?.required_compliance_documents) ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(forEvent.startsAt).getTime();
  const end = new Date(forEvent.endsAt).getTime();

  return ids.map((userId): Candidate => {
    const d = (details.data ?? []).find((x) => String(x.user_id) === userId);
    const mine = (booked.data ?? []).filter((a) => String(a.user_id) === userId);
    const events = mine
      .map((a) => (a.slots as unknown as { events: { id: string; starts_at: string; ends_at: string; client_id: string | null } } | null)?.events)
      .filter((e): e is { id: string; starts_at: string; ends_at: string; client_id: string | null } => Boolean(e));
    const done = mine.filter((a) => ['approved', 'paid'].includes(String(a.status)));

    return {
      userId,
      name: String((profiles.data ?? []).find((p) => String(p.user_id) === userId)?.full_name ?? 'Unnamed'),
      homeLabel: (d?.home_base_label as string | null | undefined) ?? null,
      homeLat: d?.home_base_latitude == null ? null : Number(d.home_base_latitude),
      homeLng: d?.home_base_longitude == null ? null : Number(d.home_base_longitude),
      travelRadiusMiles: d?.travel_radius_miles == null ? null : Number(d.travel_radius_miles),
      gear: (gear.data ?? []).filter((g) => String(g.user_id) === userId).map((g) => String(g.category)),
      availability: (availability.data ?? [])
        .filter((a) => String(a.user_id) === userId)
        .map((a): AvailabilityRow => ({
          startsOn: String(a.starts_on),
          endsOn: String(a.ends_on),
          isAvailable: Boolean(a.is_available),
          recurrenceDays: (a.recurrence_days as number[] | null) ?? null,
        })),
      bookedElsewhere: events.some(
        (e) => e.id !== forEvent.eventId && new Date(e.starts_at).getTime() < end && new Date(e.ends_at).getTime() > start,
      ),
      complianceComplete: required.every((type) =>
        (docs.data ?? []).some(
          (doc) =>
            String(doc.user_id) === userId &&
            doc.doc_type === type &&
            doc.status === 'approved' &&
            (!doc.expires_on || String(doc.expires_on) >= today),
        ),
      ),
      ratings: (ratings.data ?? [])
        .filter((r) => String((r.assignments as unknown as { user_id: string } | null)?.user_id) === userId)
        .map((r) => ({ quality: Number(r.quality), punctuality: Number(r.punctuality), communication: Number(r.communication) })),
      jobsDone: done.length,
      jobsWithClient: forEvent.clientId
        ? events.filter((e) => e.client_id === forEvent.clientId && e.id !== forEvent.eventId).length
        : 0,
    };
  });
}
