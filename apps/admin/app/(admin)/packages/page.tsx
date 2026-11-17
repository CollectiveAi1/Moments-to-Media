import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { Card, Empty, Field, H2, Muted, Row, Tag, inputStyle, textareaStyle } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { money } from '@/lib/format';
import { color } from '@/lib/ui';
import { deletePackage, savePackage } from '../client-actions';

export const metadata: Metadata = { title: 'Packages' };
export const dynamic = 'force-dynamic';

export default async function PackagesPage() {
  const viewer = await requireAdmin();
  const { data: rows } = await viewer.supabase
    .from('packages')
    .select('id, name, description, price_cents, is_addon, active, sort_order')
    .eq('org_id', viewer.org.id)
    .order('is_addon')
    .order('sort_order')
    .order('price_cents');
  const packages = rows ?? [];

  return (
    <>
      <PageHeader title="Packages" subtitle="What you sell. Packages and add-ons appear on your inquiry form and fill proposals and invoices in one click." />
      <Card>
        <H2 size={20}>Add a package or add-on</H2>
        <ActionForm action={savePackage} submit="Add" reset>
          <Row>
            <Field label="Name" grow={2}>
              <input name="name" required style={inputStyle} placeholder="Full-day video coverage" />
            </Field>
            <Field label="Price ($)">
              <input name="price" required inputMode="decimal" style={inputStyle} placeholder="2500" />
            </Field>
            <Field label="Order">
              <input name="sort_order" type="number" defaultValue={0} style={inputStyle} />
            </Field>
          </Row>
          <Field label="What’s included">
            <textarea name="description" style={textareaStyle} placeholder="Two shooters, up to 8 hours, 5-minute highlight film, delivered in 3 weeks." />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14 }}>
            <input type="checkbox" name="is_addon" /> This is an add-on (offered on top of a package)
          </label>
        </ActionForm>
      </Card>

      {packages.length === 0 ? (
        <Empty title="No packages yet">Add your main packages and a few add-ons (drone, extra hour, rush delivery).</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 16 }}>
          {packages.map((p) => (
            <Card key={String(p.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <H2 size={18}>{String(p.name)}</H2>
                <strong style={{ fontSize: 16 }}>{money(Number(p.price_cents))}</strong>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Tag tone={p.is_addon ? 'label' : 'positive'}>{p.is_addon ? 'Add-on' : 'Package'}</Tag>
                {p.active ? null : <Tag tone="muted">Hidden</Tag>}
              </div>
              {p.description ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: color.textBody, whiteSpace: 'pre-wrap' }}>{String(p.description)}</p> : null}
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 14, color: color.label, minHeight: 32 }}>Edit</summary>
                <ActionForm action={savePackage} submit="Save" style={{ paddingTop: 10 }}>
                  <input type="hidden" name="package_id" value={String(p.id)} />
                  <Row>
                    <Field label="Name" grow={2}>
                      <input name="name" required defaultValue={String(p.name)} style={inputStyle} />
                    </Field>
                    <Field label="Price ($)">
                      <input name="price" required defaultValue={(Number(p.price_cents) / 100).toFixed(2)} style={inputStyle} />
                    </Field>
                  </Row>
                  <Field label="What’s included">
                    <textarea name="description" defaultValue={String(p.description ?? '')} style={textareaStyle} />
                  </Field>
                  <Row align="center">
                    <Field label="Order">
                      <input name="sort_order" type="number" defaultValue={Number(p.sort_order)} style={inputStyle} />
                    </Field>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                      <input type="checkbox" name="is_addon" defaultChecked={Boolean(p.is_addon)} /> Add-on
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                      <input type="checkbox" name="inactive" defaultChecked={!p.active} /> Hide from the inquiry form
                    </label>
                  </Row>
                </ActionForm>
                <ActionForm action={deletePackage} submit="Delete" variant="secondary" confirm={`Delete ${String(p.name)}? Proposals already sent keep their copy.`} style={{ paddingTop: 8 }}>
                  <input type="hidden" name="package_id" value={String(p.id)} />
                </ActionForm>
              </details>
            </Card>
          ))}
        </div>
      )}
      <Muted size={13}>Prices here are defaults. Each proposal and invoice keeps its own copy, so changing a price never changes what a client already received.</Muted>
    </>
  );
}
