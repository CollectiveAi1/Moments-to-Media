# The 50 GB throttled upload proof

CLAUDE.md "Build order" closes Phase 1 with:

> Upload pipeline proof: presign, multipart to R2, complete with checksum;
> prove a 50 GB upload over a throttled connection

and PRD "Phases and gates" makes it part of the Foundation gate. This is the
procedure, written down before the run so the result is a pass or a fail
rather than an impression.

## Why it is not in CI

The database half of the pipeline is tested on every push
(`supabase/tests/10_upload_pipeline.test.sql`). This proof is a different
kind of claim: that 50 GB actually lands in R2, intact, over a connection
bad enough to drop parts, and resumes when it does. That needs a real
bucket, real credentials and a real network for a few hours. A GitHub runner
has none of those and its egress is nothing like a venue's.

So it runs once, by hand, against Moments to Media's own Cloudflare account,
and the result is recorded here.

## What must exist first

1. ~~**A Cloudflare R2 bucket**~~ — created: `moments-to-media-footage`,
   location hint `ENAM`, Standard storage class, default jurisdiction, no
   public access. **It is in the CollectiveAi Cloudflare account, not Moments
   to Media's**, which is the same ownership gap recorded for the Supabase
   project in `foundation-review.md` and has to close before this bucket holds
   real footage. An R2 bucket cannot be moved between accounts: closing it
   means creating the bucket again in the client's account and copying what is
   there.

   Still outstanding: **an S3-compatible API token scoped to this bucket**,
   Object Read & Write, nothing wider. R2 has no API for minting those, so it
   is a dashboard step by hand whoever does it.
