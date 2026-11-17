import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { Card, Empty, Field, H2, LinkButton, Muted, Row, Tag, inputStyle, textareaStyle } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { LEAD_STATUS, dateTime } from '@/lib/format';
import { color, radius } from '@/lib/ui';
import { addLead, setLeadStatus } from '../client-actions';

export const metadata: Metadata = { title: 'Inquiries' };
export const dynamic = 'force-dynamic';

const COLUMNS = ['new', 'contacted', 'proposal_sent', 'booked', 'lost'] as const;

export default async function LeadsPage() {
  const viewer = await requireAdmin();
  const [{ data: rows }, { data: org }] = await Promise.all([
    viewer.supabase
      .from('leads')
      .select('id, name, email, phone, event_type, event_date, location, message, status, created_at, client_id, packages(name)')
      .eq('org_id', viewer.org.id)
      .order('created_at', { ascending: false })
      .limit(300),
    viewer.supabase.from('organization_public').select('slug').eq('id', viewer.org.id).maybeSingle(),
  ]);
  const leads = (rows ?? []) as unknown as Array<{
    id: string; name: string; email: string | null; phone: string | null; event_type: string | null; event_date: string | null;
    location: string | null; message: string | null; status: string; created_at: string; client_id: string | null; packages: { name: string } | null;
  }>;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const formUrl = `${proto}://${host}/inquire/${String(org?.slug ?? '')}`;

  return (
    <>
      <PageHeader title="Inquiries" subtitle="Every lead from your inquiry form, and any you add by hand, from first message to booked." />
      <Card>
        <Row align="center">
          <span style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <strong>Your public inquiry form</strong>
            <code style={{ fontSize: 13, overflowWrap: 'anywhere', color: color.textSecondary }}>{formUrl}</code>
            <Muted size={13}>Link it from your website, Instagram bio or email signature. New inquiries land in the first column.</Muted>
          </span>
          <LinkButton href={`/inquire/${String(org?.slug ?? '')}`} variant="secondary">Open the form</LinkButton>
        </Row>
      </Card>

      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {COLUMNS.map((col) => {
            const items = leads.filter((l) => l.status === col);
            return (
              <section key={col} aria-label={LEAD_STATUS[col]?.label} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: color.textMuted, display: 'flex', justifyContent: 'space-between' }}>
                  {LEAD_STATUS[col]?.label}
                  <span>{items.length}</span>
                </h2>
                {items.length === 0 ? <Muted size={13}>None</Muted> : null}
                {items.map((l) => (
                  <article key={l.id} style={{ background: color.surface, border: `1px solid ${col === 'new' ? color.label : color.border}`, borderRadius: radius.md, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <strong style={{ fontSize: 14 }}>{l.name}</strong>
                    <span style={{ fontSize: 12, color: color.textMuted }}>
                      {[l.event_type, l.event_date, l.location].filter(Boolean).join(' · ') || 'No event details'}
                    </span>
                    {l.packages?.name ? <Tag tone="label">{l.packages.name}</Tag> : null}
                    <span style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                      {l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : null}
                      {l.email && l.phone ? ' · ' : null}
                      {l.phone ? <a href={`tel:${l.phone}`}>{l.phone}</a> : null}
                    </span>
                    {l.message ? (
                      <details>
                        <summary style={{ cursor: 'pointer', fontSize: 12, color: color.label }}>Message</summary>
                        <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{l.message}</p>
                      </details>
                    ) : null}
                    <span style={{ fontSize: 11, color: color.textMuted }}>Received {dateTime(l.created_at, 'America/New_York')}</span>
                    {col === 'booked' ? (
                      l.client_id ? <Link href={`/clients/${l.client_id}`} style={{ fontSize: 13 }}>Open client →</Link> : null
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {col !== 'lost' ? (
                          <LinkButton href={`/proposals/new?lead=${l.id}`} height={32} style={{ fontSize: 12, padding: '0 10px' }}>
                            Proposal
                          </LinkButton>
                        ) : null}
                        {col === 'new' ? (
                          <ActionForm action={setLeadStatus} submit="Contacted" variant="secondary" height={32} layout="inline" buttonStyle={{ fontSize: 12, padding: '0 10px' }}>
                            <input type="hidden" name="lead_id" value={l.id} />
                            <input type="hidden" name="status" value="contacted" />
                          </ActionForm>
                        ) : null}
                        <ActionForm action={setLeadStatus} submit={col === 'lost' ? 'Reopen' : 'Lost'} variant="secondary" height={32} layout="inline" buttonStyle={{ fontSize: 12, padding: '0 10px' }}>
                          <input type="hidden" name="lead_id" value={l.id} />
                          <input type="hidden" name="status" value={col === 'lost' ? 'new' : 'lost'} />
                        </ActionForm>
                      </div>
                    )}
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      <Card>
        <H2 size={20}>Add an inquiry by hand</H2>
        <Muted size={13}>For leads that came by phone, DM or referral.</Muted>
        <ActionForm action={addLead} submit="Add inquiry" reset>
          <Row>
            <Field label="Name"><input name="name" required style={inputStyle} /></Field>
            <Field label="Email"><input name="email" type="email" style={inputStyle} /></Field>
            <Field label="Phone"><input name="phone" type="tel" style={inputStyle} /></Field>
          </Row>
          <Row>
            <Field label="Event type"><input name="event_type" style={inputStyle} placeholder="Wedding" /></Field>
            <Field label="Date"><input name="event_date" type="date" style={inputStyle} /></Field>
            <Field label="Location"><input name="location" style={inputStyle} placeholder="Columbus, OH" /></Field>
          </Row>
          <Field label="Notes"><textarea name="message" style={textareaStyle} /></Field>
        </ActionForm>
      </Card>
      {leads.length === 0 ? <Empty title="No inquiries yet">Share your inquiry form link to start collecting them.</Empty> : null}
    </>
  );
}
