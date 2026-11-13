/**
 * Request parsing and response shapes shared by the three upload functions.
 *
 * Every failure path returns the same JSON envelope so the client has one
 * thing to parse: { error: { message, code? } }. CLAUDE.md rule 9 — the
 * failure paths are the ones that have to be legible.
 */

export interface ErrorBody {
  error: { message: string; code?: string };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function fail(message: string, status: number, code?: string): Response {
  const body: ErrorBody = { error: code ? { message, code } : { message } };
  return json(body, status);
}

/** A caller error that carries the status it should become. */
export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function requirePost(req: Request): void {
  if (req.method !== "POST") {
    throw new HttpError(`${req.method} is not allowed, use POST`, 405);
  }
}

/**
 * The caller's bearer token, which is passed straight through to PostgREST so
 * `auth.uid()` inside the database functions is the person making the request
 * rather than the service role.
 */
export function requireAuthorization(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(header)) {
    throw new HttpError("a bearer token is required", 401);
  }
  return header;
}

export async function readJson<T>(req: Request): Promise<T> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new HttpError("body must be JSON", 400);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError("body must be a JSON object", 400);
  }
  return parsed as T;
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new HttpError(`${key} is required`, 400);
  }
  return v;
}

export function requireInteger(body: Record<string, unknown>, key: string): number {
  const v = body[key];
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw new HttpError(`${key} must be an integer`, 400);
  }
  return v;
}

export function optionalInteger(
  body: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  return body[key] === undefined ? fallback : requireInteger(body, key);
}

/** Turns anything thrown by a handler into the shared error envelope. */
export function toResponse(err: unknown): Response {
  if (err instanceof HttpError) return fail(err.message, err.status, err.code);
  if (err instanceof Error && err.name === "MissingEnv") {
    // Never leak which secret, or any value, to a client.
    console.error(err.message);
    return fail("the upload service is misconfigured", 500);
  }
  console.error(err);
  return fail("unexpected error", 500);
}
