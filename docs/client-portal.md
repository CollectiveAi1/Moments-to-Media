# Client side: inquiries, proposals, invoices and the client portal

Built 2026-11-17 to close the gaps found in `docs/honeybook-comparison.md`. The PRD listed a client portal as v2; Moments to Media asked for it now.

## The flow

1. **Inquiry.** A prospect fills in the public form at `/inquire/<org slug>`. It needs no account. The inquiry lands in **Inquiries** in the console, and owners and producers get an in-app notification.
2. **Proposal.** From the inquiry, a producer clicks **Proposal**. They pick packages, offer optional add-ons, set the deposit and when the balance is due, and edit the contract. **Send** fixes the offer and gives a private link (`/p/<token>`) to email the client.
3. **Sign.** The client opens the link on any device, ticks add-ons (the total updates live), agrees and types their name to sign. Signing creates, in one transaction:
   - the client record;
   - a **Draft event** ready to staff;
   - an **invoice** with a deposit due now and a balance due N days before the event;
   - a **portal invitation** for the signer's email.

   The inquiry moves to Booked.
4. **Portal.** The client signs in at `/sign-in` with that email (a link, no password) and lands on `/portal`. There they find:
   - their projects;
   - their invoices, with the schedule, a Pay button and receipts;
   - the signed contract;
   - released media to download;
   - a message thread with the studio.
5. **Payment.** The owner or a producer records checks, cash and transfers on the invoice. Card payments go through Stripe Checkout once they are switched on (below). The invoice moves from Open to Partly paid to Paid by itself.
6. **Delivery.** When a contractor's footage is approved, the event page offers **Release approved media**. The client sees the approved, completed files and downloads each one through a 15-minute private link straight from R2. Nothing passes through our servers.

Producers can also add clients, invoices and inquiries by hand.

## Rules it keeps

- Every new table has `org_id`, an index on it, RLS and policies.
- A client reaches only the records of the client accounts their login is attached to (`app.is_client_of`). They never see:
  - slots or crew assignments;
  - payouts;
  - inquiries;
  - other clients;
  - drafts.
- Status, totals and signatures are not writable by any client. They change only through the database functions:
  - `send_proposal`, `accept_proposal`, `decline_proposal`, `void_proposal`;
  - `send_invoice`, `void_invoice`, `record_client_payment`, `record_stripe_payment`;
  - `set_lead_status`, `release_media`.
- Once sent, a proposal's offer and contract cannot change, and neither can an invoice's lines. To change either, void it and send a new one.
- `anon` can call exactly five functions:
  - `inquiry_form` and `submit_inquiry` (rate-limited per email and per organization);
  - `open_proposal`, `accept_proposal` and `decline_proposal`, which need the 64-character secret token.
- A returning client is matched by email when a proposal is sent (`20261118000400`), so one client record and one portal hold all their projects. Live QA caught the case where a second signing created a duplicate client.
- Tests:
  - `supabase/tests/12_client_side.test.sql`: 68 pgTAP checks, allowed and denied. `scripts/qa/client_db.py` turns it into one rolled-back script for a hosted project.
  - `scripts/qa/client_live.ts`: 59 checks through the deployed site's real forms, from inquiry to signing, the portal and payment.

## Switching on card payments (owner, billing setup)

**Account.** Payments run on **Collective Ai's Stripe account** (`acct_1Ud3PjP1dkhSe6nS`), by the user's decision on 2026-11-18, not on an account in Moments to Media's name. Client payments land in that balance, and Collective Ai is the platform for contractor payouts and 1099s. The account also takes Collective Ai's other payments; the webhook skips anything that is not an invoice payment.

