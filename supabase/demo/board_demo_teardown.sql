-- Removes everything board_demo.sql created, and nothing else.
--
-- The organization goes first: events, slots, assignments, memberships and the
-- rest all cascade from it. The fictional people are removed afterwards,
-- because events reference their producer with ON DELETE RESTRICT. They are
-- matched on the reserved .invalid domain, which no real account can have.
do $teardown$
declare
  v_org uuid;
begin
  select id into v_org from public.organizations where slug = 'mtm-demo';
  if v_org is not null then
    delete from public.organizations where id = v_org;
  end if;
  delete from auth.users where email like '%@demo.moments-to-media.invalid';
  raise notice 'demo data removed';
end;
$teardown$;
