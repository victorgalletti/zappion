-- Ahead of the function drops below: db diff emitted this last, but the
-- trigger depends on lookup_agents_by_email_after_insert_on_auth_users and
-- Postgres refuses to drop a function still wired to one.
drop trigger if exists "handle_new_auth_user" on "auth"."users";

drop trigger if exists "handle_new_invitation" on "public"."agents";

drop trigger if exists "z_enforce_invitation_status_flow" on "public"."agents";

drop trigger if exists "prevent_last_owner_deletion_before_delete" on "public"."agents";

drop trigger if exists "prevent_last_owner_deletion_before_update" on "public"."agents";

drop policy "admins can create their orgs ai agents" on "public"."agents";

drop policy "admins can manage their orgs ai agents" on "public"."agents";

drop policy "members can read themselves" on "public"."agents";

drop policy "owners can send invitations" on "public"."agents";

drop policy "members can update themselves" on "public"."agents";

drop policy "owners can update their orgs agents" on "public"."agents";

drop function if exists "public"."agent_update_by_owner_rules"(p_id uuid, p_user_id uuid, p_organization_id uuid, p_ai boolean, p_extra jsonb);

drop function if exists "public"."enforce_invitation_status_flow"();

drop function if exists "public"."lookup_agents_by_email_after_insert_on_auth_users"();

drop function if exists "public"."lookup_user_id_by_email_before_insert_on_agents"();

drop function if exists "public"."member_self_update_rules"(p_id uuid, p_user_id uuid, p_organization_id uuid, p_ai boolean, p_extra jsonb);

drop index if exists "public"."agents_organization_id_user_id_key";


  create table "public"."invitations" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "email" text not null,
    "role" public.role not null default 'member'::public.role,
    "status" text not null default 'pending'::text,
    "invited_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."invitations" enable row level security;

alter table "public"."agents" add column "role" public.role not null default 'member'::public.role;

alter table "public"."agents" alter column "ai" set default false;

CREATE INDEX invitations_email_idx ON public.invitations USING btree (lower(email)) WHERE (status = 'pending'::text);

CREATE UNIQUE INDEX invitations_pending_email_key ON public.invitations USING btree (organization_id, lower(email)) WHERE (status = 'pending'::text);

CREATE UNIQUE INDEX invitations_pkey ON public.invitations USING btree (id);

alter table "public"."invitations" add constraint "invitations_pkey" PRIMARY KEY using index "invitations_pkey";

alter table "public"."invitations" add constraint "invitations_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES public.agents(id) ON DELETE SET NULL not valid;

alter table "public"."invitations" validate constraint "invitations_invited_by_fkey";

alter table "public"."invitations" add constraint "invitations_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."invitations" validate constraint "invitations_organization_id_fkey";

alter table "public"."invitations" add constraint "invitations_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'revoked'::text]))) not valid;

alter table "public"."invitations" validate constraint "invitations_status_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.accept_invitation(invitation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  claims jsonb := auth.jwt();
  caller uuid := auth.uid();
  caller_email text := claims->>'email';
  inv public.invitations;
  agent_id uuid;
