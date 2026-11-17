import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { BackLink, Card, H1, H2, ListRow, Muted, Row, StatusText, Table, Tag, td } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { ASSIGNMENT_STATUS, PAYOUT_STATUS, dateTime, money } from '@/lib/format';
import { color } from '@/lib/ui';
import { reviewDocument } from '../actions';

export const metadata: Metadata = { title: 'Contractor' };
export const dynamic = 'force-dynamic';

const DOC_LABEL: Record<string, string> = {
  contractor_agreement: 'Contractor agreement',
  insurance: 'Insurance certificate',
  w9: 'W-9',
};

export default async function ContractorPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const viewer = await requireAdmin();
  const db = viewer.supabase;

  const [{ data: profile }, { data: membership }] = await Promise.all([
    db.from('profiles').select('full_name, email, phone, bio, portfolio_links').eq('user_id', userId).maybeSingle(),
    db.from('memberships').select('role, status, created_at').eq('org_id', viewer.org.id).eq('user_id', userId),
  ]);
  if (!profile || (membership ?? []).length === 0) notFound();

  const [details, gear, docs, history, ratings, payouts] = await Promise.all([
    db.from('contractor_details').select('*').eq('user_id', userId).maybeSingle(),
    db.from('equipment').select('category, make, model').eq('user_id', userId).order('category'),
    db.from('compliance_documents').select('id, doc_type, status, expires_on, created_at').eq('org_id', viewer.org.id).eq('user_id', userId).order('created_at', { ascending: false }),
    db.from('assignments')
      .select('id, status, created_at, slots!assignments_slot_id_fkey ( role, events!slots_event_id_fkey ( id, title, starts_at, time_zone ) )')
      .eq('org_id', viewer.org.id)
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    db.from('ratings').select('quality, punctuality, communication, notes, created_at, assignments!ratings_assignment_id_fkey!inner ( user_id )').eq('org_id', viewer.org.id).eq('assignments.user_id', userId),
    db.from('payouts').select('id, assignment_id, amount_cents, status, created_at, assignments!payouts_assignment_id_fkey!inner ( user_id )').eq('org_id', viewer.org.id).eq('assignments.user_id', userId),
  ]);

  const d = details.data;
  const ratingRows = ratings.data ?? [];
  const avg = (key: 'quality' | 'punctuality' | 'communication') =>
    ratingRows.length ? (ratingRows.reduce((n, r) => n + Number(r[key]), 0) / ratingRows.length).toFixed(1) : '—';
  const paid = (payouts.data ?? []).filter((p) => p.status === 'paid').reduce((n, p) => n + Number(p.amount_cents), 0);

  return (
    <>
      <BackLink href="/contractors">Contractors</BackLink>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <H1>{String(profile.full_name)}</H1>
        <Muted>
          {[profile.email, profile.phone].filter(Boolean).join(' · ')} · {(membership ?? []).map((m) => String(m.role)).join(', ')}
        </Muted>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        <Card>
          <H2 size={20}>Profile</H2>
          <ListRow label="Based in" value={d?.home_base_label ? String(d.home_base_label) : <Muted size={13}>Not set</Muted>} />
          <ListRow label="Travels up to" value={d?.travel_radius_miles ? `${String(d.travel_radius_miles)} miles` : '—'} />
          <ListRow label="Skills" value={((d?.skills as string[] | undefined) ?? []).join(', ') || '—'} />
          <ListRow label="Default rate" value={d?.default_rate_cents ? money(Number(d.default_rate_cents)) : '—'} />
          <ListRow label="Stripe payouts" value={d?.stripe_payouts_enabled ? <StatusText tone="positive">Ready</StatusText> : <StatusText tone="warn">Not set up</StatusText>} />
          {profile.bio ? <Muted>{String(profile.bio)}</Muted> : null}
        </Card>
        <Card>
          <H2 size={20}>Gear</H2>
          {(gear.data ?? []).length === 0 ? <Muted>None listed.</Muted> : null}
          {(gear.data ?? []).map((g, i) => (
            <ListRow key={i} label={String(g.category).replace('_', ' ')} value={[g.make, g.model].filter(Boolean).join(' ') || '—'} />
          ))}
        </Card>
        <Card>
          <H2 size={20}>Ratings</H2>
          <ListRow label="Quality" value={avg('quality')} />
          <ListRow label="Punctuality" value={avg('punctuality')} />
          <ListRow label="Communication" value={avg('communication')} />
          <Muted size={13}>{ratingRows.length} rated jobs · {money(paid)} paid out. Contractors never see their ratings.</Muted>
        </Card>
      </div>

      <Card>
        <H2 size={20}>Documents</H2>
        {(docs.data ?? []).length === 0 ? <Muted>Nothing uploaded yet.</Muted> : null}
        {(docs.data ?? []).map((doc) => {
          const expiring = doc.expires_on && new Date(String(doc.expires_on)).getTime() < Date.now() + 60 * 86_400_000;
          return (
            <Row key={String(doc.id)} align="center" gap={10}>
              <strong style={{ fontSize: 14, minWidth: 180 }}>{DOC_LABEL[String(doc.doc_type)] ?? String(doc.doc_type)}</strong>
              <Tag tone={doc.status === 'approved' ? 'positive' : doc.status === 'rejected' || doc.status === 'expired' ? 'danger' : 'warn'}>{String(doc.status)}</Tag>
              {doc.expires_on ? <StatusText tone={expiring ? 'warn' : 'muted'}>Expires {String(doc.expires_on)}</StatusText> : null}
              {doc.status === 'submitted' || doc.status === 'pending' ? (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <ActionForm action={reviewDocument} submit="Approve" layout="inline">
                    <input type="hidden" name="document_id" value={String(doc.id)} />
                    <input type="hidden" name="status" value="approved" />
                  </ActionForm>
                  <ActionForm action={reviewDocument} submit="Reject" variant="danger" layout="inline">
                    <input type="hidden" name="document_id" value={String(doc.id)} />
                    <input type="hidden" name="status" value="rejected" />
                  </ActionForm>
                </span>
              ) : null}
            </Row>
          );
        })}
      </Card>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <H2 size={20}>Work history</H2>
        {(history.data ?? []).length === 0 ? (
          <Muted>No jobs yet.</Muted>
        ) : (
          <Table head={['Event', 'Role', 'When', 'Status', 'Payout']} minWidth={700}>
            {(history.data ?? []).map((a) => {
              const slot = a.slots as unknown as { role: string; events: { id: string; title: string; starts_at: string; time_zone: string } };
              const st = ASSIGNMENT_STATUS[String(a.status)] ?? { label: String(a.status), tone: 'muted' as const };
              const payout = (payouts.data ?? []).find((p) => String((p as { assignment_id?: string }).assignment_id) === String(a.id));
              return (
                <tr key={String(a.id)}>
                  <td style={td}>
                    <Link href={`/events/${slot.events.id}`} style={{ color: color.text, fontWeight: 700 }}>{slot.events.title}</Link>
                  </td>
                  <td style={td}>{slot.role}</td>
                  <td style={td}>{dateTime(slot.events.starts_at, slot.events.time_zone)}</td>
                  <td style={td}><Tag tone={st.tone}>{st.label}</Tag></td>
                  <td style={td}>{payout ? `${money(Number(payout.amount_cents))} · ${PAYOUT_STATUS[String(payout.status)]?.label ?? payout.status}` : '—'}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </section>
    </>
  );
}
