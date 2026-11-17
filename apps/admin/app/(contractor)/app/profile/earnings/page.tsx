import type { Metadata } from 'next';
import { BackLink, Card, H1, H2, Muted, StatusText } from '@/components/ui';
import { requireContractor } from '@/lib/context';
import { dateTime, money } from '@/lib/format';
import { color, fonts } from '@/lib/ui';

export const metadata: Metadata = { title: 'Earnings' };
export const dynamic = 'force-dynamic';

type Payout = {
  id: string; amount_cents: number; adjustments: Array<{ amount_cents: number }> | null; status: string; paid_at: string | null; created_at: string;
  assignments: { slots: { role: string; events: { title: string; starts_at: string; time_zone: string } } } | null;
};

const STATUS: Record<string, { label: string; tone: 'muted' | 'label' | 'positive' | 'warn' }> = {
  draft: { label: 'Upcoming', tone: 'muted' },
  submitted: { label: 'Upcoming', tone: 'muted' },
  approved: { label: 'Upcoming', tone: 'muted' },
  sent: { label: 'On the way', tone: 'label' },
  paid: { label: 'Paid', tone: 'positive' },
  failed: { label: 'Failed', tone: 'warn' },
  reversed: { label: 'Reversed', tone: 'warn' },
};

export default async function Earnings() {
  const viewer = await requireContractor();
  const year = new Date().getFullYear();
  const { data } = await viewer.supabase
    .from('payouts')
    .select('id, amount_cents, adjustments, status, paid_at, created_at, assignments!payouts_assignment_id_fkey!inner ( user_id, slots!assignments_slot_id_fkey ( role, events!slots_event_id_fkey ( title, starts_at, time_zone ) ) )')
    .eq('assignments.user_id', viewer.userId)
    .order('created_at', { ascending: false });
  const payouts = (data ?? []) as unknown as Payout[];
  const total = (p: Payout) => p.amount_cents + (p.adjustments ?? []).reduce((n, a) => n + Number(a.amount_cents ?? 0), 0);
  const paidThisYear = payouts.filter((p) => p.status === 'paid' && p.paid_at && new Date(p.paid_at).getFullYear() === year).reduce((n, p) => n + total(p), 0);

  return (
    <>
      <BackLink href="/app/profile">Profile</BackLink>
      <H1>Earnings</H1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Muted>Paid in {year}</Muted>
        <span style={{ fontFamily: fonts.heading, fontSize: 40, fontWeight: 600 }}>{money(paidThisYear)}</span>
      </div>

      <section>
        {payouts.length === 0 ? <Muted>No payouts yet. A payout is queued when the producer approves your deliverables.</Muted> : null}
        {payouts.map((p) => {
          const ev = p.assignments?.slots.events;
          const st = STATUS[p.status] ?? { label: p.status, tone: 'muted' as const };
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1px solid ${color.divider}` }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <strong style={{ fontSize: 15 }}>{ev?.title ?? 'Job'}</strong>
                <Muted size={13}>
                  {p.assignments?.slots.role} · {ev ? dateTime(ev.starts_at, ev.time_zone) : ''}
                </Muted>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <strong style={{ fontSize: 15 }}>{money(total(p))}</strong>
                <StatusText tone={st.tone}>{st.label}</StatusText>
              </span>
            </div>
          );
        })}
      </section>

      <Card>
        <H2 size={20}>Bank details and tax forms</H2>
        <Muted>Managed securely by Stripe. Your {year} 1099-NEC will be there in January.</Muted>
        <button type="button" disabled style={{ minHeight: 52, borderRadius: 14, border: 0, background: color.divider, color: color.textMuted, fontFamily: fonts.label, fontWeight: 600 }}>
          Open Stripe Express
        </button>
        <Muted size={12}>Stripe payouts are not connected for this organization yet. Until they are, the producer pays you directly and records it here.</Muted>
      </Card>
    </>
  );
}
