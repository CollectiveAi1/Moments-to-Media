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
  the job board screen; it needs somewhere to live. Slicing the address would
  leak the block and reverse-geocoding the pin would put a third-party service
  in the read path. `transition_event` refuses `draft → staffing` when the
  event has an open-call slot and no area label, so a job board card cannot go
  up blank.
- **`briefs.summary`** — row 4 gives an opted-in contractor a "Summary line
  only". Truncating `body` would leak whatever its first sentence happens to
  contain, so the summary is written separately. The `body` stays packet data.

Both agreed with the client.

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

These filled gaps the PRD and CLAUDE.md left open. All four open questions
below were put to the client and agreed on 2026-11-12; CLAUDE.md's "State
machines" section has been updated to match, and the behaviour described here
is what the code now does.

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
- **`staffed → staffing` when a committed contractor leaves.** Agreed with the
  client. "Staffed" is an invariant, not just a doorway: the PRD defines it as
  "every required slot has a confirmed contractor", the client-facing term for
  it is "Accepted", and the operations board flags unfilled slots. Leaving the
  event at `staffed` would tell a client their shoot is accepted when nobody
  is coming. `transition_assignment` demotes the event and releases the slot
  (back to `open_call` or `inviting` by its staffing mode) when a `confirmed`
  assignment moves to `cancelled` or `dropped` and a required slot is left
  uncovered. Never from `in_progress` — by then the day has started.
- **Hourly payouts** bill in quarter-hour increments rounded up, from the
  check-in and check-out stamps, never below `slots.minimum_hours`, with
  `overtime_rule = {"after_hours": 8, "multiplier": 1.5}` applied above the
  threshold. Agreed with the client. Quarter hours are the freelance norm and
  cap the rounding gift at 14 minutes rather than 59; the minimum call covers
  the short shoot that still cost the contractor a journey. An hourly slot
  with no recorded times falls back to the quoted rate rather than paying
  zero. PRD "Questions for Moments to Media" still asks how contractors are
  paid today, so the per-slot defaults want setting from their current
  practice.

## Auth

Phase 1's second item: passwordless sign-in, org membership and role claims.
Three migrations, `20261112000700` to `20261112000900`.

**There is no sign-up that is not an invitation.** The PRD puts self-serve
signup in v2 and says contractors arrive by "invite by SMS link with
passwordless sign-in", so `org_invitations` is the account-creation path. An
invitation names an organization, a role and an email or phone; the owner
invites admins and a producer invites contractors, which the insert policy
enforces by role.

An invitation is claimed only against a **verified** address. The claim runs
when `email_confirmed_at` or `phone_confirmed_at` first becomes non-null, not
when the auth row appears — otherwise signing up with someone else's address
would burn their invitation before the magic link proved anything. For an
existing login invited to a second organization no auth row changes at all, so
the app calls `public.claim_invitations()` after sign-in; it is idempotent.

`app.handle_new_user()` creates the `profiles` row, because passwordless
sign-in carries no name and the rest of the schema assumes one exists.
`full_name` falls back to the email local part.

**The `org_roles` claim is for the clients, not for RLS.** The access token
hook names each organization the person belongs to and the roles they hold
there, so the apps can draw the organization switcher without a round trip.
Policies keep reading `memberships`, which means suspending or removing
someone takes effect immediately rather than at their next token refresh —
up to an hour away at the current `jwt_expiry`. A test asserts that a
suspended membership disappears from the claim, and that no client role can
execute the hook.

Registering the hook needed `[auth.hook.custom_access_token]` in
`config.toml`, an auth configuration change, agreed before it was made.

## Uploads

Phase 1's last item, the database half: `20261112001000_upload_pipeline.sql`.

