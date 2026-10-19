create table public.agents (
  organization_id uuid not null,
  user_id uuid,
  id uuid default gen_random_uuid() not null,
  name text not null,
  picture text,
  -- Access control, and only that. AI personas ("presupuestador
  -- metalúrgico", "Recopiladora de datos") are not roles; they stay in
  -- `extra`, where they belong next to the prompt.
  role public.role default 'member'::public.role not null,
  -- An agent with no `user_id` is nobody's membership — an AI agent: that is
  -- what agent-client runs, and what every access helper skips.
  --
  -- The one row shape that could lie is a person whose auth user was erased:
  -- user_id goes null, the agent survives, and it starts looking like an AI
  -- agent. Harmless in practice (agent-client needs a model and instructions
  -- to do anything), and the cure is upstream — an owner cannot erase their
  -- user at all (prevent_owner_user_deletion), and a member who leaves is
  -- marked deleted_at, which is the other half of the test.
  extra jsonb,
  -- Set by prevent_last_owner_deletion, which cancels the DELETE and marks the
  -- row instead: an agent outlives their membership, because messages name
  -- them as author and local rosters name them in the conversation ADDRESS
  -- itself. Every access helper (04-01, 04-02) skips a marked agent, so this
  -- revokes exactly what a delete would. Members cannot clear it —
  -- preserve_agent_deletion.
  deleted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- TOTAL, not partial on deleted_at: one row per person per organization,
-- forever. A former member keeps their user_id, so re-adding them has to find
-- that row and revive it — which is what accept_invitation's ON CONFLICT does,
-- and it can only conflict against an index that still contains the marked
-- row. Minting a second agent instead would strand their message authorship
-- and every local DM keyed on the old id.
--
-- Nulls do not collide in Postgres, so AI agents (no user_id) are unaffected.
create unique index agents_organization_id_user_id_key
on public.agents
using btree (organization_id, user_id);

-- Same purpose as the equivalent on conversations: a target for child tables
-- that must pin an agent AND its organization in one reference, so a row can
-- never name an agent from another tenant.
alter table only public.agents
add constraint agents_organization_id_id_key
unique (organization_id, id);

alter table only public.agents
add constraint agents_pkey
primary key (id);

alter table only public.agents
add constraint agents_organization_id_fkey
foreign key (organization_id)
references public.organizations(id)
on delete cascade;

-- `set null`, not `cascade`: erasing the auth user must not erase the agent.
-- The person goes; the agent row stays, unclaimed, so message authorship and
-- the rosters that name them in a conversation address remain intact. A
-- cascade could not complete anyway, since deleting an agent row is cancelled
-- in favour of marking it.
alter table only public.agents
add constraint agents_user_id_fkey
foreign key (user_id)
references auth.users(id)
on delete set null;

-- Declared here (not in 03-01) because agents is created after
-- organizations_addresses. `restrict`: deleting a connected account is an
-- API-side operation (revoke tokens etc.), not just a row delete — so an
-- agent cannot be removed while it still owns addresses. Offboarding deletes
-- the address first (cascading its data: if the account's owner goes away,
-- its messages do too), then the agent.
alter table only public.organizations_addresses
add constraint organizations_addresses_agent_id_fkey
foreign key (agent_id)
references public.agents(id)
on delete restrict;

create index agents_user_id_idx
on public.agents
using btree (user_id);

-- `z_` so it sorts after prevent_last_owner_deletion_before_delete: the guard
-- must get its chance to raise before the delete turns into a mark.
create trigger z_mark_deleted
before delete
on public.agents
for each row
execute function public.mark_agent_deleted();

create trigger preserve_deletion
before update
on public.agents
for each row
execute function public.preserve_agent_deletion();

create trigger set_extra
before update
on public.agents
for each row
when (
  new.extra is not null
)
execute function public.merge_update('extra');

create trigger set_updated_at
before update
on public.agents
for each row
execute function public.moddatetime('updated_at');

-- `user_id is not null`: an owner is a person, and having an auth identity
-- is what makes one — it holds even for an AI agent that somehow carries the
-- owner role.
--
-- `old.deleted_at is null` on the update guard: a marked agent is already not
-- an owner as far as every access helper is concerned, so reviving one at a
-- lower role is not a demotion the last-owner rule has any business refusing.
create trigger prevent_last_owner_deletion_before_update
before update
on public.agents
for each row
when (
  old.user_id is not null
  and old.deleted_at is null
  and old.role = 'owner'
  and new.role <> 'owner'
)
execute function public.prevent_last_owner_deletion();

create trigger prevent_last_owner_deletion_before_delete
before delete
on public.agents
for each row
when (
  old.user_id is not null
  and old.role = 'owner'
)
execute function public.prevent_last_owner_deletion();
