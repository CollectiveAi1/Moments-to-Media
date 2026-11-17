import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BackLink, Card, H1, H2, ListRow, Muted, Notice, Tag } from '@/components/ui';
import { requireClient } from '@/lib/context';
import { INVOICE_STATUS, bytes, dateTime, formatDay, money, timeRange } from '@/lib/format';
import { color } from '@/lib/ui';

export const metadata: Metadata = { title: 'Project' };
export const dynamic = 'force-dynamic';

export default async function PortalProject({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await requireClient();
  const db = viewer.supabase;
  const [{ data: e }, { data: release }, { data: media }, { data: proposal }, { data: invoices }] = await Promise.all([
    db.from('events').select('id, title, starts_at, ends_at, time_zone, venue_name, address, status').eq('id', eventId).maybeSingle(),
    db.from('media_releases').select('released_at, message').eq('event_id', eventId).maybeSingle(),
    db.rpc('client_media', { p_event: eventId }),
    db.from('proposals').select('id, title, signer_name, responded_at, signed_contract, status').eq('event_id', eventId).eq('status', 'accepted').maybeSingle(),
    db.from('invoices').select('id, number, title, status, total_cents, paid_cents').eq('event_id', eventId).neq('status', 'draft'),
  ]);
  if (!e) notFound();
  const zone = String(e.time_zone);
  const files = (media ?? []) as Array<{ id: string; filename: string; bytes: number | null; kind: string; completed_at: string | null }>;
  const totalBytes = files.reduce((n, f) => n + Number(f.bytes ?? 0), 0);

  return (
    <>
      <BackLink href="/portal">Overview</BackLink>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <H1>{String(e.title)}</H1>
        <Muted>
          {formatDay(String(e.starts_at), zone)} · {timeRange(String(e.starts_at), String(e.ends_at), zone)}
          {e.venue_name || e.address ? ` · ${[e.venue_name, e.address].filter(Boolean).join(', ')}` : ''}
        </Muted>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, alignItems: 'start' }}>
        <Card highlight={files.length > 0}>
          <H2 size={20}>Your photos and video</H2>
          {release ? (
            <>
              {release.message ? <Notice>{String(release.message)}</Notice> : null}
              <Muted size={13}>Delivered {dateTime(String(release.released_at), zone)} · {files.length} file{files.length === 1 ? '' : 's'} · {bytes(totalBytes)}</Muted>
              {files.map((f) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${color.divider}`, padding: '8px 0' }}>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</span>
                    <Muted size={12}>{bytes(f.bytes)}{f.kind === 'deliverables' ? ' · final' : f.kind === 'selects' ? ' · selects' : ''}</Muted>
                  </span>
                  <a href={`/download/${f.id}`} style={{ minHeight: 40, padding: '0 14px', display: 'flex', alignItems: 'center', borderRadius: 8, background: color.primary, color: color.onPrimary, textDecoration: 'none', fontWeight: 600, fontSize: 13 }}>
                    Download
                  </a>
                </div>
              ))}
              <Muted size={12}>Each download link is private to you and lasts 15 minutes; open this page again for a fresh one.</Muted>
            </>
          ) : (
            <Muted>Your media will appear here as soon as it’s edited and approved. We’ll let you know.</Muted>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card>
            <H2 size={20}>Billing</H2>
            {(invoices ?? []).length === 0 ? <Muted>No invoices for this project.</Muted> : null}
            {(invoices ?? []).map((i) => {
              const st = INVOICE_STATUS[String(i.status)] ?? { label: String(i.status), tone: 'muted' as const };
              return (
                <ListRow
                  key={String(i.id)}
                  label={<Link href={`/portal/invoices/${String(i.id)}`}>Invoice {String(i.number)}</Link>}
                  value={<span>{money(Number(i.paid_cents))} of {money(Number(i.total_cents))} · <Tag tone={st.tone}>{st.label}</Tag></span>}
                />
              );
            })}
          </Card>
          {proposal ? (
            <Card>
              <H2 size={20}>Your contract</H2>
              <Muted size={13}>Signed by {String(proposal.signer_name)} on {dateTime(String(proposal.responded_at), zone)}.</Muted>
              <details>
                <summary style={{ cursor: 'pointer', color: color.label, fontSize: 14 }}>Read the signed contract</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6 }}>{String(proposal.signed_contract ?? '')}</pre>
              </details>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
