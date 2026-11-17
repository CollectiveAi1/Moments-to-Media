-- Failed sign-in throttle, on top of Supabase Auth's own per-IP rate limit.
--
-- Five wrong passwords for one email from one IP address in 15 minutes pause
-- that pair for 15 minutes. The key is the pair, never the email alone, so
-- nobody can lock a real person out by guessing at their address from
-- elsewhere. Emails and IPs are stored only as SHA-256 hashes, and rows older
-- than a day are swept on every write.

create table public.login_attempts (
  id         bigint generated always as identity primary key,
  key_hash   text not null,
  failed_at  timestamptz not null default now()
);

create index login_attempts_key_idx on public.login_attempts (key_hash, failed_at desc);

alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;
-- No policies: only the functions below (security definer) touch it.

create or replace function app.login_key(p_email text, p_ip text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(lower(btrim(coalesce(p_email, ''))) || '|' || coalesce(p_ip, ''), 'sha256'), 'hex');
$$;

-- Seconds until this email and IP may try again; 0 when allowed.
create or replace function public.login_wait_seconds(p_email text, p_ip text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) >= 5
              then greatest(1, ceil(extract(epoch from (min(a.failed_at) + interval '15 minutes' - now())))::integer)
              else 0 end
  from (select failed_at from public.login_attempts
        where key_hash = app.login_key(p_email, p_ip) and failed_at > now() - interval '15 minutes'
        order by failed_at desc limit 5) a;
$$;

create or replace function public.record_login_failure(p_email text, p_ip text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.login_attempts where failed_at < now() - interval '1 day';
  insert into public.login_attempts (key_hash) values (app.login_key(p_email, p_ip));
  return public.login_wait_seconds(p_email, p_ip);
end;
$$;

create or replace function public.clear_login_failures(p_email text, p_ip text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.login_attempts where key_hash = app.login_key(p_email, p_ip);
$$;

revoke all on function public.login_wait_seconds(text, text), public.record_login_failure(text, text), public.clear_login_failures(text, text) from public;
grant execute on function public.login_wait_seconds(text, text), public.record_login_failure(text, text) to anon, authenticated;
-- Clearing needs a signed-in caller, so only a real successful sign-in resets the count.
grant execute on function public.clear_login_failures(text, text) to authenticated;
