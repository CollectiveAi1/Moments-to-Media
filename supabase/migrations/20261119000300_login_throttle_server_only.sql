-- Security audit M2 (2026-11-19): the sign-in throttle could be abused.
--
-- The throttle's functions were callable with the public key. Anyone could
-- record failures for another person's email and IP (a targeted lockout), and
-- any signed-in user could clear the count for any email while guessing
-- passwords through the form. They are now callable only by the service role,
-- which the app's sign-in action uses on the server
-- (apps/admin/lib/supabase/service.ts). Supabase Auth's own rate limits still
-- apply to every sign-in, including ones that skip the app's form.

revoke execute on function public.login_wait_seconds(text, text) from anon, authenticated;
revoke execute on function public.record_login_failure(text, text) from anon, authenticated;
revoke execute on function public.clear_login_failures(text, text) from authenticated;

grant execute on function public.login_wait_seconds(text, text) to service_role;
grant execute on function public.record_login_failure(text, text) to service_role;
grant execute on function public.clear_login_failures(text, text) to service_role;
