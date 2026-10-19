drop policy "admins can update their orgs agents" on "public"."agents";

drop policy "members can update themselves" on "public"."agents";

drop policy "owners can update their orgs agents" on "public"."agents";

drop function if exists "public"."agent_identity_and_role_unchanged"(p_id uuid, p_user_id uuid, p_organization_id uuid, p_ai boolean, p_role public.role);

drop function if exists "public"."agent_identity_unchanged"(p_id uuid, p_user_id uuid, p_organization_id uuid, p_ai boolean);

alter table "public"."agents" drop column "ai";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.agent_identity_and_role_unchanged(p_id uuid, p_user_id uuid, p_organization_id uuid, p_role public.role)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return exists (
    select 1 from public.agents
    where id = p_id
      and user_id is not distinct from p_user_id
      and organization_id = p_organization_id
      and role = p_role
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.agent_identity_unchanged(p_id uuid, p_user_id uuid, p_organization_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return exists (
    select 1 from public.agents
    where id = p_id
      and user_id is not distinct from p_user_id
      and organization_id = p_organization_id
  );
end;
$function$
;

  create policy "admins can update their orgs agents"
  on "public"."agents"
  as permissive
  for update
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)))
with check (((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)) AND public.agent_identity_and_role_unchanged(id, user_id, organization_id, role)));

  create policy "members can update themselves"
  on "public"."agents"
  as permissive
  for update
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check (((user_id = ( SELECT auth.uid() AS uid)) AND public.agent_identity_and_role_unchanged(id, user_id, organization_id, role)));

  create policy "owners can update their orgs agents"
  on "public"."agents"
  as permissive
  for update
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs)))
with check (((organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs)) AND public.agent_identity_unchanged(id, user_id, organization_id)));

-- DML (hand-written; db diff emits schema only).
--
-- Settings that were always per-agent but lived on the organization. The
-- welcome message and media preprocessing stay where they are — both fire
-- without any AI agent involved — but the response delay is the agent's own
-- debounce, and default_agent_id is gone: selection is "the oldest active AI
-- agent in the organization", full stop.
--
-- User triggers off: these updates would otherwise merge (extra is
-- merge_update'd, so `- 'key'` would be undone) and notify every webhook
-- subscriber for a change no consumer asked for.
alter table public.organizations disable trigger user;
alter table public.conversations disable trigger user;
alter table public.agents disable trigger user;

update public.agents a
set extra = coalesce(a.extra, '{}'::jsonb)
  || jsonb_build_object(
       'response_delay_seconds',
       (o.extra->>'response_delay_seconds')::numeric
     )
from public.organizations o
where o.id = a.organization_id
  and a.user_id is null
  and a.deleted_at is null
  and o.extra->>'response_delay_seconds' is not null;

update public.organizations
set extra = extra
  - 'response_delay_seconds'
  - 'authorized_contacts_only'
  - 'default_agent_id'
  - 'default_agent_id_by_contact_group'
where extra ?| array[
  'response_delay_seconds',
  'authorized_contacts_only',
  'default_agent_id',
  'default_agent_id_by_contact_group'
];

update public.conversations
set extra = extra - 'default_agent_id'
where extra ? 'default_agent_id';

alter table public.agents enable trigger user;
alter table public.conversations enable trigger user;
alter table public.organizations enable trigger user;
