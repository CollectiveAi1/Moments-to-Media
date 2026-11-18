/**
 * CORS for the upload functions, so the web uploader (crew uploads and studio
 * delivery in the admin app) can call them from a browser. The phone app is
 * not a browser and ignores all of this.
 *
 * Only the app's own origins are allowed. This is not the security boundary:
 * every call still needs the caller's bearer token, and the database decides
 * what that caller may upload. It only stops other websites' pages from
 * reading the responses.
 */

export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://moments-to-media-admin.vercel.app",
  "http://localhost:3000",
]);

const ALLOW_HEADERS = "authorization, content-type, apikey, x-client-info";

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = ALLOW_HEADERS;
    headers["Access-Control-Max-Age"] = "3600";
  }
  return headers;
}

/**
 * Answers the browser's preflight and adds the CORS headers to every response
 * the handler returns, error responses included, so a browser can read why a
 * request was refused.
 */
export function withCors(
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const extra = corsHeaders(req.headers.get("Origin"));
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: extra });
    const res = await handler(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
