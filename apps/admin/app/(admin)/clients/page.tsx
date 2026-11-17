import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { Card, Empty, Field, H2, Muted, Row, Table, inputStyle, td } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { money } from '@/lib/format';
import { addClient } from '../client-actions';

export const metadata: Metadata = { title: 'Clients', description: 'Every client, with their projects, balances and portal access.' };
export const dynamic = 'force-dynamic';

type Row = {
  id: string; name: string;
  client_contacts: Array<{ name: string; email: string | null; user_id: string | null; is_primary: boolean }>;
  invoices: Array<{ status: string; total_cents: number; paid_cents: number }>;
  events: Array<{ id: string }>;
};

export default async function ClientsPage() {
  const viewer = await requireAdmin();
  const { data } = await viewer.supabase
    .from('clients')
    .select('id, name, client_contacts!client_contacts_client_id_fkey(name, email, user_id, is_primary), invoices!invoices_client_id_fkey(status, total_cents, paid_cents), events!events_client_id_fkey(id)')
    .eq('org_id', viewer.org.id)
    .order('name');
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader title="Clients" subtitle="Everyone you’ve worked with or quoted, with their projects, balances and portal access." />
      {rows.length === 0 ? (
        <Empty title="No clients yet">Clients are added for you when someone signs a proposal. You can add one by hand below.</Empty>
      ) : (
        <Table head={['Client', 'Main contact', 'Projects', 'Balance', 'Portal']}>
          {rows.map((c) => {
            const contact = c.client_contacts.find((x) => x.is_primary) ?? c.client_contacts[0];
            const balance = c.invoices.filter((i) => i.status === 'open' || i.status === 'partially_paid').reduce((n, i) => n + i.total_cents - i.paid_cents, 0);
            const portal = c.client_contacts.some((x) => x.user_id);
            return (
              <tr key={c.id}>
                <td style={td}><Link href={`/clients/${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link></td>
                <td style={td}>{contact ? `${contact.name}${contact.email ? ` · ${contact.email}` : ''}` : '—'}</td>
                <td style={td}>{c.events.length}</td>
                <td style={td}>{balance ? money(balance) : '—'}</td>
                <td style={td}>{portal ? 'Active' : <Muted size={13}>Not invited</Muted>}</td>
              </tr>
            );
          })}
        </Table>
      )}
      <Card>
        <H2 size={20}>Add a client</H2>
        <ActionForm action={addClient} submit="Add client">
          <Row>
            <Field label="Client (person or company)"><input name="name" required style={inputStyle} /></Field>
            <Field label="Contact name"><input name="contact_name" style={inputStyle} /></Field>
            <Field label="Email"><input name="email" type="email" style={inputStyle} /></Field>
            <Field label="Phone"><input name="phone" type="tel" style={inputStyle} /></Field>
          </Row>
        </ActionForm>
      </Card>
    </>
  );
}