2. ~~**The credentials in Edge Function secrets**~~ — set and verified:
   `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Rule 4: nowhere
   else, and never in the mobile bundle. The functions read them through
   `_shared/env.ts`, which fails fast naming any that are absent and never
   echoes a value, so a misconfigured deploy says so on the first call
   instead of signing something unusable.
3. ~~**The three Edge Functions**~~ — built, in `supabase/functions`:
   - `upload-start` — calls `public.start_upload` with the contractor's own
     token, then R2 `CreateMultipartUpload`, then `public.attach_multipart`
     with the service role, and returns the plan with the first window of
     presigned part URLs (100 by default; 6,400 signed URLs would be a 3 MB
     response).
   - `upload-presign` — re-signs the parts `public.upload_resume_plan` says
     are still missing. Part URLs last 15 minutes, so a 50 GB upload outlives
     its first batch and comes back here; that is the normal path, and it is
     one of the things the proof has to exercise.
   - `upload-complete` — R2 `CompleteMultipartUpload`, then `HEAD` with
     checksum mode on, then `public.complete_upload` with what R2 reported.
     On a mismatch it calls `public.fail_upload` and returns 409. It does not
     delete the object: 50 GB of someone's footage is worth a human look.

   ~~Deploy them~~ — deployed to `uvjtcwpfksmgmnfvghwz`, all three ACTIVE at
   version 1 with `verify_jwt` on, which was checked rather than assumed: an
   unauthenticated `POST` to each returns
   `401 UNAUTHORIZED_NO_AUTH_HEADER` at the gateway, before any of this code
   runs.

   They were deployed through the Supabase connection rather than
   `supabase functions deploy`, for the same reason the migrations were — no
   Supabase CLI runs on the machine this was built on. That means the files
   were handed to the deploy API individually instead of being bundled from
   the repository, so each one was read back afterwards and diffed against
   its file here: all nine (`deno.json`, five `_shared` modules, three
   entrypoints) are identical. `supabase functions deploy` from the
   repository remains the canonical path and should be a no-op.

   The secrets are still missing, so every call currently fails at
   `readEnv()` with a 500 saying the service is misconfigured and naming
   nothing. That is the designed behaviour, not a deployment fault — but it
   does mean these endpoints are live and non-functional until step 2 is
   done.

   They are typechecked, linted and unit-tested in CI; what CI cannot do is
   call R2, which is what this document is for.

4. **A client that can send the parts.** The Expo native module for the real
   thing; a script against the same Edge Functions is enough for this proof,
   and is what makes the throttling easy to control.

## The run

A 50 GB file is 6,400 parts of 8 MiB, which is what `app.plan_part_size`
chooses and what `packages/shared/src/uploads.ts` mirrors.

1. Make the file from random bytes, not zeros — zeros compress and would
   flatter the result:
   `dd if=/dev/urandom of=card-dump.mov bs=1m count=51200`
2. Record its SHA-256 and the composite checksum for 8 MiB parts. The
   composite is the digest of the concatenated part digests, with `-6400`
   suffixed; the client declares it to `start_upload`.
3. Throttle to something a venue would actually give you. On macOS, Network
   Link Conditioner at 5 Mbps up with 2% loss and 200 ms latency; on Linux,
   `tc qdisc add dev <iface> root netem rate 5mbit loss 2% delay 200ms`.
   At 5 Mbps, 50 GB is about 24 hours, so run the full-size pass at a usable
   rate (50 Mbps, about 2.5 hours) and run the 5 Mbps pass against a 5 GB
   file to prove the behaviour under genuinely bad conditions.
4. Start the upload, then interfere on purpose:
   - kill the client process at around 20% and restart it — it must ask
     `upload_resume_plan` and send only the missing parts
   - drop the network for two minutes at around 50%
   - let the first batch of presigned URLs expire before using them, so the
     re-sign path runs under load rather than in a unit test
5. Complete it, and download the object back to check the SHA-256 against
   step 2.

## What counts as a pass

| Claim | How it is shown |
| --- | --- |
| The footage never touches our servers | Supabase Edge Function logs for the run show no request body over a few KB; the parts go to `*.r2.cloudflarestorage.com` |
| 50 GB lands intact | The downloaded object's SHA-256 equals the source file's |
| The parts are verified, not trusted | `uploads.verified_bytes` and `verified_checksum` equal `bytes` and `checksum` on the completed row |
| A killed client resumes | The ledger shows no part uploaded twice except the ones deliberately retried, and the total bytes sent is within a part of 50 GB |
| Expired URLs are survivable | The run includes at least one successful re-sign of a part whose first URL had expired |
| A tampered completion is refused | Repeat the completion call with a size one byte out: it must raise, and the row must stay `in_progress` |
| Nothing is left billing | After an aborted run, R2 lists no in-progress multipart uploads for the bucket |

## Record the result here

Date, file size, throttle profile, wall-clock time, parts retried, and the
two checksums. A pass that is not written down is not a gate.

## The dress rehearsal, 2026-11-16

Before the 50 GB run, the whole pipeline was taken end to end at 20 MiB in
three parts against the real bucket, by `scripts/upload_smoke.py`. It passed:

```
[06] part 1/3 ok  etag "a899e7efb1f2cc2800874d18e187a42f"  checksum verified by R2
     part 2/3 ok  etag "08c88e345dff6170796b06a6236426e5"  checksum verified by R2
     part 3/3 ok  etag "c4bcd4adc1195966539f3bea77f1ac5e"  checksum verified by R2
[08] status completed, checksum OMBJKmCIh7o=
[09] second call returned already: true
[10] bytes 20971520 == verified_bytes 20971520
     checksum OMBJKmCIh7o= == verified_checksum OMBJKmCIh7o=
