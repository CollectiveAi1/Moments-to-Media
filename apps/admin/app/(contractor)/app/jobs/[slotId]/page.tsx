import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { BottomBar, FactTile, LockNotice } from '@/components/contractor/bits';
import { BackLink, Eyebrow, H1, ListRow, Muted, StatusText, textareaStyle } from '@/components/ui';
import { GEAR_LABELS } from '@/app/(admin)/events/[eventId]/SlotFields';
import { requireContractor } from '@/lib/context';
import { dateTime, formatDay, hours, isCommitted, rate, timeRange } from '@/lib/format';
import { color } from '@/lib/ui';
import { confirmJob, declineInvite, optIn, withdrawInterest } from '../../actions';

export const metadata: Metadata = { title: 'Open call' };
export const dynamic = 'force-dynamic';

export default async function JobDetail({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params;
  const viewer = await requireContractor();
  const db = viewer.supabase;

  const [{ data: job }, { data: mine }, { data: gear }] = await Promise.all([
    db.from('job_board').select('*').eq('slot_id', slotId).maybeSingle(),
    db.from('assignments').select('id, status').eq('slot_id', slotId).eq('user_id', viewer.userId).maybeSingle(),
    db.from('equipment').select('category, make, model').eq('user_id', viewer.userId),
  ]);

  // Once confirmed, the job lives in the packet instead.
  if (mine && isCommitted(String(mine.status))) {
    const { data: slot } = await db.from('slots').select('event_id').eq('id', slotId).maybeSingle();
    if (slot) redirect(`/app/events/${slot.event_id}`);
  }
  if (!job) notFound();

  const { count: crew } = await db.from('job_board').select('slot_id', { count: 'exact', head: true }).eq('event_id', job.event_id);
  const zone = String(job.time_zone);
  const status = (mine?.status as string | undefined) ?? null;
  const required = (job.required_gear as string[]) ?? [];
  const owned = gear ?? [];

  return (
    <>
      <BackLink href="/app/jobs">Open calls</BackLink>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Eyebrow tone="label">
          {String(job.role)}
          {crew && crew > 1 ? ` · 1 of ${crew} crew` : ''}
        </Eyebrow>
        <H1>{String(job.event_title)}</H1>
      </div>
      <div className="c-cols">
      <div className="c-col">
      <div className="c-facts">
        <FactTile label="Date" value={formatDay(String(job.starts_at), zone)} />
        <FactTile label="Hours" value={`${timeRange(String(job.starts_at), String(job.ends_at), zone)} (${hours(String(job.starts_at), String(job.ends_at))})`} />
        <FactTile label="Area" value={String(job.area_label ?? 'To be confirmed')} />
        <FactTile label="Rate" value={rate(String(job.rate_type), Number(job.rate_amount_cents))} />
      </div>

      {job.brief_summary ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Eyebrow>The brief, in a line</Eyebrow>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: color.textBody }}>{String(job.brief_summary)}</p>
        </section>
      ) : null}

      <section>
        <Eyebrow>Gear needed</Eyebrow>
        {required.length === 0 ? <Muted>Nothing specific.</Muted> : null}
        {required.map((g) => {
          const have = owned.find((o) => o.category === g);
          return (
            <ListRow
              key={g}
              label={GEAR_LABELS[g] ?? g}
              value={
                have ? (
                  <StatusText tone="positive">{have.make || have.model ? `You have: ${[have.make, have.model].filter(Boolean).join(' ')}` : 'You have it'}</StatusText>
                ) : (
                  <StatusText tone="warn">Missing</StatusText>
                )
              }
            />
          );
        })}
      </section>

      <LockNotice>Exact address, client contact, creative brief and shot list unlock when you’re confirmed.</LockNotice>
      </div>
      <div className="c-aside">

      <BottomBar>
        {status === null ? (
          <ActionForm action={optIn} submit="I’m interested" variant="primary" height={52} buttonStyle={{ width: '100%' }}>
            <input type="hidden" name="slot_id" value={slotId} />
            <input type="hidden" name="org_id" value={String(job.org_id)} />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
              Note to the producer (optional)
              <textarea name="note" style={{ ...textareaStyle, minHeight: 64 }} />
            </label>
          </ActionForm>
        ) : status === 'interested' && mine ? (
          <>
            <strong style={{ fontSize: 15, color: color.positive }}>✓ Interest sent</strong>
            <Muted size={13}>You’ll hear whether you’re selected{job.interest_deadline ? ` after ${dateTime(String(job.interest_deadline), zone)}` : ''}. Nothing is booked until you confirm.</Muted>
            <ActionForm action={withdrawInterest} submit="Withdraw interest" variant="secondary" confirm="Withdraw your interest in this job?">
              <input type="hidden" name="assignment_id" value={String(mine.id)} />
            </ActionForm>
          </>
        ) : (status === 'invited' || status === 'selected') && mine ? (
          <>
            <strong style={{ fontSize: 15, color: color.attention }}>
              {status === 'selected' ? 'You were selected' : 'You were invited'}
              {status === 'selected' && job.confirm_deadline ? ` · confirm by ${dateTime(String(job.confirm_deadline), zone)}` : ''}
              {status === 'invited' && job.invite_expires_at ? ` · respond by ${dateTime(String(job.invite_expires_at), zone)}` : ''}
            </strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <ActionForm action={confirmJob} submit="Confirm" variant="primary" layout="inline" style={{ flex: 1 }} buttonStyle={{ width: '100%' }}>
                <input type="hidden" name="assignment_id" value={String(mine.id)} />
                <input type="hidden" name="event" value={String(job.event_title)} />
              </ActionForm>
              {status === 'invited' ? (
                <ActionForm action={declineInvite} submit="Decline" variant="secondary" layout="inline" style={{ flex: 1 }} buttonStyle={{ width: '100%' }} confirm="Decline this invitation?">
                  <input type="hidden" name="assignment_id" value={String(mine.id)} />
                </ActionForm>
              ) : null}
            </div>
          </>
        ) : (
          <Muted>This job is no longer open to you.</Muted>
        )}
        {job.interest_deadline && status === null ? (
          <Muted size={12}>Interest closes {dateTime(String(job.interest_deadline), zone)}</Muted>
        ) : null}
      </BottomBar>
      </div>
      </div>
    </>
  );
}
