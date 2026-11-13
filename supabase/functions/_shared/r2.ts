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

/** Parts must be listed in ascending part number; S3 rejects any other order. */
export function completeMultipartXml(parts: CompletedPart[]): string {
  const ordered = [...parts].sort((a, b) => a.part_number - b.part_number);
  const body = ordered
    .map((p) => {
      const checksum = p.checksum
        ? `<ChecksumSHA256>${escapeXml(p.checksum)}</ChecksumSHA256>`
        : "";
      return `<Part><PartNumber>${p.part_number}</PartNumber>` +
        `<ETag>${escapeXml(p.etag)}</ETag>${checksum}</Part>`;
    })
    .join("");
  return `<CompleteMultipartUpload>${body}</CompleteMultipartUpload>`;
}

/**
 * R2 reports the composite checksum on the completion response, and again on
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
      // Asking for SHA-256 part checksums is what makes R2 return a composite
      // checksum on completion, which is what the declaration is checked
      // against.
      headers: { "x-amz-checksum-algorithm": "SHA256" },
    });

    const uploadId = parseTag(xml, "UploadId");
    if (!uploadId) throw new HttpError("R2 did not return an upload id", 502);
    return uploadId;
  }

  /** A short-lived URL the client PUTs one part to, directly. */
  async presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn = DEFAULT_PRESIGN_SECONDS,
  ): Promise<string> {
    const url = this.objectUrl(key);
    url.searchParams.set("partNumber", String(partNumber));
    url.searchParams.set("uploadId", uploadId);
    url.searchParams.set("X-Amz-Expires", String(expiresIn));

    const signed = await this.#client.sign(new Request(url.toString(), { method: "PUT" }), {
      aws: { signQuery: true },
    });
    return signed.url;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<{ etag: string | null; checksum: string | null }> {
    const url = this.objectUrl(key);
    url.searchParams.set("uploadId", uploadId);
    const xml = await this.#send(url, {
      method: "POST",
      headers: { "content-type": "application/xml" },
      body: completeMultipartXml(parts),
    });
    return { etag: parseTag(xml, "ETag"), checksum: parseTag(xml, "ChecksumSHA256") };
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
      checksum: res.headers.get("x-amz-checksum-sha256"),
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