```

Four rows of the pass table above are already demonstrated at this size, and
only at this size — the 50 GB run has to show them again under duration and
loss, but none of them is an open question any more:

- **The parts are verified, not trusted.** `verified_bytes` and
  `verified_checksum` match the declaration made before the first byte moved.
- **A repeated completion is not an error.** The second `upload-complete`
  returned `already: true` without touching R2 (CLAUDE.md rule 8).
- **Nothing is left billing.** The bucket lists no in-progress multipart
  uploads after the run.
- **The footage does not pass through our servers.** Every part went to
  `*.r2.cloudflarestorage.com` on a presigned URL; the Edge Functions saw only
  the plan and the ledger.

Three things the proof document assumed that turned out to be false, now
corrected here and in `foundation-review.md`:

1. The checksum is **full-object CRC-64/NVME**, not composite SHA-256. R2
   answers `501 NotImplemented` for per-part SHA-256. See
   `supabase/migrations/20261116001000`.
2. Step 5's check — downloading the object and comparing **SHA-256** against
   the source — is now more important, not less. It is the only cryptographic
   check in the proof, because the checksum R2 verifies is a CRC. Keep it.
3. The part URLs now carry the part's checksum inside the signature, so the
   re-sign path in step 4 must send `part_checksums` for the parts it asks for.
   A re-sign without them is a 400, deliberately.

Still outstanding before the 50 GB run:

- A **lifecycle rule** on the bucket aborting incomplete multipart uploads
  after 7 days. The run is meant to be interrupted; without the rule, an
  abandoned 50 GB upload bills until someone notices. Swept by hand so far.
- The **throttled client** itself. `scripts/upload_smoke.py` holds the whole
  file in memory and signs one batch; the 50 GB client has to stream from disk,
  re-sign expired batches, and survive being killed.

## Running the 50 GB proof

`scripts/upload_large.py`. Standard library only, same reason as the smoke
script. Four subcommands: `generate`, `run`, `verify`, `status`, plus
`selftest`.

```sh
export SUPABASE_URL=https://uvjtcwpfksmgmnfvghwz.supabase.co
export SUPABASE_ANON_KEY=<anon>
export SUPABASE_SERVICE_ROLE_KEY=<service role>

python3 scripts/upload_large.py selftest
python3 scripts/upload_large.py generate /path/to/proof.bin --bytes 50G
python3 scripts/upload_large.py run      /path/to/proof.bin --limit 20
```

`selftest` runs first and needs nothing but Python. It checks both CRC-64
implementations against the published vector and against each other, checks
that combining part checksums equals hashing the file whole, checks the part
planner against `app.plan_part_size`, and checks the SigV4 presigner against
AWS's own published presigned-URL example. A wrong signer would otherwise
announce itself only after 50 GB had been uploaded.

`generate` hashes while it writes, so the declaration is ready without reading
the file a second time. Budget about 45 minutes for 50 GB: the checksum is
computed in pure Python at roughly 20 MiB/s. That is a property of this
harness, not of the design — the contractor app computes it in a native module
at memory speed.

`run` is **safe to kill at any moment and re-run**. It keeps the plan and the
upload id in `proof.bin.mtm-upload.json`, and every batch begins by asking
`upload_resume_plan` what is still outstanding, so the server's ledger decides
what gets sent, not the client's memory of what it did.

### Exercising the four things that only break at size

| Row of the pass table | How to force it |
| --- | --- |
| A killed client resumes | `ctrl-c` around 20%, then `run` again. The batch header prints how many parts the server still considers outstanding. |
| The network dropping | Turn Wi-Fi off for two minutes mid-run. Parts retry with backoff; the summary counts the retries. |
| Expired URLs are survivable | `run --force-expiry` waits past the 15-minute lifetime before the first PUT, so the 403-and-re-sign path runs deliberately rather than by luck. The summary counts the re-signs. |
| A tampered completion is refused | Still to be done by hand: repeat the completion with a size one byte out and check the row stays `in_progress`. |

`--limit` is in MiB/s. Use something slow enough that a batch of 100 parts
(800 MiB) takes more than 15 minutes if you want expiry to happen naturally:
below about 0.9 MiB/s. Otherwise use `--force-expiry` and run at a sane speed.

### The read-back

```sh
export R2_ACCOUNT_ID=... R2_BUCKET=moments-to-media-footage
export R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
python3 scripts/upload_large.py verify /path/to/proof.bin
```

This is the operator checking R2, not the app: the app never holds R2
credentials, so this step uses yours. It streams the object back without
writing it to disk and compares size, CRC-64 and **SHA-256** against the source.
The SHA-256 is the point. It is the only cryptographic check in the proof,
because the checksum R2 itself verifies is a CRC.
