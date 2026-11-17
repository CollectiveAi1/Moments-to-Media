# Sign-in and payment security

The checklist Moments to Media asked about, and where each item lives.

| Item | Status | How |
| --- | --- | --- |
| Rate limits on login attempts | Yes, two layers | Supabase Auth limits sign-in requests per IP address. On top, five wrong passwords for one email from one IP pause that pair for 15 minutes (`login_attempts`, migration `20261118000800`). The key is email *and* IP, so nobody can lock a real person out by guessing at their address from elsewhere. Emails and IPs are stored only as SHA-256 hashes and swept after a day. |
| Email verification | Yes | Supabase "Confirm email" is on; an unconfirmed account cannot sign in, and the database grants nothing until the address is confirmed (`app.apply_signup`). |
| Reset links that expire | Yes | Reset links are single-use and expire with Supabase's email OTP expiry (1 hour by default: Authentication → Providers → Email → *Email OTP expiration*). The set-password page needs the session the link creates. |
| Log out on every device | Yes | Account and security → **Sign out everywhere** (`signOut({ scope: 'global' })`) ends every session for the account. Linked from all three portals. |
| Server-side permission checks | Yes | Every query runs as the signed-in person and Postgres row-level security decides what comes back. Every state change goes through a database function that checks the role (`transition_*`, `send_proposal`, `record_client_payment`, `start_upload`, …). Each portal's layout also checks the role on the server before rendering (`requireAdmin`, `requireContractor`, `requireClient`). The UI is never the only check. Test suites: `supabase/tests/` (RLS allowed and denied, per role). |
| Secure, httpOnly cookies | Yes | Session cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax` (`lib/supabase/cookies.ts`, applied in `proxy.ts` and `lib/supabase/server.ts`). Emailed links hand their tokens to `/auth/session` (same-origin only), which sets the cookie. The uploader gets a short-lived access token from `/auth/token`; the refresh token never reaches page scripts. |
| "Wrong email or password" | Yes | The sign-in form says exactly that, and never which half was wrong. Sign-up and reset answer the same way whether or not an address has an account. |

## Stripe webhook

Yes, `supabase/functions/stripe-webhook` verifies every request before reading it:
- It checks the `Stripe-Signature` header with HMAC-SHA256 over `timestamp.body`, using `STRIPE_WEBHOOK_SECRET`.
- It compares signatures in constant time.
- It refuses signatures older than five minutes, so a captured request can't be replayed later.
- It's idempotent on the Checkout Session id (`record_stripe_payment`), so a retried event records nothing twice.

Tests: `supabase/functions/_shared/stripe_test.ts`.
