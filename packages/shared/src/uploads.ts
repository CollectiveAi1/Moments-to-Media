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

export const UPLOAD_CHECKSUM_ALGORITHMS = ['sha256', 'crc32c', 'crc64nvme'] as const;
export type UploadChecksumAlgorithm = (typeof UPLOAD_CHECKSUM_ALGORITHMS)[number];

/**
 * The only one R2 can verify for a multipart object, so the only one an upload
 * should declare. R2 answers 501 NotImplemented for per-part SHA-256, which
 * leaves a completed object with no checksum to check at all. CRC-64/NVME as a
 * FULL_OBJECT checksum is one value over the whole file, so unlike a composite
 * it does not depend on how the file was split.
 */
export const UPLOAD_CHECKSUM_ALGORITHM: UploadChecksumAlgorithm = 'crc64nvme';

const CRC64_MASK = 0xffffffffffffffffn;

/**
 * CRC-64/NVME is a reflected algorithm, and the polynomial is catalogued in
 * normal form, so the table is built from the bit-reversed one. Reversing it
 * here rather than pasting a constant is deliberate: the first attempt pasted
 * a constant and produced a checksum that passed every test except the
 * published vector below.
 */
const CRC64_POLY = ((): bigint => {
  let r = 0n;
  const normal = 0xad93d23594c93659n;
  for (let i = 0; i < 64; i++) r = (r << 1n) | ((normal >> BigInt(i)) & 1n);
  return r & CRC64_MASK;
})();

const CRC64_TABLE: readonly bigint[] = (() => {
  const t: bigint[] = [];
  for (let i = 0; i < 256; i++) {
    let crc = BigInt(i);
    for (let j = 0; j < 8; j++) crc = crc & 1n ? (crc >> 1n) ^ CRC64_POLY : crc >> 1n;
    t.push(crc & CRC64_MASK);
  }
  return t;
})();

/**
 * Streaming CRC-64/NVME. A 50 GB file is never in memory at once, so the state
 * is passed back in: start with `crc64nvmeInit`, feed chunks, then finish.
 *
 * The `as` casts are not laziness. `noUncheckedIndexedAccess` is on, so every
 * index into the table or the chunk is `T | undefined`, and both are provably
 * in range here — the table has 256 entries and the index is masked to a byte.
 */
export const crc64nvmeInit = CRC64_MASK;

export function crc64nvmeUpdate(crc: bigint, chunk: Uint8Array): bigint {
  let c = crc;
  for (let i = 0; i < chunk.length; i++) {
    const byte = BigInt(chunk[i] as number);
    const entry = CRC64_TABLE[Number((c ^ byte) & 0xffn)] as bigint;
    c = (entry ^ (c >> 8n)) & CRC64_MASK;
  }
  return c;
}

export function crc64nvmeFinish(crc: bigint): bigint {
  return crc ^ CRC64_MASK;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The base64 form R2 expects in `x-amz-checksum-crc64nvme`: 8 bytes, big-endian.
 *
 * Encoded by hand rather than with `btoa` or `Buffer`. This package is shared
 * by an Expo app, a Next.js server and Deno functions, and `btoa` is a DOM
 * global that `lib: ["ES2022"]` does not declare while `Buffer` is Node-only.
 * Eight bytes is not worth a dependency or a platform assumption.
 */
export function crc64nvmeToBase64(crc: bigint): string {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = Number((crc >> BigInt((7 - i) * 8)) & 0xffn);

  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? (bytes[i + 1] as number) : 0;
    const b2 = hasB2 ? (bytes[i + 2] as number) : 0;

    out += BASE64_ALPHABET[b0 >> 2] as string;
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] as string;
    out += hasB1 ? (BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] as string) : '=';
    out += hasB2 ? (BASE64_ALPHABET[b2 & 0x3f] as string) : '=';
  }
  return out;
}

/** One-shot, for a part held in memory. */
export function crc64nvmeBase64(data: Uint8Array): string {
  return crc64nvmeToBase64(crc64nvmeFinish(crc64nvmeUpdate(crc64nvmeInit, data)));
}

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
