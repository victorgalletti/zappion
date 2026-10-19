-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: one row per MCP tool call, for admins to audit and for the per-key
-- send limits, which count rows here so they hold across stateless edge
-- invocations. Written only by the zappion_mcp_* functions (04-93).
create table public.mcp_calls (
  id uuid default gen_random_uuid() not null,
  organization_id uuid not null,
  -- The key that made the call, or the signed-in user for an OAuth session.
  api_key_id uuid,
  user_id uuid,
  tool text not null,
  contact_phone text,
  -- Set on sends: 'message' or 'template'. What the limits count.
  send_kind text,
  -- pending → ok | error; denied and rate_limited never ran.
  status text default 'pending' not null,
  error text,
  created_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  constraint mcp_calls_send_kind_check check (send_kind in ('message', 'template')),
  constraint mcp_calls_status_check check (
    status in ('pending', 'ok', 'error', 'denied', 'rate_limited')
  )
);

alter table only public.mcp_calls
add constraint mcp_calls_pkey
primary key (id);

alter table only public.mcp_calls
add constraint mcp_calls_organization_id_fkey
foreign key (organization_id)
references public.organizations(id)
on delete cascade;

alter table only public.mcp_calls
add constraint mcp_calls_api_key_id_fkey
foreign key (api_key_id)
references public.api_keys(id)
on delete set null;

alter table only public.mcp_calls
add constraint mcp_calls_user_id_fkey
foreign key (user_id)
references auth.users(id)
on delete set null;

create index mcp_calls_organization_created_idx
on public.mcp_calls
using btree (organization_id, created_at desc);

-- The limiter's window: a key's sends in the last hour.
create index mcp_calls_key_sends_idx
on public.mcp_calls
using btree (api_key_id, created_at)
where send_kind is not null;