begin
  if caller is null or caller_email is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  -- `for update` so two clicks on the same link cannot both pass the pending
  -- test and race to insert.
  select * into inv
  from public.invitations
  where id = invitation_id
    and status = 'pending'
    and lower(email) = lower(caller_email)
  for update;

  if not found then
    raise exception 'no pending invitation for this account'
      using errcode = '42501';
  end if;

  -- Revive a former member rather than mint a second agent: the agent id is
  -- named by message authorship and by the ADDRESS of every local direct and
  -- multiple they were in, so a new id would strand both — the old DM would
  -- have no live participant and a new one would appear beside it. This is
  -- also why the unique index on (organization_id, user_id) is total rather
  -- than partial on deleted_at: it has to see the marked row to conflict with
  -- it.
  --
  -- SECURITY DEFINER carries this past preserve_agent_deletion, which pins
  -- deleted_at for every role but the owner's — clearing it is exactly the
  -- privilege being exercised here, and only here.
  insert into public.agents (organization_id, user_id, name, role)
  values (
    inv.organization_id,
    caller,
    coalesce(claims->'user_metadata'->>'full_name', caller_email),
    inv.role
  )
  on conflict (organization_id, user_id) do update
    set deleted_at = null,
        -- The invitation decides the role of someone coming back, so a
        -- re-added owner does not silently return as one. An agent who never
        -- left keeps theirs: an invitation must not be a side channel for
        -- demoting a sitting member.
        role = case
          when public.agents.deleted_at is not null then excluded.role
          else public.agents.role
        end
  returning id into agent_id;

  update public.invitations
  set status = 'accepted'
  where id = inv.id;

  return agent_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.agent_identity_and_role_unchanged(p_id uuid, p_user_id uuid, p_organization_id uuid, p_ai boolean, p_role public.role)
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
      and ai = p_ai
      and role = p_role
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.agent_identity_unchanged(p_id uuid, p_user_id uuid, p_organization_id uuid, p_ai boolean)
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
      and ai = p_ai
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_owner_user_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  owned int;
begin
  select count(*) into owned
  from public.agents
  where user_id = old.id
    and role = 'owner'
    and deleted_at is null;

  if owned > 0 then
    raise exception 'Cannot delete a user who still owns % organization(s)', owned
      using hint = 'transfer ownership, leave, or delete the organization first';
  end if;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_invitation(invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_email text := auth.jwt()->>'email';
begin
  if caller_email is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  update public.invitations
  set status = 'rejected'
  where id = invitation_id
    and status = 'pending'
    and lower(email) = lower(caller_email);

  if not found then
    raise exception 'no pending invitation for this account'
      using errcode = '42501';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.after_insert_on_organizations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  user_id uuid := auth.uid();
  user_name text;
begin
  insert into public.organizations_addresses (organization_id, service, address)
    values (new.id, 'local', new.id::text);

  if user_id is not null then
    select coalesce(raw_user_meta_data->>'full_name', email, '?') into user_name
    from auth.users
    where id = user_id;

    insert into public.agents (organization_id, user_id, name, role)
    values (new.id, user_id, user_name, 'owner');
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_authorized_orgs(role public.role DEFAULT 'member'::public.role)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  req_level int;
  api_key text;
  org_id uuid;
begin
  req_level := case role::text
    when 'owner' then 3
    when 'admin' then 2
    else 1 -- 'member'
  end;

  -- First, try JWT authentication via auth.uid()
  if auth.uid() is not null then
    -- Aliased because the parameter is also called `role`: a bare `role` here
    -- would resolve to it, and every caller would come back an owner.
    --
    -- No invitation clause: an agents row is a member, full stop. It used to
    -- also have to exclude rows whose invitation was still pending, and every
    -- helper that forgot to was a hole. Invitations are their own table now.
    return query select a.organization_id from public.agents a
    where
      a.user_id = auth.uid()
    -- A deleted agent is a former member: this is what makes marking the row
    -- revoke access rather than merely rename it.
    and a.deleted_at is null
    and (
      case a.role
        when 'owner' then 3
        when 'admin' then 2
        else 1 -- 'member'
      end
    ) >= req_level;

    -- Authenticated but lacking the requested role: return the empty set so RLS
    -- subqueries can fall through to other OR-combined policies (e.g. a member
    -- editing themselves while an owner-only policy is also evaluated).
    -- Raising here would short-circuit the whole RLS evaluation.
    -- raise exception using
    --   errcode = '42501',
    --   message = format('insufficient permissions, %s role required', role::text);
    return;
  end if;

  -- Fallback to API key authentication
  api_key := current_setting('request.headers', true)::json->>'api-key';

  if api_key is not null then
    select a.organization_id into org_id
    from public.api_keys a
    where a.key = api_key
    and (
      case (a.role::text)
        when 'owner' then 3
        when 'admin' then 2
        else 1 -- 'member'
      end
    ) >= req_level;

    if org_id is not null then
      return next org_id;
    end if;
    -- Same reasoning as the JWT branch: invalid key or insufficient role returns
    -- the empty set, not a raise. Validate api-key existence at the request edge
    -- (e.g. a pre-request hook) if you want loud failure for missing/invalid keys.
    -- raise exception using
    --   errcode = '42501',
    --   message = format('invalid api key or insufficient permissions, %s role required', role::text);
    return;
  end if;

  raise exception using
    errcode = '42501',
    message = 'authentication required',
    hint = 'use api-key header or jwt authentication';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_last_owner_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  owner_count int;
begin
  -- Skip check if org is being deleted (cascade delete)
  if not exists (
    select 1 from public.organizations
    where id = old.organization_id
    for update skip locked
  ) then
    return old;
  end if;

  if old.role = 'owner' then
    -- No invitation clause any more: an agents row IS a member now, so there
    -- is no such thing as an owner who has not replied yet. `user_id is not
    -- null` stands in for the old `ai = false` — an owner is a person.
    select count(*) into owner_count
    from public.agents
    where organization_id = old.organization_id
      and role = 'owner'
      and user_id is not null
      and deleted_at is null
      and id <> old.id;

    if owner_count = 0 then
      raise exception 'Cannot delete the last owner of an organization';
    end if;
  end if;

  return old;
end;
$function$
;

grant delete on table "public"."invitations" to "anon";

grant insert on table "public"."invitations" to "anon";

grant references on table "public"."invitations" to "anon";

grant select on table "public"."invitations" to "anon";

grant trigger on table "public"."invitations" to "anon";

grant truncate on table "public"."invitations" to "anon";

grant update on table "public"."invitations" to "anon";

grant delete on table "public"."invitations" to "authenticated";

grant insert on table "public"."invitations" to "authenticated";

grant references on table "public"."invitations" to "authenticated";

grant select on table "public"."invitations" to "authenticated";

grant trigger on table "public"."invitations" to "authenticated";

grant truncate on table "public"."invitations" to "authenticated";

grant update on table "public"."invitations" to "authenticated";

grant delete on table "public"."invitations" to "service_role";

grant insert on table "public"."invitations" to "service_role";

grant references on table "public"."invitations" to "service_role";

grant select on table "public"."invitations" to "service_role";

grant trigger on table "public"."invitations" to "service_role";

grant truncate on table "public"."invitations" to "service_role";

grant update on table "public"."invitations" to "service_role";


  create policy "admins can update their orgs agents"
  on "public"."agents"
  as permissive
  for update
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)))
with check (public.agent_identity_and_role_unchanged(id, user_id, organization_id, ai, role));



  create policy "owners can create their orgs agents"
  on "public"."agents"
  as permissive
  for insert
  to authenticated, anon
