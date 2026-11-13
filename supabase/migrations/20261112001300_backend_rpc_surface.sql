-- The three backend-only upload calls, reachable from an Edge Function.
--
-- `config.toml` exposes only the `public` schema through PostgREST
-- (`[api] schemas = ["public"]`), which is deliberate: `app` holds the access
-- predicates and the transition internals and has no business being an API.
-- But the upload Edge Functions have to call `app.attach_multipart`,
-- `app.complete_upload` and `app.fail_upload`, and PostgREST cannot see them.
--
-- So each gets a thin wrapper in `public`. Three properties matter:
--
--   * They are SECURITY INVOKER — the default — on purpose. A definer wrapper
--     would carry postgres's rights into a function whose whole point is that
--     only the backend may call it, which is privilege for nothing. The
--     caller must hold the grant below and the `app` function's own execute
--     grant, both of which only service_role has.
--   * They are granted to service_role and to nobody else. 20261112001100
--     revoked the default privileges for functions in `public`, so these
--     arrive with no grants at all and get exactly the one stated here.
--   * Each pins `search_path`, as 20261112001200 requires of every function
--     in `app` and `public`. The bodies are schema-qualified, so an empty
--     one resolves everything it needs.
--   * 01_schema_conventions fails the build if a client role ever gains
--     execute on them. A contractor who could call complete_upload could
--     declare their own verification, which is the thing CLAUDE.md rule 7
--     exists to prevent.

create or replace function public.attach_multipart(
  p_upload              uuid,
  p_multipart_upload_id text
)
returns public.uploads
language sql
set search_path = ''
as $$
  select app.attach_multipart(p_upload, p_multipart_upload_id);
$$;

comment on function public.attach_multipart(uuid, text) is
  'Backend only. Records the multipart upload R2 opened and moves the upload to in_progress.';

create or replace function public.complete_upload(
  p_upload            uuid,
  p_verified_bytes    bigint,
  p_verified_checksum text
)
returns public.uploads
language sql
set search_path = ''
as $$
  select app.complete_upload(p_upload, p_verified_bytes, p_verified_checksum);
$$;

comment on function public.complete_upload(uuid, bigint, text) is
  'Backend only. Verifies the size and checksum R2 reported against what was declared, then completes the upload and queues connector copies.';

create or replace function public.fail_upload(
  p_upload uuid,
  p_reason text
)
returns public.uploads
language sql
set search_path = ''
as $$
  select app.fail_upload(p_upload, p_reason);
$$;

comment on function public.fail_upload(uuid, text) is
  'Backend only. Marks an upload failed with a reason: R2 refused, the multipart expired, or the completion did not verify.';

-- --------------------------------------------------------------- grants

revoke all on function public.attach_multipart(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_upload(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.fail_upload(uuid, text) from public, anon, authenticated;

grant execute on function public.attach_multipart(uuid, text) to service_role;
grant execute on function public.complete_upload(uuid, bigint, text) to service_role;
grant execute on function public.fail_upload(uuid, text) to service_role;
