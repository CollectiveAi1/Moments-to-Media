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

1. **A Cloudflare R2 bucket in Moments to Media's account**, private, with an
   S3-compatible API token scoped to it. CLAUDE.md: the client owns every
   account this runs on, so the bucket and the token are created in their
   account, not ours.
2. **The credentials in Edge Function secrets** — `R2_ACCOUNT_ID`,
   `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Rule 4: nowhere
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

   Deploy them with `supabase functions deploy upload-start upload-presign
   upload-complete`, and set the secrets with `supabase secrets set` before
   the first call. They are typechecked, linted and unit-tested in CI; what
   CI cannot do is call R2, which is what this document is for.

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
