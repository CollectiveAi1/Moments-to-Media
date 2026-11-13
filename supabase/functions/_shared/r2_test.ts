import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  completeMultipartXml,
  encodeKey,
  escapeXml,
  parseErrorCode,
  parseTag,
  reconcileChecksum,
} from "./r2.ts";
import { HttpError } from "./http.ts";

Deno.test("encodeKey keeps the folder separators and escapes the rest", () => {
  // PRD "Footage pipeline → Folder structure": the slashes are real.
  assertEquals(
    encodeKey("moments-to-media/desert-classic/2026-11-14_day-1/lead-video_casey/raw/A001.mp4"),
    "moments-to-media/desert-classic/2026-11-14_day-1/lead-video_casey/raw/A001.mp4",
  );
});

Deno.test("encodeKey escapes a filename that would break the URL", () => {
  assertEquals(encodeKey("org/client/raw/A 001 (final).mp4"), "org/client/raw/A%20001%20(final).mp4");
  assertEquals(encodeKey("org/client/raw/café.mov"), "org/client/raw/caf%C3%A9.mov");
  assertEquals(encodeKey("org/client/raw/a?b#c.mp4"), "org/client/raw/a%3Fb%23c.mp4");
});

Deno.test("escapeXml covers the characters an ETag can carry", () => {
  assertEquals(escapeXml('"abc"'), "&quot;abc&quot;");
  assertEquals(escapeXml("a&b<c>d"), "a&amp;b&lt;c&gt;d");
});

Deno.test("parseTag reads a value and returns null when absent", () => {
  assertEquals(parseTag("<UploadId>xyz</UploadId>", "UploadId"), "xyz");
  assertEquals(parseTag("<Other>1</Other>", "UploadId"), null);
  assertEquals(parseTag("<ETag>\n  \"abc\"\n</ETag>", "ETag"), '"abc"');
});

Deno.test("an error document is caught even when the status is 200", () => {
  // S3 and R2 stream the completion response, so a failure can arrive with a
  // 200. Trusting the status would mark a broken upload complete.
  const body = `<?xml version="1.0"?><Error><Code>InternalError</Code>` +
    `<Message>We encountered an internal error.</Message></Error>`;
  const err = parseErrorCode(body);
  assertEquals(err?.code, "InternalError");
  assertEquals(err?.message, "We encountered an internal error.");
});

Deno.test("a successful completion document is not mistaken for an error", () => {
  const body = `<CompleteMultipartUploadResult><ETag>"abc-3"</ETag>` +
    `<ChecksumSHA256>ZmFrZQ==-3</ChecksumSHA256></CompleteMultipartUploadResult>`;
  assertEquals(parseErrorCode(body), null);
  assertEquals(parseTag(body, "ChecksumSHA256"), "ZmFrZQ==-3");
});

Deno.test("completeMultipartXml orders parts ascending whatever it is handed", () => {
  const xml = completeMultipartXml([
    { part_number: 3, etag: '"c"' },
    { part_number: 1, etag: '"a"' },
    { part_number: 2, etag: '"b"' },
  ]);
  assertEquals(
    xml,
    "<CompleteMultipartUpload>" +
      "<Part><PartNumber>1</PartNumber><ETag>&quot;a&quot;</ETag></Part>" +
      "<Part><PartNumber>2</PartNumber><ETag>&quot;b&quot;</ETag></Part>" +
      "<Part><PartNumber>3</PartNumber><ETag>&quot;c&quot;</ETag></Part>" +
      "</CompleteMultipartUpload>",
  );
});

Deno.test("completeMultipartXml includes a part checksum when there is one", () => {
  const xml = completeMultipartXml([{ part_number: 1, etag: '"a"', checksum: "ZmFrZQ==" }]);
  assertEquals(xml.includes("<ChecksumSHA256>ZmFrZQ==</ChecksumSHA256>"), true);
});

Deno.test("completeMultipartXml omits the checksum element when the ledger has none", () => {
  const xml = completeMultipartXml([{ part_number: 1, etag: '"a"', checksum: null }]);
  assertEquals(xml.includes("ChecksumSHA256"), false);
});

Deno.test("reconcileChecksum accepts one source, or two that agree", () => {
  assertEquals(reconcileChecksum("abc-3", null), "abc-3");
  assertEquals(reconcileChecksum(null, "abc-3"), "abc-3");
  assertEquals(reconcileChecksum("abc-3", "abc-3"), "abc-3");
});

Deno.test("reconcileChecksum refuses two sources that disagree", () => {
  const err = assertThrows(() => reconcileChecksum("abc-3", "def-3"), HttpError);
  assertEquals((err as HttpError).status, 502);
});

Deno.test("reconcileChecksum refuses a completion R2 gave no checksum for", () => {
  // Without one there is nothing to check the declaration against, so this
  // must not fall through to the database as a pass.
  assertThrows(() => reconcileChecksum(null, null), HttpError);
});
