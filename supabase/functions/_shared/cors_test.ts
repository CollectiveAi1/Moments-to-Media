import { assertEquals } from "jsr:@std/assert@1";
import { withCors } from "./cors.ts";
import { fail, json } from "./http.ts";

const APP = "https://moments-to-media-admin.vercel.app";
const req = (method: string, origin?: string) =>
  new Request("https://fn.test/upload-start", {
    method,
    headers: origin ? { Origin: origin } : {},
  });

Deno.test("the app's preflight is answered without running the handler", async () => {
  let ran = false;
  const res = await withCors(() => {
    ran = true;
    return json({});
  })(req("OPTIONS", APP));
  assertEquals(res.status, 204);
  assertEquals(ran, false);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APP);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assertEquals(res.headers.get("Access-Control-Allow-Headers")?.includes("authorization"), true);
});

Deno.test("responses to the app carry the origin, errors included", async () => {
  const ok = await withCors(() => json({ ok: true }))(req("POST", APP));
  assertEquals(ok.headers.get("Access-Control-Allow-Origin"), APP);
  assertEquals(ok.headers.get("content-type"), "application/json");
  assertEquals(await ok.json(), { ok: true });

  const refused = await withCors(() => fail("no", 403))(req("POST", APP));
  assertEquals(refused.status, 403);
  assertEquals(refused.headers.get("Access-Control-Allow-Origin"), APP);
});

Deno.test("another site gets no CORS grant", async () => {
  const pre = await withCors(() => json({}))(req("OPTIONS", "https://evil.example"));
  assertEquals(pre.headers.get("Access-Control-Allow-Origin"), null);
  const res = await withCors(() => json({}))(req("POST", "https://evil.example"));
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("the phone app, which sends no Origin, is unaffected", async () => {
  const res = await withCors(() => json({ ok: true }, 201))(req("POST"));
  assertEquals(res.status, 201);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
});
