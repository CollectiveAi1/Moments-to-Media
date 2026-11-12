-- Auth 1/3 — every authenticated person gets a profile row.
--
-- CLAUDE.md "Build order", Phase 1: passwordless sign-in, org membership,
-- role claims. PRD "Architecture and stack": sign-in is by SMS or email link,
-- so nothing in the sign-up path collects a name, and the rest of the schema
-- assumes public.profiles already holds one.

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- A name only arrives when an invite flow put one in the metadata.
  v_name := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  )), '');

  -- profiles.full_name is not null and non-empty, so fall back to something
  -- legible. The contractor overwrites it on their profile screen
  -- (PRD "Contractor app → Profile").
  if v_name is null then
    v_name := coalesce(
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      nullif(btrim(coalesce(new.phone, '')), ''),
      'New member'
    );
  end if;

  insert into public.profiles (user_id, full_name, email, phone)
  values (new.id, v_name, new.email, nullif(btrim(coalesce(new.phone, '')), ''))
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function app.handle_new_user() is
  'Creates the public.profiles row for a new auth user. Passwordless sign-in carries no name, so full_name falls back to the email local part or the phone number.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();
