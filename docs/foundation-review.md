# Phase 1 Foundation — review notes

What to read, the decisions that needed making, and the open questions.
Implements PRD "Data model", "Permissions and data visibility" and
"Status lifecycles".

## The migration, in order

| File | What it does |
| --- | --- |
| `20261112000100_enums.sql` | The `app` helper schema and 18 enumerated types, including the three status enums |
| `20261112000200_tables.sql` | 27 tables, constraints, indexes, `updated_at` triggers, and the cross-tenant integrity keys |
| `20261112000300_access_helpers.sql` | 21 security-definer predicates the policies are written in terms of |
| `20261112000400_visibility_views.sql` | `job_board`, `event_crew`, `organization_public` — the pre-confirm projections |
| `20261112000500_rls_policies.sql` | RLS on all 27 tables, 88 policies, and the column grants that keep status columns unwritable |
| `20261112000600_transition_functions.sql` | `transition_event`, `transition_assignment`, `transition_payout` |

Review order: tables, then helpers, then policies. The policies read as prose
once the helpers are in mind (`app.packet_visible`, `app.is_admin`,
`app.can_manage_event`, `app.is_eligible_for_slot`).

## How the permissions matrix is enforced

RLS cannot hide a column, and the coarse fields a candidate may see (date,
area, role, rate, gear) sit on the same rows as the exact address and the
brief. So:

- the **tables** are closed to contractors until they are confirmed
  (`app.packet_visible`), and
- the **pre-confirm projection** is a security-definer view that selects only
  the permitted columns, with its authorization in the WHERE clause.

`job_board` therefore has no `address`, `latitude` or `arrival_notes` column at
all — `01_schema_conventions.test.sql` asserts their absence, so a later
`alter view` that widens it fails CI.

Two matrix cells needed a column that the PRD data model does not list:

- **`events.area_label`** — row 1 gives a contractor the event's *area* but not
  its address. The PRD describes this as "neighborhood, not exact address" in
  the job board screen; it needs somewhere to live.
- **`briefs.summary`** — row 4 gives an opted-in contractor a "Summary line
  only". The brief's `body` stays packet data.

## Decisions taken, worth confirming

1. **No PostGIS.** The PRD says "geo point"; this uses `numeric(9,6)`
   latitude/longitude plus a haversine helper (`app.miles_between`), so no
   extension is added. Fine for coverage-radius matching and check-in radius;
   revisit if we ever need spatial indexes or polygons.
2. **Composite tenant keys.** Every org-scoped child carries a
   `(parent_id, org_id)` foreign key against the parent's `(id, org_id)`.
   RLS decides who may write; this makes a row that carries one tenant's
   `org_id` while pointing at another tenant's parent unrepresentable.
3. **`organizations` is owner-only, with a view for everyone else.** Matrix
   row 11 says producers and contractors get nothing from organization
   settings, but both clients need the name and branding, so they read
   `organization_public`. `stripe_account_id` is in no update grant: the
   onboarding callback writes it with the service role.
4. **Status columns are not in any update grant.** That, not a policy, is what
   makes the transition functions the only path (CLAUDE.md rule 6). The
   exception is `slots.status`: the PRD defines no slot state machine, and
   posting or closing an open call is an ordinary producer action.
5. **`uploads` has no client write policy.** Rows are written by the backend
   when it presigns parts and when it completes the upload after verifying size
   and checksum (CLAUDE.md rule 7).
6. **Confirm requires finished Stripe onboarding** where the organization pays
   in the app, per PRD "Payments → Setup". Opting in does not.
7. **Open-call eligibility** is implemented as: active contractor membership,
   every required compliance document approved and unexpired, at least one
   item of equipment in each required gear category, and the event pin inside
   the contractor's travel radius. A contractor with no home base set is not
   eligible; an event with no pin excludes nobody.

## Interpretations in the state machines

These fill gaps the PRD and CLAUDE.md leave open. Each is cheap to change.

