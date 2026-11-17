import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { BackLink, Card, Field, H2, ListRow, Muted, Notice, Row, Tag, inputStyle, textareaStyle } from '@/components/ui';
import { proposalTotals } from '@/lib/billing/schedule';
import { requireAdmin } from '@/lib/context';
import { PROPOSAL_STATUS, TIME_ZONES, dateTime, money, utcToZoned } from '@/lib/format';
import { color } from '@/lib/ui';
import { addProposalItem, deleteProposal, removeProposalItem, sendProposal, updateProposal, voidProposal } from '../../client-actions';

export const metadata: Metadata = { title: 'Proposal' };
export const dynamic = 'force-dynamic';

export default async function ProposalPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const { proposalId } = await params;
  const viewer = await requireAdmin();
  const [{ data: p }, { data: items }, { data: packages }] = await Promise.all([
    viewer.supabase.from('proposals').select('*').eq('id', proposalId).maybeSingle(),
    viewer.supabase.from('proposal_items').select('id, name, description, price_cents, quantity, optional, selected').eq('proposal_id', proposalId).order('optional').order('sort_order').order('created_at'),
    viewer.supabase.from('packages').select('id, name, price_cents, is_addon').eq('org_id', viewer.org.id).eq('active', true).order('is_addon').order('sort_order'),
  ]);
  if (!p) notFound();

  const zone = String(p.time_zone);
  const draft = p.status === 'draft';
  const st = PROPOSAL_STATUS[String(p.status)] ?? { label: String(p.status), tone: 'muted' as const };
  const lines = (items ?? []).map((i) => ({ id: String(i.id), name: String(i.name), description: (i.description as string | null) ?? null, priceCents: Number(i.price_cents), quantity: Number(i.quantity), optional: Boolean(i.optional), selected: Boolean(i.selected) }));
  const totals = proposalTotals(lines, Number(p.discount_cents), Number(p.tax_rate_bp), Number(p.deposit_percent));
  const allAddons = proposalTotals(lines.map((l) => ({ ...l, selected: true })), Number(p.discount_cents), Number(p.tax_rate_bp), Number(p.deposit_percent));
  const start = utcToZoned(String(p.event_starts_at), zone);
  const end = utcToZoned(String(p.event_ends_at), zone);

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const link = `${proto}://${host}/p/${String(p.token)}`;

  return (
    <>
      <BackLink href="/proposals">Proposals</BackLink>
      <PageHeader title={String(p.title)} subtitle={`${String(p.client_name)} · ${String(p.client_email)}`} actions={<Tag tone={st.tone}>{st.label}</Tag>} />

      {draft ? null : (
        <Card highlight={p.status === 'sent' || p.status === 'viewed'}>
          {p.status === 'accepted' ? (
            <>
              <Notice>
                Signed by {String(p.signer_name)} on {dateTime(String(p.responded_at), zone)}. The event, invoice and the client’s portal access were created.
              </Notice>
              <Row align="center">
                {p.event_id ? <Link href={`/events/${String(p.event_id)}`}>Open the event (Draft, ready to staff) →</Link> : null}
                {p.invoice_id ? <Link href={`/invoices/${String(p.invoice_id)}`}>Open the invoice →</Link> : null}
                {p.client_id ? <Link href={`/clients/${String(p.client_id)}`}>Open the client →</Link> : null}
              </Row>
            </>
          ) : p.status === 'declined' ? (
            <Notice tone="warn">Declined {p.responded_at ? dateTime(String(p.responded_at), zone) : ''}{p.decline_reason ? `: “${String(p.decline_reason)}”` : '.'}</Notice>
          ) : p.status === 'void' ? (
            <Notice tone="warn">Voided. The link no longer accepts a signature.</Notice>
          ) : (
            <>
              <strong>Send this link to {String(p.client_name)}</strong>
              <code style={{ fontSize: 13, overflowWrap: 'anywhere', background: color.surfaceAlt, padding: 10, borderRadius: 8 }}>{link}</code>
              <Row align="center">
                <a href={`mailto:${String(p.client_email)}?subject=${encodeURIComponent(String(p.title))}&body=${encodeURIComponent(`Hi ${String(p.client_name).split(' ')[0]},\n\nYour proposal is ready. You can choose add-ons, sign and pay the deposit here:\n${link}\n\nThank you!`)}`}>
                  Email it from your mail app →
                </a>
                <Muted size={13}>
                  Sent {dateTime(String(p.sent_at), zone)}
                  {p.viewed_at ? ` · opened ${dateTime(String(p.viewed_at), zone)}` : ' · not opened yet'}
                </Muted>
              </Row>
              <ActionForm action={voidProposal} submit="Void this proposal" variant="secondary" confirm="Void it? The client will no longer be able to sign.">
                <input type="hidden" name="proposal_id" value={String(p.id)} />
              </ActionForm>
            </>
          )}
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 20, alignItems: 'start' }}>
        <Card>
          <H2 size={20}>What’s offered</H2>
          {lines.length === 0 ? <Muted>Add at least one package.</Muted> : null}
          {lines.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderBottom: `1px solid ${color.divider}`, paddingBottom: 10 }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <strong style={{ fontSize: 15 }}>
                  {l.name}
                  {l.quantity > 1 ? ` × ${l.quantity}` : ''}
                  {l.optional ? <span style={{ marginLeft: 8 }}><Tag tone="label">{p.status === 'accepted' ? (l.selected ? 'Add-on chosen' : 'Add-on declined') : 'Optional add-on'}</Tag></span> : null}
                </strong>
                {l.description ? <Muted size={13}>{l.description}</Muted> : null}
              </span>
              <strong>{money(l.priceCents * l.quantity)}</strong>
              {draft ? (
                <ActionForm action={removeProposalItem} submit="Remove" variant="secondary" layout="inline" height={32}>
                  <input type="hidden" name="item_id" value={l.id} />
                </ActionForm>
              ) : null}
            </div>
          ))}
          <ListRow label="Subtotal" value={money(totals.subtotal)} />
          {totals.discount ? <ListRow label="Discount" value={`−${money(totals.discount)}`} /> : null}
          {totals.tax ? <ListRow label={`Tax (${Number(p.tax_rate_bp) / 100}%)`} value={money(totals.tax)} /> : null}
          <ListRow label={<strong>Total{p.status === 'accepted' ? '' : ' without add-ons'}</strong>} value={<strong>{money(totals.total)}</strong>} />
          {p.status !== 'accepted' && allAddons.total !== totals.total ? <ListRow label="With every add-on" value={money(allAddons.total)} /> : null}
          <ListRow label={`Deposit to book (${String(p.deposit_percent)}%)`} value={money(totals.deposit)} />

          {draft ? (
            <details open={lines.length === 0}>
              <summary style={{ cursor: 'pointer', fontSize: 14, color: color.label, minHeight: 36, display: 'flex', alignItems: 'center' }}>Add a line</summary>
              <ActionForm action={addProposalItem} submit="Add" reset style={{ paddingTop: 8 }}>
                <input type="hidden" name="proposal_id" value={String(p.id)} />
                <Field label="From your packages">
                  <select name="package_id" defaultValue="" style={inputStyle}>
                    <option value="">A custom line (below)</option>
                    {(packages ?? []).map((k) => (
                      <option key={String(k.id)} value={String(k.id)}>{k.is_addon ? 'Add-on: ' : ''}{String(k.name)} · {money(Number(k.price_cents))}</option>
                    ))}
                  </select>
                </Field>
                <Row>
                  <Field label="Custom line name" grow={2}><input name="name" style={inputStyle} /></Field>
                  <Field label="Price ($)"><input name="price" inputMode="decimal" style={inputStyle} /></Field>
                  <Field label="Qty"><input name="quantity" type="number" min={1} defaultValue={1} style={inputStyle} /></Field>
                </Row>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, minHeight: 36 }}>
                  <input type="checkbox" name="optional" /> Optional: the client can tick it on or off
                </label>
              </ActionForm>
            </details>
          ) : null}
        </Card>

        <Card>
          <H2 size={20}>Details and contract</H2>
          {draft ? (
            <ActionForm action={updateProposal} submit="Save">
              <input type="hidden" name="proposal_id" value={String(p.id)} />
              <Field label="Title"><input name="title" required defaultValue={String(p.title)} style={inputStyle} /></Field>
              <Row>
                <Field label="Client name"><input name="client_name" required defaultValue={String(p.client_name)} style={inputStyle} /></Field>
                <Field label="Client email"><input name="client_email" type="email" required defaultValue={String(p.client_email)} style={inputStyle} /></Field>
              </Row>
              <Row>
                <Field label="Date"><input name="date" type="date" required defaultValue={start.date} style={inputStyle} /></Field>
                <Field label="Starts"><input name="start" type="time" defaultValue={start.time} style={inputStyle} /></Field>
                <Field label="Ends"><input name="end" type="time" defaultValue={end.time} style={inputStyle} /></Field>
                <Field label="Zone">
                  <select name="zone" defaultValue={zone} style={inputStyle}>
                    {TIME_ZONES.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
                  </select>
                </Field>
              </Row>
              <Row>
                <Field label="Venue"><input name="venue_name" defaultValue={String(p.venue_name ?? '')} style={inputStyle} /></Field>
                <Field label="Address" grow={2}><input name="address" defaultValue={String(p.address ?? '')} style={inputStyle} /></Field>
              </Row>
              <Row>
                <Field label="Deposit (%)"><input name="deposit_percent" type="number" min={0} max={100} defaultValue={Number(p.deposit_percent)} style={inputStyle} /></Field>
                <Field label="Balance due (days before)"><input name="balance_due_days_before" type="number" min={0} max={365} defaultValue={Number(p.balance_due_days_before)} style={inputStyle} /></Field>
                <Field label="Tax (%)"><input name="tax_percent" inputMode="decimal" defaultValue={String(Number(p.tax_rate_bp) / 100)} style={inputStyle} /></Field>
                <Field label="Discount ($)"><input name="discount" inputMode="decimal" defaultValue={(Number(p.discount_cents) / 100).toFixed(2)} style={inputStyle} /></Field>
              </Row>
              <Field label="Offer expires (optional)"><input name="expires_on" type="date" defaultValue={String(p.expires_on ?? '')} style={inputStyle} /></Field>
              <Field label="Note to the client"><textarea name="intro" defaultValue={String(p.intro ?? '')} style={textareaStyle} /></Field>
              <Field label="Contract" hint="The client signs exactly this text. It cannot change after you send.">
                <textarea name="contract_body" required defaultValue={String(p.contract_body)} style={{ ...textareaStyle, minHeight: 320, fontSize: 13 }} />
              </Field>
            </ActionForm>
          ) : (
            <>
              <ListRow label="Event" value={`${dateTime(String(p.event_starts_at), zone)} – ${end.time}`} />
              {p.venue_name || p.address ? <ListRow label="Where" value={[p.venue_name, p.address].filter(Boolean).join(', ')} /> : null}
              {p.intro ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{String(p.intro)}</p> : null}
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 14, color: color.label }}>{p.status === 'accepted' ? 'Signed contract' : 'Contract'}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}>{String(p.signed_contract ?? p.contract_body)}</pre>
              </details>
            </>
          )}
        </Card>
      </div>

      {draft ? (
        <Card>
          <Row align="center">
            <ActionForm action={sendProposal} submit="Send to client" variant="primary" confirm="Send it? After this the offer and contract are fixed.">
              <input type="hidden" name="proposal_id" value={String(p.id)} />
            </ActionForm>
            <ActionForm action={deleteProposal} submit="Delete draft" variant="secondary" confirm="Delete this draft?">
              <input type="hidden" name="proposal_id" value={String(p.id)} />
            </ActionForm>
          </Row>
          <Muted size={13}>Sending makes a private link the client can open on any device without an account. They choose add-ons, sign, and you get an invoice with the deposit and balance already scheduled.</Muted>
        </Card>
      ) : null}
    </>
  );
}
