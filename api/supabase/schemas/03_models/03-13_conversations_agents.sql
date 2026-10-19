-- Who is in a conversation. Two sources, by service:
--
--   mirror services  Membership of the container on the external service
--                    (Slack channel members) intersected with org members who
--                    connected it. Maintained by the service's webhook and
--                    management functions with the service role.
--
--   local            Zappion's own chat, where membership is the product:
--                    the creator is recorded by a trigger, and members add,
--                    join and leave through RLS (05-12).
--
-- Where a conversation is visible org-wide anyway (a shared inbox), a row
-- here is not what grants that — it just carries the member's own state for
-- the conversation in `extra`. Either way the split above is the one 05-12
-- enforces: members write this table on `local`, and read it everywhere.
create table public.conversations_agents (
  organization_id uuid not null,
  -- The account this row stems from: on a mirror service the member's personal
  -- one (their Slack identity T…:U…), NOT the shared anchor the conversation
  -- hangs off; on `local`, the org's single local address, which is the only
  -- one there is. Cascade makes "disconnect = delete the address row" drop
  -- this connection's visibility, and nothing from other services.
  --
  -- Always the conversation's own — a Slack membership stems from a Slack
  -- identity — so it is redundant in principle and required in practice:
  -- organizations_addresses is keyed on it, and the reference below cannot pin
  -- the account without it. Writer-stated, like every other column: a wrong
  -- value fails the account FK, because the services that populate this table
  -- give their addresses disjoint formats (`local` addresses are org uuids,
  -- Slack's are `T…:U…`), so no address string exists under more than one.
  service public.service not null,
  organization_address text not null,
  conversation_id uuid not null,
  agent_id uuid not null,
  -- Per-member state about the conversation: muted, last_read_ts. Members
  -- write it on `local` (05-12); on a mirror service the row is the sync's,
  -- and so is this. NOT UI preferences (archived, pinned, drafts), which have
  -- to be settable on any conversation you can see.
  extra jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table only public.conversations_agents
add constraint conversations_agents_pkey
primary key (conversation_id, agent_id);

alter table only public.conversations_agents
add constraint conversations_agents_organization_id_fkey
foreign key (organization_id)
references public.organizations(id)
on delete cascade;

alter table only public.conversations_agents
add constraint conversations_agents_organization_address_fkey
foreign key (organization_id, service, organization_address)
references public.organizations_addresses(organization_id, service, address)
on delete cascade;

-- Both references carry organization_id, so the tenant cannot disagree with
-- itself. Members write this table (05-12), and organization_id is theirs to
-- state; single-column references would leave it free to name ANOTHER
-- organization while conversation_id names ours — the pair FK above only
-- checks its two columns against each other — and would let a local group
-- accept an agent from another organization. Cross-tenant writes, and the
-- first would invert the cascade: a stranger's address row could then delete
-- our membership.
alter table only public.conversations_agents
add constraint conversations_agents_conversation_id_fkey
foreign key (organization_id, conversation_id)
references public.conversations(organization_id, id)
on delete cascade;

alter table only public.conversations_agents
add constraint conversations_agents_agent_id_fkey
foreign key (organization_id, agent_id)
references public.agents(organization_id, id)
on delete cascade;

-- Default privileges for postgres-created tables only grant
-- truncate/references/trigger to the API roles, so new tables need explicit
-- grants. service_role writes memberships (webhook/management functions);
-- members only read (RLS narrows rows to their own).
grant select, insert, update, delete on table public.conversations_agents to service_role;
-- Writes are granted at table level and narrowed by 05-12; anon (the API-key
-- path) gets nothing here, since every write policy means "my own row" or
-- "a local room I am in", and an API key is nobody.
grant select, insert, update, delete on table public.conversations_agents to authenticated;

create index conversations_agents_agent_id_idx
on public.conversations_agents
using btree (agent_id);

create index conversations_agents_organization_id_idx
on public.conversations_agents
using btree (organization_id);

-- Supports the on-delete-cascade lookup from organizations_addresses.
create index conversations_agents_organization_address_idx
on public.conversations_agents
using btree (organization_id, service, organization_address);

create trigger set_extra
before update
on public.conversations_agents
for each row
when (
  new.extra is not null
)
execute function public.merge_update('extra');

create trigger set_updated_at
before update
on public.conversations_agents
for each row
execute function public.moddatetime('updated_at');
