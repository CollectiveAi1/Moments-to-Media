/**
 * The upload pipeline's shared contract.
 *
 * PRD "Footage pipeline". The mobile app, the desktop uploader and the Edge
 * Function all have to agree with the database on the part plan, so the
 * limits and the planner live here and are mirrored by
 * supabase/migrations/20261112001000_upload_pipeline.sql. Changing one without
 * the other makes `start_upload` reject plans the client thought were valid.
 */

export const UPLOAD_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'aborted',
] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const UPLOAD_KINDS = ['raw', 'selects', 'deliverables'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const UPLOAD_CHECKSUM_ALGORITHMS = ['sha256', 'crc32c'] as const;
export type UploadChecksumAlgorithm = (typeof UPLOAD_CHECKSUM_ALGORITHMS)[number];

/** R2 follows S3's multipart limits. */
export const MIN_PART_BYTES = 5 * 1024 * 1024;
export const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_PARTS = 10_000;
export const MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024 * 1024;

/** Where the planner starts before doubling. 8 MiB covers files up to 80 GB. */
export const DEFAULT_PART_BYTES = 8 * 1024 * 1024;

/**
 * The part size `start_upload` would choose for a file of this size: 8 MiB,
 * doubled until the part count fits inside R2's 10,000-part limit. Mirrors
 * `app.plan_part_size`.
 */
export function planPartBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new RangeError(`an upload needs a positive size, got ${bytes}`);
  }
  if (bytes > MAX_OBJECT_BYTES) {
    throw new RangeError(`${bytes} bytes is over R2's ${MAX_OBJECT_BYTES}-byte object limit`);
  }

  let size = DEFAULT_PART_BYTES;
  while (Math.ceil(bytes / size) > MAX_PARTS) {
    size *= 2;
    if (size > MAX_PART_BYTES) {
      throw new RangeError(`${bytes} bytes cannot be split into ${MAX_PARTS} parts`);
    }
  }
  return size;
}

export interface UploadPartPlan {
  readonly part_number: number;
  readonly bytes: number;
}

/** The plan `public.start_upload` returns. */
export interface UploadPlan {
  readonly upload_id: string;
  readonly storage_key: string;
  readonly status: UploadStatus;
  readonly bytes: number;
  readonly checksum: string;
  readonly checksum_algorithm: UploadChecksumAlgorithm;
  readonly part_size_bytes: number;
  readonly part_count: number;
  readonly parts: readonly UploadPartPlan[];
}

/** The plan `public.upload_resume_plan` returns after an app restart. */
export interface UploadResumePlan {
  readonly upload_id: string;
  readonly status: UploadStatus;
  readonly storage_key: string;
  readonly multipart_upload_id: string | null;
  readonly bytes: number;
  readonly part_size_bytes: number | null;
  readonly part_count: number | null;
  readonly bytes_received: number;
  readonly missing: readonly UploadPartPlan[];
  readonly landed: readonly { readonly part_number: number; readonly etag: string; readonly checksum: string | null }[];
}

/**
 * The byte range of a part, for slicing the file client-side. Part numbers are
 * 1-based, as S3 requires.
 */
export function partRange(
  partNumber: number,
  partBytes: number,
  totalBytes: number,
): { start: number; end: number } {
  const start = (partNumber - 1) * partBytes;
  return { start, end: Math.min(start + partBytes, totalBytes) };
}

/**
 * A filename the database will accept as the last segment of an object key.
 * Mirrors the guard in `public.start_upload`.
 */
export function isUsableFilename(filename: string): boolean {
  return (
    filename.trim().length > 0 &&
    filename.length <= 255 &&
    !/[/\\]/.test(filename) &&
    !filename.startsWith('.')
  );
}
