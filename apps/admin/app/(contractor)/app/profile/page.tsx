import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { Calendar, type DayState } from '@/components/contractor/Calendar';
import { Card, Eyebrow, Field, H1, ListRow, Muted, Row, StatusText, inputStyle, textareaStyle } from '@/components/ui';
import { GEAR_LABELS } from '@/app/(admin)/events/[eventId]/SlotFields';
import { requireContractor } from '@/lib/context';
import { label } from '@/lib/contractor/home';
import { loadMyJobs } from '@/lib/contractor/load';
import { initials, isCommitted, zonedDate } from '@/lib/format';
import { color, fonts } from '@/lib/ui';
import { addDocument, addGear, removeGear, saveDetails, saveProfile, toggleDay } from '../actions';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

const REQUIRED_DOCS = ['contractor_agreement', 'insurance'];

export default async function Profile({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: monthParam } = await searchParams;
  const viewer = await requireContractor();
  const db = viewer.supabase;
  const [profile, details, gear, docs, availability, jobs] = await Promise.all([
    db.from('profiles').select('full_name, phone, email, bio').eq('user_id', viewer.userId).maybeSingle(),
    db.from('contractor_details').select('*').eq('user_id', viewer.userId).maybeSingle(),
    db.from('equipment').select('id, category, make, model').eq('user_id', viewer.userId).order('category'),
    db.from('compliance_documents').select('id, doc_type, status, expires_on').eq('user_id', viewer.userId).eq('org_id', viewer.org.id).order('created_at', { ascending: false }),
    db.from('availability').select('starts_on, ends_on, is_available, recurrence_days').eq('user_id', viewer.userId),
    loadMyJobs(viewer),
  ]);

  const d = details.data;
  const skills = ((d?.skills as string[] | undefined) ?? []);
  const today = new Date();
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '') ? String(monthParam) : today.toISOString().slice(0, 7);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const booked = new Set(jobs.filter((j) => isCommitted(j.status)).map((j) => zonedDate(j.startsAt, j.timeZone)));
  const rows = availability.data ?? [];
  const days = Array.from({ length: daysIn }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    let state: DayState = 'none';
    const specific = rows.find((r) => r.starts_on <= date && r.ends_on >= date && !(r.recurrence_days as number[] | null)?.length);
    if (specific) state = specific.is_available ? 'available' : 'unavailable';
    if (booked.has(date)) state = 'booked';
    return { date, state };
  });
  const shift = (delta: number) => {
    const t = new Date(Date.UTC(y, m - 1 + delta, 1));
    return t.toISOString().slice(0, 7);
  };
  const docStatus = (type: string) => {
    const doc = (docs.data ?? []).find((x) => x.doc_type === type);
    if (!doc) return <StatusText tone="warn">Missing</StatusText>;
    if (doc.status === 'rejected') return <StatusText tone="warn">Needs replacing</StatusText>;
    if (doc.status !== 'approved') return <StatusText tone="label">Under review</StatusText>;
    if (doc.expires_on && new Date(String(doc.expires_on)).getTime() < Date.now() + 60 * 86_400_000) {
      return <StatusText tone="warn">Expires {String(doc.expires_on)}</StatusText>;
    }
    return <StatusText tone="positive">{type === 'contractor_agreement' ? 'Signed' : 'Ready'}</StatusText>;
  };

  return (
    <>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 72, height: 72, borderRadius: 36, background: color.surfaceAlt, border: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.heading, fontSize: 24, fontWeight: 600 }}>
          {initials(String(profile.data?.full_name ?? viewer.name))}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <H1 size={24}>{String(profile.data?.full_name ?? viewer.name)}</H1>
          <Muted size={13}>{[skills.join(', '), d?.home_base_label].filter(Boolean).join(' · ') || 'Add your skills and city below'}</Muted>
        </span>
      </header>

      <Card>
        <Eyebrow>Ready to work</Eyebrow>
        <ListRow label="Stripe payouts" value={d?.stripe_payouts_enabled ? <StatusText tone="positive">Ready</StatusText> : <StatusText tone="warn">Not set up</StatusText>} />
        {REQUIRED_DOCS.map((t) => (
          <ListRow key={t} label={label(t)} value={docStatus(t)} />
        ))}
      </Card>

      <Card>
        <Eyebrow>Contact</Eyebrow>
        <ActionForm action={saveProfile} submit="Save" variant="secondary">
          <Field label="Name">
            <input name="full_name" required defaultValue={String(profile.data?.full_name ?? '')} style={inputStyle} />
          </Field>
          <Field label="Phone">
            <input name="phone" type="tel" defaultValue={String(profile.data?.phone ?? '')} style={inputStyle} />
          </Field>
          <Muted size={13}>Email: {viewer.email}</Muted>
          <Field label="About you">
            <textarea name="bio" defaultValue={String(profile.data?.bio ?? '')} style={{ ...textareaStyle, minHeight: 64 }} />
          </Field>
        </ActionForm>
      </Card>

      <Card>
        <Eyebrow>Skills and coverage</Eyebrow>
        {skills.length ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {skills.map((s) => (
              <span key={s} style={{ background: color.surfaceAlt, borderRadius: 6, padding: '4px 8px', fontSize: 12, color: color.textSecondary }}>{s}</span>
            ))}
          </div>
        ) : null}
        <ActionForm action={saveDetails} submit="Save" variant="secondary">
          <Field label="Skills" hint="Comma separated: video, photo, drone">
            <input name="skills" defaultValue={skills.join(', ')} style={inputStyle} />
          </Field>
          <Row>
            <Field label="Based in">
              <input name="home_base_label" defaultValue={String(d?.home_base_label ?? '')} style={inputStyle} placeholder="Columbus, OH" />
            </Field>
            <Field label="Travels up to (miles)">
              <input name="travel_radius_miles" type="number" min={1} max={1000} defaultValue={d?.travel_radius_miles ?? 50} style={inputStyle} />
            </Field>
          </Row>
          <Row>
            <Field label="Latitude" hint="Optional; used for distance.">
              <input name="latitude" inputMode="decimal" defaultValue={d?.home_base_latitude?.toString() ?? ''} style={inputStyle} />
            </Field>
            <Field label="Longitude">
              <input name="longitude" inputMode="decimal" defaultValue={d?.home_base_longitude?.toString() ?? ''} style={inputStyle} />
            </Field>
          </Row>
          <Field label="Default day rate ($)">
            <input name="default_rate" inputMode="decimal" defaultValue={d?.default_rate_cents ? String(Number(d.default_rate_cents) / 100) : ''} style={inputStyle} />
          </Field>
        </ActionForm>
        <Muted size={12}>Based in {String(d?.home_base_label ?? '—')} · travels up to {String(d?.travel_radius_miles ?? '—')} miles</Muted>
      </Card>

      <Card>
        <Eyebrow>Gear</Eyebrow>
        {(gear.data ?? []).length === 0 ? <Muted>Add your kit so you match open calls that need it.</Muted> : null}
        {(gear.data ?? []).map((g) => (
          <div key={String(g.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${color.divider}`, padding: '6px 0' }}>
            <span style={{ flex: 1, fontSize: 15 }}>
              {GEAR_LABELS[String(g.category)] ?? String(g.category)}
              <Muted size={13}> {[g.make, g.model].filter(Boolean).join(' ')}</Muted>
            </span>
            <ActionForm action={removeGear} submit="Remove" variant="secondary" layout="inline">
              <input type="hidden" name="equipment_id" value={String(g.id)} />
            </ActionForm>
          </div>
        ))}
        <ActionForm action={addGear} submit="Add gear" variant="secondary" reset>
          <Row>
            <Field label="Type">
              <select name="category" style={inputStyle}>
                {Object.entries(GEAR_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Make">
              <input name="make" style={inputStyle} placeholder="Sony" />
            </Field>
            <Field label="Model">
              <input name="model" style={inputStyle} placeholder="FX3" />
            </Field>
          </Row>
        </ActionForm>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Eyebrow>Availability</Eyebrow>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <Link href={`/app/profile?month=${shift(-1)}`} aria-label="Previous month" style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', color: color.text }}>‹</Link>
            <span style={{ fontFamily: fonts.label, fontSize: 14, fontWeight: 600 }}>
              {first.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </span>
            <Link href={`/app/profile?month=${shift(1)}`} aria-label="Next month" style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', color: color.text }}>›</Link>
          </span>
        </div>
        <Calendar action={toggleDay} days={days} leading={first.getUTCDay()} />
      </Card>

      <Card>
        <span id="documents" />
        <Eyebrow>Documents</Eyebrow>
        {(docs.data ?? []).map((doc) => (
          <ListRow
            key={String(doc.id)}
            label={label(String(doc.doc_type))}
            value={
              <StatusText tone={doc.status === 'approved' ? 'positive' : doc.status === 'rejected' ? 'warn' : 'label'}>
                {doc.status === 'submitted' ? 'Under review' : String(doc.status)}
                {doc.expires_on ? ` · expires ${String(doc.expires_on)}` : ''}
              </StatusText>
            }
          />
        ))}
        <ActionForm action={addDocument} submit="Submit for review" variant="secondary" reset>
          <Row>
            <Field label="Document">
              <select name="doc_type" style={inputStyle}>
                <option value="contractor_agreement">Contractor agreement</option>
                <option value="insurance">Insurance certificate</option>
                <option value="w9">W-9</option>
              </select>
            </Field>
            <Field label="Expires">
              <input name="expires_on" type="date" style={inputStyle} />
            </Field>
          </Row>
        </ActionForm>
        <Muted size={12}>Send the file itself to your producer; this records it for review.</Muted>
      </Card>

      <Link href="/app/profile/earnings" style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', textDecoration: 'none', color: color.text, fontSize: 15, fontWeight: 700 }}>
        Earnings and tax forms <span aria-hidden="true">›</span>
      </Link>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        {viewer.isAdmin ? <Link href="/board" style={{ fontSize: 14 }}>Open the admin console →</Link> : null}
        <form action="/auth/sign-out" method="post">
          <button type="submit" style={{ minHeight: 44, padding: '0 16px', borderRadius: 10, border: `1px solid ${color.border}`, background: 'transparent', fontFamily: fonts.label, fontWeight: 600, cursor: 'pointer' }}>
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}
