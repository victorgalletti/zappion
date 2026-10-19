-- SPDX-License-Identifier: AGPL-3.0-only
alter table public.conversation_preferences enable row level security;

-- Your own rows only, on conversations you can see (same rule as the
-- conversations SELECT policy, 05-03).
create policy "members manage their own conversation preferences"
on public.conversation_preferences
for all
to authenticated
using (
  agent_id in (select public.get_own_agents())
)
with check (
  agent_id in (select public.get_own_agents())
  and organization_id in (select public.get_authorized_orgs('member'))
  and exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and c.organization_id = conversation_preferences.organization_id
  )
);
