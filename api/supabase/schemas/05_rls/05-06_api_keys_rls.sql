alter table public.api_keys enable row level security;

-- Note: Self-read check is merged here (not a separate policy) because
-- get_authorized_orgs raises an exception on insufficient permissions.
-- Separate policies would fail: even if self-read passes, the owner policy's
-- exception aborts the query. Using OR short-circuits: if key matches,
-- get_authorized_orgs is never called.
--
-- Zappion: the key is matched by its hash and only while it is live; admins
-- (not just owners) manage keys, and only signed-in people do: a key cannot
-- list or delete its siblings. Keys are created and revoked through
-- zappion_create_api_key / zappion_revoke_api_key (04-93), so there is no
-- insert or update policy.
create policy "admins can read their orgs api keys"
on public.api_keys
for select
to authenticated, anon
using (
  -- Subselect so the header is read once per query (an InitPlan) instead of
  -- once per row. It still evaluates before the OR's right side, so the
  -- short-circuit above holds.
  (
    key_hash = (
      select public.zappion_hash_api_key(
        current_setting('request.headers', true)::json->>'api-key'
      )
    )
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  )
  or (
    (select auth.uid()) is not null
    and organization_id in (
      select public.get_authorized_orgs('admin')
    )
  )
);

create policy "admins can delete their orgs api keys"
on public.api_keys
for delete
to authenticated
using (
  organization_id in (
    select public.get_authorized_orgs('admin')
  )
);
