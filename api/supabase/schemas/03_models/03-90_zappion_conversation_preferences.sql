-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: per-member UI preferences about a conversation (archived now;
-- pinned/favorite later). Not conversations.extra, which members cannot write
-- on mirror services (05-03), and not conversations_agents, which is sync-owned
-- member state (03-13). Each member archives for themselves, as on WhatsApp.
create table public.conversation_preferences (
  agent_id uuid not null,
  conversation_id uuid not null,
  organization_id uuid not null,
  archived_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table only public.conversation_preferences
add constraint conversation_preferences_pkey
primary key (agent_id, conversation_id);

alter table only public.conversation_preferences
add constraint conversation_preferences_agent_id_fkey
foreign key (agent_id)
references public.agents(id)
on delete cascade;

alter table only public.conversation_preferences
add constraint conversation_preferences_conversation_id_fkey
foreign key (conversation_id)
references public.conversations(id)
on delete cascade;

alter table only public.conversation_preferences
add constraint conversation_preferences_organization_id_fkey
foreign key (organization_id)
references public.organizations(id)
on delete cascade;

create index conversation_preferences_conversation_id_idx
on public.conversation_preferences using btree (conversation_id);

create trigger set_updated_at
before update
on public.conversation_preferences
for each row
execute function public.moddatetime('updated_at');
