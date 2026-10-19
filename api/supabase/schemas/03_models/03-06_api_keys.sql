create table public.api_keys (
  id uuid default gen_random_uuid() not null,
  organization_id uuid not null,
  role public.role default 'member'::public.role not null,
  name text not null,
  -- Zappion: only the key's hash is kept (02-90), with its first characters so
  -- people can tell keys apart. The key itself is shown once, at creation
  -- (zappion_create_api_key, 04-93).
  key_hash text not null,
  key_prefix text not null,
  -- Zappion: what the key may do in the MCP server, its life and its limits.
  -- A revoked or expired key authorizes nothing (get_authorized_orgs, 04-01).
  scope public.zappion_api_key_scope default 'read' not null,
  -- Zappion: WhatsApp account addresses; null grants every number in the org.
  allowed_addresses text[],
  expires_at timestamp with time zone,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  -- Messages per rolling hour sent through the MCP, and the share of those
  -- that may be templates (Meta charges for templates).
  send_limit_per_hour integer default 60 not null,
  template_limit_per_hour integer default 10 not null,
  -- Zappion: a member approves every message the key sends before it goes
  -- out (zappion_hold_for_approval, 04-95).
  requires_approval boolean default false not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint api_keys_send_limit_check check (send_limit_per_hour > 0),
  constraint api_keys_template_limit_check check (template_limit_per_hour >= 0)
);

alter table only public.api_keys
add constraint api_keys_key_hash_key
unique (key_hash);

alter table only public.api_keys
add constraint api_keys_pkey
primary key (id);

alter table only public.api_keys
add constraint api_keys_organization_id_fkey
foreign key (organization_id)
references public.organizations(id)
on delete cascade;

alter table only public.api_keys
add constraint api_keys_created_by_fkey
foreign key (created_by)
references public.agents(id)
on delete set null;

create index api_keys_organization_idx
on public.api_keys
using btree (organization_id);

create trigger set_updated_at
before update
on public.api_keys
for each row
execute function public.moddatetime('updated_at');
