/**
 * PostgREST RPC over plain fetch.
 *
 * Deliberately not supabase-js: these functions make RPC calls and nothing
 * else, so the client library would be a second dependency earning very
 * little. aws4fetch is the only one, and it is there because hand-rolling
 * SigV4 is a worse trade.
 *
 * Two callers exist and the difference is the whole security model:
 *
 *   asCaller   passes the contractor's own bearer token through, so
 *              `auth.uid()` inside public.start_upload and
 *              public.upload_resume_plan is them. The database decides.
 *   asService  uses the service role, and is only ever used for the three
 *              backend calls in 20261112001300, which no client role can
 *              execute.
 */

import { HttpError } from "./http.ts";
import type { Env } from "./env.ts";

interface PostgrestError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

/** PostgREST already chooses a sensible status from the SQLSTATE; keep it. */
async function call<T>(
  env: Env,
  name: string,
  args: Record<string, unknown>,
  auth: { apikey: string; bearer: string },
): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "apikey": auth.apikey,
      "Authorization": auth.bearer,
      "content-type": "application/json",
      "accept": "application/json",
    },
    body: JSON.stringify(args),
  });

  const text = await res.text();

  if (!res.ok) {
    let parsed: PostgrestError = {};
    try {
      parsed = JSON.parse(text) as PostgrestError;
    } catch { /* a non-JSON body is reported as-is below */ }
    const message = parsed.message ?? text.slice(0, 300) ?? `${name} failed`;
    throw new HttpError(message, res.status, parsed.code);
  }

  return (text === "" ? null : JSON.parse(text)) as T;
}

export function asCaller(env: Env, authorization: string) {
  return <T>(name: string, args: Record<string, unknown>) =>
    call<T>(env, name, args, { apikey: env.SUPABASE_ANON_KEY, bearer: authorization });
}

export function asService(env: Env) {
  return <T>(name: string, args: Record<string, unknown>) =>
    call<T>(env, name, args, {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      bearer: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    });
}

// ----------------------------------------------------------------- shapes
// Mirrors what the database functions return. packages/shared/src/uploads.ts
// carries the same shapes for the clients.

export interface UploadPartPlan {
  part_number: number;
  bytes: number;
}

export interface UploadPlan {
  upload_id: string;
  storage_key: string;
  status: string;
  bytes: number;
  checksum: string;
  checksum_algorithm: string;
  part_size_bytes: number;
  part_count: number;
  parts: UploadPartPlan[];
}

export interface LandedPart {
  part_number: number;
  etag: string;
  checksum: string | null;
}

export interface ResumePlan {
  upload_id: string;
  status: string;
  storage_key: string;
  multipart_upload_id: string | null;
  bytes: number;
  part_size_bytes: number | null;
  part_count: number | null;
  bytes_received: number;
  missing: UploadPartPlan[];
  landed: LandedPart[];
}

export interface UploadRow {
  id: string;
  status: string;
  storage_key: string;
  bytes: number;
  checksum: string;
  verified_bytes: number | null;
  verified_checksum: string | null;
  completed_at: string | null;
}
