import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { DeliverUploader } from './DeliverUploader';
import { PageHeader } from '@/components/PageHeader';
import { BackLink, Card, Field, H2, Muted, Notice, Row, StatusText, inputStyle } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { bytes, dateTime, formatDay } from '@/lib/format';
import { color } from '@/lib/ui';
import { releaseMedia, removeStudioUpload } from '../../../client-actions';

export const metadata: Metadata = { title: 'Deliver to client', description: 'Upload finished photos and video straight to the client’s Media tab.', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const KIND: Record<string, string> = { deliverables: 'Final edit', selects: 'Select' };

/**
 * The studio's own delivery to the client: finished edits and selects
 * uploaded straight to this event, outside any crew assignment. They reach
 * the client's Media tab once the project is released.
 */
export default async function DeliverPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await requireAdmin();
  const db = viewer.supabase;
  const { data: event } = await db.from('events').select('id, title, starts_at, time_zone, client_id, clients!events_client_id_fkey(name)').eq('id', eventId).maybeSingle();
  if (!event) notFound();
  const [{ data: files }, { data: release }, { data: crew }] = await Promise.all([
    db.from('uploads').select('id, filename, bytes, kind, status, completed_at, created_at').eq('event_id', eventId).order('created_at', { ascending: false }),
    db.from('media_releases').select('released_at, message').eq('event_id', eventId).maybeSingle(),
    db.from('slots').select('assignments!assignments_slot_id_fkey(status, uploads!uploads_assignment_id_fkey(id, status))').eq('event_id', eventId),
  ]);
  const zone = String(event.time_zone);
  const clientName = (event.clients as unknown as { name: string } | null)?.name ?? null;
  const done = (files ?? []).filter((f) => f.status === 'completed');
  const approvedCrew = ((crew ?? []) as unknown as Array<{ assignments: Array<{ status: string; uploads: Array<{ status: string }> }> }>)
    .flatMap((s) => s.assignments)
    .filter((a) => a.status === 'approved' || a.status === 'paid')
    .reduce((n, a) => n + a.uploads.filter((u) => u.status === 'completed').length, 0);

  return (
    <>
      <BackLink href={`/events/${eventId}`}>{String(event.title)}</BackLink>
      <PageHeader title="Deliver to client" subtitle={`${String(event.title)} · ${formatDay(String(event.starts_at), zone)}${clientName ? ` · for ${clientName}` : ''}`} />

      {!event.client_id ? (
        <Notice tone="warn">This event has no client yet. Set one in the event details before delivering files.</Notice>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 20, alignItems: 'start' }}>
        <Card>
          <H2 size={20}>Upload finished files</H2>
          <Muted size={13}>Final edits, highlight films and selects. They go straight to storage from this browser, resume if the connection drops, and are checked byte for byte when they finish.</Muted>
          {event.client_id ? <DeliverUploader eventId={eventId} /> : <Muted>Set the client first.</Muted>}
        </Card>

        <Card highlight={done.length > 0 && !release}>
          <H2 size={20}>Send to {clientName ?? 'the client'}</H2>
          {release ? (
            <Notice>Released {dateTime(String(release.released_at), zone)}. New files appear in their Media tab as soon as they finish uploading.</Notice>
          ) : (
            <Muted>Nothing is visible to the client until you send it. They’ll see it in the Media tab of their portal.</Muted>
          )}
          <Muted size={13}>
            Ready to send: {done.length} studio file{done.length === 1 ? '' : 's'}
            {approvedCrew ? ` and ${approvedCrew} approved crew file${approvedCrew === 1 ? '' : 's'}` : ''}.
          </Muted>
          {event.client_id && (done.length > 0 || approvedCrew > 0) ? (
            <ActionForm action={releaseMedia} submit={release ? 'Update the note' : `Send to ${clientName ?? 'the client'}`} variant={release ? 'secondary' : 'primary'}>
              <input type="hidden" name="event_id" value={eventId} />
              <Field label="Note to the client (optional)">
                <input name="message" defaultValue={String(release?.message ?? '')} style={inputStyle} placeholder="Your highlight film is ready!" />
              </Field>
            </ActionForm>
          ) : null}
          {event.client_id ? <Link href={`/clients/${String(event.client_id)}`} style={{ fontSize: 14 }}>Open the client →</Link> : null}
        </Card>
      </div>

      <Card>
        <H2 size={20}>Delivered by the studio</H2>
        {(files ?? []).length === 0 ? <Muted>No files yet.</Muted> : null}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {(files ?? []).map((f) => (
            <li key={String(f.id)} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0', borderTop: `1px solid ${color.divider}` }}>
              <span style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{String(f.filename)}</span>
                <Muted size={13}>{KIND[String(f.kind)] ?? String(f.kind)} · {bytes(Number(f.bytes))}</Muted>
              </span>
              <StatusText tone={f.status === 'completed' ? 'positive' : f.status === 'failed' || f.status === 'aborted' ? 'warn' : 'muted'}>
                {f.status === 'completed' ? (release ? 'With the client' : 'Ready to send') : f.status === 'in_progress' || f.status === 'pending' ? 'Uploading' : String(f.status)}
              </StatusText>
              <Row align="center" gap={8}>
                {f.status === 'completed' ? <a href={`/download/${String(f.id)}`} style={{ fontSize: 14 }}>Download<span className="sr-only"> {String(f.filename)}</span></a> : null}
                <ActionForm action={removeStudioUpload} submit="Remove" variant="secondary" layout="inline" height={32} confirm={`Remove ${String(f.filename)}? The client will no longer see it.`}>
                  <input type="hidden" name="upload_id" value={String(f.id)} />
                  <input type="hidden" name="event_id" value={eventId} />
                </ActionForm>
              </Row>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
