import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import {
  BackLink, Card, Empty, Field, H2, LinkButton, ListRow, Muted, Notice, Row, StatusText, Tag, inputStyle, textareaStyle,
} from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import {
  ASSIGNMENT_STATUS, EVENT_STATUS, dateTime, formatDay, hours, isCommitted, money, rate, timeRange,
} from '@/lib/format';
import { isProducerish, orgPeople } from '@/lib/org';
import { color } from '@/lib/ui';
import { releaseMedia } from '../../client-actions';
import { EventFields } from '../EventFields';
import {
  addClientContact, addContact, addDeliverable, addShot, addSlot, deleteClientContact, deleteContact,
  deleteDeliverable, deleteEvent, deleteShot, deleteSlot, moveEvent, saveBrief, setSlotStatus, toggleMustHave,
  updateEvent, updateSlot,
} from './actions';
import { GEAR_LABELS, SlotFields } from './SlotFields';

export const metadata: Metadata = { title: 'Event', description: 'Event details, slots, brief, shot list, contacts and client delivery.' };
export const dynamic = 'force-dynamic';

type Slot = {
  id: string; role: string; rate_type: string; rate_amount_cents: number; call_time: string; required_gear: string[];
  staffing_mode: string; interest_deadline: string | null; is_required: boolean; status: string;
  minimum_hours: number | null; overtime_rule: { after_hours?: number; multiplier?: number } | null;
  assignments: Array<{ id: string; user_id: string; status: string }>;
  deliverables: Array<{ id: string; title: string; due_at: string | null; spec: Record<string, unknown> }>;
};

