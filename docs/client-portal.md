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
- Tests: `supabase/tests/12_client_side.test.sql`, 64 checks, allowed and denied. `scripts/qa/client_db.py` turns that file into one rolled-back script to run against a hosted project.

## Switching on card payments (owner, billing setup)

This touches billing, so it is the owner's step. It uses **Moments to Media's own Stripe account** (CLAUDE.md: accounts are in the client's name).

1. In Stripe (test mode first), copy the secret key.
2. Add a webhook endpoint:
   - URL: `https://uvjtcwpfksmgmnfvghwz.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
   - Copy its signing secret.
3. In Supabase → Edge Functions → Secrets, add:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - optionally `APP_ORIGINS` (comma-separated site origins Checkout may return to; defaults to the Vercel site and localhost).
4. In the console: **Settings → Client payments → Let clients pay invoices by card**.

Until both the secret and the switch are on, the portal tells clients to pay by check or transfer, and `client-checkout` refuses with a clear message.

The webhook verifies Stripe's signature and accepts it for five minutes. It is idempotent on the Checkout Session id.

## Not built yet

- **Email to clients.** Proposals are sent by copying the link or with the "Email it" button, which opens your mail app. The portal sign-in link does go out by email (Supabase Auth over Resend). Automatic emails for invoice reminders and "your media is ready" need a transactional sender; today the client sees these in the portal.
- **Autopay, tipping, recurring invoices, late fees, a client booking calendar, QuickBooks sync, AI drafting.** These are in HoneyBook and not here (see the comparison).
- **A drawn signature.** The signature is typed, with the signer's name, the time and the time zone stamped into the stored contract.

## Deployment notes

- Migrations `20261118000100`, `…0200` and `…0300` are applied to the hosted project. The applied `…0100` has its long comments trimmed; the statements are the same as the file.
- `client-checkout` (JWT required) and `stripe-webhook` (JWT off; the Stripe signature is the check) are deployed. Like footage-download, they ship trimmed copies of `_shared/env.ts`, `http.ts`, `db.ts` and `stripe.ts` that hold only the functions each one uses (see `docs/foundation-review.md`).
