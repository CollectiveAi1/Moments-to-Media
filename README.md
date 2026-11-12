# Moments to Media — Contractor Ops App

Internal operations app for Moments to Media's freelance crews. See
[CLAUDE.md](CLAUDE.md) for the locked decisions and the house rules, and
[docs/PRD.md](docs/PRD.md) for the spec.

## Where things are

```
apps/mobile        contractor app (Expo)      — scaffolded in Phase 2
apps/admin         admin console (Next.js)    — scaffolded in Phase 2
packages/shared    status enums, design tokens
supabase/migrations   schema, RLS, transition functions
supabase/tests        pgTAP: RLS matrix and state machines
docs/PRD.md           the spec, exported from the PRD doc
```

## Phase 1 — Foundation

Shipped: the schema from PRD "Data model", RLS policies for every row of the
PRD permissions matrix, and the three transition functions. Read
[docs/foundation-review.md](docs/foundation-review.md) before reviewing the
migration — it lists the decisions that needed making and the open questions.

Still to do in Phase 1: passwordless auth and org membership wiring, and the
upload-pipeline proof (presign, multipart to R2, checksum on completion, a
50 GB upload over a throttled connection).

## Running the database locally

Requires Docker and the Supabase CLI.

```bash
pnpm db:start     # boots Postgres and applies supabase/migrations
pnpm db:reset     # re-applies every migration from scratch, then seeds
pnpm db:test      # pgTAP: RLS matrix and state machines
pnpm db:types     # regenerates packages/shared/src/database.types.ts
```

CI runs `db:reset`, `db:test` and `supabase db lint` on every pull request
([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Secrets

Client-safe values only in `.env` files; see [.env.example](.env.example).
Server keys (Stripe secret, R2 credentials, Twilio, service role) live in
Supabase Edge Function secrets and Vercel env, never in this repo and never in
the mobile bundle.
