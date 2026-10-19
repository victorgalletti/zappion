-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: admins read their org's MCP call log. Nobody writes it through the
-- API: the zappion_mcp_* functions (04-93) do, as security definer.
alter table public.mcp_calls enable row level security;

revoke insert, update, delete on table public.mcp_calls from anon, authenticated;

create policy "admins can read their orgs mcp calls"
on public.mcp_calls
for select
to authenticated
using (
  organization_id in (
    select public.get_authorized_orgs('admin')
  )
);
