import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { BottomBar, mapsUrl } from '@/components/contractor/bits';
import { CheckInButton } from '@/components/contractor/CheckInButton';
import { BackLink, Card, Eyebrow, H1, LinkButton, ListRow, Muted, Notice, inputStyle } from '@/components/ui';
import { requireContractor } from '@/lib/context';
import { dateTime, formatDay, formatTime, isCommitted, timeRange } from '@/lib/format';
import { color, fonts, radius } from '@/lib/ui';
import { checkIn, runningLate } from '../../actions';

export const metadata: Metadata = { title: 'Event packet' };
export const dynamic = 'force-dynamic';

export default async function Packet({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await requireContractor();
  const db = viewer.supabase;

  // Row-level security returns this row only to crew confirmed on the event.
  const { data: event } = await db.from('events').select('*').eq('id', eventId).maybeSingle();
  if (!event) notFound();
  const zone = String(event.time_zone);

  const { data: mineRows } = await db
    .from('assignments')
    .select('id, status, checked_in_at, checked_out_at, slot_id, slots!assignments_slot_id_fkey!inner ( id, role, call_time, event_id )')
    .eq('user_id', viewer.userId)
    .eq('slots.event_id', eventId);
  const mine = (mineRows ?? []).find((a) => isCommitted(String(a.status)));
  if (!mine) notFound();
  const slot = mine.slots as unknown as { id: string; role: string; call_time: string };

  const [brief, shots, deliverables, crew, contacts, clientContact] = await Promise.all([
    db.from('briefs').select('summary, body').eq('event_id', eventId).maybeSingle(),
    db.from('shot_list_items').select('id, must_have, slot_id').eq('event_id', eventId),
    db.from('deliverables').select('id, title, due_at, spec').eq('slot_id', slot.id).order('due_at'),
    db.from('event_crew').select('user_id, full_name, role, phone').eq('event_id', eventId),
    db.from('event_contacts').select('kind, name, phone').eq('event_id', eventId).order('kind'),
    event.client_id
      ? db.from('client_contacts').select('name, phone, email').eq('client_id', event.client_id).order('is_primary', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const myShots = (shots.data ?? []).filter((s) => !s.slot_id || s.slot_id === slot.id);
  const mustCount = myShots.filter((s) => s.must_have).length;
  const status = String(mine.status);
  const onSite = ['checked_in', 'checked_out', 'uploaded', 'changes_requested', 'approved', 'paid'].includes(status);
  const body = String(brief.data?.body ?? '');
  const bullets = body.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3);

  return (
    <>
      <BackLink href="/app">Home</BackLink>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Eyebrow tone="label">
          {formatDay(String(event.starts_at), zone)} · {slot.role}
        </Eyebrow>
        <H1>{String(event.title)}</H1>
        <Muted>
          Call {formatTime(slot.call_time, zone)} · Wrap {formatTime(String(event.ends_at), zone)} · {onSite ? 'On site' : 'Confirmed'}
        </Muted>
      </div>

      <div className="c-cols">
      <div className="c-col">
      <Card>
        {status === 'confirmed' ? (
          ['staffed', 'in_progress'].includes(String(event.status)) ? (
            <>
              <CheckInButton action={checkIn} assignmentId={String(mine.id)} />
              <details>
                <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, border: `1px solid ${color.border}`, fontFamily: fonts.label, fontWeight: 600, fontSize: 14 }}>
                  Running late
                </summary>
                <div style={{ paddingTop: 10 }}>
                  <ActionForm action={runningLate} submit="Send ETA" variant="secondary">
                    <input type="hidden" name="assignment_id" value={String(mine.id)} />
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                      Minutes until you arrive
                      <input name="minutes" type="number" min={1} max={600} defaultValue={15} style={inputStyle} />
                    </label>
                  </ActionForm>
                </div>
              </details>
            </>
          ) : (
            <Muted>Check-in opens once the event is fully staffed. You are confirmed.</Muted>
          )
        ) : (
          <Notice>
            Checked in at {mine.checked_in_at ? formatTime(String(mine.checked_in_at), zone) : '—'}
            {mine.checked_out_at ? ` · checked out at ${formatTime(String(mine.checked_out_at), zone)}` : ''}
          </Notice>
        )}
      </Card>

      <Section title="Location">
        <Card>
          <strong style={{ fontSize: 15 }}>{String(event.venue_name ?? 'Venue')}</strong>
          <Muted>{String(event.address ?? event.area_label ?? '')}</Muted>
          {event.address || event.venue_name ? (
            <a href={mapsUrl(String(event.address ?? event.venue_name))} target="_blank" rel="noreferrer" style={{ minHeight: 44, borderRadius: 12, background: color.surfaceAlt, color: color.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.label, fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>
              Open in Maps
            </a>
          ) : null}
        </Card>
      </Section>

      {event.arrival_notes || event.parking_notes ? (
        <Section title="Arrival and parking">
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: color.textBody }}>
            {[event.arrival_notes, event.parking_notes].filter(Boolean).join(' ')}
          </p>
        </Section>
      ) : null}

      {event.dress_code ? (
        <Section title="Dress code">
          <p style={{ margin: 0, fontSize: 15 }}>{String(event.dress_code)}</p>
        </Section>
      ) : null}

      {brief.data ? (
        <Section title="Creative brief">
          <Card>
            {brief.data.summary ? <strong style={{ fontSize: 15 }}>{String(brief.data.summary)}</strong> : null}
            {bullets.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.5, color: color.textBody }}>
                {bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
            {body.length > bullets.join(' ').length + 5 ? (
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 14, color: color.label }}>Read the full brief</summary>
                <p style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{body}</p>
              </details>
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Link href={`/app/events/${eventId}/shots`} style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.xl, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none', color: color.text }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong style={{ fontSize: 15 }}>Shot list</strong>
          <Muted size={13}>
            {myShots.length} shots · {mustCount} must-have
          </Muted>
        </span>
        <span aria-hidden="true" style={{ fontSize: 20, color: color.textMuted }}>›</span>
      </Link>

      {(deliverables.data ?? []).length ? (
        <Section title="Your deliverables">
          {(deliverables.data ?? []).map((d) => (
            <ListRow key={String(d.id)} label={String(d.title)} value={<Muted size={13}>{d.due_at ? `Due ${dateTime(String(d.due_at), zone)}` : 'No due time'}</Muted>} />
          ))}
        </Section>
      ) : null}

      </div>
      <div className="c-aside">
      {clientContact.data ? (
        <Section title="Client contact">
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <strong style={{ fontSize: 15 }}>{String(clientContact.data.name)}</strong>
                <Muted size={13}>{String(clientContact.data.email ?? '')}</Muted>
              </span>
              {clientContact.data.phone ? (
                <>
                  <RoundLink href={`tel:${String(clientContact.data.phone)}`} label="Call" path="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
                  <RoundLink href={`sms:${String(clientContact.data.phone)}`} label="Text" path="M4 5h16v11H8l-4 4z" />
                </>
              ) : null}
            </div>
          </Card>
        </Section>
      ) : null}

      <Section title="Crew">
        {(crew.data ?? []).map((c) => (
          <ListRow
            key={String(c.user_id) + String(c.role)}
            label={`${String(c.full_name ?? 'Crew')}${c.user_id === viewer.userId ? ' (you)' : ''}`}
            value={
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Muted size={13}>{String(c.role)}</Muted>
                {c.phone && c.user_id !== viewer.userId ? <a href={`tel:${String(c.phone)}`} style={{ fontSize: 14 }}>Call</a> : null}
              </span>
            }
          />
        ))}
      </Section>

      {(contacts.data ?? []).length ? (
        <Section title="On-site and emergency contacts">
          {(contacts.data ?? []).map((c, i) => (
            <ListRow
              key={i}
              label={`${String(c.name)}${c.kind === 'emergency' ? ' (emergency)' : ''}`}
              value={c.phone ? <a href={`tel:${String(c.phone)}`} style={{ color: color.label, fontWeight: 600 }}>Call</a> : <Muted size={13}>No phone</Muted>}
            />
          ))}
        </Section>
      ) : null}

      <BottomBar>
        <LinkButton href="/app/uploads" variant="primary" height={52} style={{ width: '100%' }}>
          Upload footage
        </LinkButton>
        <Muted size={12}>{timeRange(String(event.starts_at), String(event.ends_at), zone)}</Muted>
      </BottomBar>
      </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Eyebrow>{title}</Eyebrow>
      {children}
    </section>
  );
}

function RoundLink({ href, label, path }: { href: string; label: string; path: string }) {
  return (
    <a href={href} aria-label={label} style={{ width: 44, height: 44, borderRadius: 22, background: color.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', color: color.text }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={path} />
      </svg>
    </a>
  );
}
