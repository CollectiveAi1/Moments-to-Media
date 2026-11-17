'use client';

import { crc64Base64, crc64Start, crc64Update, planPartBytes } from '@mtm/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { color, fonts, radius } from '@/lib/ui';
import { ProgressBar } from './bits';

type FileState = {
  name: string;
  size: number;
  sent: number;
  phase: 'queued' | 'hashing' | 'uploading' | 'done' | 'failed' | 'paused';
  hashed: number;
  error?: string;
};

type Part = { part_number: number; checksum: string; offset: number; size: number };
type Signed = { part_number: number; checksum: string; url: string };

const BATCH = 100;
const FUNCTIONS = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1`;

class Stop extends Error {}

/**
 * The browser upload path, end to end, against the same Edge Functions the
 * native app will use (PRD "Footage pipeline → How an upload works"):
 *
 *  1. hash the file locally: CRC-64/NVME per part and for the whole file;
 *  2. upload-start declares size and checksum before a byte moves;
 *  3. each part is PUT straight to R2 on a presigned URL that has the part's
 *     checksum signed into it, so R2 checks it on arrival (rule 7);
 *  4. the server's ledger, not this tab, decides what is still missing;
 *  5. upload-complete assembles it and the database judges size and checksum.
 *
 * Progress here is per part. The native module's background progress is the
 * real thing for card dumps; this is for the files a phone browser can hold.
 */
export function Uploader({ slotId, disabled }: { slotId: string; disabled?: boolean }) {
  const router = useRouter();
  const [files, setFiles] = useState<FileState[]>([]);
  const [running, setRunning] = useState(false);
  const [wifiOnly, setWifiOnly] = useState(false);
  const paused = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const patch = (i: number, p: Partial<FileState>) =>
    setFiles((list) => list.map((f, j) => (j === i ? { ...f, ...p } : f)));

  async function waitIfPaused() {
    while (paused.current) await new Promise((r) => setTimeout(r, 400));
    const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
    if (wifiOnly && conn?.type === 'cellular') throw new Error('Paused: on mobile data and Wi-Fi only is on.');
  }

  async function call<T>(name: string, token: string, body: unknown): Promise<T> {
    const res = await fetch(`${FUNCTIONS}/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `${name} failed (${res.status})`);
    return json;
  }

  async function uploadOne(file: File, index: number) {
    const supabase = browserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error('You are signed out. Sign in again and retry.');
    const token = session.access_token;

    // 1. hash
    patch(index, { phase: 'hashing' });
    const partSize = planPartBytes(file.size);
    const whole = crc64Start();
    const parts: Part[] = [];
    for (let offset = 0, n = 1; offset < file.size; offset += partSize, n++) {
      const size = Math.min(partSize, file.size - offset);
      const buf = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
      const own = crc64Update(crc64Start(), buf);
      crc64Update(whole, buf);
      parts.push({ part_number: n, checksum: crc64Base64(own), offset, size });
      patch(index, { hashed: offset + size });
    }
    const checksumOf = (n: number) => parts.find((p) => p.part_number === n)!.checksum;

    // 2. declare
    const plan = await call<{ upload_id: string; part_size_bytes: number; presigned: Signed[] }>('upload-start', token, {
      slot_id: slotId,
      filename: file.name,
      bytes: file.size,
      checksum: crc64Base64(whole),
      part_checksums: parts.slice(0, BATCH).map((p) => ({ part_number: p.part_number, checksum: p.checksum })),
      presign_count: BATCH,
    });
    if (plan.part_size_bytes !== partSize) {
      throw new Error('The server planned the parts differently from this device. Update the app and retry.');
    }
    patch(index, { phase: 'uploading' });

    // 3-4. parts, batch by batch, the server deciding what is missing
    let signed: Signed[] = plan.presigned;
    let sent = 0;
    for (;;) {
      for (const s of signed) {
        await waitIfPaused();
        const part = parts.find((p) => p.part_number === s.part_number)!;
        let etag: string | null = null;
        for (let attempt = 1; attempt <= 4 && !etag; attempt++) {
          let res: Response;
          try {
            res = await fetch(s.url, {
              method: 'PUT',
              headers: { 'x-amz-checksum-crc64nvme': s.checksum },
              body: file.slice(part.offset, part.offset + part.size),
            });
          } catch {
            if (attempt === 1 && sent === 0) {
              throw new Stop(
                'Storage refused the upload from this browser. The footage bucket needs a CORS rule allowing this site; your file is untouched. Tell the producer.',
              );
            }
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            continue;
          }
          if (res.status === 403) break; // URL expired: re-sign below
          if (!res.ok) {
            if (attempt === 4) throw new Error(`Part ${part.part_number} was refused (${res.status}).`);
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            continue;
          }
          etag = res.headers.get('ETag');
          if (!etag) throw new Stop('Storage did not report the part back to this browser (the bucket’s CORS rule must expose ETag).');
        }
        if (!etag) break;
        const { error } = await supabase.rpc('record_upload_part', {
          p_upload: plan.upload_id,
          p_part_number: part.part_number,
          p_etag: etag,
          p_checksum: s.checksum,
        });
        if (error) throw new Error(error.message);
        sent += part.size;
        patch(index, { sent });
      }

      const { data: resume, error } = await supabase.rpc('upload_resume_plan', { p_upload: plan.upload_id });
      if (error) throw new Error(error.message);
      const missing = ((resume as { missing: Array<{ part_number: number }> }).missing ?? []).map((m) => m.part_number);
      if (missing.length === 0) break;
      const next = missing.slice(0, BATCH);
      const res = await call<{ presigned: Signed[] }>('upload-presign', token, {
        upload_id: plan.upload_id,
        part_numbers: next,
        part_checksums: next.map((n) => ({ part_number: n, checksum: checksumOf(n) })),
        count: next.length,
      });
      signed = res.presigned;
    }

    // 5. assemble and verify
    await call('upload-complete', token, { upload_id: plan.upload_id });
    patch(index, { phase: 'done', sent: file.size });
  }

  async function start(list: FileList) {
    const chosen = [...list];
    const offset = files.length;
    setFiles((f) => [...f, ...chosen.map((c) => ({ name: c.name, size: c.size, sent: 0, hashed: 0, phase: 'queued' as const }))]);
    setRunning(true);
    for (let i = 0; i < chosen.length; i++) {
      try {
        await uploadOne(chosen[i]!, offset + i);
      } catch (e) {
        patch(offset + i, { phase: 'failed', error: e instanceof Error ? e.message : String(e) });
        if (e instanceof Stop) break;
      }
    }
    setRunning(false);
    router.refresh();
  }

  const total = files.reduce((n, f) => n + f.size, 0);
  const sent = files.reduce((n, f) => n + f.sent, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {files.length ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>
              {(sent / 1e9).toFixed(2)} of {(total / 1e9).toFixed(2)} GB
            </span>
            <span style={{ color: color.textMuted }}>{running ? (isPaused ? 'Paused' : 'Uploading…') : 'Finished'}</span>
          </div>
          <ProgressBar value={sent} total={total} height={8} paused={isPaused} label="Upload progress" />
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span style={{ flex: '0 0 auto', fontWeight: 700, color: f.phase === 'done' ? color.positive : f.phase === 'failed' ? color.attention : color.textSecondary }}>
                {f.phase === 'done'
                  ? 'Done'
                  : f.phase === 'failed'
                    ? 'Failed'
                    : f.phase === 'hashing'
                      ? `Preparing ${Math.round((f.hashed / Math.max(f.size, 1)) * 100)}%`
                      : f.phase === 'uploading'
                        ? `${Math.round((f.sent / Math.max(f.size, 1)) * 100)}%`
                        : 'Queued'}
              </span>
            </div>
          ))}
          {files.filter((f) => f.error).map((f, i) => (
            <span key={`e${i}`} role="alert" style={{ fontSize: 13, color: color.warnText, background: color.warnBg, padding: '8px 10px', borderRadius: radius.sm }}>
              {f.name}: {f.error}
            </span>
          ))}
        </>
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={!running}
          onClick={() => {
            paused.current = !paused.current;
            setIsPaused(paused.current);
          }}
          style={{ flex: 1, minHeight: 44, borderRadius: radius.lg, border: `1px solid ${color.border}`, background: 'transparent', color: running ? color.text : color.textMuted, fontFamily: fonts.label, fontWeight: 600, cursor: running ? 'pointer' : 'default' }}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          disabled={disabled || running}
          onClick={() => input.current?.click()}
          style={{ flex: 1, minHeight: 44, borderRadius: radius.lg, border: `1px solid ${color.border}`, background: 'transparent', color: disabled || running ? color.textMuted : color.text, fontFamily: fonts.label, fontWeight: 600, cursor: disabled || running ? 'default' : 'pointer' }}
        >
          Add files
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void start(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, fontSize: 14 }}>
        Wi-Fi only
        <input type="checkbox" checked={wifiOnly} onChange={(e) => setWifiOnly(e.target.checked)} style={{ width: 22, height: 22 }} />
      </label>
    </div>
  );
}
