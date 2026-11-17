/**
 * footage-download — a short-lived link to one finished upload.
 *
 * PRD "Admin console → Footage library": download single files. Who may
 * download is decided by the database, not here: the upload row is read with
 * the caller's own token, so row-level security (owner all, producer their
 * events, contractor their own) is the whole permission check. If the caller
 * cannot see the row, there is nothing to sign.
 *
 *   POST { upload_id }  ->  { url, expires_in }
 */

import { readEnv } from "../_shared/env.ts";
import {
  HttpError,
  json,
  readJson,
  requireAuthorization,
  requirePost,
  requireString,
  toResponse,
} from "../_shared/http.ts";
import { DEFAULT_PRESIGN_SECONDS, R2 } from "../_shared/r2.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  try {
    requirePost(req);
    const authorization = requireAuthorization(req);
    const body = await readJson<Record<string, unknown>>(req);
    const uploadId = requireString(body, "upload_id");
    if (!UUID.test(uploadId)) throw new HttpError("upload_id must be a uuid", 400);

    const env = readEnv();
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/uploads?id=eq.${uploadId}&select=storage_key,filename,status`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization, accept: "application/json" } },
    );
    if (!res.ok) throw new HttpError(`could not read the upload (${res.status})`, 502);

    const rows = (await res.json()) as Array<{ storage_key: string; filename: string; status: string }>;
    const upload = rows[0];
    if (!upload) throw new HttpError("upload not found, or not yours to download", 404);
    if (upload.status !== "completed") {
      throw new HttpError(`upload is ${upload.status}, so there is nothing to download yet`, 409);
    }

    const url = await new R2(env).presignGet(upload.storage_key, upload.filename);
    return json({ url, expires_in: DEFAULT_PRESIGN_SECONDS });
  } catch (err) {
    return toResponse(err);
  }
});
