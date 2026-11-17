import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, Empty, H1, H2, Muted, Notice } from '@/components/ui';
import { requireClient } from '@/lib/context';
import { bytes, dateTime, formatDay } from '@/lib/format';
import { myClientIds } from '@/lib/portal/load';
import { color, fonts, radius } from '@/lib/ui';

export const metadata: Metadata = { title: 'Your media' };
export const dynamic = 'force-dynamic';

type File = { id: string; filename: string; bytes: number | null; kind: string; completed_at: string | null };

const KIND: Record<string, string> = { deliverables: 'Final edits', selects: 'Selects', raw: 'Original footage' };

function typeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mov', 'm4v', 'mxf', 'avi'].includes(ext)) return 'Video';
  if (['jpg', 'jpeg', 'png', 'heic', 'tif', 'tiff', 'raw', 'cr3', 'arw', 'dng', 'webp'].includes(ext)) return 'Photo';
  if (['zip'].includes(ext)) return 'Archive';
  if (['wav', 'mp3', 'aac'].includes(ext)) return 'Audio';
  return 'File';
}

/**
 * Everything Moments to Media has delivered, across every project, in one
 * place. A file shows here once the producer has approved it and released
 * the project (public.client_media decides). Each download is a private
 * link straight from storage that lasts 15 minutes.
 */
export default async function PortalMedia() {
  const viewer = await requireClient();
  const ids = (await myClientIds(viewer)).map((c) => c.id);
  const db = viewer.supabase;
  const [{ data: events }, { data: releases }] = await Promise.all([
    ids.length
      ? db.from('events').select('id, title, starts_at, time_zone, status').in('client_id', ids).neq('status', 'cancelled').order('starts_at', { ascending: false })
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    db.from('media_releases').select('event_id, released_at, message'),
  ]);
  const released = new Map((releases ?? []).map((r) => [String(r.event_id), r]));
  const delivered = (events ?? []).filter((e) => released.has(String(e.id)));
  const waiting = (events ?? []).filter((e) => !released.has(String(e.id)));
  const files = await Promise.all(
    delivered.map(async (e) => ({ event: e, files: ((await db.rpc('client_media', { p_event: String(e.id) })).data ?? []) as File[] })),
  );
  const total = files.reduce((n, g) => n + g.files.length, 0);
  const totalBytes = files.reduce((n, g) => n + g.files.reduce((m, f) => m + Number(f.bytes ?? 0), 0), 0);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <H1>Your media</H1>
        <Muted>
          {total
            ? `${total} file${total === 1 ? '' : 's'} from ${viewer.org.name} · ${bytes(totalBytes)} in all.`
            : `Photos and video from ${viewer.org.name} appear here as soon as they are delivered.`}
        </Muted>
      </div>

      {files.length === 0 ? (
        <Empty title="Nothing delivered yet">
          {waiting.length ? 'Your media will appear here once it’s edited and approved. We’ll let you know.' : 'You have no projects with us yet.'}
        </Empty>
      ) : null}

      {files.map(({ event: e, files: list }) => {
        const r = released.get(String(e.id));
        const groups = ['deliverables', 'selects', 'raw'].map((k) => ({ kind: k, items: list.filter((f) => f.kind === k) })).filter((g) => g.items.length);
        return (
          <Card key={String(e.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <H2 size={20}>{String(e.title)}</H2>
              <Link href={`/portal/projects/${String(e.id)}`} style={{ fontSize: 14 }}>Project details<span className="sr-only"> for {String(e.title)}</span></Link>
            </div>
            <Muted size={13}>
              {formatDay(String(e.starts_at), String(e.time_zone))} · delivered {r ? dateTime(String(r.released_at), String(e.time_zone)) : ''}
            </Muted>
            {r?.message ? <Notice>{String(r.message)}</Notice> : null}
            {groups.map((g) => (
              <section key={g.kind} aria-label={`${KIND[g.kind] ?? g.kind}, ${String(e.title)}`} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <h3 style={{ margin: '6px 0', fontFamily: fonts.label, fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: color.textMuted }}>
                  {KIND[g.kind] ?? g.kind} ({g.items.length})
                </h3>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {g.items.map((f) => (
                    <li key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${color.divider}` }}>
                      <span aria-hidden="true" style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: radius.md, background: color.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.label, fontSize: 11, fontWeight: 600, color: color.textSecondary }}>
                        {typeOf(f.filename) === 'Video' ? 'VID' : typeOf(f.filename) === 'Photo' ? 'IMG' : 'FILE'}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{f.filename}</span>
                        <span style={{ fontSize: 13, color: color.textMuted }}>{typeOf(f.filename)} · {bytes(f.bytes)}</span>
                      </span>
                      <a
                        href={`/download/${f.id}`}
                        download
                        style={{ minHeight: 44, padding: '0 16px', display: 'inline-flex', alignItems: 'center', borderRadius: radius.sm, background: color.primary, color: color.onPrimary, textDecoration: 'none', fontFamily: fonts.label, fontWeight: 600, fontSize: 14 }}
                      >
                        Download<span className="sr-only"> {f.filename}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </Card>
        );
      })}

      {files.length && waiting.length ? (
        <Muted size={13}>Still in editing: {waiting.map((e) => String(e.title)).join(', ')}.</Muted>
      ) : null}
      <Muted size={12}>Each download link is private to you and works for 15 minutes; come back to this page any time for a fresh one. Large videos download best on a computer.</Muted>
    </>
  );
}
