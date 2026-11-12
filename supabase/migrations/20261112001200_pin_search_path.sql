-- Pin search_path on the four functions that still resolved through the
-- caller's.
--
-- Supabase's linter flagged these after the first hosted deploy, alongside the
-- anon grant that 20261112001100 closed. None of them is SECURITY DEFINER, so
-- this is hardening rather than a hole: a caller who can set `search_path`
-- could put their own `now()`, `lower()` or `btrim()` ahead of pg_catalog's
-- and have a BEFORE trigger write whatever it returned. `touch_updated_at`
-- runs on twenty-seven of the twenty-nine tables and
-- `normalise_invitation_identity` decides what an invitation matches on, so
-- neither is somewhere to leave that open.
--
-- Everything these four call is either in pg_catalog, which stays reachable
-- with an empty search_path, or already schema-qualified (`auth.uid()`), so
-- the bodies are unchanged — they were copied from their original migrations
-- with the SET clause added rather than retyped.
--
-- One cost worth naming: a function with a SET clause cannot be inlined, so
-- `app.miles_between` is now a real call per row inside
-- `app.within_travel_radius`. That runs over one contractor's home base at a
-- time, not over a table, so it is not worth trading a mutable search_path
-- for.
--
-- 01_schema_conventions now fails the build if any function in `app` or
-- `public` arrives without one.

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid();
$$;

create or replace function app.miles_between(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 3958.7613 * 2 * asin(sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
$$;

create or replace function app.normalise_invitation_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(nullif(btrim(coalesce(new.email, '')), ''));
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  return new;
end;
$$;

-- The grants these functions already had are preserved by `create or replace`;
-- nothing here widens them. app.current_user_id and app.miles_between stay
-- callable by authenticated because the policy helpers call them, and the two
-- trigger functions are only ever reached by their triggers.
