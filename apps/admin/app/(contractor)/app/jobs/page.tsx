import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, Eyebrow, H1, Muted } from '@/components/ui';
import { GEAR_LABELS } from '@/app/(admin)/events/[eventId]/SlotFields';
import { requireContractor } from '@/lib/context';
import { dateTime, formatDay, hours, rate } from '@/lib/format';
import { color, fonts, radius } from '@/lib/ui';

export const metadata: Metadata = { title: 'Open calls' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'week', label: 'This week' },
  { key: 'video', label: 'Video' },
  { key: 'photo', label: 'Photo' },
] as const;

type Job = {
  slot_id: string; role: string; rate_type: string; rate_amount_cents: number; required_gear: string[]; interest_deadline: string | null;
  event_title: string; starts_at: string; ends_at: string; time_zone: string; area_label: string | null; my_assignment_status: string | null;
};

export default async function JobBoard({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f = 'all' } = await searchParams;
  const viewer = await requireContractor();
  const { data, error } = await viewer.supabase
    .from('job_board')
    .select('slot_id, role, rate_type, rate_amount_cents, required_gear, interest_deadline, event_title, starts_at, ends_at, time_zone, area_label, my_assignment_status')
    .eq('org_id', viewer.org.id)
    .order('starts_at');
  if (error) throw new Error(`Could not load open calls: ${error.message}`);

  const now = Date.now();
  const all = (data ?? []) as Job[];
  const open = all.filter((j) => j.my_assignment_status === null);
  const mine = all.filter((j) => j.my_assignment_status !== null);
  const shown = open.filter((j) => {
    if (f === 'week') return new Date(j.starts_at).getTime() < now + 7 * 86_400_000;
    if (f === 'video') return /video|film|drone/i.test(j.role);
    if (f === 'photo') return /photo/i.test(j.role);
    return true;
  });

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <H1 size={26}>Open calls</H1>
        <Muted>
          {open.length} {open.length === 1 ? 'job matches' : 'jobs match'} your area, gear and documents
        </Muted>
      </div>
      <nav aria-label="Filter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((x) => {
          const on = x.key === f;
          return (
            <Link
              key={x.key}
              href={`/app/jobs?f=${x.key}`}
              aria-current={on ? 'page' : undefined}
              style={{
                height: 36, minWidth: 44, padding: '0 14px', borderRadius: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: fonts.label, fontSize: 13, fontWeight: 600, textDecoration: 'none',
                border: on ? 0 : `1px solid ${color.border}`, background: on ? color.primary : 'transparent', color: on ? color.onPrimary : color.textSecondary,
              }}
            >
              {x.label}
            </Link>
          );
        })}
      </nav>

      {shown.length === 0 ? (
        <Empty title={open.length ? 'Nothing for this filter' : 'No open calls right now'}>
          {open.length ? 'Try All.' : 'New calls appear here as producers post them. Keep your gear, area and documents current in Profile so you match.'}
        </Empty>
      ) : (
        <div className="c-grid">
          {shown.map((j) => (
            <JobCard key={j.slot_id} job={j} now={now} />
          ))}
        </div>
      )}

      {mine.length ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow>Your responses</Eyebrow>
          <div className="c-grid">
            {mine.map((j) => (
              <JobCard key={j.slot_id} job={j} now={now} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function JobCard({ job: j, now }: { job: Job; now: number }) {
  const closesSoon = j.interest_deadline && new Date(j.interest_deadline).getTime() - now < 48 * 3_600_000;
  const status = j.my_assignment_status;
  return (
    <Link
      href={`/app/jobs/${j.slot_id}`}
      style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.xxl, padding: 16, display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none', color: color.text }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: fonts.label, fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: color.label }}>{j.role}</span>
        <span style={{ fontFamily: fonts.heading, fontSize: 18, fontWeight: 600 }}>{rate(j.rate_type, j.rate_amount_cents)}</span>
      </div>
      <strong style={{ fontSize: 17 }}>{j.event_title}</strong>
      <Muted size={13}>
        {formatDay(j.starts_at, j.time_zone)} · {hours(j.starts_at, j.ends_at)} · {j.area_label ?? 'Area to be confirmed'}
      </Muted>
      {j.required_gear.length ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {j.required_gear.map((g) => (
            <span key={g} style={{ background: color.surfaceAlt, borderRadius: radius.xs, padding: '4px 8px', fontSize: 12, color: color.textSecondary }}>
              {GEAR_LABELS[g] ?? g}
            </span>
          ))}
        </div>
      ) : null}
      <span style={{ fontSize: 12, fontWeight: 700, color: status ? color.label : closesSoon ? color.attention : color.textMuted }}>
        {status === 'interested'
          ? 'Interest sent'
          : status === 'invited'
            ? 'You were invited · respond'
            : status === 'selected'
              ? 'You were selected · confirm'
              : j.interest_deadline
                ? `Interest closes ${dateTime(j.interest_deadline, j.time_zone)}`
                : 'Open until filled'}
      </span>
    </Link>
  );
}
