import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { BackLink, Card, Eyebrow, H1, H2, ListRow, Muted, Notice, StatusText, Tag, inputStyle, textareaStyle } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { ASSIGNMENT_STATUS, PAYOUT_STATUS, bytes, dateTime, firstName, formatDay, money } from '@/lib/format';
import { card, color, radius } from '@/lib/ui';
import { approveAll, requestChanges, saveRating } from './actions';
import { RatingPicker } from './RatingPicker';

export const metadata: Metadata = { title: 'Review' };
export const dynamic = 'force-dynamic';

export default async function ReviewPage({ params }: { params: Promise<{ eventId: string; assignmentId: string }> }) {
  const { eventId, assignmentId } = await params;
  const viewer = await requireAdmin();
  const db = viewer.supabase;

  const { data: a } = await db
    .from('assignments')
    .select('id, user_id, status, note, checked_in_at, checked_out_at, updated_at, slot_id, slots!assignments_slot_id_fkey ( role, events!slots_event_id_fkey ( id, title, starts_at, time_zone ) )')
    .eq('id', assignmentId)
    .maybeSingle();
  if (!a) notFound();
  const slot = a.slots as unknown as { role: string; events: { id: string; title: string; starts_at: string; time_zone: string } };
  const zone = slot.events.time_zone;

  const [profile, uploads, deliverables, reviews, shots, checks, rating, payout] = await Promise.all([
    db.from('profiles').select('full_name').eq('user_id', a.user_id).maybeSingle(),
    db.from('uploads').select('id, filename, bytes, status, kind, completed_at').eq('assignment_id', assignmentId).order('created_at'),
    db.from('deliverables').select('id, title, spec, due_at').eq('slot_id', a.slot_id).order('due_at'),
    db.from('deliverable_reviews').select('deliverable_id, decision, notes, created_at').eq('assignment_id', assignmentId).order('created_at', { ascending: false }),
    db.from('shot_list_items').select('id, title, must_have, slot_id').eq('event_id', slot.events.id),
    db.from('shot_checks').select('shot_list_item_id, outcome, reason').eq('assignment_id', assignmentId),
    db.from('ratings').select('quality, punctuality, communication, notes').eq('assignment_id', assignmentId).maybeSingle(),
    db.from('payouts').select('amount_cents, status').eq('assignment_id', assignmentId).maybeSingle(),
  ]);

  const name = String(profile.data?.full_name ?? 'Contractor');
  const files = (uploads.data ?? []).filter((u) => u.status === 'completed');
  const inFlight = (uploads.data ?? []).filter((u) => ['pending', 'in_progress'].includes(String(u.status)));
  const myShots = (shots.data ?? []).filter((s) => !s.slot_id || s.slot_id === a.slot_id);
  const must = myShots.filter((s) => s.must_have);
  const outcome = new Map((checks.data ?? []).map((c) => [String(c.shot_list_item_id), c]));
  const mustCaptured = must.filter((s) => outcome.get(String(s.id))?.outcome === 'captured').length;
  const notPossible = myShots.filter((s) => outcome.get(String(s.id))?.outcome === 'not_possible');
  const latest = (id: string) => (reviews.data ?? []).find((r) => String(r.deliverable_id) === id);
  const st = ASSIGNMENT_STATUS[String(a.status)] ?? { label: String(a.status), tone: 'muted' as const };
  const canDecide = a.status === 'uploaded';

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <BackLink href="/footage">Footage and review</BackLink>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <H1>
            {slot.events.title} · {slot.role}
          </H1>
          <Muted>
            {name} · shot {formatDay(slot.events.starts_at, zone)}
            {a.status !== 'checked_out' ? ` · marked uploaded ${dateTime(String(a.updated_at), zone)}` : ''} · {files.length} files,{' '}
            {bytes(files.reduce((n, f) => n + Number(f.bytes ?? 0), 0))}
          </Muted>
          <span>
            <Tag tone={st.tone}>{st.label}</Tag>
          </span>
        </div>

        {inFlight.length ? <Notice tone="warn">{inFlight.length} file(s) are still uploading.</Notice> : null}

        {files.length === 0 ? (
          <Card>
            <Muted>
              No files were uploaded for this slot. {name.split(' ')[0]} marked it complete without footage; the board records that.
            </Muted>
          </Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {files.map((f) => (
              <a
                key={String(f.id)}
                href={`/download/${String(f.id)}`}
                style={{
                  ...card(radius.md),
                  aspectRatio: '3 / 2',
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  textDecoration: 'none',
                  color: color.text,
                }}
              >
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, overflowWrap: 'anywhere' }}>{String(f.filename)}</span>
                <span style={{ fontSize: 12, color: color.textMuted }}>
                  {bytes(Number(f.bytes))} · {String(f.kind)} · Download
                </span>
              </a>
            ))}
          </div>
        )}
        <Muted size={12}>Previews are not generated yet; files open as downloads (docs/ui/NOTES.md).</Muted>

        <Card>
          <H2 size={20}>Deliverables</H2>
          {(deliverables.data ?? []).length === 0 ? <Muted>This slot has no deliverables listed; approving reviews the footage as a whole.</Muted> : null}
          {(deliverables.data ?? []).map((d) => {
            const r = latest(String(d.id));
            const spec = (d.spec ?? {}) as Record<string, unknown>;
            return (
              <ListRow
                key={String(d.id)}
                label={
                  <span>
                    {String(d.title)}
                    <Muted size={12}>
                      {spec.format ? ` · ${String(spec.format)}` : ''}
                      {d.due_at ? ` · due ${dateTime(String(d.due_at), zone)}` : ''}
                    </Muted>
                  </span>
                }
                value={
                  r ? (
                    <StatusText tone={r.decision === 'approved' ? 'positive' : 'warn'}>
                      {r.decision === 'approved' ? 'Approved' : `Changes requested: ${String(r.notes ?? '')}`}
                    </StatusText>
                  ) : (
                    <StatusText>Not reviewed</StatusText>
                  )
                }
              />
            );
          })}
          <ListRow
            label="Must-have shots"
            value={
              must.length === 0 ? (
                <StatusText>None on the list</StatusText>
              ) : (
                <StatusText tone={mustCaptured === must.length ? 'positive' : 'warn'}>
                  {mustCaptured} of {must.length} captured
                </StatusText>
              )
            }
          />
          {notPossible.map((s) => (
            <Muted key={String(s.id)} size={13}>
              Not possible: {String(s.title)} — “{String(outcome.get(String(s.id))?.reason ?? '')}”
            </Muted>
          ))}
          {a.note ? <Muted size={13}>Note on the assignment: “{String(a.note)}”</Muted> : null}
        </Card>
      </div>

      <aside style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
          <Eyebrow>Rate this job</Eyebrow>
          <ActionForm action={saveRating} submit="Save rating" variant="secondary">
            <input type="hidden" name="assignment_id" value={assignmentId} />
            <RatingPicker name="quality" label="Quality" initial={rating.data?.quality ?? null} />
            <RatingPicker name="punctuality" label="Punctuality" initial={rating.data?.punctuality ?? null} />
            <RatingPicker name="communication" label="Communication" initial={rating.data?.communication ?? null} />
            <textarea name="notes" placeholder="Private notes (optional)" defaultValue={String(rating.data?.notes ?? '')} style={{ ...textareaStyle, minHeight: 64 }} />
          </ActionForm>
        </Card>

        <Card>
          <Eyebrow>Decision</Eyebrow>
          {canDecide ? (
            <>
              <ActionForm action={approveAll} submit="Approve all deliverables" buttonStyle={{ width: '100%' }}>
                <input type="hidden" name="assignment_id" value={assignmentId} />
                <input type="hidden" name="first_name" value={firstName(name)} />
              </ActionForm>
              <div style={{ borderTop: `1px solid ${color.divider}`, paddingTop: 12 }}>
                <ActionForm action={requestChanges} submit="Request changes" variant="secondary">
                  <input type="hidden" name="assignment_id" value={assignmentId} />
                  <input type="hidden" name="first_name" value={firstName(name)} />
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                    Or ask for changes
                    <textarea name="notes" required style={textareaStyle} placeholder="What needs to change" />
                  </label>
                  {(deliverables.data ?? []).length > 1 ? (
                    <select name="deliverable_id" style={inputStyle} defaultValue="">
                      <option value="">All deliverables</option>
                      {(deliverables.data ?? []).map((d) => (
                        <option key={String(d.id)} value={String(d.id)}>{String(d.title)}</option>
                      ))}
                    </select>
                  ) : null}
                </ActionForm>
              </div>
            </>
          ) : a.status === 'changes_requested' ? (
            <Notice tone="warn">Changes were requested. This becomes reviewable again when {firstName(name)} re-uploads.</Notice>
          ) : ['approved', 'paid'].includes(String(a.status)) ? (
            <Notice>
              Approved.{' '}
              {payout.data
                ? `Payout of ${money(Number(payout.data.amount_cents))} is ${PAYOUT_STATUS[String(payout.data.status)]?.label.toLowerCase() ?? payout.data.status}.`
                : ''}
            </Notice>
          ) : (
            <Muted>Not uploaded yet. The decision opens once {firstName(name)} marks the upload complete.</Muted>
          )}
        </Card>
        <BackLink href={`/events/${eventId}`}>Event page</BackLink>
      </aside>
    </div>
  );
}
