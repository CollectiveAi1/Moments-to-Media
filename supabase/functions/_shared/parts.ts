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
