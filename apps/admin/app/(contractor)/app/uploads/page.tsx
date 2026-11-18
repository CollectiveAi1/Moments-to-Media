import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { Uploader } from '@/components/contractor/Uploader';
import { Card, Empty, H1, H2, Muted, Notice, StatusText } from '@/components/ui';
import { requireContractor } from '@/lib/context';
import { isDemoEmail } from '@/lib/demo';
import { loadMyJobs } from '@/lib/contractor/load';
import { bytes, duration, firstName, formatDay } from '@/lib/format';
import { color } from '@/lib/ui';
import { markUploaded } from '../actions';

export const metadata: Metadata = { title: 'Uploads', description: 'Upload footage for your jobs straight to storage, with resume and verification.' };
export const dynamic = 'force-dynamic';

const CAN_UPLOAD = ['checked_in', 'checked_out', 'changes_requested'];

export default async function Uploads() {
  const viewer = await requireContractor();
  const jobs = await loadMyJobs(viewer);
  const active = jobs.filter((j) => [...CAN_UPLOAD, 'uploaded'].includes(j.status));
  const due = jobs.filter((j) => j.status === 'confirmed' && j.dueAt);
  const ids = active.map((j) => j.id);
  const { data: uploads } = ids.length
    ? await viewer.supabase.from('uploads').select('id, assignment_id, filename, bytes, status, kind, failed_reason').in('assignment_id', ids).order('created_at')
    : { data: [] };
  const now = Date.now();

  return (
    <>
      <H1 size={26}>Uploads</H1>
      {active.length === 0 && due.length === 0 ? (
        <Empty title="Nothing to upload">Uploads open when you check in on a job.</Empty>
      ) : null}

      <div className="c-grid">
      {active.map((j) => {
        const mine = (uploads ?? []).filter((u) => String(u.assignment_id) === j.id);
        const landed = mine.filter((u) => u.status === 'completed');
        const inFlight = mine.filter((u) => u.status === 'pending' || u.status === 'in_progress');
        return (
          <Card key={j.id}>
            <H2 size={20}>{j.eventTitle}</H2>
            <span style={{ fontSize: 13, color: color.textSecondary, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" style={{ marginTop: 2 }}>
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              Goes to: {formatDay(j.startsAt, j.timeZone)} {j.eventTitle} / {j.role}, {firstName(viewer.name)} / raw
            </span>
            {j.status === 'changes_requested' ? (
              <Notice tone="warn">Changes requested{j.changesNote ? `: “${j.changesNote}”` : ''}. Upload the fixes, then mark it complete again.</Notice>
            ) : null}
            {mine.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {mine.map((u) => (
                  <div key={String(u.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                    <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' }}>{String(u.filename)}</span>
                    <span style={{ flex: '0 0 auto', display: 'flex', gap: 8 }}>
                      <Muted size={13}>{bytes(Number(u.bytes))}</Muted>
                      <StatusText tone={u.status === 'completed' ? 'positive' : u.status === 'failed' || u.status === 'aborted' ? 'warn' : 'muted'}>
                        {u.status === 'completed' ? 'Done' : u.status === 'in_progress' ? 'Uploading' : String(u.status)}
                      </StatusText>
                      {u.status === 'completed' ? <a href={`/download/${String(u.id)}`} style={{ fontSize: 13 }}>Get</a> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {CAN_UPLOAD.includes(j.status) ? (isDemoEmail(viewer.email) ? <Notice tone="warn">Uploads are off in the demo. A real crew account uploads straight to storage from here.</Notice> : <Uploader slotId={j.slotId} />) : null}

            {j.status === 'uploaded' ? (
              <Notice>Marked complete with {landed.length} file{landed.length === 1 ? '' : 's'}. The producer is reviewing.</Notice>
            ) : j.status === 'checked_out' || j.status === 'changes_requested' ? (
              inFlight.length ? (
                <button type="button" disabled style={{ minHeight: 52, borderRadius: 12, border: 0, background: color.divider, color: color.textMuted, fontWeight: 600 }}>
                  Mark upload complete ({inFlight.length} still uploading)
                </button>
              ) : (
                <ActionForm action={markUploaded} submit="Mark upload complete" variant="primary" height={52} buttonStyle={{ width: '100%' }} {...(landed.length === 0 ? { confirm: 'Mark complete with no files? The producer will see that nothing was uploaded.' } : {})}>
                  <input type="hidden" name="assignment_id" value={j.id} />
                </ActionForm>
              )
            ) : (
              <Muted size={13}>Check out on the shot list when you wrap, then mark the upload complete.</Muted>
            )}
            <Muted size={12}>Big card dump? Use the desktop uploader on your computer.</Muted>
          </Card>
        );
      })}

      {due.map((j) => (
        <Card key={`due-${j.id}`}>
          <span style={{ fontSize: 13, fontWeight: 700, color: color.attention }}>
            {j.dueAt && new Date(j.dueAt).getTime() > now ? `Due in ${duration(new Date(j.dueAt).getTime() - now)}` : 'Due'}
          </span>
          <strong style={{ fontSize: 15 }}>
            {j.eventTitle} · {j.role}
          </strong>
          <Muted size={13}>Not started. Uploads open when you check in.</Muted>
        </Card>
      ))}
      </div>
    </>
  );
}
