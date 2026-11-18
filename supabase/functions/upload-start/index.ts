/**
 * upload-start — authorize an upload, open it on R2, hand back the plan.
 *
 * PRD "Footage pipeline → How an upload works", step 1. The order matters:
 * the database authorizes first and R2 is only touched once it has said yes,
 * so a refusal never leaves an orphaned multipart upload behind.
 *
 *   POST { slot_id, filename, bytes, checksum, part_checksums,
 *          kind?, part_size_bytes?, checksum_algorithm?, presign_count? }
 *
 * part_checksums carries the base64 CRC-64/NVME digest of each part being
 * signed. It is required for the first batch: the value is signed into the
 * part URL, so R2 verifies each part as it arrives rather than at the end.
 */

import { asCaller, asService, type UploadPlan } from "../_shared/db.ts";
import { withCors } from "../_shared/cors.ts";
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
import { readPartChecksums, requirePartChecksum } from "../_shared/parts.ts";
import { CHECKSUM_ALGORITHM, DEFAULT_PRESIGN_SECONDS, R2 } from "../_shared/r2.ts";

/** A 50 GB upload is 6,400 parts; signing them all would be a 3 MB response. */
const DEFAULT_PRESIGN_COUNT = 100;
const MAX_PRESIGN_COUNT = 1000;

Deno.serve(withCors(async (req) => {
  try {
    requirePost(req);
    const authorization = requireAuthorization(req);
    const body = await readJson<Record<string, unknown>>(req);

    const presignCount = Math.min(
      Math.max(optionalInteger(body, "presign_count", DEFAULT_PRESIGN_COUNT), 1),
      MAX_PRESIGN_COUNT,
    );
    // Shape-checked before anything is created, so a malformed body costs
    // nothing but a 400.
    const partChecksums = readPartChecksums(body.part_checksums);

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
      // Only crc64nvme round-trips through R2 for a multipart object; the
      // column still allows the others so older rows stay readable.
      p_checksum_algorithm: body.checksum_algorithm ?? CHECKSUM_ALGORITHM,
    });

    // ---- every part in the first batch must have a checksum before R2 is
    // touched; otherwise a client that forgot them leaves an open multipart
    // upload and a row pinning the assignment behind the in-flight guard.
    const batch = plan.parts.slice(0, presignCount);
    let signable: Array<{ part: { part_number: number; bytes: number }; checksum: string }>;
    try {
      signable = batch.map((part) => ({
        part,
        checksum: requirePartChecksum(partChecksums, part.part_number),
      }));
    } catch (err) {
      await service("fail_upload", {
        p_upload: plan.upload_id,
        p_reason: `the first batch of parts was not covered by part_checksums`,
      }).catch((e) => console.error("fail_upload after checksum gap failed", e));
      throw err;
    }

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
    const urls = await Promise.all(
      signable.map(async ({ part, checksum }) => ({
        part_number: part.part_number,
        bytes: part.bytes,
        // Echoed back because the client must send exactly this value as
        // x-amz-checksum-crc64nvme; it is inside the signature.
        checksum,
        url: await r2.presignPart(plan.storage_key, uploadId, part.part_number, checksum),
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
}));
