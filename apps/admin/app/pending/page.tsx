import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Card, Field, H1, H2, Muted, Notice, Row, inputStyle, textareaStyle } from '@/components/ui';
import { GEAR_LABELS } from '@/app/(admin)/events/[eventId]/SlotFields';
import { getViewer } from '@/lib/context';
import { color } from '@/lib/ui';
import { addGear, removeGear, saveDetails, saveProfile } from '../(contractor)/app/actions';

export const metadata: Metadata = { title: 'Application received', description: 'Your crew application is waiting for approval. Complete your profile meanwhile.', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** A crew applicant waiting for approval: their profile, so the team can decide. */
export default async function PendingPage() {
  const viewer = await getViewer();
  if (viewer.isContractor) redirect('/app');
  if (!viewer.pendingContractor) redirect('/');
  const db = viewer.supabase;
  const [{ data: profile }, { data: d }, { data: gear }] = await Promise.all([
    db.from('profiles').select('full_name, phone, bio').eq('user_id', viewer.userId).maybeSingle(),
    db.from('contractor_details').select('skills, home_base_label, travel_radius_miles, default_rate_cents').eq('user_id', viewer.userId).maybeSingle(),
    db.from('equipment').select('id, category, make, model').eq('user_id', viewer.userId),
  ]);
  const skills = (d?.skills as string[] | undefined) ?? [];

  return (
    <div style={{ minHeight: '100vh', background: color.bg, display: 'flex', justifyContent: 'center' }}>
      <main id="main" tabIndex={-1} style={{ width: '100%', maxWidth: 720, padding: '32px 20px 64px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <H1>Thanks for applying</H1>
          <form action="/auth/sign-out" method="post">
            <button type="submit" style={{ minHeight: 40, padding: '0 12px', borderRadius: 8, border: `1px solid ${color.border}`, background: 'transparent', cursor: 'pointer' }}>Sign out</button>
          </form>
        </div>
        <Notice>Your application is with the team. You’ll be able to see and take jobs once they approve you; we’ll let you know by email.</Notice>
        <Muted>Tell them about yourself in the meantime. A complete profile gets approved faster.</Muted>

        <Card>
          <H2 size={20}>About you</H2>
          <ActionForm action={saveProfile} submit="Save" variant="secondary">
            <Row>
              <Field label="Full name"><input name="full_name" autoComplete="name" required defaultValue={String(profile?.full_name ?? '')} style={inputStyle} /></Field>
              <Field label="Phone"><input name="phone" type="tel" autoComplete="tel" defaultValue={String(profile?.phone ?? '')} style={inputStyle} /></Field>
            </Row>
            <Field label="Experience and portfolio link"><textarea name="bio" defaultValue={String(profile?.bio ?? '')} style={textareaStyle} /></Field>
          </ActionForm>
        </Card>

        <Card>
          <H2 size={20}>What you shoot and where</H2>
          <ActionForm action={saveDetails} submit="Save" variant="secondary">
            <Field label="Skills" hint="Comma separated: video, photo, drone"><input name="skills" defaultValue={skills.join(', ')} style={inputStyle} /></Field>
            <Row>
              <Field label="Based in"><input name="home_base_label" defaultValue={String(d?.home_base_label ?? '')} style={inputStyle} placeholder="Columbus, OH" /></Field>
              <Field label="Travels up to (miles)"><input name="travel_radius_miles" type="number" min={1} max={1000} defaultValue={Number(d?.travel_radius_miles ?? 50)} style={inputStyle} /></Field>
              <Field label="Day rate ($)"><input name="default_rate" inputMode="decimal" defaultValue={d?.default_rate_cents ? String(Number(d.default_rate_cents) / 100) : ''} style={inputStyle} /></Field>
            </Row>
          </ActionForm>
        </Card>

        <Card>
          <H2 size={20}>Gear</H2>
          {(gear ?? []).map((g) => (
            <Row key={String(g.id)} align="center">
              <span style={{ flex: 1 }}>{GEAR_LABELS[String(g.category)] ?? String(g.category)} {[g.make, g.model].filter(Boolean).join(' ')}</span>
              <ActionForm action={removeGear} submit="Remove" variant="secondary" layout="inline">
                <input type="hidden" name="equipment_id" value={String(g.id)} />
              </ActionForm>
            </Row>
          ))}
          <ActionForm action={addGear} submit="Add gear" variant="secondary" reset>
            <Row>
              <Field label="Type">
                <select name="category" style={inputStyle}>
                  {Object.entries(GEAR_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Make"><input name="make" style={inputStyle} /></Field>
              <Field label="Model"><input name="model" style={inputStyle} /></Field>
            </Row>
          </ActionForm>
        </Card>
      </main>
    </div>
  );
}
