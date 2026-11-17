import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { Avatar, Monogram, mapsUrl } from '@/components/contractor/bits';
import { Card, Eyebrow, H1, H2, LinkButton, Muted, StatusText } from '@/components/ui';
import { parseAudience, reaches } from '@/lib/audience';
import { requireContractor } from '@/lib/context';
import { needs, nextUp } from '@/lib/contractor/home';
import { loadMyJobs } from '@/lib/contractor/load';
import { dateTime, duration, firstName, formatDay, formatTime, isCommitted, rate, timeRange } from '@/lib/format';
import { color, fonts, radius } from '@/lib/ui';
import { confirmJob, declineInvite } from './actions';

export const metadata: Metadata = { title: 'Home', description: 'Your next job, what needs you, and what is coming up.' };
export const dynamic = 'force-dynamic';

export default async function ContractorHome() {
  const viewer = await requireContractor();
  const db = viewer.supabase;
  const now = new Date();
  const [jobs, docs, details, announcements] = await Promise.all([
    loadMyJobs(viewer),
    db.from('compliance_documents').select('id, doc_type, status, expires_on').eq('user_id', viewer.userId).eq('org_id', viewer.org.id),
    db.from('contractor_details').select('skills, home_base_label').eq('user_id', viewer.userId).maybeSingle(),
    db.from('announcements').select('id, body, pinned, audience, created_at').eq('org_id', viewer.org.id).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(10),
  ]);

  const next = nextUp(jobs, now);
  const asks = needs(jobs, (docs.data ?? []).map((d) => ({ id: String(d.id), docType: String(d.doc_type), status: String(d.status), expiresOn: (d.expires_on as string | null) ?? null })), now);
  const upcoming = jobs
    .filter((j) => (isCommitted(j.status) || ['invited', 'selected', 'interested'].includes(j.status)) && new Date(j.startsAt).getTime() > now.getTime() && new Date(j.startsAt).getTime() < now.getTime() + 30 * 86_400_000)
    .filter((j) => j.id !== next?.id)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const who = {
    skills: ((details.data?.skills as string[] | undefined) ?? []),
    homeLabel: (details.data?.home_base_label as string | null | undefined) ?? null,
    eventIds: jobs.filter((j) => isCommitted(j.status)).map((j) => j.eventId),
  };
  const news = (announcements.data ?? []).filter((a) => reaches(parseAudience(a.audience), who)).slice(0, 3);

  return (
    <>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="c-mobile-only">
          <Monogram />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <H1 size={24}>Hi, {firstName(viewer.name)}</H1>
          <span className="c-desktop-only" style={{ fontSize: 14, color: color.textMuted }}>
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: next?.timeZone ?? 'America/New_York' })}
          </span>
        </span>
        <span className="c-mobile-only" style={{ marginLeft: 'auto' }}>
          <Avatar name={viewer.name} href="/app/profile" />
        </span>
      </header>

      <div className="c-cols">
      <div className="c-col">
      {next ? (
        <Card r={radius.xxl}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <Eyebrow tone="label">
              {whenLabel(next.startsAt, next.timeZone, now)} · {next.role}
            </Eyebrow>
            <StatusText tone={next.status === 'checked_in' ? 'positive' : 'label'}>
              {next.status === 'checked_in' ? 'Checked in' : `Call in ${duration(new Date(next.callTime).getTime() - now.getTime())}`}
            </StatusText>
          </div>
          <H2>{next.eventTitle}</H2>
          <Muted>
            Call {formatTime(next.callTime, next.timeZone)} · Wrap {formatTime(next.endsAt, next.timeZone)}
          </Muted>
          {next.venue || next.address ? <Muted>{[next.venue, next.address].filter(Boolean).join(' · ')}</Muted> : null}
          <div style={{ display: 'flex', gap: 10 }}>
            <LinkButton href={`/app/events/${next.eventId}`} variant="primary" height={48} style={{ flex: 1 }}>
              Open packet
            </LinkButton>
            {next.address || next.venue ? (
              <a href={mapsUrl(String(next.address ?? next.venue))} target="_blank" rel="noreferrer" style={{ flex: 1, minHeight: 48, borderRadius: 12, background: color.surfaceAlt, color: color.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.label, fontWeight: 600, fontSize: 15, textDecoration: 'none' }}>
                Directions
              </a>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card>
          <Muted>Nothing booked yet. Open calls you can take are under Jobs.</Muted>
          <LinkButton href="/app/jobs" variant="secondary">See open calls</LinkButton>
        </Card>
      )}

      {asks.length ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow>Needs you</Eyebrow>
          {asks.map((n) => {
            const job = jobs.find((j) => j.id === n.assignmentId);
            const respond = n.kind === 'respond_selected' || n.kind === 'respond_invite';
            return (
              <div
                key={n.key}
                style={{ background: color.surface, border: `1px solid ${n.urgent ? color.attentionBorder : color.border}`, borderRadius: radius.xl, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: n.urgent ? color.attention : color.textSecondary }}>
                  {n.title}
                  {n.by ? ` · ${respond ? 'respond by' : 'by'} ${job ? dateTime(n.by, job.timeZone) : n.by}` : ''}
                </span>
                <strong style={{ fontSize: 15 }}>{n.detail}</strong>
                {job && respond ? (
                  <>
                    <Muted size={13}>
                      {formatDay(job.startsAt, job.timeZone)} · {timeRange(job.startsAt, job.endsAt, job.timeZone)} · {rate(job.rateType, job.rateCents)}
                      {job.area ? ` · ${job.area}` : ''}
                    </Muted>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <ActionForm action={confirmJob} submit="Confirm" variant="primary" layout="inline" style={{ flex: 1 }} buttonStyle={{ width: '100%' }}>
                        <input type="hidden" name="assignment_id" value={job.id} />
                        <input type="hidden" name="event" value={job.eventTitle} />
                      </ActionForm>
                      {n.kind === 'respond_invite' ? (
                        <ActionForm action={declineInvite} submit="Decline" variant="secondary" layout="inline" style={{ flex: 1 }} buttonStyle={{ width: '100%' }} confirm="Decline this invitation?">
                          <input type="hidden" name="assignment_id" value={job.id} />
                        </ActionForm>
                      ) : null}
                    </div>
                    {n.kind === 'respond_selected' ? (
                      <Muted size={12}>Can’t make it? Tell the producer; if you don’t confirm by the deadline the slot goes to the next candidate.</Muted>
                    ) : null}
                  </>
                ) : n.kind === 'upload' || n.kind === 'changes' ? (
                  <Link href="/app/uploads" style={{ fontSize: 14 }}>Go to uploads →</Link>
                ) : n.kind === 'document' ? (
                  <Link href="/app/profile#documents" style={{ fontSize: 14 }}>Update documents →</Link>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      </div>
      <div className="c-col">
      {upcoming.length ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Eyebrow>Upcoming</Eyebrow>
          {upcoming.map((j) => (
            <Link
              key={j.id}
              href={isCommitted(j.status) ? `/app/events/${j.eventId}` : `/app/jobs/${j.slotId}`}
              style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${color.divider}`, textDecoration: 'none', color: color.text }}
            >
              <span style={{ width: 44, textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontFamily: fonts.label, fontSize: 11, color: color.textMuted }}>{formatDay(j.startsAt, j.timeZone).split(' ')[0]}</span>
                <span style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 600 }}>{formatDay(j.startsAt, j.timeZone).split(' ')[2]}</span>
              </span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <strong style={{ fontSize: 15 }}>{j.eventTitle}</strong>
                <Muted size={13}>{j.role} · {j.venue ?? j.area ?? ''}</Muted>
              </span>
              <StatusText tone={isCommitted(j.status) ? 'positive' : j.status === 'interested' ? 'label' : 'warn'}>
                {isCommitted(j.status)
                  ? 'Confirmed'
                  : j.status === 'interested'
                    ? 'Interest sent'
                    : j.confirmDeadline || j.inviteExpiresAt
                      ? `Confirm by ${formatTime(String(j.confirmDeadline ?? j.inviteExpiresAt), j.timeZone)}`
                      : 'Respond'}
              </StatusText>
            </Link>
          ))}
        </section>
      ) : null}

      {news.length ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow>From the producers</Eyebrow>
          {news.map((a) => (
            <Card key={String(a.id)} highlight={Boolean(a.pinned)}>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: color.textBody, whiteSpace: 'pre-wrap' }}>{String(a.body)}</p>
            </Card>
          ))}
        </section>
      ) : null}

      </div>
      </div>

      {viewer.isAdmin ? (
        <Link href="/board" className="c-mobile-only" style={{ fontSize: 14, textAlign: 'center' }}>
          Open the admin console →
        </Link>
      ) : null}
    </>
  );
}

function whenLabel(startsAt: string, zone: string, now: Date): string {
  const day = formatDay(startsAt, zone);
  if (day === formatDay(now.toISOString(), zone)) {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hour12: false }).format(new Date(startsAt)));
    return hour >= 17 ? 'Tonight' : 'Today';
  }
  if (day === formatDay(new Date(now.getTime() + 86_400_000).toISOString(), zone)) return 'Tomorrow';
  return day;
}
