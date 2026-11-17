-- Removes what portal_demo.sql added (the demo client, their bookings and the
-- demo packages and inquiries), and signs out and disables every demo login.
begin;
create temp table d_clients on commit drop as
  select c.id from public.clients c join public.client_contacts cc on cc.client_id = c.id
  where cc.email = 'demo-client@demo.moments-to-media.invalid';
delete from public.client_payments where invoice_id in (select id from public.invoices where client_id in (select id from d_clients));
delete from public.proposals where client_email = 'demo-client@demo.moments-to-media.invalid';
delete from public.invoices where client_id in (select id from d_clients);
delete from public.client_messages where client_id in (select id from d_clients);
delete from public.events where client_id in (select id from d_clients);
delete from public.org_invitations where client_id in (select id from d_clients);
delete from public.clients where id in (select id from d_clients);
delete from public.leads where email in ('jordan@ellis.invalid', 'priya@demo-couple.invalid');
delete from public.packages where name in ('Full-day wedding film', 'Half-day event coverage', 'Drone aerials', 'Extra hour', 'Rush delivery')
  and org_id = (select id from public.organizations where slug = 'mtm-demo');
delete from public.memberships where user_id = (select id from auth.users where email = 'demo-client@demo.moments-to-media.invalid');
delete from auth.users where email = 'demo-client@demo.moments-to-media.invalid';
update auth.users set encrypted_password = '' where email in ('sam-park@demo.moments-to-media.invalid', 'maya-chen@demo.moments-to-media.invalid');
delete from auth.sessions where user_id in (select id from auth.users where email in ('sam-park@demo.moments-to-media.invalid', 'maya-chen@demo.moments-to-media.invalid'));
commit;
