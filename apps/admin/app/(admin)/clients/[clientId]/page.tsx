import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { BackLink, Card, Field, H2, LinkButton, ListRow, Muted, Row, Tag, inputStyle, textareaStyle } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { EVENT_STATUS, INVOICE_STATUS, PROPOSAL_STATUS, dateTime, formatDay, money } from '@/lib/format';
import { color, radius } from '@/lib/ui';
import { addContact, inviteClient, sendClientMessage } from '../../client-actions';

export const metadata: Metadata = { title: 'Client' };
export const dynamic = 'force-dynamic';

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const viewer = await requireAdmin();
  const db = viewer.supabase;
  const [{ data: client }, { data: contacts }, { data: events }, { data: proposals }, { data: invoices }, { data: messages }, { data: invites }] = await Promise.all([
    db.from('clients').select('id, name, created_at').eq('id', clientId).maybeSingle(),
    db.from('client_contacts').select('id, name, email, phone, is_primary, user_id').eq('client_id', clientId).order('is_primary', { ascending: false }),
    db.from('events').select('id, title, starts_at, time_zone, status').eq('client_id', clientId).order('starts_at', { ascending: false }),
    db.from('proposals').select('id, title, status, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
    db.from('invoices').select('id, number, title, status, total_cents, paid_cents').eq('client_id', clientId).order('created_at', { ascending: false }),
    db.from('client_messages').select('id, body, from_client, created_at').eq('client_id', clientId).order('created_at').limit(200),
    db.from('org_invitations').select('email, status, expires_at').eq('client_id', clientId).eq('status', 'pending'),
  ]);
  if (!client) notFound();
  const balance = (invoices ?? []).filter((i) => i.status === 'open' || i.status === 'partially_paid').reduce((n, i) => n + Number(i.total_cents) - Number(i.paid_cents), 0);
  const primary = (contacts ?? []).find((c) => c.email);

  return (
    <>
      <BackLink href="/clients">Clients</BackLink>
      <PageHeader
        title={String(client.name)}
        subtitle={balance ? `${money(balance)} outstanding` : 'Nothing outstanding'}
        actions={
          <>
            <LinkButton href={`/proposals/new?client=${clientId}`} variant="secondary">New proposal</LinkButton>
            <LinkButton href={`/invoices/new?client=${clientId}`}>New invoice</LinkButton>
          </>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card>
            <H2 size={20}>Contacts and portal access</H2>
            {(contacts ?? []).map((c) => (
              <ListRow
                key={String(c.id)}
                label={
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ fontSize: 15 }}>{String(c.name)}{c.is_primary ? ' (main)' : ''}</strong>
                    <Muted size={13}>{[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}</Muted>
                  </span>
                }
                value={c.user_id ? <Tag tone="positive">Portal active</Tag> : <Muted size={13}>No portal login</Muted>}
              />
            ))}
            {(invites ?? []).map((i) => (
              <Muted key={String(i.email)} size={13}>Invited {String(i.email)}: they get in by signing in with that address.</Muted>
            ))}
            <ActionForm action={inviteClient} submit="Give portal access" variant="secondary">
              <input type="hidden" name="client_id" value={clientId} />
              <Field label="Email they sign in with" hint="They get a sign-in link. In the portal they see their invoices, pay, download released media and message you.">
                <input name="email" type="email" defaultValue={String(primary?.email ?? '')} style={inputStyle} />
              </Field>
            </ActionForm>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 14, color: color.label }}>Add a contact</summary>
              <ActionForm action={addContact} submit="Add" reset style={{ paddingTop: 8 }}>
                <input type="hidden" name="client_id" value={clientId} />
                <Row>
                  <Field label="Name"><input name="name" required style={inputStyle} /></Field>
                  <Field label="Email"><input name="email" type="email" style={inputStyle} /></Field>
                  <Field label="Phone"><input name="phone" type="tel" style={inputStyle} /></Field>
                </Row>
              </ActionForm>
            </details>
          </Card>

          <Card>
            <H2 size={20}>Projects</H2>
            {(events ?? []).length === 0 ? <Muted>No events yet.</Muted> : null}
            {(events ?? []).map((e) => {
              const st = EVENT_STATUS[String(e.status)] ?? { label: String(e.status), tone: 'muted' as const };
              return <ListRow key={String(e.id)} label={<Link href={`/events/${String(e.id)}`}>{String(e.title)}</Link>} value={<span>{formatDay(String(e.starts_at), String(e.time_zone))} · <Tag tone={st.tone}>{st.label}</Tag></span>} />;
            })}
          </Card>

          <Card>
            <H2 size={20}>Proposals and invoices</H2>
            {(proposals ?? []).map((p) => {
              const st = PROPOSAL_STATUS[String(p.status)] ?? { label: String(p.status), tone: 'muted' as const };
              return <ListRow key={String(p.id)} label={<Link href={`/proposals/${String(p.id)}`}>{String(p.title)}</Link>} value={<Tag tone={st.tone}>{st.label}</Tag>} />;
            })}
            {(invoices ?? []).map((i) => {
              const st = INVOICE_STATUS[String(i.status)] ?? { label: String(i.status), tone: 'muted' as const };
              return <ListRow key={String(i.id)} label={<Link href={`/invoices/${String(i.id)}`}>Invoice {String(i.number)} · {String(i.title)}</Link>} value={<span>{money(Number(i.total_cents))} · <Tag tone={st.tone}>{st.label}</Tag></span>} />;
            })}
            {(proposals ?? []).length + (invoices ?? []).length === 0 ? <Muted>None yet.</Muted> : null}
          </Card>
        </div>

        <Card>
          <H2 size={20}>Messages</H2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 520, overflowY: 'auto' }}>
            {(messages ?? []).length === 0 ? <Muted>No messages yet. What you write here appears in the client’s portal.</Muted> : null}
            {(messages ?? []).map((m) => (
              <div key={String(m.id)} style={{ alignSelf: m.from_client ? 'flex-start' : 'flex-end', maxWidth: '85%', background: m.from_client ? color.surfaceAlt : color.positiveBg, borderRadius: radius.lg, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{String(m.body)}</span>
                <span style={{ fontSize: 11, color: color.textMuted }}>{m.from_client ? String(client.name) : 'You'} · {dateTime(String(m.created_at), 'America/New_York')}</span>
              </div>
            ))}
          </div>
          <ActionForm action={sendClientMessage} submit="Send" reset>
            <input type="hidden" name="client_id" value={clientId} />
            <Field label="Message"><textarea name="body" required style={textareaStyle} /></Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