**Plan** (from Stripe's implementation planner, 2026-11-18): hosted Checkout for clients; Connect as a marketplace with separate charges and transfers for contractors (Express dashboard, v2 recipient accounts, embedded onboarding, platform owns pricing and loss liability, Radar on). Each payment carries `transfer_group` = `event_<event id>` so the event's contractor transfers can be tied to it. Connect payouts are not built yet.

1. Stripe → Developers → API keys → **Create restricted key**, with **Checkout Sessions: Write** and nothing else. It is the only call the app makes.
2. Stripe → Developers → Webhooks → **Add endpoint**:
   - URL: `https://uvjtcwpfksmgmnfvghwz.supabase.co/functions/v1/stripe-webhook`
   - API version: `2026-10-28.endive` (the version the code pins with `Stripe-Version`)
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`
   - Copy its signing secret.
3. In Supabase → Edge Functions → Secrets, add:
   - `STRIPE_SECRET_KEY` (the restricted key)
   - `STRIPE_WEBHOOK_SECRET`
   - optionally `APP_ORIGINS` (comma-separated site origins Checkout may return to; defaults to the Vercel site and localhost).
4. In Stripe settings, turn on Link and dynamic payment methods, and check Radar is on.
5. In the console: **Settings → Client payments → Let clients pay invoices by card**.

Until both the secret and the switch are on, the portal tells clients to pay by check or transfer, and `client-checkout` refuses with a clear message.

**What the webhook does** (`supabase/functions/stripe-webhook`, migration `20261118000900`):
- Verifies Stripe's signature and accepts it for five minutes.
- Payments are idempotent on the Checkout Session id.
- Refunds and disputes are set from Stripe's own totals, never added to. Only what is left of a payment after refunds and any amount a dispute holds counts toward the invoice; a won dispute counts again. A dispute event older than the last one applied is ignored.
- A failed bank payment is logged once and the owners are notified; nothing was recorded as paid.
- Invoices show "$X refunded", "Refunded in full" or the dispute state next to the payment, in the console and the portal.

## Not built yet

- **Email to clients.** Proposals are sent by copying the link or with the "Email it" button, which opens your mail app. The portal sign-in link does go out by email (Supabase Auth over Resend). Automatic emails for invoice reminders and "your media is ready" need a transactional sender; today the client sees these in the portal.
- **Autopay, tipping, recurring invoices, late fees, a client booking calendar, QuickBooks sync, AI drafting.** These are in HoneyBook and not here (see the comparison).
- **A drawn signature.** The signature is typed, with the signer's name, the time and the time zone stamped into the stored contract.

## Deployment notes

- Migrations `20261118000100` to `…0400` are applied to the hosted project. The applied `…0100` has its long comments trimmed; the statements are the same as the file.
- `client-checkout` (JWT required) and `stripe-webhook` (JWT off; the Stripe signature is the check) are deployed. Like footage-download, they ship trimmed copies of `_shared/env.ts`, `http.ts`, `db.ts` and `stripe.ts` that hold only the functions each one uses (see `docs/foundation-review.md`).

## Accounts and sign-in (2026-11-17)

Sign-in is email and password, with a separate sign-in for each portal:

| Portal | Sign in | Sign up | Lands on |
| --- | --- | --- | --- |
| Admin console (owners, producers) | `/login/admin` | By invitation only | `/board` |
| Crew | `/login/contractor` | `/signup/contractor`, then approval | `/app` (`/pending` until approved) |
| Client portal | `/login/client` | `/signup/client` | `/portal` |

- `/` is the chooser when signed out, and routes by role when signed in. A signed-out visitor to a portal page is sent to that portal's sign-in.
- **Nothing is granted until the email is confirmed** (`app.apply_signup`, on the confirmation trigger):
  - crew get a *pending* membership and see no jobs, events or organization until an owner or producer approves them on the Contractors page;
  - clients are attached to every client record that already lists their confirmed email; anyone else gets an empty portal;
  - nobody can sign up as an owner or producer.
- Owners turn crew and client sign-up on or off in Settings.
- Forgot password (`/forgot`) emails a link to `/account/password`. Anyone invited before passwords existed, or who used email links, sets their first password this way, or on first arrival from an invitation link.
- Tests: `supabase/tests/13_password_accounts.test.sql` (31 checks) and `scripts/qa/login_live.ts` (45 checks through the live sign-in forms).

**Supabase Auth settings this relies on** (owner step, dashboard → Authentication):
- *Confirm email* must stay **on**. If it were off, an account would count as confirmed without anyone opening the email, and client matching by email would not be safe.
- Turn on *leaked password protection* (the security advisor flags it).
- *Redirect URLs* must include `https://moments-to-media-admin.vercel.app/auth/callback`; it already does for invitations.

## Demo mode (temporary, for Moments to Media's review)

The sign-in page shows a **Demo mode** panel with one button per portal. Each signs in as a fictional account with sample data:

| Portal | Demo account | What's there |
| --- | --- | --- |
| Admin console | Sam Park (producer) | The board's sample events, packages, two inquiries, a signed and a waiting proposal, an invoice with the deposit paid |
| Crew | Maya Chen (photographer) | Her jobs, schedule and earnings from the board demo |
| Client portal | Avery Harper (wedding client) | A signed booking, an invoice with the deposit paid and a balance due, the contract, a message from the studio, and a delivered engagement session in **Media** (four real sample photos in R2, uploaded through the normal pipeline by `scripts/demo/upload_samples.ts`) |

- A banner shows on every page while in a demo account, with "Try another portal".
- Demo accounts cannot send emails (invitations, portal access) or change a password. Everything else works on the demo organization's data. The demo admin is a producer, not an owner, so organization settings and members stay locked.
- On when Vercel has `DEMO_MODE=on` and `DEMO_PASSWORD`; the password is a Vercel secret and the database holds only its hash.

**To remove it after approval:**
1. Delete `DEMO_MODE` and `DEMO_PASSWORD` in Vercel and redeploy. The panel and the buttons disappear.
2. Run `supabase/demo/portal_demo_teardown.sql`. It removes the sample client side, including the engagement session and its upload rows, and disables the demo logins. The four sample photos stay in R2 under `moments-to-media/…harper-lee-engagement-session…` until the footage lifecycle rule, or a manual delete, removes them.
3. Delete `apps/admin/lib/demo.ts`, `components/auth/DemoPanel.tsx` and `DemoBanner.tsx`, and their callers (`grep -rn demo apps/admin`).

## Client media tab

`/portal/media` lists every file delivered to the client across all their projects, grouped by project and by kind:
- **Final edits:** uploads of kind `deliverables`;
- **Selects:** kind `selects`;
- **Original footage:** kind `raw`.

Each file has a Download button, a private 15-minute link straight from R2. A file appears once two things are true: the contractor's work on it is approved, and the producer has clicked **Release approved media to the client** on the event (`public.client_media` decides). The overview shows a "Your media is ready" card that links here.

## Studio delivery

**Events → an event → Upload finished files** opens **Deliver to client** (`/events/<id>/deliver`). The event's producer or an owner uploads final edits and selects straight to the client's project, outside any crew assignment. Contractors cannot. The files use the same resumable, checksum-verified upload to R2 as crew footage (`start_upload` with the event id). Once the project is released (**Send to client**), they appear in the client's Media tab next to approved crew files. Delivered files can be removed again. Browser uploads were verified end to end on Nov 18, 2026. If the app moves to a new domain, add it to the R2 bucket's CORS rule and to `ALLOWED_ORIGINS` in `supabase/functions/_shared/cors.ts`.
