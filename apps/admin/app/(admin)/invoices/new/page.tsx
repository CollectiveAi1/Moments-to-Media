import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { BackLink, Card, Empty, Field, LinkButton, Row, inputStyle } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { createInvoice } from '../../client-actions';

export const metadata: Metadata = { title: 'New invoice', description: 'Start an invoice for a client.' };
export const dynamic = 'force-dynamic';

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const viewer = await requireAdmin();
  const { client } = await searchParams;
  const [{ data: clients }, { data: events }] = await Promise.all([
    viewer.supabase.from('clients').select('id, name').eq('org_id', viewer.org.id).order('name'),
    viewer.supabase.from('events').select('id, title, client_id').eq('org_id', viewer.org.id).neq('status', 'cancelled').order('starts_at', { ascending: false }).limit(100),
  ]);
  if ((clients ?? []).length === 0) {
    return (
      <>
        <BackLink href="/invoices">Invoices</BackLink>
        <Empty title="Add a client first">An invoice belongs to a client so it shows in their portal.</Empty>
        <LinkButton href="/clients">Go to clients</LinkButton>
      </>
    );
  }
  return (
    <>
      <BackLink href="/invoices">Invoices</BackLink>
      <PageHeader title="New invoice" subtitle="Add lines and a payment schedule on the next screen." />
      <Card>
        <ActionForm action={createInvoice} submit="Create draft">
          <Row>
            <Field label="Client">
              <select name="client_id" required defaultValue={client ?? ''} style={inputStyle}>
                <option value="" disabled>Choose…</option>
                {(clients ?? []).map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
              </select>
            </Field>
            <Field label="Event (optional)">
              <select name="event_id" defaultValue="" style={inputStyle}>
                <option value="">None</option>
                {(events ?? []).map((e) => <option key={String(e.id)} value={String(e.id)}>{String(e.title)}</option>)}
              </select>
            </Field>
          </Row>
          <Field label="Title"><input name="title" required style={inputStyle} placeholder="Extra hour and rush delivery" /></Field>
        </ActionForm>
      </Card>
    </>
  );
}
