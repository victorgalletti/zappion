-- The welcome message becomes the agent's, like the response delay before it.
--
-- DML only (db diff emits schema): copy each organization's message onto its
-- AI agents — an agent with no user_id, not retired — and drop the key.
--
-- This loses the welcome message for organizations that have no AI agent at
-- all: 2 of the 6 that were still sending one. That is the cost of the
-- setting being the agent's, and it is deliberate.
--
-- User triggers off: extra is merge_update'd, so `- 'key'` would be merged
-- straight back, and every webhook subscriber would hear about a change no
-- consumer asked for.
alter table public.organizations disable trigger user;
alter table public.agents disable trigger user;

update public.agents a
set extra = coalesce(a.extra, '{}'::jsonb)
  || jsonb_build_object('welcome_message', o.extra->>'welcome_message')
from public.organizations o
where o.id = a.organization_id
  and a.user_id is null
  and a.deleted_at is null
  and coalesce(o.extra->>'welcome_message', '') <> '';

update public.organizations
set extra = extra - 'welcome_message'
where extra ? 'welcome_message';

alter table public.agents enable trigger user;
alter table public.organizations enable trigger user;