with check (((organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs)) AND (user_id IS NULL)));



  create policy "invitees can read their own invitations"
  on "public"."invitations"
  as permissive
  for select
  to authenticated
using (((status = 'pending'::text) AND (lower(email) = lower(( SELECT (auth.jwt() ->> 'email'::text))))));



  create policy "members can read their orgs invitations"
  on "public"."invitations"
  as permissive
  for select
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)));



  create policy "owners can manage their orgs invitations"
  on "public"."invitations"
  as permissive
  for all
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs)))
with check ((organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs)));



  create policy "members can update themselves"
  on "public"."agents"
  as permissive
  for update
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check (public.agent_identity_and_role_unchanged(id, user_id, organization_id, ai, role));



  create policy "owners can update their orgs agents"
  on "public"."agents"
  as permissive
  for update
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs)))
with check (public.agent_identity_unchanged(id, user_id, organization_id, ai));


CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

CREATE TRIGGER prevent_last_owner_deletion_before_delete BEFORE DELETE ON public.agents FOR EACH ROW WHEN (((old.user_id IS NOT NULL) AND (old.role = 'owner'::public.role))) EXECUTE FUNCTION public.prevent_last_owner_deletion();

CREATE TRIGGER prevent_last_owner_deletion_before_update BEFORE UPDATE ON public.agents FOR EACH ROW WHEN (((old.user_id IS NOT NULL) AND (old.deleted_at IS NULL) AND (old.role = 'owner'::public.role) AND (new.role <> 'owner'::public.role))) EXECUTE FUNCTION public.prevent_last_owner_deletion();

CREATE TRIGGER prevent_owner_user_deletion BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.prevent_owner_user_deletion();

-- ---------------------------------------------------------------------------
-- Data. Two things move out of agents.extra: the access-control role, into its
-- own typed column, and invitations, into their own table.
--
-- Triggers off for the duration. z_mark_deleted would turn the delete below
-- into a soft delete, preserve_agent_deletion and merge_update would fight the
-- direct assignments, and the last-owner guard would refuse a pending
-- invitation that happened to carry the owner role (four of them do).
-- ---------------------------------------------------------------------------

alter table public.agents disable trigger user;

-- Only the three enum values are roles. The same key holds a persona on AI
-- agents — "presupuestador metalúrgico", "Recopiladora de datos" — which is
-- not an access level and must not become one; those rows keep the column
-- default and their extra untouched.
update public.agents
set role = (extra->>'role')::public.role
where extra->>'role' in ('owner', 'admin', 'member');

-- Invitations become rows. The role the invitee was going to receive travels
-- with the invitation, since that is where it is decided now.
insert into public.invitations (
  organization_id, email, role, status, created_at, updated_at
)
select
  a.organization_id,
  a.extra->'invitation'->>'email',
  case
    when a.extra->>'role' in ('owner', 'admin', 'member')
      then (a.extra->>'role')::public.role
    else 'member'::public.role
  end,
  a.extra->'invitation'->>'status',
  a.created_at,
  a.updated_at
from public.agents a
where a.extra->'invitation'->>'email' is not null
  and a.extra->'invitation'->>'status' in ('pending', 'accepted', 'rejected')
on conflict do nothing;

-- A pending invitation was never a member; its agents row existed only because
-- the old model had nowhere else to keep it. It has to go: get_authorized_orgs
-- no longer excludes unaccepted invitations, so leaving the row behind would
-- silently admit someone who never replied.
--
-- Accepted ones stay — those are members.
delete from public.agents
where extra->'invitation'->>'status' = 'pending';

update public.agents
set extra = extra - 'role'
where extra->>'role' in ('owner', 'admin', 'member');

update public.agents
set extra = extra - 'invitation'
where extra ? 'invitation';

alter table public.agents enable trigger user;

-- Created here rather than with the other indexes: it is TOTAL now (it was
-- partial on deleted_at), so it has to see the agents table after the pending
-- invitations above are gone.
CREATE UNIQUE INDEX agents_organization_id_user_id_key ON public.agents USING btree (organization_id, user_id);
