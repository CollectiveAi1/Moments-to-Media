/**
 * Which parts to sign next. Pure, so it is testable without R2 or a database.
 */

import { HttpError } from "./http.ts";

export interface PartRef {
  part_number: number;
  bytes: number;
}

/**
 * The requested parts if they are genuinely still outstanding, otherwise the
 * next batch. Signing a part that has already landed would hand out a URL
 * that overwrites good data, so the server's idea of "missing" wins over the
 * client's.
 */
export function choosePartsToSign(
  missing: PartRef[],
  requested: unknown,
  count: number,
): PartRef[] {
  if (requested === undefined) return missing.slice(0, count);

  if (!Array.isArray(requested) || requested.some((n) => !Number.isSafeInteger(n))) {
    throw new HttpError("part_numbers must be an array of integers", 400);
  }

  const wanted = new Set(requested as number[]);
  const hits = missing.filter((p) => wanted.has(p.part_number));

  if (hits.length === 0) {
    throw new HttpError("none of those parts are outstanding", 409);
  }
  return hits.slice(0, count);
}

// ------------------------------------------------------------- checksums

/** A base64 CRC-64/NVME digest: 8 bytes, so 11 characters and one pad. */
const BASE64_CRC64 = /^[A-Za-z0-9+/]{11}=$/;

/**
 * The per-part checksums a client sends when asking for URLs.
 *
 * They are required rather than optional, and the reason is worth stating.
 * The checksum is signed into the part URL, so R2 checks each part against it
 * as the part arrives and refuses a corrupted one on the spot. Over a 50 GB
 * upload on a bad connection that is the difference between losing one part
 * and discovering at the end that the object is wrong. Refusing to sign a part
 * the caller has not committed to a checksum for keeps that guarantee whole.
 */
export function readPartChecksums(value: unknown): Map<number, string> {
  if (value === undefined || value === null) return new Map();
  if (!Array.isArray(value)) {
    throw new HttpError("part_checksums must be an array", 400);
  }

  const out = new Map<number, string>();
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpError("each part_checksums entry must be an object", 400);
    }
    const { part_number: n, checksum: c } = entry as Record<string, unknown>;

    if (!Number.isSafeInteger(n) || (n as number) < 1) {
      throw new HttpError("part_checksums[].part_number must be a positive integer", 400);
    }
    if (typeof c !== "string" || !BASE64_CRC64.test(c)) {
      throw new HttpError(
        `part_checksums[].checksum for part ${n} must be a base64 CRC-64/NVME digest`,
        400,
      );
    }
    if (out.has(n as number)) {
      throw new HttpError(`part ${n} appears twice in part_checksums`, 400);
    }
    out.set(n as number, c);
  }
  return out;
}

/** The checksum for one part, or a refusal naming the part that is missing. */
export function requirePartChecksum(checksums: Map<number, string>, partNumber: number): string {
  const checksum = checksums.get(partNumber);
  if (checksum === undefined) {
    throw new HttpError(
      `part_checksums is missing part ${partNumber}; every part being signed needs its ` +
        "base64 CRC-64/NVME digest, because the checksum is inside the presigned URL's " +
        "signature and R2 verifies the part against it as it arrives",
      400,
      "part_checksum_missing",
    );
  }
  return checksum;
}
