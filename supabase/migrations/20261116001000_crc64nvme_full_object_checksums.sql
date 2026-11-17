-- Full-object CRC-64/NVME, because R2 cannot do per-part SHA-256.
--
-- The pipeline was built to declare a composite SHA-256 checksum: the digest
-- of the concatenated part digests, with the part count suffixed. That shape
-- requires R2 to store a SHA-256 for every part, and R2 does not. Asked for
-- one on UploadPart it answers:
--
--   501 NotImplemented
--   Header 'x-amz-checksum-sha256' with value '...' not implemented
--
-- verified against the live bucket on 2026-11-16. Without per-part checksums
-- CompleteMultipartUpload reports no checksum at all, so the verification
-- CLAUDE.md rule 7 rests on had nothing to compare and upload-complete failed
-- with "R2 did not report a checksum".
--
-- What R2 does implement for multipart objects is CRC-64/NVME with checksum
-- type FULL_OBJECT, added 2025-07-03. It is a better fit than the composite
-- scheme it replaces, for a reason beyond availability: a composite checksum
-- is only reproducible by a client that splits the file exactly as the
-- database planned, so re-planning the part size silently invalidates a
-- checksum the client already declared. A full-object checksum is the
-- checksum of the file and nothing else.
--
-- What changes, honestly stated: CRC-64/NVME is a checksum, not a
-- cryptographic hash. It detects corruption -- the failure that actually
-- happens to a 50 GB upload over a hotel connection -- but it is not
-- collision resistant, so it is not evidence against a deliberately crafted
-- substitution. Storing the client's own SHA-256 alongside it, for an
-- integrity audit that does not depend on R2, is left as a separate decision.

begin;

alter table public.uploads
  drop constraint if exists uploads_checksum_algorithm;

alter table public.uploads
  add constraint uploads_checksum_algorithm
    check (checksum_algorithm in ('sha256', 'crc32c', 'crc64nvme'));

alter table public.uploads
  alter column checksum_algorithm set default 'crc64nvme';

-- upload-complete has to hand R2 the declared full-object checksum and the
-- object's size on CompleteMultipartUpload, so the resume plan has to carry
-- both. Everything else about this function is unchanged.
create or replace function public.upload_resume_plan(p_upload uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads;
begin
  select * into v_upload from public.uploads where id = p_upload;

  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;

  if auth.uid() is not null
     and not app.owns_assignment(v_upload.assignment_id)
     and not app.is_owner(v_upload.org_id)
     and not app.can_see_event_money_and_footage(app.assignment_event(v_upload.assignment_id))
  then
    raise exception 'upload % does not belong to you', p_upload
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'upload_id', v_upload.id,
    'status', v_upload.status,
    'storage_key', v_upload.storage_key,
    'multipart_upload_id', v_upload.multipart_upload_id,
    'bytes', v_upload.bytes,
    'checksum', v_upload.checksum,
    'checksum_algorithm', v_upload.checksum_algorithm,
    'part_size_bytes', v_upload.part_size_bytes,
    'part_count', v_upload.part_count,
    'bytes_received', coalesce((select sum(up.bytes) from public.upload_parts up
                                 where up.upload_id = p_upload and up.etag is not null), 0),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('part_number', up.part_number,
                                                             'bytes', up.bytes)
                                          order by up.part_number)
                           from public.upload_parts up
                          where up.upload_id = p_upload and up.etag is null),
                        '[]'::jsonb),
    'landed', coalesce((select jsonb_agg(jsonb_build_object('part_number', up.part_number,
                                                            'etag', up.etag,
                                                            'checksum', up.checksum)
                                         order by up.part_number)
                          from public.upload_parts up
                         where up.upload_id = p_upload and up.etag is not null),
                       '[]'::jsonb));
end;
$$;

comment on function public.upload_resume_plan(uuid) is
  'What a client needs to resume an upload: which parts are missing, which have '
  'landed, and the size and full-object checksum declared before the first byte '
  'moved, which upload-complete hands to R2 on CompleteMultipartUpload.';

commit;