/** The moves a producer can make from here, in the order they are likely wanted. */
const NEXT: Record<string, Array<{ to: string; label: string; variant: 'admin' | 'secondary' | 'danger'; confirm?: string }>> = {
  draft: [
    { to: 'staffing', label: 'Open staffing', variant: 'admin' },
    { to: 'cancelled', label: 'Cancel event', variant: 'danger', confirm: 'Cancel this event? This cannot be undone.' },
  ],
  staffing: [
    { to: 'staffed', label: 'Mark staffed', variant: 'secondary' },
    { to: 'cancelled', label: 'Cancel event', variant: 'danger', confirm: 'Cancel this event? Confirmed crew are released and cannot be restored.' },
  ],
  staffed: [
    { to: 'in_progress', label: 'Start event', variant: 'admin' },
    { to: 'staffing', label: 'Back to staffing', variant: 'secondary' },
    { to: 'cancelled', label: 'Cancel event', variant: 'danger', confirm: 'Cancel this event? Confirmed crew are released and cannot be restored.' },
  ],
  in_progress: [{ to: 'uploaded', label: 'Mark uploaded', variant: 'admin' }],
  uploaded: [{ to: 'complete', label: 'Mark complete', variant: 'admin' }],
};

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { eventId } = await params;
  const { created } = await searchParams;
  const viewer = await requireAdmin();
  const db = viewer.supabase;

  const { data: event } = await db.from('events').select('*').eq('id', eventId).maybeSingle();
  if (!event) notFound();

  const [people, clientsRes, briefRes, slotsRes, shotsRes, contactsRes, clientContactsRes, activityRes] = await Promise.all([
    orgPeople(viewer, String(event.org_id)),
    db.from('clients').select('id, name').eq('org_id', event.org_id).order('name'),
    db.from('briefs').select('summary, body').eq('event_id', eventId).maybeSingle(),
    db.from('slots')
      .select('id, role, rate_type, rate_amount_cents, call_time, required_gear, staffing_mode, interest_deadline, is_required, status, minimum_hours, overtime_rule, assignments!assignments_slot_id_fkey ( id, user_id, status ), deliverables!deliverables_slot_id_fkey ( id, title, due_at, spec )')
      .eq('event_id', eventId)
      .order('call_time'),
    db.from('shot_list_items').select('id, title, description, must_have, slot_id, position').eq('event_id', eventId).order('position'),
    db.from('event_contacts').select('id, kind, name, phone').eq('event_id', eventId).order('kind'),
    event.client_id
      ? db.from('client_contacts').select('id, name, phone, email, is_primary').eq('client_id', event.client_id).order('is_primary', { ascending: false })
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    db.from('activity_log').select('action, change, created_at, actor_id').eq('entity_id', eventId).order('created_at', { ascending: false }).limit(8),
  ]);
  const [releaseRes, invoiceRes] = await Promise.all([
    db.from('media_releases').select('released_at, message').eq('event_id', eventId).maybeSingle(),
    db.from('invoices').select('id, number, status, total_cents, paid_cents').eq('event_id', eventId).neq('status', 'void'),
  ]);
  const release = releaseRes.data;
  const eventInvoices = invoiceRes.data ?? [];

  const zone = String(event.time_zone);
  const slots = (slotsRes.data ?? []) as unknown as Slot[];
  const shots = shotsRes.data ?? [];
  const contacts = contactsRes.data ?? [];
  const clientContacts = clientContactsRes.data ?? [];
  const clients = (clientsRes.data ?? []).map((c) => ({ id: String(c.id), name: String(c.name) }));
  const names = new Map(people.map((p) => [p.userId, p.name]));
  const status = EVENT_STATUS[String(event.status)] ?? { label: String(event.status), tone: 'muted' as const };
  const clientName = clients.find((c) => c.id === event.client_id)?.name;
  const live = slots.filter((s) => s.status !== 'cancelled');
  const approvedCount = slots.flatMap((s) => s.assignments).filter((a) => a.status === 'approved' || a.status === 'paid').length;
  const filled = live.filter((s) => s.assignments.some((a) => isCommitted(a.status))).length;
  const editable = !['complete', 'cancelled'].includes(String(event.status));

  return (
    <>
      <BackLink href="/events">Events</BackLink>
      {created ? <Notice>Draft created. Add slots, the brief and the shot list, then open staffing.</Notice> : null}

      <PageHeader
        title={String(event.title)}
        subtitle={`${formatDay(String(event.starts_at), zone)} · ${timeRange(String(event.starts_at), String(event.ends_at), zone)} · ${event.venue_name ?? event.area_label ?? 'No venue yet'} · ${names.get(String(event.producer_id)) ?? 'No producer'}${clientName ? ` · ${clientName}` : ''}`}
        actions={
          <>
            <Tag tone={status.tone}>{status.label}</Tag>
            {['staffing', 'staffed', 'draft'].includes(String(event.status)) ? (
              <LinkButton href={`/events/${eventId}/staffing`} variant="secondary">
                Staffing
              </LinkButton>
            ) : null}
            {(NEXT[String(event.status)] ?? []).map((m) => (
              <ActionForm key={m.to} action={moveEvent} submit={m.label} variant={m.variant} layout="inline" {...(m.confirm ? { confirm: m.confirm } : {})}>
                <input type="hidden" name="event_id" value={eventId} />
                <input type="hidden" name="to" value={m.to} />
              </ActionForm>
            ))}
            {event.status === 'draft' ? (
              <ActionForm action={deleteEvent} submit="Delete draft" variant="danger" layout="inline" confirm="Delete this draft and everything on it?">
                <input type="hidden" name="event_id" value={eventId} />
              </ActionForm>
            ) : null}
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 12 }}>
        <Fact label="Crew" value={`${filled} of ${live.length} slots filled`} />
        <Fact label="Hours" value={hours(String(event.starts_at), String(event.ends_at))} />
        <Fact label="Shot list" value={`${shots.length} shots · ${shots.filter((s) => s.must_have).length} must-have`} />
        <Fact label="Deliverables" value={String(live.reduce((n, s) => n + s.deliverables.length, 0))} />
      </div>

      {/* ------------------------------------------------------------ slots */}
      <Card>
        <Row align="center">
          <H2>Slots</H2>
          <span style={{ marginLeft: 'auto' }}>
            <LinkButton href={`/events/${eventId}/staffing`} variant="secondary">
              Open staffing view
            </LinkButton>
          </span>
        </Row>
        {slots.length === 0 ? <Muted>No slots yet. Add the roles this event needs.</Muted> : null}
        {slots.map((s) => {
          const crew = s.assignments.filter((a) => isCommitted(a.status));
          const waiting = s.assignments.filter((a) => ['invited', 'interested', 'selected'].includes(a.status));
          return (
            <div key={s.id} style={{ borderTop: `1px solid ${color.divider}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Row align="center" gap={10}>
                <strong style={{ fontSize: 15 }}>{s.role}</strong>
                <Muted>{rate(s.rate_type, s.rate_amount_cents)}</Muted>
                <Muted>· call {dateTime(s.call_time, zone)}</Muted>
                <Tag tone={s.status === 'filled' ? 'positive' : s.status === 'cancelled' ? 'muted' : 'label'}>
                  {s.status === 'open_call' ? 'Open call' : s.status === 'inviting' ? 'Inviting' : s.status === 'filled' ? 'Filled' : s.status === 'cancelled' ? 'Cancelled' : 'Draft'}
                </Tag>
                {!s.is_required ? <Tag>Optional</Tag> : null}
                {s.required_gear.length ? <Muted size={12}>Needs {s.required_gear.map((g) => GEAR_LABELS[g] ?? g).join(', ')}</Muted> : null}
              </Row>
              <Muted size={13}>
                {crew.length
                  ? crew.map((a) => `${names.get(a.user_id) ?? 'Contractor'} (${ASSIGNMENT_STATUS[a.status]?.label ?? a.status})`).join(', ')
                  : waiting.length
                    ? `${waiting.length} waiting: ${waiting.map((a) => `${names.get(a.user_id) ?? 'Contractor'} ${ASSIGNMENT_STATUS[a.status]?.label.toLowerCase() ?? a.status}`).join(', ')}`
                    : 'Nobody yet.'}
              </Muted>
              {editable ? (
                <Row gap={8} align="center">
                  {s.status === 'draft' && s.staffing_mode === 'open_call' && ['staffing', 'staffed'].includes(String(event.status)) ? (
                    <ActionForm action={setSlotStatus} submit="Post to job board" layout="inline" variant="secondary">
                      <input type="hidden" name="slot_id" value={s.id} />
                      <input type="hidden" name="to" value="open_call" />
                    </ActionForm>
                  ) : null}
                  {s.status === 'open_call' ? (
                    <ActionForm action={setSlotStatus} submit="Close open call" layout="inline" variant="secondary">
                      <input type="hidden" name="slot_id" value={s.id} />
                      <input type="hidden" name="to" value="draft" />
                    </ActionForm>
                  ) : null}
                  {s.status !== 'cancelled' && s.status !== 'filled' ? (
                    <ActionForm action={setSlotStatus} submit="Cancel slot" layout="inline" variant="secondary" confirm="Cancel this slot?">
                      <input type="hidden" name="slot_id" value={s.id} />
                      <input type="hidden" name="to" value="cancelled" />
                    </ActionForm>
                  ) : null}
                  {s.assignments.length === 0 ? (
                    <ActionForm action={deleteSlot} submit="Delete" layout="inline" variant="danger" confirm="Delete this slot?">
                      <input type="hidden" name="slot_id" value={s.id} />
                    </ActionForm>
                  ) : null}
                </Row>
              ) : null}
              {editable ? (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 14, color: color.label, minHeight: 32 }}>Edit slot</summary>
                  <div style={{ paddingTop: 10 }}>
                    <ActionForm action={updateSlot} submit="Save slot">
                      <input type="hidden" name="event_id" value={eventId} />
                      <input type="hidden" name="slot_id" value={s.id} />
                      <SlotFields defaults={s} zone={zone} eventStart={String(event.starts_at)} />
                    </ActionForm>
                  </div>
                </details>
              ) : null}
            </div>
          );
        })}
        {editable ? (
          <details style={{ borderTop: `1px solid ${color.divider}`, paddingTop: 12 }} open={slots.length === 0}>
            <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: color.label, minHeight: 32 }}>+ Add a slot</summary>
            <div style={{ paddingTop: 10 }}>
              <ActionForm action={addSlot} submit="Add slot" reset>
                <input type="hidden" name="event_id" value={eventId} />
                <SlotFields zone={zone} eventStart={String(event.starts_at)} />
              </ActionForm>
            </div>
          </details>
        ) : null}
      </Card>

      {/* ------------------------------------------------------------ brief */}
      <Card>
        <H2>Creative brief</H2>
        <Muted size={13}>The summary line is the only part a candidate sees before confirming. The rest unlocks on confirm.</Muted>
        <ActionForm action={saveBrief} submit="Save brief">
          <input type="hidden" name="event_id" value={eventId} />
          <Field label="Summary (one line)">
            <input name="summary" defaultValue={String(briefRes.data?.summary ?? '')} style={inputStyle} />
          </Field>
          <Field label="Brief">
            <textarea name="body" defaultValue={String(briefRes.data?.body ?? '')} style={{ ...textareaStyle, minHeight: 140 }} />
          </Field>
        </ActionForm>
      </Card>

      {/* ----------------------------------------------------- deliverables */}
      <Card>
        <H2>Deliverables</H2>
        {live.every((s) => s.deliverables.length === 0) ? <Muted>None yet. Each deliverable belongs to the slot that owes it.</Muted> : null}
        {live.flatMap((s) =>
          s.deliverables.map((d) => (
            <Row key={d.id} align="center" gap={10}>
              <strong style={{ fontSize: 14 }}>{d.title}</strong>
              <Muted size={13}>
                {s.role}
                {d.due_at ? ` · due ${dateTime(d.due_at, zone)}` : ''}
                {d.spec.format ? ` · ${String(d.spec.format)}` : ''}
                {d.spec.count ? ` · ${String(d.spec.count)}` : ''}
              </Muted>
              {editable ? (
                <span style={{ marginLeft: 'auto' }}>
                  <ActionForm action={deleteDeliverable} submit="Remove" variant="danger" layout="inline" confirm="Remove this deliverable?">
                    <input type="hidden" name="deliverable_id" value={d.id} />
                  </ActionForm>
                </span>
              ) : null}
            </Row>
          )),
        )}
        {editable && live.length > 0 ? (
          <ActionForm action={addDeliverable} submit="Add deliverable" reset>
            <input type="hidden" name="event_id" value={eventId} />
            <Row>
              <Field label="Slot">
                <select name="slot_id" style={inputStyle}>
                  {live.map((s) => (
                    <option key={s.id} value={s.id}>{s.role}</option>
                  ))}
                </select>
              </Field>
              <Field label="Deliverable" grow={2}>
                <input name="title" placeholder="40 edited stills" style={inputStyle} />
              </Field>
              <Field label="Format">
                <input name="format" placeholder="JPEG" style={inputStyle} />
              </Field>
              <Field label="Count">
                <input name="count" type="number" min={1} style={inputStyle} />
              </Field>
              <Field label="Due date">
                <input name="due_date" type="date" style={inputStyle} />
              </Field>
              <Field label="Due time">
                <input name="due_time" type="time" defaultValue="17:00" style={inputStyle} />
              </Field>
            </Row>
          </ActionForm>
        ) : null}
      </Card>

      {/* --------------------------------------------------------- shot list */}
      <Card>
        <H2>Shot list</H2>
        {shots.length === 0 ? <Muted>No shots yet. Must-haves block check-out until they are captured or marked not possible.</Muted> : null}
        {shots.map((s) => (
          <Row key={String(s.id)} align="center" gap={10}>
            {s.must_have ? <Tag tone="warn">Must-have</Tag> : <Tag>Also get</Tag>}
            <strong style={{ fontSize: 14 }}>{String(s.title)}</strong>
            {s.description ? <Muted size={13}>{String(s.description)}</Muted> : null}
            {editable ? (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <ActionForm action={toggleMustHave} submit={s.must_have ? 'Make optional' : 'Make must-have'} variant="secondary" layout="inline">
                  <input type="hidden" name="shot_id" value={String(s.id)} />
                  <input type="hidden" name="must_have" value={s.must_have ? 'false' : 'true'} />
                </ActionForm>
                <ActionForm action={deleteShot} submit="Remove" variant="danger" layout="inline">
                  <input type="hidden" name="shot_id" value={String(s.id)} />
                </ActionForm>
              </span>
            ) : null}
          </Row>
        ))}
        {editable ? (
          <ActionForm action={addShot} submit="Add shot" reset>
            <input type="hidden" name="event_id" value={eventId} />
            <Row>
              <Field label="Shot" grow={2}>
                <input name="title" placeholder="Trophy presentation" style={inputStyle} />
              </Field>
              <Field label="Hint" grow={2}>
                <input name="description" placeholder="Wide and tight, stage left" style={inputStyle} />
              </Field>
              <Field label="For slot">
                <select name="slot_id" style={inputStyle}>
                  <option value="">Everyone</option>
                  {live.map((s) => (
                    <option key={s.id} value={s.id}>{s.role}</option>
                  ))}
                </select>
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14 }}>
                <input type="checkbox" name="must_have" /> Must-have
              </label>
            </Row>
          </ActionForm>
        ) : null}
      </Card>

      {/* ---------------------------------------------------------- contacts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 20 }}>
        <Card>
          <H2>On-site and emergency</H2>
          {contacts.length === 0 ? <Muted>None yet. Confirmed crew see these in their packet.</Muted> : null}
          {contacts.map((c) => (
            <Row key={String(c.id)} align="center" gap={8}>
              <Tag tone={c.kind === 'emergency' ? 'danger' : 'label'}>{c.kind === 'emergency' ? 'Emergency' : 'On site'}</Tag>
              <span style={{ fontSize: 14 }}>{String(c.name)}</span>
              <Muted size={13}>{String(c.phone ?? '')}</Muted>
              {editable ? (
                <span style={{ marginLeft: 'auto' }}>
                  <ActionForm action={deleteContact} submit="Remove" variant="danger" layout="inline">
                    <input type="hidden" name="contact_id" value={String(c.id)} />
                  </ActionForm>
                </span>
              ) : null}
            </Row>
          ))}
          {editable ? (
            <ActionForm action={addContact} submit="Add contact" reset>
              <input type="hidden" name="event_id" value={eventId} />
              <Row>
                <Field label="Kind">
                  <select name="kind" style={inputStyle}>
                    <option value="on_site">On site</option>
                    <option value="emergency">Emergency</option>
                  </select>
                </Field>
                <Field label="Name">
                  <input name="name" style={inputStyle} />
                </Field>
                <Field label="Phone">
                  <input name="phone" type="tel" style={inputStyle} />
                </Field>
              </Row>
            </ActionForm>
          ) : null}
        </Card>

        <Card>
          <H2>Client contact</H2>
          {!event.client_id ? (
            <Muted>Set a client in the event details below to add their contacts.</Muted>
          ) : (
            <>
              {clientContacts.length === 0 ? <Muted>No contacts for {clientName}. Confirmed crew see the primary contact in their packet.</Muted> : null}
              {clientContacts.map((c) => (
                <Row key={String(c.id)} align="center" gap={8}>
                  {c.is_primary ? <Tag tone="positive">Primary</Tag> : null}
                  <span style={{ fontSize: 14 }}>{String(c.name)}</span>
                  <Muted size={13}>{[c.phone, c.email].filter(Boolean).join(' · ')}</Muted>
                  <span style={{ marginLeft: 'auto' }}>
                    <ActionForm action={deleteClientContact} submit="Remove" variant="danger" layout="inline">
                      <input type="hidden" name="contact_id" value={String(c.id)} />
                    </ActionForm>
                  </span>
                </Row>
              ))}
              <ActionForm action={addClientContact} submit="Add client contact" reset>
                <input type="hidden" name="client_id" value={String(event.client_id)} />
                <Row>
                  <Field label="Name">
                    <input name="name" style={inputStyle} />
                  </Field>
                  <Field label="Phone">
                    <input name="phone" type="tel" style={inputStyle} />
                  </Field>
                  <Field label="Email">
                    <input name="email" type="email" style={inputStyle} />
                  </Field>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14 }}>
                    <input type="checkbox" name="is_primary" defaultChecked={clientContacts.length === 0} /> Primary
                  </label>
                </Row>
              </ActionForm>
            </>
          )}
        </Card>
      </div>

      {/* ----------------------------------------------------------- details */}
      <Card>
        <H2>Event details</H2>
        {editable ? (
          <ActionForm action={updateEvent} submit="Save details">
            <input type="hidden" name="event_id" value={eventId} />
            <EventFields
              defaults={event as never}
              producers={people.filter(isProducerish)}
              clients={clients}
              canChooseProducer={viewer.isOwner}
              viewerId={viewer.userId}
            />
          </ActionForm>
        ) : (
          <Muted>This event is {status.label.toLowerCase()} and can no longer be edited.</Muted>
        )}
      </Card>

      {/* ------------------------------------------------------- the client */}
      {event.client_id ? (
        <Card>
          <H2>Client delivery and billing</H2>
          {eventInvoices.map((i) => (
            <ListRow
              key={String(i.id)}
              label={<Link href={`/invoices/${String(i.id)}`}>Invoice {String(i.number)}</Link>}
              value={<StatusText>{money(Number(i.paid_cents))} of {money(Number(i.total_cents))} paid</StatusText>}
            />
          ))}
          {eventInvoices.length === 0 ? (
            <Link href={`/invoices/new?client=${String(event.client_id)}`} style={{ fontSize: 14 }}>Invoice {clientName} for this event →</Link>
          ) : null}
          <LinkButton href={`/events/${eventId}/deliver`} variant="secondary">Upload finished files for {clientName ?? 'the client'}</LinkButton>
          {release ? (
            <Muted>Media released to {clientName} {dateTime(String(release.released_at), zone)}. New approvals appear in their portal automatically.</Muted>
          ) : approvedCount === 0 ? (
            <Muted>Once you approve a contractor’s footage you can release it to {clientName}’s portal.</Muted>
          ) : null}
          {approvedCount > 0 ? (
            <ActionForm action={releaseMedia} submit={release ? 'Update the note' : `Release approved media to ${clientName ?? 'the client'}`} variant={release ? 'secondary' : 'admin'}>
              <input type="hidden" name="event_id" value={eventId} />
              <Field label="Note to the client (optional)">
                <input name="message" defaultValue={String(release?.message ?? '')} style={inputStyle} placeholder="Your highlight film is ready!" />
              </Field>
            </ActionForm>
          ) : null}
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- history */}
      <Card>
        <H2>History</H2>
        {(activityRes.data ?? []).length === 0 ? <Muted>Nothing recorded yet.</Muted> : null}
        {(activityRes.data ?? []).map((a, i) => {
          const change = (a.change ?? {}) as { from?: string; to?: string; reason?: string };
          return (
            <ListRow
              key={i}
              label={
                a.action === 'status_change'
                  ? `${EVENT_STATUS[change.from ?? '']?.label ?? change.from} → ${EVENT_STATUS[change.to ?? '']?.label ?? change.to}${change.reason ? ` (${change.reason})` : ''}`
                  : String(a.action).replace(/_/g, ' ')
              }
              value={<StatusText>{dateTime(String(a.created_at), zone)} · {names.get(String(a.actor_id)) ?? 'System'}</StatusText>}
            />
          );
        })}
        {['uploaded', 'complete'].includes(String(event.status)) ? (
          <Link href="/footage" style={{ fontSize: 14 }}>Review footage for this event →</Link>
        ) : null}
        <Muted size={12}>Total quoted crew cost: {money(live.reduce((n, s) => n + (s.rate_type === 'hourly' ? 0 : s.rate_amount_cents), 0))}{live.some((s) => s.rate_type === 'hourly') ? ' plus hourly slots' : ''}</Muted>
      </Card>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: color.textMuted }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700 }}>{value}</span>
    </div>
  );
}
