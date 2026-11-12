# Moments to Media — Contractor Ops App

Internal operations app for Moments to Media's freelance crews. Contractors see assignments, opt into jobs, get a full event packet, check in, work a live shot list, upload footage and get paid. Admins staff events, brief crews, review deliverables and pay out.

- Spec (source of truth): `docs/PRD.md` (exported from the PRD doc; https://claude.ai/artifact/7nPDtHiPf68SCJHmsg9jjZ)
- Approved prototype: https://claude.ai/artifact/WuahTAdhBnHJVaWKPg1wau
- Owner: Moments to Media owns this code and every account it runs on. Never create infrastructure under anyone else's account.

## Locked decisions

| Area | Decision |
| --- | --- |
| Tenancy | Multi-tenant from day one: `org_id` on every org-scoped table, enforced by row-level security |
| Clients | Native contractor app (iOS + Android) and web admin console |
| Footage | Hosted in Cloudflare R2; connectors push copies to Google Drive, Dropbox, Frame.io |
| Payments | Stripe Connect Express, enabled for Moments to Media only (per-org setting, off for any other org) |
| 1099s | Filed and delivered through Stripe Connect tax reporting (platform responsibility with Express) |

## Stack

- Monorepo: pnpm workspaces + Turborepo
- `apps/mobile`: Expo (React Native, TypeScript), expo-router, a custom Expo native module for background multipart uploads
- `apps/admin`: Next.js (App Router, TypeScript) on Vercel
- `supabase/`: Postgres, Auth (passwordless SMS + email link), Realtime, Storage (documents and photos only), Edge Functions, Postgres-backed job queue
- `packages/shared`: generated DB types, zod schemas, status enums, design tokens
- Storage: Cloudflare R2 for footage (S3-compatible multipart, presigned part URLs)
- Payments: Stripe Connect Express
- Messaging: Expo Push Notifications, Twilio SMS for critical notices
- Monitoring: Sentry on both clients

## Repo layout

```
apps/mobile        contractor app
apps/admin         admin console
packages/shared    types, schemas, tokens
supabase/migrations
supabase/functions
supabase/tests     RLS and state-machine tests
docs/PRD.md
```

## Non-negotiable rules

1. Every org-scoped table has `org_id uuid not null`, an index on it, and RLS enabled with explicit policies. No table ships without policies and tests.
2. Contractor visibility depends on slot state, not role alone. Before a contractor is confirmed on a slot they never see the exact address, client contact, brief, shot list, crew list or emergency contacts. Enforce in RLS or security-definer views, never only in the UI. See PRD "Permissions and data visibility".
3. Schema changes only through files in `supabase/migrations`. Never edit the remote database by hand.
4. No secrets in code or in the mobile bundle. Server keys (Stripe secret, R2 credentials, Twilio, service role) live only in Edge Function secrets and Vercel env.
5. Money is integer cents. Times are `timestamptz` in UTC, with the event's IANA time zone stored on the event.
6. Status changes go through one function per state machine (`transition_event`, `transition_assignment`, `transition_payout`) that validates the move and writes `activity_log`. No direct status updates from clients.
7. Footage never passes through our servers. Clients upload parts straight to R2 with short-lived presigned URLs; the backend verifies size and checksum on completion.
8. Every webhook handler (Stripe, upload completion) is idempotent and verifies signatures.
9. Every endpoint handles its failure paths: validation errors, permission errors, retries. No happy-path-only code.
10. Index every foreign key. Add tests for every RLS policy (allowed and denied cases).

## State machines

Event: `draft → staffing → staffed → in_progress → uploaded → complete`, plus `cancelled` from any state before `in_progress`. One move runs backwards: `staffed → staffing`, when a committed contractor leaves and a required slot is uncovered again — "staffed" means every required slot has a confirmed contractor, and the operations board must stop claiming otherwise. Not available from `in_progress`.

Assignment (contractor on a slot), two entry paths:
- Direct invite: `invited → confirmed`. The invite is already the producer's choice, so accepting it commits; there is no second selection step.
- Open call: `interested → selected → confirmed`.
- Then `confirmed → checked_in → checked_out → uploaded → approved → paid`
- `uploaded ⇄ changes_requested`
- Exits: `declined` (from invited), `expired` (invite window or confirm deadline passed), `not_selected` / `withdrawn` (from interested), `cancelled` / `dropped` (from confirmed)

Payout: `draft → submitted → approved → sent → paid`, plus `failed` / `reversed` from Stripe webhooks, and `failed → submitted` to retry.

Hourly pay: quarter-hour increments rounded up, from check-in to check-out, never below the slot's minimum call (`slots.minimum_hours`). Flat and day rates pay as quoted.

Selection rule: selecting a contractor sends a confirm request (default 12h deadline). Only a confirm commits them. On confirm, everyone else who opted in is notified that the slot is filled. On expiry, the producer gets the next-ranked candidate.

## Design tokens (from the approved prototype)

- Background `#F7F4EF`, surface `#FFFDF9`, chip/secondary `#EFEAE2`, border `#D9D2C7`, divider `#E6E0D6`
- Text `#1F1F1F`, secondary `#3F3B35`, muted `#6B655A`
- Primary button `#1F1F1F` with `#FFFDF9` text; admin accent `#7A7059`
- Done/progress fill `#6E7360`; positive text `#5B6A4A` on `#EEF0E9`
- Attention text `#9C5F5F`, attention border `#D4A5A5`
- Brand palette reference: `#D9D2C7`, `#B6BCAD`, olive (labeled `#BE937E` on the board, rendered olive), `#1F1F1F`, `#0D0D0D`. Pale sage and pale rose are fills only; they fail contrast as text.
- Type: Cinzel (headings), Montserrat (labels, buttons), Lato (body)
- Logos: MM circle monogram (app icon, contractor header), "Moments to Media Content Co." wordmark (admin sidebar)
- Touch targets at least 44px; text contrast at least 4.5:1

## Build order

1. Foundation (start here)
   - Monorepo scaffold, CI (typecheck, lint, tests on every PR)
   - Supabase schema from PRD "Data model", RLS policies, transition functions, seed data
   - RLS test suite covering every row of the permissions matrix
   - Auth: passwordless sign-in, org membership, role claims
   - Upload pipeline proof: presign, multipart to R2, complete with checksum; prove a 50 GB upload over a throttled connection
2. MVP build (after client signs off on the prototype)
   - Contractor app: Home, job board, open call detail, event packet (offline cache), check-in, shot list, upload center, profile and availability, earnings
   - Admin console: operations board, event builder, staffing with ranked candidates, footage library, review, payouts, announcements
   - Notifications per PRD matrix; Stripe Connect onboarding and payouts
3. Pilot with real events, then v1.1 per PRD "Scope and phases"

## Working rules for Claude Code

- Read `docs/PRD.md` before starting any feature and cite the section you're implementing in the PR description.
- Small PRs, one concern each, with tests.
- When the PRD and the prototype disagree, the PRD wins; flag the conflict.
- Ask before adding a dependency, changing a locked decision, or touching billing or auth configuration.
