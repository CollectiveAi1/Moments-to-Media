# HoneyBook vs Moments to Media

Reviewed 2026-11-17 from HoneyBook's own pages: `honeybook.com/ai-information` (last reviewed August 2026) and its product pages for payments, invoices, proposals, contracts, the scheduler and AI. HoneyBook has no page of its own for the client portal, so what it offers there is inferred from mentions on other pages.

## The short version

HoneyBook and this app sit on opposite sides of the same job.

- **HoneyBook** covers the client side of a booking: inquiry, proposal, contract, invoice, payment, scheduling. Once the client has paid, it has nothing for the shoot itself: no crew, no shot list, no footage.
- **Moments to Media** covers the production side: staffing, briefing, the event day, footage, review and contractor pay. It has nothing for the client yet. Clients exist only as a name and contacts on an event.

The gap list is the whole client-facing side. Adding it makes this one app run a job from the first inquiry to the delivered files and the paid crew. HoneyBook can't do that, and neither can any of the crew tools in the PRD's competitive landscape.

## Feature by feature

| Area | HoneyBook | Moments to Media today | Gap |
| --- | --- | --- | --- |
| Leads and inquiries | Contact and lead forms feed a pipeline | None | **Missing.** Public inquiry form and a leads pipeline |
| CRM | Clients, projects and pipeline stages in one place | `clients` and `client_contacts` tables; client picker on events; no client screens | **Partial.** Client list and client record page |
| Packages and proposals | One "smart file" link: pick packages and add-ons, sign, pay | None | **Missing.** Package catalog and proposals the client accepts online |
| Contracts and e-signature | Templates, smart fields, typed or drawn signature, re-sign after edits, reminders | Contractor agreement is tracked as a document; no client contracts | **Missing.** Client contract with in-browser signing |
| Invoices | Branded, numbered, tax, discounts, payment schedules, recurring, reminders, PDF | None for clients (contractor payouts only) | **Missing.** Invoices with deposit and balance installments |
| Client payments | Card, ACH, Apple/Google Pay, tips, autopay, deposits, manual "mark paid" | Stripe Connect planned for contractor payouts only; not connected | **Missing.** Needs a Stripe decision (see below) |
| Client portal | Mentioned only: proposals, contracts, payments, event details | None (PRD lists a client portal as v2) | **Missing.** The portal you asked for |
| File delivery | Files can be attached in automations; no gallery product | Footage in R2 with signed downloads; producer approves deliverables | **Strong base.** Needs client-facing delivery of approved media |
| Scheduling | Client self-booking, session types, calendar sync, reminders | Contractor availability calendar; events created by producers | **Partial.** Booking requests in the inquiry form; full calendar sync later |
| Automations | Trigger-based emails, reminders, stage moves | Database-driven deadlines and notifications for crew | **Partial.** Client emails at each step (proposal sent, invoice due, files ready) |
| Messaging | Email, SMS (paid tier) | Announcements to crew; in-app notifications | **Partial.** Client message thread per project |
| Reporting | Advanced reporting (Premium) | Operations board | **Partial.** Revenue and outstanding balance on the board |
| AI | Drafted emails, summaries, task plans | None | Not proposed for this pass |
| Integrations | QuickBooks, Gmail, Zoom, Calendly, 40+ | Planned: Drive, Dropbox, Frame.io connectors | Not proposed for this pass |
| Crew staffing, event packets, shot lists, check-in | None | Full | **Ours alone** |
| Footage upload and review | None | Resumable multipart to R2, checksum-verified, review and approval | **Ours alone** |
| Contractor payouts and 1099s | None | Payout state machine; Stripe Connect planned | **Ours alone** |

## Proposed build: the client side

1. **Package catalog** (admin): named packages with price, what's included, and optional add-ons.
2. **Inquiry form** (public, per organization): name, contact details, event date, location, the package they're interested in, and a message. Each submission becomes a lead on a pipeline.
3. **Leads and clients** (admin): pipeline stages (new, proposal sent, booked, lost), the client record, and its projects.
4. **Proposal** (admin builds, client accepts): packages and add-ons, a contract, and a payment schedule (deposit plus balance). The client opens one link, adjusts add-ons, signs, and pays the deposit. Accepting it creates the event in Draft, so it flows straight into staffing.
5. **Client portal** (client logs in with an email link):
   - Their projects and their status.
   - Their proposal, their signed contract, and their invoices with Pay buttons and receipts.
   - Their media: once the producer approves the deliverables, the client can download them. Links are short-lived and go straight to R2, so nothing passes through our servers.
   - A message thread with the producer.
6. **Invoices** (admin): numbered, with tax, discounts, installments and due dates; "mark paid" for checks and cash; reminders.
7. **Client notices**: email when a proposal is sent, a payment comes due or is received, and files are ready.

Every new table carries `org_id` with row-level security, plus tests for allowed and denied access. A client sees only their own organization's records for their own client account, and media only after it is approved. Status changes go through transition functions, the same as the crew side.

## Decisions this needs

- **Payments.** HoneyBook processes payments itself. Here it would be Stripe Checkout under Moments to Media's own Stripe account (CLAUDE.md: billing changes need sign-off, and accounts are opened in the client's name). Until Stripe is connected, the portal can show invoices and the owner can record payments by hand.
- **Scope change.** The PRD lists the client portal as v2 and "Not in v1". Building it now changes that, and the PRD should say so.
