# Moving the infrastructure to Moments to Media

`CLAUDE.md`: *"Moments to Media owns this code and every account it runs on.
Never create infrastructure under anyone else's account."* Three things are
currently in CollectiveAi accounts and are not.

| What | Where it is now | Can it transfer? |
| --- | --- | --- |
| Supabase project `uvjtcwpfksmgmnfvghwz` | CollectiveAi org (Free plan) | **Yes, in place** |
| R2 bucket `moments-to-media-footage` | CollectiveAi Cloudflare account | **No. Recreate.** |
| Git repository `CollectiveAi1/Moments-to-Media` | CollectiveAi GitHub org | Yes, GitHub repo transfer |

Written 2026-11-16, before the 50 GB proof, deliberately: the bucket holds one
disposable 20 MiB test object today. That is the entire migration cost right
now. After the proof it is 50 GB, and after the pilot it is client footage.

## The Supabase half is nearly free

A project transfers between organizations without touching the infrastructure.
The project ref stays `uvjtcwpfksmgmnfvghwz`, so **nothing in the codebase or
in any client changes**: same URL, same keys, same database, same auth users,
same Edge Functions, same Edge Function secrets. There is no data migration and
no dump to restore.

Supabase's own prerequisites, which have to be true before the button works:

- Owner of the source organization (CollectiveAi).
- At least a member of the target organization (Moments to Media).
- **No active GitHub integration connection on the project.** Disconnect it
  first if one exists, reconnect after.
- No project-scoped roles and no log drains. Neither applies here.

Two things to decide while doing it:

- The CollectiveAi org is on the **Free plan**. Free projects pause after a
  week of inactivity and keep only seven days of backups. That is fine for a
  proof and wrong for a pilot holding a client's footage. Upgrading the target
  organization to Pro *before* the transfer avoids a second migration and
  avoids the free-project-limit check.
- Transfers do not move regions. The project stays where it is.

## The R2 half has to be rebuilt

R2 has no account-to-account transfer, and no copy tool that crosses accounts
without pulling the bytes through something. Today that does not matter: the
only object is `mtm-smoke/.../smoke-1794829213.mov`, 20 MiB of random bytes
from the dress rehearsal, which is disposable.

What changes in Edge Function secrets afterwards:

| Secret | Changes? |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | No — they travel with the project |
| `R2_BUCKET` | No — same bucket name in the new account |
| `R2_ACCOUNT_ID` | **Yes** — the new account's id |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | **Yes** — a new token in the new account |

## The order, and why

1. **Moments to Media creates a Cloudflare account and a Supabase account.**
   Identities and payment methods; nobody else can do this step.
2. **Create the "Moments to Media" Supabase organization**, add whoever needs
   access, and put it on Pro if the pilot is close.
3. **Check for a GitHub integration** on the project and disconnect it if
   present. This is the prerequisite most likely to block the transfer.
4. **Transfer the project** from the project's General settings.
5. **In the new Cloudflare account:** enable R2, create the bucket
   `moments-to-media-footage` with location hint `ENAM` to match, and
   immediately add the **lifecycle rule** aborting incomplete multipart uploads
   after 7 days. It was missing on the old bucket and the 50 GB run needs it.
6. **Create an R2 API token** from the R2 Overview page: Object Read & Write,
   scoped to that bucket only. Account API token, not User — a User token dies
   when the person who made it leaves.
7. **Update the three R2 secrets** on the Edge Functions.
8. **Verify before trusting it:** `python3 scripts/r2_check.py` with the new
   credentials exported, then the 20 MiB `scripts/upload_smoke.py` end to end.
   A green smoke test is the proof the cutover worked.
9. **Only then** delete the old bucket, revoke the old token, and remove the
   CollectiveAi Cloudflare account's access.
10. **Transfer the GitHub repository** to the Moments to Media organization and
    update the remote. Independent of the above; do it whenever.

Step 8 before step 9 is the point of the ordering. Nothing in the old account
gets deleted until the new one has been shown to work.

## Afterwards

- One `completed` row in `public.uploads` points at a `storage_key` in the old
  bucket. After the cutover that object no longer exists. Fail the row so the
  record does not claim footage that is gone.
- `docs/foundation-review.md` and `docs/upload-proof.md` both record the
  ownership gap as open. Close them out here.
