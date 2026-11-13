/**
 * upload-complete — assemble the object, read it back, let the database judge.
 *
 * PRD "Footage pipeline → How an upload works", step 3, and CLAUDE.md rule 7.
 * This function does not decide whether an upload is good. It tells the
 * database what R2 reported, and public.complete_upload refuses unless that
 * matches the size and checksum declared before the first byte moved.
 *
 *   POST { upload_id }
 */

import { asCaller, asService, type ResumePlan, type UploadRow } from "../_shared/db.ts";
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
import { R2, reconcileChecksum } from "../_shared/r2.ts";

Deno.serve(async (req) => {
  try {
    requirePost(req);
    const authorization = requireAuthorization(req);
    const body = await readJson<Record<string, unknown>>(req);
    const uploadId = requireString(body, "upload_id");

    const env = readEnv();
    const service = asService(env);
    const r2 = new R2(env);

    const caller = asCaller(env, authorization);
    const plan = await caller<ResumePlan>("upload_resume_plan", { p_upload: uploadId });

    // Already done. The completion call can arrive twice — a client retry, a
    // flaky network — and the second one is not an error (CLAUDE.md rule 8).
    if (plan.status === "completed") {
      return json({ upload_id: plan.upload_id, status: "completed", already: true });
    }

    const multipartUploadId = plan.multipart_upload_id;
    if (plan.status !== "in_progress" || !multipartUploadId) {
      throw new HttpError(`upload is ${plan.status}, so it cannot be completed`, 409);
    }

    if (plan.missing.length > 0) {
      throw new HttpError(
        `${plan.missing.length} part(s) have not landed yet`,
        409,
        "parts_outstanding",
      );
    }

    // ---- assemble, then read back what was actually stored
    const completed = await r2.completeMultipartUpload(
      plan.storage_key,
      multipartUploadId,
      plan.landed,
    );
    const head = await r2.headObject(plan.storage_key);
    const checksum = reconcileChecksum(completed.checksum, head.checksum);

    // ---- the database is the judge
    let row: UploadRow;
    try {
      row = await service<UploadRow>("complete_upload", {
        p_upload: plan.upload_id,
        p_verified_bytes: head.bytes,
        p_verified_checksum: checksum,
      });
    } catch (err) {
      const reason = (err as Error).message;
      // The object exists in R2 but does not match what was declared. It is
      // deliberately not deleted: 50 GB of someone's footage is worth a human
      // look, and the row now says why.
      await service("fail_upload", {
        p_upload: plan.upload_id,
        p_reason: `verification failed: ${reason}`,
      }).catch((e) => console.error("fail_upload after mismatch failed", e));

      throw new HttpError(
        `R2 stored ${head.bytes} bytes with checksum ${checksum}, which the database refused: ${reason}`,
        409,
        "verification_failed",
      );
    }

    return json({
      upload_id: row.id,
      status: row.status,
      storage_key: row.storage_key,
      bytes: row.verified_bytes,
      checksum: row.verified_checksum,
      completed_at: row.completed_at,
    });
  } catch (err) {
    return toResponse(err);
  }
});