**The database never sees a byte.** CLAUDE.md rule 7 means footage goes from
the device straight to R2, so what the database can do is decide who may open
an upload, hand out the plan the client uploads against, keep the ledger that
makes a resume possible, and refuse to call an upload complete until the size
and checksum the backend read back from R2 match what was declared. The R2
calls themselves — `CreateMultipartUpload`, the presigned part URLs,
`CompleteMultipartUpload`, the `HEAD` that reads the object back — are an Edge
Function, because that is the only place R2 credentials may live (rule 4).

```
client                    Edge Function                database
start_upload  --------->  public.start_upload  ------>  authorize, derive the
                                                        key, write the ledger
                          R2 CreateMultipartUpload
                          app.attach_multipart  ------>  pending → in_progress
                          presign part URLs
PUT part -----------------------------------------------> (straight to R2)
report part  ---------->  public.record_upload_part --->  ledger
  ... resume: public.upload_resume_plan names the missing parts
complete  ------------->  R2 CompleteMultipartUpload
                          R2 HEAD object
                          app.complete_upload  -------->  verify, then queue
                                                          connector copies
```

**Verification is an invariant, not a code path.** `uploads` carries both what
was declared at start (`bytes`, `checksum`) and what the backend read back
(`verified_bytes`, `verified_checksum`), and a check constraint says a row
cannot be `completed` unless the two agree. That holds against `service_role`
and against any later code path that forgets to go through
`app.complete_upload`, which is the difference between a rule and a habit.

**Checksums are composite, and the client declares its own.** Parts are
uploaded with SHA-256 part checksums, so R2 returns the digest of the
concatenated part digests with the part count suffixed. The client is the one
chunking the file, so it can compute that value before it starts and declare
it; the Edge Function compares R2's answer to the declaration. Part digests
are kept in the ledger so the composite can be recomputed from it if the two
ever disagree. Postgres computes none of this — pgcrypto is not enabled and
the bytes are not here to hash.

**The part plan comes from the file size.** R2 allows at most 10,000 parts,
none over 5 GiB and none but the last under 5 MiB, so no fixed part size
serves both a 40 MB clip and a 50 GB card dump. `app.plan_part_size` starts at
8 MiB and doubles until the count fits: a 50 GB upload is 6,400 parts of 8
MiB. `packages/shared/src/uploads.ts` mirrors the limits and the planner, so
the clients compute the same plan the database will accept.

**Resuming is the server's answer, not the client's memory.** After the app is
killed mid-upload, `public.upload_resume_plan` says which parts are still
missing and which ETags landed. A retried part reports a new ETag and the
latest report wins, which is what R2 does to a re-uploaded part.

**"Mark upload complete" cannot lie.** A trigger on `assignments` refuses the
move to `uploaded` while any upload on that assignment is still `pending` or
`in_progress` — the same class of problem as a `staffed` event with an
uncovered slot. It is a table trigger rather than a check inside
`transition_assignment` so it also holds for `service_role`.

Zero files is *not* refused. A contractor whose card went to the lead shooter
would otherwise be trapped with no way out of the app, so the move is allowed
and an `uploaded_with_no_files` entry goes to `activity_log` for the producer
instead. Worth confirming with the client: the alternative is to block it and
require the producer to mark the slot themselves.

**Completion is idempotent** (rule 8). The same verification twice is the same
call; a *different* one on an already-completed upload raises, rather than
passing quietly. Same for `app.attach_multipart` and `app.abort_upload`.

**Every failure path has a state.** `aborted` is someone's choice —
`public.abort_upload`, open to the contractor who owns it or the event's
producer, after which the Edge Function aborts the multipart upload on R2 so
the parts stop being billed. `failed` is the backend's: R2 refused, the
multipart expired, the completion did not verify. Without both, an upload that
stopped would pin its assignment behind the in-flight guard forever.

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
- **The R2 calls themselves** — `CreateMultipartUpload`, presigning part
  URLs, `CompleteMultipartUpload`, the `HEAD` that reads back size and
  checksum, and the connector sync worker. The database decides and
  verifies; the Edge Function is the only thing holding R2 credentials.
  This is what is left of Phase 1 after this branch, together with the
  50 GB throttled proof itself — `docs/upload-proof.md` is the procedure
  and the pass criteria, written before the run.

