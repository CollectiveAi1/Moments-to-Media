/**
 * Puts real sample files into the demo client's delivered project, through the
 * same upload protocol the crew uploader uses (upload-start, presigned PUTs
 * straight to R2 with CRC-64/NVME, record_upload_part, upload-complete), as
 * the demo photographer. Run from a machine, so the bucket's browser CORS rule
 * does not matter.
 *
 *   SUPABASE_URL, SUPABASE_ANON_KEY, CREW_EMAIL, CREW_PASSWORD, SLOT_ID
 *   node --experimental-strip-types scripts/demo/upload_samples.ts <kind>:<file> ...
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';
import { crc64Base64, crc64Start, crc64Update, planPartBytes } from '../../packages/shared/src/uploads.ts';

const require = createRequire(new URL('../../apps/admin/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });

async function call<T>(name: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${env('SUPABASE_URL')}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`${name}: ${json.error?.message ?? res.status}`);
  return json;
}

async function main() {
  const { data, error } = await db.auth.signInWithPassword({ email: env('CREW_EMAIL'), password: env('CREW_PASSWORD') });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  const token = data.session.access_token;

  for (const arg of process.argv.slice(2)) {
    const [kind, path] = arg.split(':') as [string, string];
    const bytes = new Uint8Array(readFileSync(path));
    const partSize = planPartBytes(bytes.length);
    const whole = crc64Start();
    const parts: Array<{ n: number; sum: string; from: number; to: number }> = [];
    for (let from = 0, n = 1; from < bytes.length; from += partSize, n++) {
      const chunk = bytes.subarray(from, Math.min(from + partSize, bytes.length));
      crc64Update(whole, chunk);
      parts.push({ n, sum: crc64Base64(crc64Update(crc64Start(), chunk)), from, to: from + chunk.length });
    }
    const plan = await call<{ upload_id: string; presigned: Array<{ part_number: number; checksum: string; url: string }> }>('upload-start', token, {
      slot_id: env('SLOT_ID'), filename: basename(path), bytes: bytes.length, kind, checksum: crc64Base64(whole),
      part_checksums: parts.map((p) => ({ part_number: p.n, checksum: p.sum })), presign_count: parts.length,
    });
    for (const s of plan.presigned) {
      const p = parts.find((x) => x.n === s.part_number)!;
      const res = await fetch(s.url, { method: 'PUT', headers: { 'x-amz-checksum-crc64nvme': s.checksum }, body: bytes.subarray(p.from, p.to) });
      if (!res.ok) throw new Error(`part ${p.n} refused: ${res.status} ${await res.text()}`);
      const rec = await db.rpc('record_upload_part', { p_upload: plan.upload_id, p_part_number: p.n, p_etag: res.headers.get('ETag'), p_checksum: s.checksum });
      if (rec.error) throw new Error(rec.error.message);
    }
    await call('upload-complete', token, { upload_id: plan.upload_id });
    console.log(`uploaded ${kind} ${basename(path)} (${bytes.length} bytes)`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