- **`invited → confirmed` directly.** CLAUDE.md lists
  `selected → confirmed`, and names `invited` only as an entry state. A direct
  invite *is* the selection, so accepting one confirms. Without this, accepting
  an invite would need a producer action in between.
- **`invited → expired`.** CLAUDE.md names `expired` for a selection whose
  confirm deadline passed. The PRD also gives direct invites their own window
  ("default 24 hours"), so an invite can expire too.
- **On confirm, only `interested` rivals are closed out** (to
  `not_selected`, which is what the PRD's "everyone else who opted in is told
  the slot is filled" notification reads from). Other `invited` or `selected`
  rows on the same slot are left as they are — nothing says what should happen
  to them, and the one-committed-contractor index already blocks a second
  confirm.
- **System moves** (`approved → paid`, `sent → paid`, `sent → failed`,
  `paid → reversed`) are allowed for the service role, which has no JWT, or for
  the owner. Everything else is refused from a client.
- **No `staffed → staffing`.** If a confirmed contractor drops, the event is
  left at `staffed` and the producer re-staffs the slot. CLAUDE.md's event
  machine has no edge back to `staffing`. **Open question:** should dropping
  un-staff the event?
- **Hourly payouts** use `ceil(hours)` from the check-in and check-out stamps,
  with `overtime_rule = {"after_hours": 8, "multiplier": 1.5}`. An hourly slot
  with no recorded times falls back to the quoted rate rather than paying zero.
  **Open question:** confirm the rounding — whole hours up, or quarter hours?

## Deliberately not in the database

These belong to the API and client layers and are not part of this migration:

- **Logging reads.** The PRD requires every read of client contact details and
  every footage download to reach `activity_log`. RLS cannot log a read: the
  endpoint that serves contact details and the one that presigns a download
  call `app.log_activity` themselves.
- **Announcement audience targeting** (all, by skill, by area, one event's
  crew). The policy floor is "a member of the organization, once it is due";
  targeting happens when the fan-out writes `notifications`.
- **Match score and ranked candidates** (distance, gear, availability,
  reliability, history with the client) — a staffing query, not a constraint.
- **The notification matrix** and its channels.
- **R2 presigning, checksum verification and connector sync** — Edge Functions.

## Verification status

The suite in `supabase/tests` is written but **has not been run**: this machine
has no Postgres, no Docker and no working Node toolchain (Apple Silicon with
x86-only Node builds installed and Rosetta absent), so neither
`supabase test db` nor a bare `pg_prove` can start.

It is 8 files and roughly 190 assertions:

| File | Covers |
| --- | --- |
| `01_schema_conventions.test.sql` | CLAUDE.md rules 1, 5, 6, 10 against the catalog: RLS everywhere, policies everywhere, `org_id` not null and indexed, every foreign key indexed, integer cents, no naive timestamps, status columns not writable, `anon` has nothing |
| `02_tenant_isolation.test.sql` | Each tenant invisible to the other across all 22 org-scoped tables, both directions, plus three grafted-row attempts the composite keys must refuse |
| `03_matrix_packet_visibility.test.sql` | Matrix rows 1-6, all five personas, and the 7-day window after completion |
| `04_matrix_footage_money_profiles.test.sql` | Matrix rows 7-10, including the producer "own events" boundary |
| `05_matrix_settings_and_writes.test.sql` | Matrix row 11 and the write side: who may insert, update and opt in |
| `06_state_machine_event.test.sql` | `transition_event`: actors, illegal moves, entry conditions, cancel cascade, audit trail |
| `07_state_machine_assignment.test.sql` | `transition_assignment`: the full walk from invite to paid, the review loop, every exit, both confirm guards |
| `08_state_machine_payout.test.sql` | `transition_payout`: who submits and approves, auto-approval under the threshold, webhook settlement, failure and reversal |

To run them, either:

```bash
pnpm db:reset && pnpm db:test
```

on a machine with Docker and the Supabase CLI, or push the branch and let CI do
it — `.github/workflows/ci.yml` runs exactly that.