## Verification status

Green on CI as of run #23: `Files=10, Tests=412, Result: PASS`, against a
Postgres the migrations are applied to from scratch on every run. Each run
reports its own `Files=` and `Result:` line as a workflow notice, so the size
of the suite is never a claim in a document.

Getting there took four fixes to the migrations, all found by the suite and
none visible by reading the SQL:

- **The policy migration revoked the projection views.**
  `20261112000500` opens with `revoke all on all tables in schema public`,
  which in Postgres covers views, so it took back the grants
  `20261112000400` had just made on `job_board`, `event_crew` and
  `organization_public`. A contractor got `permission denied for view
  job_board` — no job board, no open calls, nothing before confirmation. The
  grants are now re-applied after the revoke.
- **The audit trail could not be ordered.** `activity_log.created_at` and
  `deliverable_reviews.created_at` defaulted to `now()`, the *transaction*
  timestamp, so every row written by one transition shared it and "the most
  recent entry" was undefined. That matters for the log, and more for
  `app.deliverable_is_approved`, which decides approval from the latest
  review. Both now default to `clock_timestamp()`.

- **The slot release could not assign its own enum.** The `staffed → staffing`
  cascade set `slots.status` from a `CASE` of two bare literals, which
  resolves to `text` and will not assign to a `slot_status` column. It raised
  `42804` and took the whole transition with it, so a contractor could not
  drop at all. Both branches now cast explicitly.

- **A new table arrived with privileges nobody granted it.** Supabase's
  default privileges hand every new table in `public` to `anon` and
  `authenticated`, so `org_invitations` appeared with seven privileges for
  `anon` and a full-table `UPDATE` for `authenticated` that would have made
  its column-level grant meaningless. The default is now revoked as well as
  the table's own grants, and `01_schema_conventions` fails the build if
  either slips again.

Everything else the suite caught was wrong expectations in the tests
themselves, since corrected.

| File | Covers |
| --- | --- |
| `01_schema_conventions.test.sql` | CLAUDE.md rules 1, 5, 6, 10 against the catalog: RLS everywhere, policies everywhere, `org_id` not null and indexed, every foreign key indexed, integer cents, no naive timestamps, status columns not writable, `anon` has nothing |
| `02_tenant_isolation.test.sql` | Each tenant invisible to the other across all 22 org-scoped tables, both directions, plus three grafted-row attempts the composite keys refuse |
| `03_matrix_packet_visibility.test.sql` | Matrix rows 1-6, all five personas, and the 7-day window after completion |
| `04_matrix_footage_money_profiles.test.sql` | Matrix rows 7-10, including the producer "own events" boundary |
| `05_matrix_settings_and_writes.test.sql` | Matrix row 11 and the write side: who may insert, update and opt in |
| `06_state_machine_event.test.sql` | `transition_event`: actors, illegal moves, entry conditions, cancel cascade, audit trail |
| `07_state_machine_assignment.test.sql` | `transition_assignment`: the full walk from invite to paid, the review loop, every exit, both confirm guards |
| `08_state_machine_payout.test.sql` | `transition_payout`: who submits and approves, auto-approval under the threshold, webhook settlement, failure and reversal |
| `09_auth.test.sql` | Profile bootstrap, who may invite whom, claiming only against a verified address, the `org_roles` claim |
| `10_upload_pipeline.test.sql` | Who may open an upload, the part plan and the derived object key, resuming, the verification that gates completion, idempotent completion, abort and fail, connector queueing, the in-flight guard, and the ledger's visibility |

Run them locally with:

```bash
pnpm db:reset && pnpm db:test
```

on a machine with Docker and the Supabase CLI, or push the branch and let CI do
it — `.github/workflows/ci.yml` runs exactly that.
