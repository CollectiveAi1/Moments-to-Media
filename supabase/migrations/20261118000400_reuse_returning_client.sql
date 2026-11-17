-- A returning client signs a new proposal. Live QA found that signing always
-- made a new client record when the proposal was not tied to one, so the same
-- email ended up on two clients and their portal showed only the first. Now a
-- signer whose email is already a contact in the organization is matched to
-- that client: one client, one portal, every project in it.
create or replace function app.client_for_signer(p_org uuid, p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.client_id
  from public.client_contacts c
  where c.org_id = p_org and lower(c.email) = lower(p_email)
  order by (c.user_id is not null) desc, c.is_primary desc, c.created_at
  limit 1;
$$;

revoke all on function app.client_for_signer(uuid, text) from public;

create or replace function app.match_returning_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only at the moment of signing, and only when no client was chosen.
  if new.status = 'accepted' and old.status <> 'accepted' then
    return new;
  end if;
  if new.client_id is null and new.status in ('sent', 'viewed') and old.status = 'draft' then
    new.client_id := app.client_for_signer(new.org_id, new.client_email);
  end if;
  return new;
end;
$$;

-- Sending is the last moment the proposal can change, so the match is made
-- then; accept_proposal already uses proposals.client_id when it is set.
create trigger proposals_match_returning_client
  before update of status on public.proposals
  for each row execute function app.match_returning_client();
