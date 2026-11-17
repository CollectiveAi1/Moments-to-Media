import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { PublicShell } from '@/components/PublicShell';
import { Card, H1, LinkButton, Muted, Notice, textareaStyle } from '@/components/ui';
import { dateTime, formatDay, money, timeRange } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { color } from '@/lib/ui';
import { declineProposal } from '../../public-actions';
import { SignForm, type SignItem } from './SignForm';

export const metadata: Metadata = { title: 'Your proposal', description: 'Review your proposal, choose add-ons, sign and book.', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Proposal = {
  org_name: string; title: string; client_name: string; intro: string | null; contract_body: string;
  event_starts_at: string; event_ends_at: string; time_zone: string; venue_name: string | null; address: string | null;
  status: string; expired: boolean; deposit_percent: number; balance_due_days_before: number; tax_rate_bp: number; discount_cents: number;
  signer_name: string | null; responded_at: string | null;
  totals: { total_cents: number; deposit_cents: number };
  items: Array<{ id: string; name: string; description: string | null; price_cents: number; quantity: number; optional: boolean; selected: boolean }>;
};

export default async function ProposalLinkPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ signed?: string }> }) {
  const { token } = await params;
  const { signed } = await searchParams;
  if (!/^[0-9a-f]{48,80}$/i.test(token)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('open_proposal', { p_token: token });
  if (error || !data) notFound();
  const p = data as Proposal;
  const zone = p.time_zone;
  const when = `${formatDay(p.event_starts_at, zone)} · ${timeRange(p.event_starts_at, p.event_ends_at, zone)}`;
  const items: SignItem[] = p.items.map((i) => ({ id: i.id, name: i.name, description: i.description, priceCents: i.price_cents, quantity: i.quantity, optional: i.optional, selected: i.selected }));

  return (
    <PublicShell orgName={p.org_name}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, color: color.textMuted }}>Proposal for {p.client_name}</span>
        <H1>{p.title}</H1>
        <Muted>{when}{p.venue_name || p.address ? ` · ${[p.venue_name, p.address].filter(Boolean).join(', ')}` : ''}</Muted>
      </div>

      {p.status === 'accepted' ? (
        <>
          <Notice>
            {signed ? 'You’re booked! ' : ''}Signed by {p.signer_name} on {p.responded_at ? dateTime(p.responded_at, zone) : ''}. Total {money(p.totals.total_cents)}.
          </Notice>
          <Card>
            <strong style={{ fontSize: 17 }}>Next: your client portal</strong>
            <Muted>
              Your invoice, the signed contract, payments and, after the event, your photos and video all live in your portal. Create your account
              with the email this proposal was sent to, and it’s all there.
            </Muted>
            <LinkButton href="/signup/client" variant="primary" height={48}>Create my portal account</LinkButton>
            <LinkButton href="/login/client" variant="secondary" height={44}>I already have an account</LinkButton>
          </Card>
          <details>
            <summary style={{ cursor: 'pointer', color: color.label }}>Signed contract</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6 }}>{p.contract_body}</pre>
          </details>
        </>
      ) : p.status === 'declined' ? (
        <Notice tone="warn">You declined this proposal. If you change your mind, reply to us and we’ll send a new one.</Notice>
      ) : p.status === 'void' ? (
        <Notice tone="warn">This proposal has been withdrawn. Contact us for an updated one.</Notice>
      ) : p.expired ? (
        <Notice tone="warn">This proposal has expired. Contact us and we’ll send a fresh one.</Notice>
      ) : (
        <>
          {p.intro ? <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{p.intro}</p> : null}
          <SignForm token={token} items={items} discountCents={p.discount_cents} taxRateBp={p.tax_rate_bp} depositPercent={p.deposit_percent} contract={p.contract_body} />
          <Muted size={13}>
            {p.deposit_percent > 0 && p.deposit_percent < 100
              ? `After you sign, a ${p.deposit_percent}% deposit holds your date. The balance is due ${p.balance_due_days_before} days before the event.`
              : 'After you sign, your invoice is ready in your client portal.'}
          </Muted>
          <details>
            <summary style={{ cursor: 'pointer', color: color.label, fontSize: 14 }}>Not the right fit? Decline</summary>
            <ActionForm action={declineProposal} submit="Decline proposal" variant="secondary" confirm="Decline this proposal?" style={{ paddingTop: 10 }}>
              <input type="hidden" name="token" value={token} />
              <textarea name="reason" placeholder="Optional: let us know why" style={textareaStyle} />
            </ActionForm>
          </details>
        </>
      )}
    </PublicShell>
  );
}
