import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { choosePartsToSign } from "./parts.ts";
import { HttpError } from "./http.ts";

const missing = [
  { part_number: 2, bytes: 100 },
  { part_number: 5, bytes: 100 },
  { part_number: 9, bytes: 42 },
];

Deno.test("with no request, the next batch of outstanding parts", () => {
  assertEquals(choosePartsToSign(missing, undefined, 2).map((p) => p.part_number), [2, 5]);
  assertEquals(choosePartsToSign(missing, undefined, 99).length, 3);
});

Deno.test("a requested subset is honoured", () => {
  assertEquals(choosePartsToSign(missing, [5, 9], 10).map((p) => p.part_number), [5, 9]);
});

Deno.test("parts that already landed are not signed again", () => {
  // Signing a landed part hands out a URL that would overwrite good data, so
  // the server's idea of what is missing wins over the client's.
  assertEquals(choosePartsToSign(missing, [1, 2, 3], 10).map((p) => p.part_number), [2]);
});

Deno.test("asking only for parts that already landed is a conflict", () => {
  const err = assertThrows(() => choosePartsToSign(missing, [1, 3], 10), HttpError);
  assertEquals((err as HttpError).status, 409);
});

Deno.test("the batch cap still applies to a requested subset", () => {
  assertEquals(choosePartsToSign(missing, [2, 5, 9], 2).map((p) => p.part_number), [2, 5]);
});

Deno.test("part_numbers has to be integers", () => {
  const bad = assertThrows(() => choosePartsToSign(missing, "2", 10), HttpError);
  assertEquals((bad as HttpError).status, 400);
  assertThrows(() => choosePartsToSign(missing, [1.5], 10), HttpError);
  assertThrows(() => choosePartsToSign(missing, ["2"], 10), HttpError);
});

Deno.test("nothing missing yields nothing to sign", () => {
  assertEquals(choosePartsToSign([], undefined, 10), []);
});
