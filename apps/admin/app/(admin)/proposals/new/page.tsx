import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { BackLink, Card, Field, Muted, Row, inputStyle, textareaStyle } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { TIME_ZONES, money } from '@/lib/format';
import { createProposal } from '../../client-actions';

export const metadata: Metadata = { title: 'New proposal', description: 'Start a proposal for an inquiry or client.' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function NewProposalPage({ searchParams }: { searchParams: Promise<{ lead?: string; client?: string }> }) {
  const viewer = await requireAdmin();
  const { lead: leadId, client: clientId } = await searchParams;
  const [lead, client, packages] = await Promise.all([
    leadId && UUID.test(leadId)
      ? viewer.supabase.from('leads').select('id, name, email, event_type, event_date, location, package_id').eq('id', leadId).maybeSingle()
      : Promise.resolve({ data: null }),
    clientId && UUID.test(clientId)
      ? viewer.supabase.from('clients').select('id, name, client_contacts(name, email, is_primary)').eq('id', clientId).maybeSingle()
      : Promise.resolve({ data: null }),
    viewer.supabase.from('packages').select('id, name, price_cents').eq('org_id', viewer.org.id).eq('active', true).eq('is_addon', false).order('sort_order'),
  ]);
  const l = lead.data as { id: string; name: string; email: string | null; event_type: string | null; event_date: string | null; location: string | null; package_id: string | null } | null;
  const c = client.data as { id: string; name: string; client_contacts: Array<{ name: string; email: string | null; is_primary: boolean }> } | null;
  const contact = c?.client_contacts.find((x) => x.is_primary && x.email) ?? c?.client_contacts.find((x) => x.email);
  const name = l?.name ?? c?.name ?? '';
  const title = l ? `${l.event_type ? `${l.event_type} · ` : ''}${l.name}` : c ? `${c.name} coverage` : '';

  return (
    <>
      <BackLink href={l ? '/leads' : '/proposals'}>{l ? 'Inquiries' : 'Proposals'}</BackLink>
      <PageHeader title="New proposal" subtitle={l ? `For ${l.name}’s inquiry` : 'You can change everything on the next screen before sending.'} />
      <Card>
        <ActionForm action={createProposal} submit="Create draft">
          {l ? <input type="hidden" name="lead_id" value={l.id} /> : null}
          {c ? <input type="hidden" name="client_id" value={c.id} /> : null}
          <Field label="Title the client sees">
            <input name="title" required defaultValue={title} style={inputStyle} placeholder="Smith & Lee wedding coverage" />
          </Field>
          <Row>
            <Field label="Client name"><input name="client_name" required defaultValue={name} style={inputStyle} /></Field>
            <Field label="Client email" hint="The signer’s portal access goes here.">
              <input name="client_email" type="email" required defaultValue={l?.email ?? contact?.email ?? ''} style={inputStyle} />
            </Field>
          </Row>
          <Row>
            <Field label="Event date"><input name="date" type="date" required defaultValue={l?.event_date ?? ''} style={inputStyle} /></Field>
            <Field label="Starts"><input name="start" type="time" defaultValue="16:00" style={inputStyle} /></Field>
            <Field label="Ends"><input name="end" type="time" defaultValue="22:00" style={inputStyle} /></Field>
            <Field label="Time zone">
              <select name="zone" defaultValue="America/New_York" style={inputStyle}>
                {TIME_ZONES.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Venue"><input name="venue_name" style={inputStyle} /></Field>
            <Field label="Address" grow={2}><input name="address" defaultValue={l?.location ?? ''} style={inputStyle} /></Field>
          </Row>
          <Row>
            <Field label="Main package">
              <select name="package_id" defaultValue={l?.package_id ?? ''} style={inputStyle}>
                <option value="">Add later</option>
                {(packages.data ?? []).map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>{String(p.name)} · {money(Number(p.price_cents))}</option>
                ))}
              </select>
            </Field>
            <Field label="Deposit to book (%)"><input name="deposit_percent" type="number" min={0} max={100} defaultValue={30} style={inputStyle} /></Field>
          </Row>
          <Field label="A note to the client (optional)">
            <textarea name="intro" style={textareaStyle} placeholder={`Hi ${name.split(' ')[0] || 'there'}, thanks for reaching out. Here’s what we’d love to do for your day.`} />
          </Field>
          <Muted size={13}>A standard contract is filled in for you. Edit it on the next screen.</Muted>
        </ActionForm>
      </Card>
    </>
  );
}
