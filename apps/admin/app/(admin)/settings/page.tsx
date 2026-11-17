import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { Card, Field, H2, LinkButton, Muted, Notice, Row, StatusText, Tag, inputStyle } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { color } from '@/lib/ui';
import { removeMember, saveOrganization, updateMember } from './actions';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

type Settings = {
  invite_window_hours?: number;
  confirm_deadline_hours?: number;
  footage_retention_days?: number;
  payout_auto_approve_under_cents?: number;
  reminder_hours_before_call?: number[];
  required_compliance_documents?: string[];
};

const DOCS = [
  { key: 'contractor_agreement', label: 'Contractor agreement' },
  { key: 'insurance', label: 'Insurance certificate' },
  { key: 'w9', label: 'W-9' },
];

export default async function SettingsPage() {
  const viewer = await requireAdmin();
  const db = viewer.supabase;
  const [{ data: org }, { data: members }] = await Promise.all([
    db.from('organizations').select('name, slug, settings, in_app_payments_enabled, stripe_account_id').eq('id', viewer.org.id).maybeSingle(),
    db.from('memberships').select('id, user_id, role, status, created_at').eq('org_id', viewer.org.id).order('role'),
  ]);
  const ids = [...new Set((members ?? []).map((m) => String(m.user_id)))];
  const { data: profiles } = ids.length ? await db.from('profiles').select('user_id, full_name, email').in('user_id', ids) : { data: [] };
  const people = new Map((profiles ?? []).map((p) => [String(p.user_id), p]));
  const s = (org?.settings ?? {}) as Settings;

  return (
    <>
      <PageHeader title="Settings" subtitle={viewer.org.name} actions={<LinkButton href="/contractors" variant="secondary">Invite people</LinkButton>} />

      {!viewer.isOwner || !org ? (
        <Notice tone="warn">Organization settings are owner-only. Ask an owner to change deadlines, thresholds or required documents.</Notice>
      ) : (
        <Card>
          <H2 size={20}>Organization</H2>
          <ActionForm action={saveOrganization} submit="Save settings">
            <Row>
              <Field label="Name" grow={2}>
                <input name="name" required defaultValue={String(org.name)} style={inputStyle} />
              </Field>
              <Field label="Invitation window (hours)" hint="How long a direct invite stays open.">
                <input name="invite_window_hours" type="number" min={1} max={720} defaultValue={s.invite_window_hours ?? 24} style={inputStyle} />
              </Field>
              <Field label="Confirm deadline (hours)" hint="How long a selected contractor has to confirm.">
                <input name="confirm_deadline_hours" type="number" min={1} max={168} defaultValue={s.confirm_deadline_hours ?? 12} style={inputStyle} />
              </Field>
            </Row>
            <Row>
              <Field label="Auto-approve payouts under ($)" hint="0 means every payout needs an owner.">
                <input name="payout_auto_approve_under" inputMode="decimal" defaultValue={String((s.payout_auto_approve_under_cents ?? 0) / 100)} style={inputStyle} />
              </Field>
              <Field label="Keep footage (days)">
                <input name="footage_retention_days" type="number" min={7} defaultValue={s.footage_retention_days ?? 90} style={inputStyle} />
              </Field>
              <Field label="Call reminders (hours before)" hint="Comma separated, e.g. 24, 2">
                <input name="reminders" defaultValue={(s.reminder_hours_before_call ?? [24, 2]).join(', ')} style={inputStyle} />
              </Field>
            </Row>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: '6px 18px', flexWrap: 'wrap' }}>
              <legend style={{ fontSize: 12, fontWeight: 600, color: color.textMuted, marginBottom: 6 }}>
                Documents a contractor needs before they can opt into open calls
              </legend>
              {DOCS.map((d) => (
                <label key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 32, fontSize: 14 }}>
                  <input type="checkbox" name={`doc_${d.key}`} defaultChecked={(s.required_compliance_documents ?? []).includes(d.key)} /> {d.label}
                </label>
              ))}
            </fieldset>
          </ActionForm>
          <Muted size={13}>
            In-app payments: {org.in_app_payments_enabled ? 'on' : 'off'}. Stripe Connect is a locked decision and a billing setting, so it is
            not switched from here.
          </Muted>
        </Card>
      )}

      <Card>
        <H2 size={20}>People</H2>
        {(members ?? []).map((m) => {
          const p = people.get(String(m.user_id));
          return (
            <Row key={String(m.id)} align="center" gap={10}>
              <strong style={{ fontSize: 14, minWidth: 160 }}>{String(p?.full_name ?? 'Unnamed')}</strong>
              <Muted size={13}>{String(p?.email ?? '')}</Muted>
              <Tag tone={m.role === 'owner' ? 'label' : 'muted'}>{String(m.role)}</Tag>
              {m.status !== 'active' ? <StatusText tone="danger">{String(m.status)}</StatusText> : null}
              {viewer.isOwner ? (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <ActionForm action={updateMember} submit={m.status === 'active' ? 'Suspend' : 'Reactivate'} variant="secondary" layout="inline" {...(m.status === 'active' ? { confirm: 'Suspend this person? They lose access straight away.' } : {})}>
                    <input type="hidden" name="membership_id" value={String(m.id)} />
                    <input type="hidden" name="user_id" value={String(m.user_id)} />
                    <input type="hidden" name="status" value={m.status === 'active' ? 'suspended' : 'active'} />
                  </ActionForm>
                  <ActionForm action={removeMember} submit="Remove role" variant="danger" layout="inline" confirm="Remove this role from them?">
                    <input type="hidden" name="membership_id" value={String(m.id)} />
                    <input type="hidden" name="user_id" value={String(m.user_id)} />
                    <input type="hidden" name="role" value={String(m.role)} />
                  </ActionForm>
                </span>
              ) : null}
            </Row>
          );
        })}
      </Card>
    </>
  );
}
