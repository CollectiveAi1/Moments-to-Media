import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { PublicShell } from '@/components/PublicShell';
import { Card, Field, H1, Muted, Notice, Row, inputStyle, textareaStyle } from '@/components/ui';
import { money } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { color } from '@/lib/ui';
import { submitInquiry } from '../../public-actions';

export const metadata: Metadata = { title: 'Check availability', robots: { index: true, follow: false } };
export const dynamic = 'force-dynamic';

type Form = { org_name: string; packages: Array<{ id: string; name: string; description: string | null; price_cents: number; is_addon: boolean }> };

export default async function InquirePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ sent?: string; package?: string }> }) {
  const { slug } = await params;
  const { sent, package: chosen } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('inquiry_form', { p_org_slug: slug });
  if (error || !data) notFound();
  const form = data as Form;
  const main = form.packages.filter((p) => !p.is_addon);

  if (sent) {
    return (
      <PublicShell orgName={form.org_name}>
        <H1>Thank you!</H1>
        <Notice>Your inquiry is in. We’ll reply within one business day with availability and a proposal.</Notice>
      </PublicShell>
    );
  }

  return (
    <PublicShell orgName={form.org_name} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <H1>Check our availability</H1>
        <Muted>Tell us about your event. We’ll reply with availability and a proposal you can sign and book online.</Muted>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
        <Card>
          <ActionForm action={submitInquiry} submit="Send inquiry" variant="primary" height={48}>
            <input type="hidden" name="slug" value={slug} />
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1 }} />
            <Field label="Your name"><input name="name" required autoComplete="name" style={inputStyle} /></Field>
            <Row>
              <Field label="Email"><input name="email" type="email" autoComplete="email" style={inputStyle} /></Field>
              <Field label="Phone"><input name="phone" type="tel" autoComplete="tel" style={inputStyle} /></Field>
            </Row>
            <Row>
              <Field label="What’s the event?"><input name="event_type" style={inputStyle} placeholder="Wedding, gala, conference…" /></Field>
              <Field label="Date"><input name="event_date" type="date" style={inputStyle} /></Field>
            </Row>
            <Field label="Where"><input name="location" style={inputStyle} placeholder="Venue or city" /></Field>
            {main.length ? (
              <Field label="Package you’re interested in">
                <select name="package_id" defaultValue={chosen ?? ''} style={inputStyle}>
                  <option value="">Not sure yet</option>
                  {main.map((p) => <option key={p.id} value={p.id}>{p.name} · from {money(p.price_cents)}</option>)}
                </select>
              </Field>
            ) : null}
            <Field label="Anything else we should know?"><textarea name="message" style={textareaStyle} /></Field>
          </ActionForm>
        </Card>
        {form.packages.length ? (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {form.packages.map((p) => (
              <Card key={p.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 16 }}>{p.name}</strong>
                  <span style={{ fontSize: 15 }}>{p.is_addon ? '+' : 'from '}{money(p.price_cents)}</span>
                </div>
                {p.description ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: color.textBody, whiteSpace: 'pre-wrap' }}>{p.description}</p> : null}
                {p.is_addon ? <Muted size={12}>Add-on</Muted> : null}
              </Card>
            ))}
          </section>
        ) : null}
      </div>
    </PublicShell>
  );
}
