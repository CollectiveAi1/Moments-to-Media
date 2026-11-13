import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  HttpError,
  optionalInteger,
  readJson,
  requireAuthorization,
  requireInteger,
  requirePost,
  requireString,
  toResponse,
} from "./http.ts";
import { MissingEnv } from "./env.ts";

const post = (body?: unknown, headers: Record<string, string> = {}) =>
  new Request("https://fn.test/upload-start", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

Deno.test("only POST is allowed", () => {
  const err = assertThrows(
    () => requirePost(new Request("https://fn.test/x", { method: "GET" })),
    HttpError,
  );
  assertEquals((err as HttpError).status, 405);
  requirePost(post({}));
});

Deno.test("a bearer token is required and returned intact", () => {
  assertEquals(
    requireAuthorization(post({}, { Authorization: "Bearer abc.def.ghi" })),
    "Bearer abc.def.ghi",
  );
  const err = assertThrows(() => requireAuthorization(post({})), HttpError);
  assertEquals((err as HttpError).status, 401);
  assertThrows(() => requireAuthorization(post({}, { Authorization: "abc" })), HttpError);
});

Deno.test("the body has to be a JSON object", async () => {
  assertEquals(await readJson(post({ a: 1 })), { a: 1 });

  const notJson = new Request("https://fn.test/x", { method: "POST", body: "nope" });
  await assertRejectsWith(() => readJson(notJson), 400);
  await assertRejectsWith(() => readJson(post([1, 2])), 400);
  await assertRejectsWith(() => readJson(post(null)), 400);
});

async function assertRejectsWith(fn: () => Promise<unknown>, status: number) {
  try {
    await fn();
    throw new Error("expected a rejection");
  } catch (e) {
    assertEquals(e instanceof HttpError, true);
    assertEquals((e as HttpError).status, status);
  }
}

Deno.test("required fields are checked, not coerced", () => {
  assertEquals(requireString({ a: "x" }, "a"), "x");
  assertThrows(() => requireString({ a: "  " }, "a"), HttpError);
  assertThrows(() => requireString({ a: 1 }, "a"), HttpError);

  assertEquals(requireInteger({ n: 7 }, "n"), 7);
  assertThrows(() => requireInteger({ n: "7" }, "n"), HttpError);
  assertThrows(() => requireInteger({ n: 1.5 }, "n"), HttpError);
});

Deno.test("optionalInteger falls back but still validates", () => {
  assertEquals(optionalInteger({}, "count", 100), 100);
  assertEquals(optionalInteger({ count: 5 }, "count", 100), 5);
  assertThrows(() => optionalInteger({ count: "5" }, "count", 100), HttpError);
});

Deno.test("an HttpError keeps its status and code in the envelope", async () => {
  const res = toResponse(new HttpError("nope", 409, "parts_outstanding"));
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: { message: "nope", code: "parts_outstanding" } });
});

Deno.test("a missing secret becomes a 500 that names nothing", async () => {
  // CLAUDE.md rule 4: a client learns that the service is misconfigured and
  // not which secret is absent.
  const res = toResponse(new MissingEnv(["R2_SECRET_ACCESS_KEY"]));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.message, "the upload service is misconfigured");
  assertEquals(JSON.stringify(body).includes("R2_SECRET_ACCESS_KEY"), false);
});

Deno.test("anything else is a 500 with nothing leaked", async () => {
  const res = toResponse(new Error("connection string postgres://user:pw@host"));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: { message: "unexpected error" } });
});
