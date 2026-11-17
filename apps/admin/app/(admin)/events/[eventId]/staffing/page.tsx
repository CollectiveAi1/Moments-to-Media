import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { BackLink, Card, H1, H2, Muted, Notice, Row, StatusText, Table, Tag, td } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { ASSIGNMENT_STATUS, dateTime, formatDay, hours, isCommitted, rate, zonedDate } from '@/lib/format';
import { loadCandidates } from '@/lib/staffing/load';
import { rank, type Ranked } from '@/lib/staffing/rank';
import { color, fonts, radius } from '@/lib/ui';
import { cancelBooking, expireSelection, invite, pass, select, withdrawInvite } from './actions';

export const metadata: Metadata = { title: 'Staffing' };
export const dynamic = 'force-dynamic';

type Assignment = { id: string; user_id: string; status: string; note: string | null; invite_expires_at: string | null; confirm_deadline: string | null };
type Slot = {
  id: string; role: string; rate_type: string; rate_amount_cents: number; staffing_mode: string; status: string;
  interest_deadline: string | null; required_gear: string[]; is_required: boolean; call_time: string;
  assignments: Assignment[];
};

export default async function StaffingPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ slot?: string }>;
}) {
  const { eventId } = await params;
  const { slot: slotParam } = await searchParams;
  const viewer = await requireAdmin();
  const db = viewer.supabase;

  const { data: event } = await db
    .from('events')
    .select('id, org_id, title, status, starts_at, ends_at, time_zone, venue_name, area_label, latitude, longitude, client_id, producer_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) notFound();
  const zone = String(event.time_zone);

  const { data: slotRows } = await db
    .from('slots')
    .select('id, role, rate_type, rate_amount_cents, staffing_mode, status, interest_deadline, required_gear, is_required, call_time, assignments!assignments_slot_id_fkey ( id, user_id, status, note, invite_expires_at, confirm_deadline )')
    .eq('event_id', eventId)
    .neq('status', 'cancelled')
    .order('call_time');
  const slots = (slotRows ?? []) as unknown as Slot[];

  const current =
    slots.find((s) => s.id === slotParam) ??
    slots.find((s) => !s.assignments.some((a) => isCommitted(a.status))) ??
    slots[0];

  const candidates = await loadCandidates(viewer, String(event.org_id), {
    startsAt: String(event.starts_at),
    endsAt: String(event.ends_at),
    eventId,
    clientId: (event.client_id as string | null) ?? null,
  });
  const names = new Map(candidates.map((c) => [c.userId, c.name]));
  const { data: producer } = await db.from('profiles').select('full_name').eq('user_id', event.producer_id).maybeSingle();

  const needs = current
    ? {
        requiredGear: current.required_gear,
        eventDate: zonedDate(String(event.starts_at), zone),
        eventLat: event.latitude == null ? null : Number(event.latitude),
        eventLng: event.longitude == null ? null : Number(event.longitude),
      }
    : null;
  const onSlot = new Set(current?.assignments.map((a) => a.user_id) ?? []);
  const interested = current?.assignments.filter((a) => a.status === 'interested') ?? [];
  const rankedInterested = needs ? rank(candidates.filter((c) => interested.some((a) => a.user_id === c.userId)), needs) : [];
  const rankedRoster = needs ? rank(candidates.filter((c) => !onSlot.has(c.userId)), needs) : [];
  const filled = current?.assignments.find((a) => isCommitted(a.status));
  const selected = current?.assignments.find((a) => a.status === 'selected');
  const decided = current?.assignments.filter((a) => !['interested'].includes(a.status)) ?? [];

  return (
    <>
      <BackLink href={`/events/${eventId}`}>Back to event</BackLink>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <H1>{String(event.title)}</H1>
        <Muted>
          {formatDay(String(event.starts_at), zone)} · {hours(String(event.starts_at), String(event.ends_at))} ·{' '}
          {String(event.venue_name ?? event.area_label ?? 'No venue')} · {String(producer?.full_name ?? 'No producer')}
        </Muted>
      </div>

      {event.status === 'draft' ? (
        <Notice tone="warn">
          This event is still a draft, so contractors cannot see invitations or open calls yet. Open staffing from the{' '}
          <Link href={`/events/${eventId}`}>event page</Link> first.
        </Notice>
      ) : null}

      {slots.length === 0 ? (
        <Notice tone="warn">
          No slots yet. <Link href={`/events/${eventId}`}>Add slots on the event page.</Link>
        </Notice>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {slots.map((s) => {
            const committed = s.assignments.find((a) => isCommitted(a.status));
            const sel = s.assignments.find((a) => a.status === 'selected');
            const invited = s.assignments.filter((a) => a.status === 'invited');
            const want = s.assignments.filter((a) => a.status === 'interested').length;
            const line = committed
              ? { text: `${names.get(committed.user_id) ?? 'Contractor'} confirmed`, tone: color.positive }
              : sel
                ? { text: `${names.get(sel.user_id) ?? 'Contractor'} selected${sel.confirm_deadline ? ` · confirm by ${dateTime(sel.confirm_deadline, zone)}` : ''}`, tone: color.warnText }
                : invited.length
                  ? { text: `${invited.length} invited${invited[0]?.invite_expires_at ? ` · expires ${dateTime(invited[0].invite_expires_at, zone)}` : ''}`, tone: color.warnText }
                  : s.staffing_mode === 'open_call'
                    ? { text: `Open call · ${want} interested`, tone: color.label }
                    : { text: 'Nobody invited yet', tone: color.textMuted };
            const active = s.id === current?.id;
            return (
              <Link
                key={s.id}
                href={`/events/${eventId}/staffing?slot=${s.id}`}
                aria-current={active ? 'true' : undefined}
                style={{
                  background: color.surface,
                  border: `${active ? 2 : 1}px solid ${active ? color.label : color.border}`,
                  borderRadius: radius.lg,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  textDecoration: 'none',
                  color: color.text,
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 700 }}>
                  {s.role} · {rate(s.rate_type, s.rate_amount_cents)}
                </span>
                <span style={{ fontSize: 12, color: color.textMuted }}>
                  {s.staffing_mode === 'open_call' ? 'Open call' : 'Direct invite'}
                  {s.interest_deadline ? ` · closes ${dateTime(s.interest_deadline, zone)}` : ''}
                  {!s.is_required ? ' · optional' : ''}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: line.tone }}>{line.text}</span>
              </Link>
            );
          })}
        </div>
      )}

      {current ? (
        <>
          {decided.length > 0 ? (
            <Card>
              <H2 size={20}>On this slot</H2>
              {decided.map((a) => {
                const s = ASSIGNMENT_STATUS[a.status] ?? { label: a.status, tone: 'muted' as const };
                const name = names.get(a.user_id) ?? 'Contractor';
                return (
                  <Row key={a.id} align="center" gap={10}>
                    <strong style={{ fontSize: 14, minWidth: 140 }}>{name}</strong>
                    <Tag tone={s.tone}>{s.label}</Tag>
                    <Muted size={13}>
                      {a.status === 'invited' && a.invite_expires_at ? `Invitation expires ${dateTime(a.invite_expires_at, zone)}` : ''}
                      {a.status === 'selected' && a.confirm_deadline ? `Must confirm by ${dateTime(a.confirm_deadline, zone)}` : ''}
                    </Muted>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      {a.status === 'invited' ? (
                        <ActionForm action={withdrawInvite} submit="Withdraw invite" variant="secondary" layout="inline">
                          <input type="hidden" name="assignment_id" value={a.id} />
                          <input type="hidden" name="name" value={name} />
                        </ActionForm>
                      ) : null}
                      {a.status === 'selected' ? (
                        <ActionForm action={expireSelection} submit="Expire selection" variant="secondary" layout="inline" confirm={`Expire ${name}'s selection? They will no longer be able to confirm.`}>
                          <input type="hidden" name="assignment_id" value={a.id} />
                          <input type="hidden" name="name" value={name} />
                        </ActionForm>
                      ) : null}
                      {a.status === 'confirmed' ? (
                        <ActionForm action={cancelBooking} submit="Cancel booking" variant="danger" layout="inline" confirm={`Cancel ${name}'s booking? The slot reopens.`}>
                          <input type="hidden" name="assignment_id" value={a.id} />
                          <input type="hidden" name="name" value={name} />
                        </ActionForm>
                      ) : null}
                      {['uploaded', 'changes_requested'].includes(a.status) ? (
                        <Link href={`/events/${eventId}/review/${a.id}`} style={{ fontSize: 14, alignSelf: 'center' }}>
                          Review →
                        </Link>
                      ) : null}
                    </span>
                  </Row>
                );
              })}
            </Card>
          ) : null}

          {interested.length > 0 || current.staffing_mode === 'open_call' ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <H2 size={20}>
                {interested.length} interested in {current.role}
              </H2>
              <Muted>Ranked by distance, gear and availability. Reliability and history with the client are shown, not scored (PRD MVP).</Muted>
              {interested.length === 0 ? (
                <Muted>
                  Nobody yet.{' '}
                  {current.status === 'open_call'
                    ? 'The open call is on the job board for eligible contractors.'
                    : 'Post the open call from the event page so eligible contractors can see it.'}
                </Muted>
              ) : (
                <CandidateTable
                  ranked={rankedInterested}
                  action={filled || selected ? null : 'select'}
                  slotId={current.id}
                  interested={interested}
                  {...(filled || selected ? { quietNote: filled ? 'Filled' : 'Selection pending' } : {})}
                />
              )}
            </section>
          ) : null}

          {!filled ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <H2 size={20}>Invite directly</H2>
              <Muted>Everyone on the roster not already on this slot. Accepting an invitation books them.</Muted>
              {rankedRoster.length === 0 ? (
                <Muted>No other contractors in the organization. Invite people from Contractors.</Muted>
              ) : (
                <CandidateTable ranked={rankedRoster} action="invite" slotId={current.id} interested={[]} />
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function CandidateTable({
  ranked,
  action,
  slotId,
  interested,
  quietNote,
}: {
  ranked: Ranked[];
  action: 'select' | 'invite' | null;
  slotId: string;
  interested: Assignment[];
  quietNote?: string;
}) {
  return (
    <Table head={['Contractor', 'Match', 'Distance', 'Gear', 'Reliability', 'Note and flags', '']} minWidth={860}>
      {ranked.map((r) => {
        const assignment = interested.find((a) => a.user_id === r.candidate.userId);
        return (
          <tr key={r.candidate.userId}>
            <td style={td}>
              <Link href={`/contractors/${r.candidate.userId}`} style={{ fontWeight: 700, color: color.text }}>
                {r.candidate.name}
              </Link>
              <div>
                <Muted size={12}>
                  {r.candidate.jobsDone} jobs{r.candidate.jobsWithClient ? ` · ${r.candidate.jobsWithClient} with this client` : ''}
                </Muted>
              </div>
            </td>
            <td style={{ ...td, fontFamily: fonts.heading, fontSize: 18, fontWeight: 600 }}>{r.score}</td>
            <td style={td}>{r.distanceMiles === null ? (r.candidate.homeLabel ?? '—') : `${r.distanceMiles} mi`}</td>
            <td style={td}>
              {r.missingGear.length === 0 ? <StatusText tone="positive">Has it</StatusText> : <StatusText tone="warn">Missing {r.missingGear.length}</StatusText>}
            </td>
            <td style={td}>{r.reliability === null ? <Muted size={13}>New</Muted> : `${r.reliability} / 5`}</td>
            <td style={{ ...td, maxWidth: 260 }}>
              {assignment?.note ? <div style={{ fontSize: 13 }}>“{assignment.note}”</div> : null}
              {r.flags.map((f) => (
                <div key={f} style={{ fontSize: 12, color: color.dangerText }}>{f}</div>
              ))}
            </td>
            <td style={{ ...td, textAlign: 'right' }}>
              {action === 'select' && assignment ? (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <ActionForm action={select} submit="Select" layout="inline">
                    <input type="hidden" name="assignment_id" value={assignment.id} />
                    <input type="hidden" name="name" value={r.candidate.name} />
                  </ActionForm>
                  <ActionForm action={pass} submit="Pass" variant="secondary" layout="inline">
                    <input type="hidden" name="assignment_id" value={assignment.id} />
                    <input type="hidden" name="name" value={r.candidate.name} />
                  </ActionForm>
                </div>
              ) : action === 'invite' ? (
                <ActionForm action={invite} submit="Invite" layout="inline">
                  <input type="hidden" name="slot_id" value={slotId} />
                  <input type="hidden" name="user_id" value={r.candidate.userId} />
                  <input type="hidden" name="name" value={r.candidate.name} />
                </ActionForm>
              ) : (
                <Muted size={12}>{quietNote ?? ''}</Muted>
              )}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}
