/**
 * The R2 calls. S3-compatible multipart, signed with SigV4.
 *
 * CLAUDE.md rule 7: footage never passes through our servers, so nothing here
 * ever reads or forwards a part body. The functions below open a multipart
 * upload, hand the client short-lived URLs to PUT parts straight to R2,
 * assemble the object when the parts have landed, and read back the size and
 * checksum that app.complete_upload checks against the declaration.
 *
 * The pure helpers (key encoding, XML building and parsing) are exported so
 * they can be tested without a bucket — which matters, because until the
 * client's Cloudflare account exists they are the only part of this file that
 * can be exercised at all.
 */

import { AwsClient } from "aws4fetch";
import { HttpError } from "./http.ts";
import type { Env } from "./env.ts";

export const DEFAULT_PRESIGN_SECONDS = 900; // 15 minutes

/**
 * R2 answers 501 NotImplemented for `x-amz-checksum-sha256` on UploadPart, so
 * the composite SHA-256 this pipeline was built around is not available. What
 * R2 does implement for multipart objects is CRC-64/NVME as a FULL_OBJECT
 * checksum: one value over the whole file, independent of how it was split.
 * See supabase/migrations/20261116001000 for the evidence and the trade-off.
 */
export const CHECKSUM_ALGORITHM = "crc64nvme";
const CREATE_CHECKSUM_HEADERS = {
  "x-amz-checksum-algorithm": "CRC64NVME",
  "x-amz-checksum-type": "FULL_OBJECT",
};
const PART_CHECKSUM_HEADER = "x-amz-checksum-crc64nvme";
const OBJECT_CHECKSUM_HEADER = "x-amz-checksum-crc64nvme";
const CHECKSUM_TAG = "ChecksumCRC64NVME";

// ------------------------------------------------------------ pure helpers

/**
 * Object keys carry `/` as a real separator (PRD "Footage pipeline → Folder
 * structure"), so the slashes stay and everything else is escaped.
 */
export function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** First value of a tag, or null. These documents are small and flat. */
export function parseTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
}

/**
 * S3 and R2 can answer CompleteMultipartUpload with HTTP 200 and an <Error>
 * document, because the response streams while the parts are being stitched.
 * Treating 200 as success would mark a failed upload complete, so every
 * response body is checked for an error regardless of status.
 */
export function parseErrorCode(xml: string): { code: string; message: string } | null {
  if (!/<Error>/.test(xml)) return null;
  return {
    code: parseTag(xml, "Code") ?? "Unknown",
    message: parseTag(xml, "Message") ?? "R2 returned an error document",
  };
}

export interface CompletedPart {
  part_number: number;
  etag: string;
  checksum?: string | null;
}

/**
 * Parts must be listed in ascending part number; S3 rejects any other order.
 *
 * No per-part checksum appears here. Each part's checksum was verified by R2
 * when the part was PUT, and the object's checksum is declared in a header on
 * the completion request itself, which is what FULL_OBJECT means. Per-part
 * digests in this document belong to the COMPOSITE scheme R2 does not support.
 */
export function completeMultipartXml(parts: CompletedPart[]): string {
  const ordered = [...parts].sort((a, b) => a.part_number - b.part_number);
  const body = ordered
    .map((p) =>
      `<Part><PartNumber>${p.part_number}</PartNumber>` +
      `<ETag>${escapeXml(p.etag)}</ETag></Part>`
    )
    .join("");
  return `<CompleteMultipartUpload>${body}</CompleteMultipartUpload>`;
}

/**
 * R2 reports the full-object checksum on the completion response, and again on
 * HEAD when checksum mode is on. If both arrive they must agree; disagreement
 * means something is wrong at the storage layer and is not ours to paper over.
 */
export function reconcileChecksum(fromComplete: string | null, fromHead: string | null): string {
  if (fromComplete && fromHead && fromComplete !== fromHead) {
    throw new HttpError("R2 reported two different checksums for the same object", 502);
  }
  const checksum = fromComplete ?? fromHead;
  if (!checksum) throw new HttpError("R2 did not report a checksum", 502);
  return checksum;
}

// --------------------------------------------------------------- the client

export class R2 {
  readonly #client: AwsClient;
  readonly #origin: string;
  readonly #bucket: string;

