import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { Card, Empty, Field, H2, Muted, Row, StatusText, Table, Tag, inputStyle, td } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { dateTime } from '@/lib/format';
import { orgPeople } from '@/lib/org';
import { color } from '@/lib/ui';
import { inviteMember, resendInvite, revokeInvite } from './actions';

export const metadata: Metadata = { title: 'Contractors' };
export const dynamic = 'force-dynamic';

export default async function ContractorsPage() {
  const viewer = await requireAdmin();
  const db = viewer.supabase;
  const people = (await orgPeople(viewer, viewer.org.id)).filter((p) => p.roles.includes('contractor'));
  const ids = people.map((p) => p.userId);

  const [details, gear, docs, jobs, ratings, invites, org] = await Promise.all([
    ids.length ? db.from('contractor_details').select('user_id, skills, home_base_label, travel_radius_miles').in('user_id', ids) : { data: [] },
    ids.length ? db.from('equipment').select('user_id, category').in('user_id', ids) : { data: [] },
    ids.length ? db.from('compliance_documents').select('user_id, doc_type, status, expires_on').eq('org_id', viewer.org.id).in('user_id', ids) : { data: [] },
    ids.length ? db.from('assignments').select('user_id, status').eq('org_id', viewer.org.id).in('user_id', ids).in('status', ['approved', 'paid']) : { data: [] },
    db.from('ratings').select('quality, punctuality, communication, assignments!ratings_assignment_id_fkey!inner ( user_id )').eq('org_id', viewer.org.id),
    db.from('org_invitations').select('id, email, role, status, expires_at, created_at').eq('org_id', viewer.org.id).eq('status', 'pending').order('created_at', { ascending: false }),
    db.from('organizations').select('settings').eq('id', viewer.org.id).maybeSingle(),
  ]);

  const required: string[] = ((org.data?.settings as { required_compliance_documents?: string[] } | null)?.required_compliance_documents) ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Contractors" subtitle={`${people.length} on the roster. Invite people, check their documents and see their history.`} />

      <Card>
        <H2 size={20}>Invite someone</H2>
        <ActionForm action={inviteMember} submit="Send invitation" reset>
          <Row>
            <Field label="Email" grow={2}>
              <input name="email" type="email" required style={inputStyle} placeholder="name@example.com" />
            </Field>
            <Field label="Role">
              <select name="role" style={inputStyle} defaultValue="contractor">
                <option value="contractor">Contractor</option>
                {viewer.isOwner ? <option value="producer">Producer</option> : null}
                {viewer.isOwner ? <option value="owner">Owner</option> : null}
              </select>
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14 }}>
              <input type="checkbox" name="send" defaultChecked /> Email them a sign-in link
            </label>
          </Row>
        </ActionForm>
        {(invites.data ?? []).length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${color.divider}`, paddingTop: 12 }}>
            <strong style={{ fontSize: 14 }}>Pending invitations</strong>
            {(invites.data ?? []).map((i) => (
              <Row key={String(i.id)} align="center" gap={10}>
                <span style={{ fontSize: 14 }}>{String(i.email)}</span>
                <Tag>{String(i.role)}</Tag>
                <Muted size={13}>expires {dateTime(String(i.expires_at), 'America/New_York')}</Muted>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <ActionForm action={resendInvite} submit="Resend link" variant="secondary" layout="inline">
                    <input type="hidden" name="email" value={String(i.email)} />
                  </ActionForm>
                  <ActionForm action={revokeInvite} submit="Revoke" variant="danger" layout="inline" confirm="Revoke this invitation?">
                    <input type="hidden" name="invitation_id" value={String(i.id)} />
                  </ActionForm>
                </span>
              </Row>
            ))}
          </div>
        ) : null}
      </Card>

      {people.length === 0 ? (
        <Empty title="No contractors yet">Invite your first contractors above.</Empty>
      ) : (
        <Table head={['Contractor', 'Based in', 'Skills', 'Gear', 'Documents', 'Rating', 'Jobs']} minWidth={900}>
          {people.map((p) => {
            const d = (details.data ?? []).find((x) => String(x.user_id) === p.userId);
            const myGear = [...new Set((gear.data ?? []).filter((g) => String(g.user_id) === p.userId).map((g) => String(g.category).replace('_', ' ')))];
            const myDocs = (docs.data ?? []).filter((x) => String(x.user_id) === p.userId);
            const complete = required.every((t) => myDocs.some((x) => x.doc_type === t && x.status === 'approved' && (!x.expires_on || String(x.expires_on) >= today)));
            const waiting = myDocs.filter((x) => x.status === 'submitted' || x.status === 'pending').length;
            const mine = (ratings.data ?? []).filter((r) => String((r.assignments as unknown as { user_id: string }).user_id) === p.userId);
            const avg = mine.length ? (mine.reduce((n, r) => n + (Number(r.quality) + Number(r.punctuality) + Number(r.communication)) / 3, 0) / mine.length).toFixed(1) : null;
            return (
              <tr key={p.userId}>
                <td style={td}>
                  <Link href={`/contractors/${p.userId}`} style={{ fontWeight: 700, color: color.text }}>{p.name}</Link>
                  <div><Muted size={12}>{p.email ?? ''}</Muted></div>
                </td>
                <td style={td}>{d?.home_base_label ? `${String(d.home_base_label)}${d.travel_radius_miles ? ` · ${String(d.travel_radius_miles)} mi` : ''}` : <Muted size={13}>Not set</Muted>}</td>
                <td style={td}>{((d?.skills as string[] | undefined) ?? []).join(', ') || <Muted size={13}>—</Muted>}</td>
                <td style={td}>{myGear.join(', ') || <Muted size={13}>None listed</Muted>}</td>
                <td style={td}>
                  {waiting ? <StatusText tone="warn">{waiting} to review</StatusText> : complete ? <StatusText tone="positive">Complete</StatusText> : <StatusText tone="warn">Incomplete</StatusText>}
                </td>
                <td style={td}>{avg ? `${avg} / 5` : <Muted size={13}>New</Muted>}</td>
                <td style={td}>{(jobs.data ?? []).filter((j) => String(j.user_id) === p.userId).length}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
