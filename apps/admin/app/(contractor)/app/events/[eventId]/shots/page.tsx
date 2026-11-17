import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { BottomBar, ProgressBar } from '@/components/contractor/bits';
import { ShotRow } from '@/components/contractor/ShotRow';
import { AutoRefresh } from '@/components/AutoRefresh';
import { BackLink, Eyebrow, H1, Muted, Notice } from '@/components/ui';
import { requireContractor } from '@/lib/context';
import { isCommitted } from '@/lib/format';
import { color } from '@/lib/ui';
import { checkOut, setShot } from '../../../actions';

export const metadata: Metadata = { title: 'Shot list' };
export const dynamic = 'force-dynamic';

export default async function ShotList({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await requireContractor();
  const db = viewer.supabase;

  const { data: mineRows } = await db
    .from('assignments')
    .select('id, org_id, status, slot_id, slots!assignments_slot_id_fkey!inner ( event_id )')
    .eq('user_id', viewer.userId)
    .eq('slots.event_id', eventId);
  const mine = (mineRows ?? []).find((a) => isCommitted(String(a.status)));
  if (!mine) notFound();

  const [{ data: items }, { data: checks }] = await Promise.all([
    db.from('shot_list_items').select('id, title, description, must_have, slot_id, position').eq('event_id', eventId).order('position'),
    db.from('shot_checks').select('shot_list_item_id, outcome, reason').eq('assignment_id', mine.id),
  ]);
  const shots = (items ?? []).filter((s) => !s.slot_id || s.slot_id === mine.slot_id);
  const outcome = new Map((checks ?? []).map((c) => [String(c.shot_list_item_id), c]));
  const must = shots.filter((s) => s.must_have);
  const other = shots.filter((s) => !s.must_have);
  const resolved = (id: string) => outcome.has(id);
  const done = shots.filter((s) => resolved(String(s.id))).length;
  const mustDone = must.filter((s) => resolved(String(s.id))).length;
  const mustLeft = must.length - mustDone;
  const status = String(mine.status);
  const editable = status === 'checked_in' || status === 'checked_out';

  const row = (s: (typeof shots)[number]) => {
    const c = outcome.get(String(s.id));
    return (
      <ShotRow
        key={String(s.id)}
        action={setShot}
        orgId={String(mine.org_id)}
        assignmentId={String(mine.id)}
        shot={{ id: String(s.id), title: String(s.title), description: (s.description as string | null) ?? null }}
        outcome={(c?.outcome as 'captured' | 'not_possible' | undefined) ?? null}
        reason={(c?.reason as string | null | undefined) ?? null}
        mustHave={Boolean(s.must_have)}
        editable={editable}
      />
    );
  };

  return (
    <>
      <AutoRefresh seconds={20} />
      <BackLink href={`/app/events/${eventId}`}>Event packet</BackLink>
      <H1>Shot list</H1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
          <span>
            {done} of {shots.length} shots
          </span>
          <span style={{ fontWeight: 700, color: mustLeft === 0 ? color.positive : color.attention }}>
            {mustDone} of {must.length} must-haves
          </span>
        </div>
        <ProgressBar value={done} total={shots.length} label="Shots captured" />
      </div>

      {status === 'confirmed' ? <Notice tone="warn">Check in from the packet to start ticking shots off.</Notice> : null}
      {shots.length === 0 ? <Muted>The producer has not written a shot list for this event.</Muted> : null}

      <div className="c-cols">
      <div className="c-col">
      {must.length ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow tone="warn">Must-have</Eyebrow>
          {must.map(row)}
        </section>
      ) : null}
      {other.length ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow>Also get</Eyebrow>
          {other.map(row)}
        </section>
      ) : null}

      </div>
      <div className="c-aside">
      {status === 'checked_in' ? (
        <BottomBar>
          <span style={{ fontSize: 13, fontWeight: 700, color: mustLeft === 0 ? color.positive : color.attention }}>
            {mustLeft === 0 ? 'All must-haves captured' : `${mustLeft} must-have${mustLeft === 1 ? '' : 's'} left. Capture or mark not possible before check out.`}
          </span>
          {mustLeft === 0 ? (
            <ActionForm action={checkOut} submit="Check out" variant="primary" height={52} buttonStyle={{ width: '100%' }} confirm="Check out now? Your hours stop here.">
              <input type="hidden" name="assignment_id" value={String(mine.id)} />
            </ActionForm>
          ) : (
            <button type="button" disabled style={{ minHeight: 52, borderRadius: 12, border: 0, background: color.divider, color: color.textMuted, fontWeight: 600 }}>
              Check out
            </button>
          )}
        </BottomBar>
      ) : status === 'checked_out' ? (
        <Notice>Checked out. Your footage goes up from Uploads.</Notice>
      ) : (
        <span className="c-desktop-only">
          <Muted size={13}>Tick shots as you get them; the producer sees progress live.</Muted>
        </span>
      )}
      </div>
      </div>
    </>
  );
}
