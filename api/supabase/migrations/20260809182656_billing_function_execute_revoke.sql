-- Hand-written: migra does not diff function privileges, so `db diff` cannot
-- produce this. Mirrors supabase/schemas/06_billing/06-40_grants.sql.
--
-- Postgres grants EXECUTE on a new function to PUBLIC, which anon and
-- authenticated inherit, and the billing schema is exposed to PostgREST for the
-- UI's reads. That put every billing function behind /rest/v1/rpc/<name> for
-- any signed-in user: change_plan sets a tier and grants balance products,
-- update_usage takes a negative quantity.
--
-- Nothing legitimate uses that grant. A trigger checks EXECUTE when it is
-- created, not when it fires, so the check_/update_ trigger functions keep
-- working for inserts by any role; the RPC callers (agent-client and
-- media-preprocessor call check_limit) hold service_role.
--
-- `on all functions in schema` covers only what exists now, so a later
-- migration that adds a billing function repeats this revoke.
revoke execute on all functions in schema billing from public;

grant execute on all functions in schema billing to service_role;
