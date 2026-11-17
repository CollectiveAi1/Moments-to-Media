import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { Card, Empty, Field, H2, Muted, Row, Tag, inputStyle, textareaStyle } from '@/components/ui';
import { describeAudience, parseAudience } from '@/lib/audience';
import { requireAdmin } from '@/lib/context';
import { TIME_ZONES, dateTime } from '@/lib/format';
import { color } from '@/lib/ui';
import { deleteAnnouncement, postAnnouncement, setPinned } from './actions';

export const metadata: Metadata = { title: 'Announcements' };
export const dynamic = 'force-dynamic';

export default async function AnnouncementsPage() {
  const viewer = await requireAdmin();
  const [{ data: rows }, { data: events }] = await Promise.all([
    viewer.supabase.from('announcements').select('id, body, pinned, audience, scheduled_for, created_at, author_id').eq('org_id', viewer.org.id).order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    viewer.supabase.from('events').select('id, title').eq('org_id', viewer.org.id).in('status', ['staffing', 'staffed', 'in_progress']).order('starts_at'),
  ]);
  const authorIds = [...new Set((rows ?? []).map((r) => String(r.author_id)))];
  const { data: authors } = authorIds.length ? await viewer.supabase.from('profiles').select('user_id, full_name').in('user_id', authorIds) : { data: [] };
  const names = new Map((authors ?? []).map((a) => [String(a.user_id), String(a.full_name)]));
  const now = Date.now();

  return (
    <>
      <PageHeader title="Announcements" subtitle="Messages for the crew. Pinned ones stay at the top of contractors’ home screens." />
      <Card>
        <H2 size={20}>New announcement</H2>
        <ActionForm action={postAnnouncement} submit="Post" reset>
          <Field label="Message">
            <textarea name="body" required style={textareaStyle} placeholder="Insurance certificates expiring this quarter: please re-upload." />
          </Field>
          <Row>
            <Field label="Who it is for">
              <select name="kind" style={inputStyle} defaultValue="all">
                <option value="all">Everyone</option>
                <option value="skill">Contractors with a skill</option>
                <option value="area">Contractors based in an area</option>
                <option value="event">Crew on one event</option>
              </select>
            </Field>
            <Field label="Skill" hint="If by skill.">
              <input name="skill" placeholder="drone" style={inputStyle} />
            </Field>
            <Field label="Area" hint="If by area.">
              <input name="area" placeholder="Columbus" style={inputStyle} />
            </Field>
            <Field label="Event" hint="If one event’s crew.">
              <select name="event_id" style={inputStyle} defaultValue="">
                <option value="">—</option>
                {(events ?? []).map((e) => (
                  <option key={String(e.id)} value={String(e.id)}>{String(e.title)}</option>
                ))}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Schedule for (optional)">
              <input name="date" type="date" style={inputStyle} />
            </Field>
            <Field label="Time">
              <input name="time" type="time" defaultValue="09:00" style={inputStyle} />
            </Field>
            <Field label="Zone">
              <select name="zone" style={inputStyle} defaultValue="America/New_York">
                {TIME_ZONES.map((z) => (
                  <option key={z.value} value={z.value}>{z.label}</option>
                ))}
              </select>
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14 }}>
              <input type="checkbox" name="pinned" /> Pin to the top
            </label>
          </Row>
        </ActionForm>
      </Card>

      {(rows ?? []).length === 0 ? (
        <Empty title="No announcements yet" />
      ) : (
        (rows ?? []).map((r) => {
          const scheduled = r.scheduled_for && new Date(String(r.scheduled_for)).getTime() > now;
          return (
            <Card key={String(r.id)} highlight={Boolean(r.pinned)}>
              <Row align="center" gap={8}>
                {r.pinned ? <Tag tone="label">Pinned</Tag> : null}
                {scheduled ? <Tag tone="warn">Scheduled {dateTime(String(r.scheduled_for), 'America/New_York')}</Tag> : null}
                <Tag>{describeAudience(parseAudience(r.audience))}</Tag>
                <Muted size={12}>
                  {names.get(String(r.author_id)) ?? 'Someone'} · {dateTime(String(r.created_at), 'America/New_York')}
                </Muted>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <ActionForm action={setPinned} submit={r.pinned ? 'Unpin' : 'Pin'} variant="secondary" layout="inline">
                    <input type="hidden" name="announcement_id" value={String(r.id)} />
                    <input type="hidden" name="pinned" value={r.pinned ? 'false' : 'true'} />
                  </ActionForm>
                  <ActionForm action={deleteAnnouncement} submit="Delete" variant="danger" layout="inline" confirm="Delete this announcement?">
                    <input type="hidden" name="announcement_id" value={String(r.id)} />
                  </ActionForm>
                </span>
              </Row>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: color.textBody, whiteSpace: 'pre-wrap' }}>{String(r.body)}</p>
            </Card>
          );
        })
      )}
    </>
  );
}
