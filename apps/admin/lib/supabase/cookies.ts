/**
 * Session cookies: httpOnly so no script on the page can read them, Secure in
 * production so they only travel over HTTPS, SameSite=Lax so another site
 * cannot send them along with a form post. The browser never needs them:
 * emailed links hand their tokens to /auth/session, and the uploader asks
 * /auth/token for a short-lived access token.
 */
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
