import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { MissingEnv, readEnv } from "./env.ts";

const complete: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "akid",
  R2_SECRET_ACCESS_KEY: "secret-value-do-not-leak",
  R2_BUCKET: "footage",
};

const source = (over: Record<string, string | undefined> = {}) => ({
  get: (k: string) => ({ ...complete, ...over })[k],
});

Deno.test("a complete environment reads back", () => {
  assertEquals(readEnv(source()).R2_BUCKET, "footage");
});

Deno.test("a missing secret is named, not guessed at", () => {
  const err = assertThrows(
    () => readEnv(source({ R2_SECRET_ACCESS_KEY: undefined })),
    MissingEnv,
  );
  assertEquals((err as MissingEnv).missing, ["R2_SECRET_ACCESS_KEY"]);
});

Deno.test("an empty string counts as missing", () => {
  const err = assertThrows(() => readEnv(source({ R2_BUCKET: "   " })), MissingEnv);
  assertEquals((err as MissingEnv).missing, ["R2_BUCKET"]);
});

Deno.test("every missing secret is reported at once", () => {
  const err = assertThrows(
    () => readEnv(source({ R2_ACCOUNT_ID: undefined, SUPABASE_ANON_KEY: undefined })),
    MissingEnv,
  );
  assertEquals((err as MissingEnv).missing, ["SUPABASE_ANON_KEY", "R2_ACCOUNT_ID"]);
});

Deno.test("the error never contains a secret value", () => {
  // CLAUDE.md rule 4. The message names variables; it must not echo them.
  const err = assertThrows(() => readEnv(source({ R2_BUCKET: undefined })), MissingEnv);
  for (const value of Object.values(complete)) {
    assertEquals((err as Error).message.includes(value), false);
  }
});