  constructor(env: Env) {
    this.#client = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    });
    this.#origin = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    this.#bucket = env.R2_BUCKET;
  }

  objectUrl(key: string): URL {
    return new URL(`${this.#origin}/${encodeURIComponent(this.#bucket)}/${encodeKey(key)}`);
  }

  async #send(url: URL, init: RequestInit & { method: string }): Promise<string> {
    const res = await this.#client.fetch(url.toString(), init);
    const text = await res.text();

    const err = parseErrorCode(text);
    if (err) throw new HttpError(`R2 ${err.code}: ${err.message}`, 502, err.code);
    if (!res.ok) {
      throw new HttpError(`R2 returned ${res.status} for ${init.method}`, 502);
    }
    return text;
  }

  /** Opens the multipart upload and returns R2's id for it. */
  async createMultipartUpload(key: string): Promise<string> {
    const url = this.objectUrl(key);
    url.searchParams.set("uploads", "");
    const xml = await this.#send(url, {
      method: "POST",
      // Declaring the algorithm and FULL_OBJECT here is what makes R2 accept a
      // whole-object checksum on completion and report it back on HEAD.
      headers: CREATE_CHECKSUM_HEADERS,
    });

    const uploadId = parseTag(xml, "UploadId");
    if (!uploadId) throw new HttpError("R2 did not return an upload id", 502);
    return uploadId;
  }

  /**
   * A short-lived URL the client PUTs one part to, directly.
   *
   * The part's checksum is inside the signature, not an afterthought. SigV4
   * requires every `x-amz-*` header to be signed, so a URL signed without it
   * answers SignatureDoesNotMatch the moment a client attaches the checksum
   * header — and a client that drops the header to get the PUT through leaves
   * R2 storing a part nobody checked. Signing it here means R2 verifies every
   * part as it lands, which is why there is no overload without a checksum.
   */
  async presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    checksum: string,
    expiresIn = DEFAULT_PRESIGN_SECONDS,
  ): Promise<string> {
    const url = this.objectUrl(key);
    url.searchParams.set("partNumber", String(partNumber));
    url.searchParams.set("uploadId", uploadId);
    url.searchParams.set("X-Amz-Expires", String(expiresIn));

    const signed = await this.#client.sign(
      new Request(url.toString(), {
        method: "PUT",
        headers: { [PART_CHECKSUM_HEADER]: checksum },
      }),
      { aws: { signQuery: true } },
    );
    return signed.url;
  }

  /**
   * Assembles the object, declaring what it should turn out to be.
   *
   * The checksum and size go to R2 rather than being checked afterwards, so a
   * mismatch is refused at the storage layer instead of producing an object
   * that then has to be reconciled and deleted.
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
    object: { checksum: string; bytes: number },
  ): Promise<{ etag: string | null; checksum: string | null }> {
    const url = this.objectUrl(key);
    url.searchParams.set("uploadId", uploadId);
    const xml = await this.#send(url, {
      method: "POST",
      headers: {
        "content-type": "application/xml",
        [OBJECT_CHECKSUM_HEADER]: object.checksum,
        "x-amz-mp-object-size": String(object.bytes),
      },
      body: completeMultipartXml(parts),
    });
    return { etag: parseTag(xml, "ETag"), checksum: parseTag(xml, CHECKSUM_TAG) };
  }

  /** What R2 actually stored, which is the half of rule 7 we can observe. */
  async headObject(key: string): Promise<{ bytes: number; checksum: string | null }> {
    const res = await this.#client.fetch(this.objectUrl(key).toString(), {
      method: "HEAD",
      headers: { "x-amz-checksum-mode": "ENABLED" },
    });
    if (!res.ok) throw new HttpError(`R2 returned ${res.status} for HEAD`, 502);

    const length = res.headers.get("content-length");
    if (length === null) throw new HttpError("R2 did not report the object size", 502);

    return {
      bytes: Number(length),
      checksum: res.headers.get(OBJECT_CHECKSUM_HEADER),
    };
  }

  /** Stops the parts being billed once an upload is abandoned or failed. */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const url = this.objectUrl(key);
    url.searchParams.set("uploadId", uploadId);
    const res = await this.#client.fetch(url.toString(), { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      console.error(`abort of ${uploadId} returned ${res.status}`);
    }
  }
}
