/**
 * What page addresses look like by the time Vercel Analytics records them.
 *
 * A proposal link (/p/<token>) is the client's key to read, sign or decline
 * their proposal, so the token must never leave the browser. Query strings
 * and fragments are dropped too: page counts do not need them, and emailed
 * sign-in links carry tokens there.
 */
export function redactUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.split(/[?#]/)[0]?.replace(/\/p\/[^/]+/, '/p/[token]') ?? url;
  }
  const path = u.pathname.replace(/^\/p\/[^/]+/, '/p/[token]');
  return `${u.origin}${path}`;
}
