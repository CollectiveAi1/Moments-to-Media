/**
 * upload-start — authorize an upload, open it on R2, hand back the plan.
 *
 * PRD "Footage pipeline → How an upload works", step 1. The order matters:
 * the database authorizes first and R2 is only touched once it has said yes,
 * so a refusal never leaves an orphaned multipart upload behind.
 *
 *   POST { slot_id, filename, bytes, checksum,
 *          kind?, part_size_bytes?, checksum_algorithm?, presign_count? }
 */

import { asCaller, asService, type UploadPlan } from "../_shared/db.ts";
import { readEnv } from "../_shared/env.ts";
import {
  json,
  optionalInteger,
  readJson,
  requireAuthorization,
  requireInteger,
  requirePost,
  requireString,
  toResponse,
} from "../_shared/http.ts";
import { DEFAULT_PRESIGN_SECONDS, R2 } from "../_shared/r2.ts";

/** A 50 GB upload is 6,400 parts; signing them all would be a 3 MB response. */
const DEFAULT_PRESIGN_COUNT = 100;
const MAX_PRESIGN_COUNT = 1000;

Deno.serve(async (req) => {
  try {
    requirePost(req);
    const authorization = requireAuthorization(req);
    const body = await readJson<Record<string, unknown>>(req);

    const presignCount = Math.min(
      Math.max(optionalInteger(body, "presign_count", DEFAULT_PRESIGN_COUNT), 1),
      MAX_PRESIGN_COUNT,
    );

    const env = readEnv();
    const caller = asCaller(env, authorization);
    const service = asService(env);
    const r2 = new R2(env);

    // ---- the database decides who may upload, and derives the key
    const plan = await caller<UploadPlan>("start_upload", {
      p_slot_id: requireString(body, "slot_id"),
      p_filename: requireString(body, "filename"),
      p_bytes: requireInteger(body, "bytes"),
      p_checksum: requireString(body, "checksum"),
      p_kind: body.kind ?? "raw",
      p_part_size_bytes: body.part_size_bytes ?? null,
      p_checksum_algorithm: body.checksum_algorithm ?? "sha256",
    });

    // ---- only now is it worth an R2 call
    let uploadId: string;
    try {
      uploadId = await r2.createMultipartUpload(plan.storage_key);
    } catch (err) {
      // The row is 'pending' and would pin the assignment behind the
      // in-flight guard, so it has to stop in the record too.
      await service("fail_upload", {
        p_upload: plan.upload_id,
        p_reason: `R2 refused the multipart upload: ${(err as Error).message}`,
      }).catch((e) => console.error("fail_upload after create failed", e));
      throw err;
    }

    try {
      await service("attach_multipart", {
        p_upload: plan.upload_id,
        p_multipart_upload_id: uploadId,
      });
    } catch (err) {
      // R2 has an open multipart we can no longer reach by id; abandon it so
      // the parts stop being billed.
      await r2.abortMultipartUpload(plan.storage_key, uploadId);
      await service("fail_upload", {
        p_upload: plan.upload_id,
        p_reason: "could not record the multipart upload id",
      }).catch((e) => console.error("fail_upload after attach failed", e));
      throw err;
    }

    // ---- the first window of part URLs; the rest come from upload-presign
    const batch = plan.parts.slice(0, presignCount);
    const urls = await Promise.all(
      batch.map(async (part) => ({
        part_number: part.part_number,
        bytes: part.bytes,
        url: await r2.presignPart(plan.storage_key, uploadId, part.part_number),
      })),
    );

    return json({
      upload_id: plan.upload_id,
      storage_key: plan.storage_key,
      multipart_upload_id: uploadId,
      bytes: plan.bytes,
      checksum: plan.checksum,
      checksum_algorithm: plan.checksum_algorithm,
      part_size_bytes: plan.part_size_bytes,
      part_count: plan.part_count,
      presigned: urls,
      expires_in: DEFAULT_PRESIGN_SECONDS,
    }, 201);
  } catch (err) {
    return toResponse(err);
  }
});
