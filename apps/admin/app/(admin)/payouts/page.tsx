import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { Empty, Muted, Notice, Table, Tag, td } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { PAYOUT_STATUS, dateTime, money } from '@/lib/format';
import { color, fonts } from '@/lib/ui';
import { movePayout } from './actions';

export const metadata: Metadata = { title: 'Payouts', description: 'Contractor payouts from draft to paid.' };
export const dynamic = 'force-dynamic';

type Payout = {
  id: string; amount_cents: number; adjustments: Array<{ amount_cents: number; reason?: string }> | null; status: string;
  created_at: string; submitted_at: string | null; approved_at: string | null; sent_at: string | null; paid_at: string | null; failure_reason: string | null;
  assignments: { user_id: string; slots: { role: string; events: { id: string; title: string; starts_at: string; time_zone: string; producer_id: string } } };
};

const FILTERS = ['open', 'paid', 'all'] as const;

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show = 'open' } = await searchParams;
  const viewer = await requireAdmin();
  let q = viewer.supabase
    .from('payouts')
    .select('id, amount_cents, adjustments, status, created_at, submitted_at, approved_at, sent_at, paid_at, failure_reason, assignments!payouts_assignment_id_fkey ( user_id, slots!assignments_slot_id_fkey ( role, events!slots_event_id_fkey ( id, title, starts_at, time_zone, producer_id ) ) )')
    .eq('org_id', viewer.org.id)
    .order('created_at', { ascending: false });
  if (show === 'open') q = q.in('status', ['draft', 'submitted', 'approved', 'sent', 'failed']);
  if (show === 'paid') q = q.eq('status', 'paid');
  const { data, error } = await q;
  if (error) throw new Error(`Could not load payouts: ${error.message}`);
  const payouts = (data ?? []) as unknown as Payout[];

  const ids = [...new Set(payouts.map((p) => p.assignments.user_id))];
  const { data: profiles } = ids.length ? await viewer.supabase.from('profiles').select('user_id, full_name').in('user_id', ids) : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [String(p.user_id), String(p.full_name)]));
  const total = (p: Payout) => p.amount_cents + (p.adjustments ?? []).reduce((n, a) => n + Number(a.amount_cents ?? 0), 0);
  const waiting = payouts.filter((p) => p.status === 'submitted');

  return (
    <>
      <PageHeader
        title="Payouts"
        subtitle={`Approving a deliverable queues its payout here as a draft. ${waiting.length ? `${waiting.length} awaiting approval (${money(waiting.reduce((n, p) => n + total(p), 0))}).` : ''}`}
      />
      <Notice tone="warn">
        Stripe Connect is not connected yet, so nothing is transferred from here. Until it is, the owner records Sent and Paid by
        hand after paying by other means. Hourly payouts are computed from check-in and check-out, rounded up to the quarter hour.
      </Notice>
      <nav style={{ display: 'flex', gap: 8 }}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/payouts?show=${f}`}
            style={{
              minHeight: 36, padding: '0 14px', borderRadius: 18, display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: 600, textDecoration: 'none',
              border: f === show ? 0 : `1px solid ${color.border}`, background: f === show ? color.primary : 'transparent', color: f === show ? color.onPrimary : color.textSecondary,
            }}
          >
            {f === 'open' ? 'Open' : f === 'paid' ? 'Paid' : 'All'}
          </Link>
        ))}
      </nav>
      {payouts.length === 0 ? (
        <Empty title="No payouts here">Payouts appear when a contractor’s deliverables are approved.</Empty>
      ) : (
        <Table head={['Contractor', 'Event', 'Amount', 'Status', 'Updated', '']} minWidth={900}>
          {payouts.map((p) => {
            const st = PAYOUT_STATUS[p.status] ?? { label: p.status, tone: 'muted' as const };
            const ev = p.assignments.slots.events;
            const last = p.paid_at ?? p.sent_at ?? p.approved_at ?? p.submitted_at ?? p.created_at;
            const actions: Array<{ to: string; label: string; variant: 'admin' | 'secondary' | 'danger' }> = [];
            if (p.status === 'draft' || p.status === 'failed') actions.push({ to: 'submitted', label: p.status === 'failed' ? 'Resubmit' : 'Submit', variant: 'admin' });
            if (viewer.isOwner && p.status === 'submitted') actions.push({ to: 'approved', label: 'Approve', variant: 'admin' });
            if (viewer.isOwner && p.status === 'approved') actions.push({ to: 'sent', label: 'Record sent', variant: 'secondary' });
            if (viewer.isOwner && p.status === 'sent') {
              actions.push({ to: 'paid', label: 'Record paid', variant: 'admin' });
              actions.push({ to: 'failed', label: 'Record failed', variant: 'danger' });
            }
            return (
              <tr key={p.id}>
                <td style={td}>
                  <Link href={`/contractors/${p.assignments.user_id}`} style={{ color: color.text, fontWeight: 700 }}>{names.get(p.assignments.user_id) ?? 'Contractor'}</Link>
                  <div><Muted size={12}>{p.assignments.slots.role}</Muted></div>
                </td>
                <td style={td}>
                  <Link href={`/events/${ev.id}`} style={{ color: color.text }}>{ev.title}</Link>
                  <div><Muted size={12}>{dateTime(ev.starts_at, ev.time_zone)}</Muted></div>
                </td>
                <td style={{ ...td, fontFamily: fonts.heading, fontSize: 17, fontWeight: 600 }}>{money(total(p))}</td>
                <td style={td}>
                  <Tag tone={st.tone}>{st.label}</Tag>
                  {p.failure_reason ? <div><Muted size={12}>{p.failure_reason}</Muted></div> : null}
                </td>
                <td style={td}>{dateTime(last, ev.time_zone)}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {actions.map((a) => (
                      <ActionForm key={a.to} action={movePayout} submit={a.label} variant={a.variant} layout="inline" {...(a.to === 'failed' ? { confirm: 'Record this payout as failed?' } : {})}>
                        <input type="hidden" name="payout_id" value={p.id} />
                        <input type="hidden" name="to" value={a.to} />
                        {a.to === 'failed' ? <input type="hidden" name="reason" value="Recorded as failed by the owner" /> : null}
                      </ActionForm>
                    ))}
                    {p.status === 'submitted' && !viewer.isOwner ? <Muted size={12}>Waiting for the owner</Muted> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
