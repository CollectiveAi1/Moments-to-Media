/**
 * upload-presign — fresh URLs for the parts that have not landed.
 *
 * PRD "Footage pipeline → How an upload works", step 2: the client resumes by
 * asking the server what is missing rather than trusting its own record. Part
 * URLs are deliberately short-lived, so a large upload outlives its first
 * batch and comes back here — that is the normal path, not an error path.
 *
 *   POST { upload_id, part_numbers?: number[], count? }
 */

import { asCaller, type ResumePlan } from "../_shared/db.ts";
import { readEnv } from "../_shared/env.ts";
import {
  HttpError,
  json,
  optionalInteger,
  readJson,
  requireAuthorization,
  requirePost,
  requireString,
  toResponse,
} from "../_shared/http.ts";
import { choosePartsToSign } from "../_shared/parts.ts";
import { DEFAULT_PRESIGN_SECONDS, R2 } from "../_shared/r2.ts";

const DEFAULT_COUNT = 100;
const MAX_COUNT = 1000;

Deno.serve(async (req) => {
  try {
    requirePost(req);
    const authorization = requireAuthorization(req);
    const body = await readJson<Record<string, unknown>>(req);
    const uploadId = requireString(body, "upload_id");
    const count = Math.min(Math.max(optionalInteger(body, "count", DEFAULT_COUNT), 1), MAX_COUNT);

    const env = readEnv();
    const r2 = new R2(env);

    // The caller's own token: upload_resume_plan refuses an upload that is
    // not theirs (or their event, if they are the producer).
    const caller = asCaller(env, authorization);
    const plan = await caller<ResumePlan>("upload_resume_plan", { p_upload: uploadId });

    const multipartUploadId = plan.multipart_upload_id;
    if (plan.status !== "in_progress" || !multipartUploadId) {
      throw new HttpError(`upload is ${plan.status}, so there is nothing to sign`, 409);
    }

    const parts = choosePartsToSign(plan.missing, body.part_numbers, count);
    const presigned = await Promise.all(
      parts.map(async (part) => ({
        part_number: part.part_number,
        bytes: part.bytes,
        url: await r2.presignPart(plan.storage_key, multipartUploadId, part.part_number),
      })),
    );

    return json({
      upload_id: plan.upload_id,
      part_size_bytes: plan.part_size_bytes,
      bytes_received: plan.bytes_received,
      remaining: plan.missing.length,
      presigned,
      expires_in: DEFAULT_PRESIGN_SECONDS,
    });
  } catch (err) {
    return toResponse(err);
  }
});
