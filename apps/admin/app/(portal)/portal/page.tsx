import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, Empty, H1, H2, LinkButton, ListRow, Muted, Notice, Tag } from '@/components/ui';
import { allocate, amountDueNow, todayIn } from '@/lib/billing/schedule';
import { requireClient } from '@/lib/context';
import { INVOICE_STATUS, firstName, formatDay, money, timeRange } from '@/lib/format';
import { myClientIds } from '@/lib/portal/load';
import { color } from '@/lib/ui';

export const metadata: Metadata = { title: 'Your portal' };
export const dynamic = 'force-dynamic';

type Inv = { id: string; number: number; title: string; status: string; total_cents: number; paid_cents: number; invoice_installments: Array<{ id: string; label: string; amount_cents: number; due_on: string }> };

export default async function PortalHome() {
  const viewer = await requireClient();
  const clients = await myClientIds(viewer);
  const ids = clients.map((c) => c.id);
  if (ids.length === 0) {
    return <Empty title="Nothing here yet">Your portal opens up once {viewer.org.name} links your account to your booking. If you just signed, sign out and in again.</Empty>;
  }
  const db = viewer.supabase;
  const [{ data: events }, { data: invoices }, { data: releases }] = await Promise.all([
    db.from('events').select('id, title, starts_at, ends_at, time_zone, venue_name, status').in('client_id', ids).order('starts_at', { ascending: false }),
    db.from('invoices').select('id, number, title, status, total_cents, paid_cents, invoice_installments!invoice_installments_invoice_id_fkey(id, label, amount_cents, due_on)').in('client_id', ids).neq('status', 'draft').order('created_at', { ascending: false }),
    db.from('media_releases').select('event_id, released_at, message'),
  ]);
  const released = new Map((releases ?? []).map((r) => [String(r.event_id), r]));
  const today = todayIn('America/New_York');
  const dueRows = ((invoices ?? []) as unknown as Inv[])
    .filter((i) => i.status === 'open' || i.status === 'partially_paid')
    .map((i) => ({ inv: i, due: amountDueNow(allocate(i.invoice_installments.map((x) => ({ id: x.id, label: x.label, amountCents: x.amount_cents, dueOn: x.due_on })), i.paid_cents, today)) }));
  const owing = dueRows.reduce((n, r) => n + r.inv.total_cents - r.inv.paid_cents, 0);
  const now = Date.now();
  const upcoming = (events ?? []).filter((e) => new Date(String(e.ends_at)).getTime() > now && e.status !== 'cancelled');
  const past = (events ?? []).filter((e) => !upcoming.includes(e));

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <H1>Hi, {firstName(viewer.name.includes('@') ? clients[0]?.name : viewer.name)}</H1>
        <Muted>Everything for your bookings with {viewer.org.name}: invoices, your contract, and your photos and video when they’re ready.</Muted>
      </div>

      {[...released.keys()].some((id) => (events ?? []).some((e) => String(e.id) === id)) ? (
        <Card highlight>
          <H2 size={20}>Your media is ready</H2>
          <Muted>Photos and video from your projects are waiting for you.</Muted>
          <LinkButton href="/portal/media" variant="primary" height={48}>Go to my media</LinkButton>
        </Card>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, alignItems: 'start' }}>
        <Card highlight={owing > 0}>
          <H2 size={20}>Payments</H2>
          {dueRows.length === 0 ? <Muted>You’re all paid up. Thank you!</Muted> : null}
          {dueRows.map(({ inv, due }) => (
            <div key={inv.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderBottom: `1px solid ${color.divider}`, paddingBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <Link href={`/portal/invoices/${inv.id}`} style={{ fontWeight: 600 }}>Invoice {inv.number} · {inv.title}</Link>
                <strong>{money(inv.total_cents - inv.paid_cents)} left</strong>
              </div>
              {due ? <Muted size={13}>Next: {due.label} · {money(due.cents)}</Muted> : null}
              <LinkButton href={`/portal/invoices/${inv.id}`} variant="primary" height={44}>Review and pay</LinkButton>
            </div>
          ))}
          {(invoices ?? []).filter((i) => i.status === 'paid').map((i) => (
            <ListRow key={String(i.id)} label={<Link href={`/portal/invoices/${String(i.id)}`}>Invoice {String(i.number)}</Link>} value={<Tag tone="positive">{INVOICE_STATUS.paid?.label}</Tag>} />
          ))}
        </Card>

        <Card>
          <H2 size={20}>Your projects</H2>
          {(events ?? []).length === 0 ? <Muted>No projects yet.</Muted> : null}
          {[...upcoming, ...past].map((e) => {
            const zone = String(e.time_zone);
            const media = released.get(String(e.id));
            return (
              <Link key={String(e.id)} href={`/portal/projects/${String(e.id)}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderBottom: `1px solid ${color.divider}`, textDecoration: 'none', color: color.text }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{String(e.title)}</strong>
                  {media ? <Tag tone="positive">Media ready</Tag> : e.status === 'cancelled' ? <Tag tone="muted">Cancelled</Tag> : upcoming.includes(e) ? <Tag tone="label">Booked</Tag> : <Tag tone="muted">In editing</Tag>}
                </span>
                <span style={{ fontSize: 13, color: color.textMuted }}>
                  {formatDay(String(e.starts_at), zone)} · {timeRange(String(e.starts_at), String(e.ends_at), zone)}{e.venue_name ? ` · ${String(e.venue_name)}` : ''}
                </span>
              </Link>
            );
          })}
        </Card>
      </div>
      <Muted size={13}>Questions? <Link href="/portal/messages">Send us a message</Link>.</Muted>
    </>
  );
}
