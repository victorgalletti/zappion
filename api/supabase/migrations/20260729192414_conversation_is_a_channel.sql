-- The conversations policies and get_restricted_conversations() read `type`,
-- so it must exist before either is created.
alter table "public"."conversations" add column "type" text;

drop trigger if exists "set_extra" on "public"."conversations_system";

drop trigger if exists "set_updated_at" on "public"."conversations_system";

drop trigger if exists "pause_conversation_on_human_message" on "public"."messages";

drop trigger if exists "set_updated_at" on "public"."quick_replies";

drop policy "members can manage their orgs conversations" on "public"."conversations";

drop policy "members can read system facts of visible conversations" on "public"."conversations_system";

drop policy "admins can manage their orgs quick replies" on "public"."quick_replies";

drop policy "members can read their orgs quick replies" on "public"."quick_replies";

drop policy "members can create their orgs messages" on "public"."messages";

drop policy "members can read their orgs messages" on "public"."messages";

alter table "public"."agents" drop constraint "agents_organization_id_user_id_key";

alter table "public"."conversations_system" drop constraint "conversations_system_channel_type_check";

alter table "public"."conversations_system" drop constraint "conversations_system_conversation_id_fkey";

alter table "public"."conversations_system" drop constraint "conversations_system_organization_id_fkey";

alter table "public"."quick_replies" drop constraint "quick_replies_organization_id_fkey";

alter table "public"."agents" drop constraint "agents_user_id_fkey";

alter table "public"."conversations_agents" drop constraint "conversations_agents_agent_id_fkey";

alter table "public"."conversations_agents" drop constraint "conversations_agents_conversation_id_fkey";

drop function if exists "public"."get_private_conversations"();

drop function if exists "public"."is_conversation_visible"(conv_id uuid, conv_org uuid, conv_addr text, conv_service public.service);

drop function if exists "public"."pause_conversation_on_human_message"();

alter table "public"."conversations_system" drop constraint "conversations_system_pkey";

alter table "public"."quick_replies" drop constraint "quick_replies_pkey";

drop index if exists "public"."conversations_system_pkey";

drop index if exists "public"."conversations_system_private_idx";

drop index if exists "public"."quick_replies_organization_idx";

drop index if exists "public"."quick_replies_pkey";

drop index if exists "public"."agents_organization_id_user_id_key";

alter table "public"."agents" add column "deleted_at" timestamp with time zone;

CREATE UNIQUE INDEX agents_organization_id_id_key ON public.agents USING btree (organization_id, id);

CREATE UNIQUE INDEX conversations_organization_id_id_key ON public.conversations USING btree (organization_id, id);

CREATE UNIQUE INDEX agents_organization_id_user_id_key ON public.agents USING btree (organization_id, user_id) WHERE (deleted_at IS NULL);

alter table "public"."agents" add constraint "agents_organization_id_id_key" UNIQUE using index "agents_organization_id_id_key";

alter table "public"."conversations" add constraint "conversations_organization_id_id_key" UNIQUE using index "conversations_organization_id_id_key";

alter table "public"."agents" add constraint "agents_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."agents" validate constraint "agents_user_id_fkey";

alter table "public"."conversations_agents" add constraint "conversations_agents_agent_id_fkey" FOREIGN KEY (organization_id, agent_id) REFERENCES public.agents(organization_id, id) ON DELETE CASCADE not valid;

alter table "public"."conversations_agents" validate constraint "conversations_agents_agent_id_fkey";

alter table "public"."conversations_agents" add constraint "conversations_agents_conversation_id_fkey" FOREIGN KEY (organization_id, conversation_id) REFERENCES public.conversations(organization_id, id) ON DELETE CASCADE not valid;

alter table "public"."conversations_agents" validate constraint "conversations_agents_conversation_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.after_insert_on_local_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.conversations_agents (
    organization_id,
    organization_address,
    conversation_id,
    agent_id
  )
  select
    new.organization_id,
    new.organization_address,
    new.id,
    a.id
  from public.agents a
  where a.organization_id = new.organization_id
    and case
      when new.type in ('direct', 'multiple')
      then a.id::text = any (string_to_array(new.conversation_address, ':'))
      else a.user_id = auth.uid()
    end
  on conflict do nothing;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_own_agents()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.id from public.agents a
  where a.user_id = auth.uid() and a.deleted_at is null;
$function$
;

CREATE OR REPLACE FUNCTION public.get_restricted_conversations()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id
  from public.conversations c
  where c.organization_id in (select public.get_authorized_orgs('member'))
    and (
      -- Slack: shared iff the bot is in it.
      (
        c.service = 'slack'::public.service
        and not coalesce((c.extra->>'is_bot_member')::boolean, false)
      )
      -- local: shared iff it is a public channel.
      or (
        c.service = 'local'::public.service
        and c.type is distinct from 'channel'
      )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.is_conversation_visible(conv_id uuid, conv_org uuid, conv_addr text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (
      (conv_org, conv_addr) in (
        select v.organization_id, v.address from public.get_visible_addresses() v
      )
      and conv_id not in (select public.get_restricted_conversations())
    )
    or conv_id in (select public.get_participant_conversations());
$function$
;

CREATE OR REPLACE FUNCTION public.mark_agent_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1 from public.organizations
    where id = old.organization_id
    for update skip locked
  ) then
    return old;
  end if;

  update public.agents
  set deleted_at = coalesce(deleted_at, now())
  where id = old.id;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.preserve_agent_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if current_role not in ('service_role', 'postgres', 'supabase_admin') then
    new.deleted_at := old.deleted_at;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.preserve_conversation_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.conversation_address := old.conversation_address;

  if current_role not in ('service_role', 'postgres', 'supabase_admin') then
    new.type := old.type;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.before_insert_on_conversations()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  _existing_address text;
  _declared text[];
  _unknown text[];
  _roster uuid[];
  _caller uuid;
begin
  -- Transition compat: derive conversation_address from the legacy column.
  if new.conversation_address is null then
    new.conversation_address := new.contact_address;
  end if;

  -- `local` addresses itself, in one of two ways, and the client chooses by
  -- stating a type:
  --
  --   group / channel   A named container whose membership changes. Identity
  --                     is its own; it gets the row's id, further down.
  --   anything else     A ROSTER. The client says who is in it ('A:B:C', any
  --                     order) and this canonicalises to sorted agent ids.
  --                     That canonical form IS the identity, so the unique
  --                     index answers "does this conversation already exist
  --                     between these people" with a conflict — for two
  --                     participants and for eight alike. direct and multiple
  --                     differ only in how many ids there are, so neither is
  --                     a special case of the other.
  --
  -- The author is always in the room they open, so it is added rather than
  -- demanded: you cannot start a conversation you are not in, and omitting the
  -- address entirely is then just a roster of one — a note to self, which is
  -- what the UI's "new conversation" has always produced. One of those per
  -- member, for the same reason there is one DM per pair.
  if new.service = 'local'
    and (new.type is null or new.type in ('direct', 'multiple'))
  then
    -- Null for the service role, which has no agent of its own; a roster it
    -- states is taken as given.
    select a.id into _caller
    from public.agents a
    where a.organization_id = new.organization_id
      and a.user_id = auth.uid();

    _declared := array_remove(
      coalesce(string_to_array(new.conversation_address, ':'), '{}'), ''
    );

    if _caller is not null then
      _declared := _declared || _caller::text;
    end if;

    -- Named before resolved, so the error can say WHICH id failed. Every
    -- malformed roster arrives here: a stranger's id, an agent of another
    -- organization, an uppercased uuid (agent ids render lowercase), a word
    -- that is not a uuid at all.
    _unknown := array(
      select distinct d
      from unnest(_declared) d
      where not exists (
        select 1 from public.agents a
        where a.organization_id = new.organization_id and a.id::text = d
      )
    );

    if array_length(_unknown, 1) is not null then
      raise exception 'Roster names %, not an agent of this organization',
        array_to_string(_unknown, ', ');
    end if;

    -- distinct: naming someone twice is a typo, not a bigger room.
    select array_agg(distinct a.id order by a.id) into _roster
    from public.agents a
    where a.organization_id = new.organization_id
      and a.id::text = any (_declared);

    if _roster is not null then
      new.conversation_address := array_to_string(_roster, ':');

      -- Size decides the shape, so the two can never disagree.
      if array_length(_roster, 1) > 2 then
        new.type := 'multiple';
      else
        new.type := 'direct';
      end if;
    end if;
  end if;

  -- A named container is identified by ITSELF, so its address is not the
  -- client's to choose. A supplied address could name the canonical roster of
  -- two other people — a `group` addressed 'B:C' would occupy the identity
  -- index and make the DM between B and C impossible forever, while neither
  -- could see or delete the row holding it.
  if new.service = 'local' and new.type in ('group', 'channel') then
    new.conversation_address := new.id::text;
  end if;

  -- A conversation minted without a stated shape is 1:1 — that is what an
  -- inbound message from an unknown peer means, and it is the only shape
  -- WhatsApp Cloud and Instagram have. Connectors that know better state it
  -- before the message lands (generic-webhook, for whatsapp-web group JIDs and
  -- broadcast lists).
  --
  -- `slack` is exempt: its ingestor classifies asynchronously and relies on a
  -- null meaning "ask conversations.info again", which a default would erase.
  if new.type is null and new.service <> 'slack' then
    new.type := 'direct';
  end if;

  -- Conversations with external services must have a peer.
  if new.service <> 'local' and new.conversation_address is null then
    raise exception 'Conversations with external services require a conversation_address';
  end if;

  -- A `local` group or channel is identified by itself, not by who is in it,
  -- so it addresses itself: the conversation's own id. Column defaults are
  -- applied before BEFORE-INSERT triggers run, so new.id is already there.
  -- Keeping the column NOT NULL is what lets the identity index be a plain
  -- unique constraint rather than one whose behaviour depends on NULL
  -- semantics.
  if new.conversation_address is null then
    new.conversation_address := new.id::text;
  end if;

  -- Contact bootstrap applies to legacy individual-peer writers only; new
  -- writers manage contacts_addresses themselves (soft reference by design).
  if new.contact_address is null then
    return new;
  end if;

  select address into _existing_address
  from public.contacts_addresses
  where organization_id = new.organization_id
    and service = new.service
    and address = new.contact_address
  order by created_at desc
  limit 1;

  if _existing_address is null then
    insert into public.contacts_addresses (
      organization_id,
      address,
      service
    ) values (
      new.organization_id,
      new.contact_address,
      new.service
    );
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.before_insert_on_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Transition compat (direction → sender_address, contact_address →
  -- conversation_address): legacy writers still send direction +
  -- contact_address; new writers send sender_address/conversation_address
  -- only. Derive whichever side is missing so both stay consistent until
  -- direction and contact_address are dropped.
  --
  -- sender_address is a contact reference or null: the peer who authored the
  -- message (a phone/BSUID, a Slack workspace member — ties to
  -- contacts_addresses), or null when the account itself spoke. Deliverable
  -- vs record-only is decided by content kind + status.pending, not by
  -- authorship (see the dispatch trigger's kind whitelist).
  if new.conversation_address is null then
    new.conversation_address := new.contact_address;
  end if;

  if new.sender_address is null and new.direction = 'incoming'::public.direction then
    new.sender_address := new.contact_address;
  elsif new.direction is null then
    new.direction := case
      when new.sender_address is not null then 'incoming'::public.direction
      when new.content->'tool' is not null then 'internal'::public.direction
      else 'outgoing'::public.direction
    end;
  end if;

  -- Internal rows (tool traces, notes, agent errors) are record-only and
  -- never need the pending arm bit — strip it so no automation (dispatch,
  -- retry sweeps, media preprocessing) can ever pick them up. This also IS
  -- the deprecation of dispatching agent errors.
  if new.direction = 'internal'::public.direction then
    new.status := new.status - 'pending';
  end if;

  -- If conversation_id is already provided, proceed as is
  if new.conversation_id is not null then
    return new;
  end if;

  -- Look up conversation_id. A conversation IS a channel, so this is an exact
  -- hit on conversations_identity_idx — no `status` predicate (the session
  -- dimension is gone) and no most-recent tiebreak (the key is unique).
  --
  -- organization_id is in the predicate so the scan can start from the index's
  -- leading column. Plain equality throughout: conversation_address is never
  -- null, so the old `is not distinct from` — which is not indexable and
  -- degraded it to a filter over every conversation on the account — is gone.
  --
  -- A peerless (local) message with neither conversation_id nor
  -- conversation_address matches nothing and falls through to the insert
  -- below, where the conversations trigger mints an id for it.
  if new.conversation_address is not null then
    select id into new.conversation_id
    from public.conversations
    where organization_id = new.organization_id
      and service = new.service
      and organization_address = new.organization_address
      and conversation_address = new.conversation_address;
  end if;

  -- Create conversation if it doesn't exist. The legacy contact_address is
  -- only meaningful on direct chats (peer = a contact); in group messages
  -- contact_address carries the per-message sender, which must not become
  -- the conversation's peer.
  if new.conversation_id is null then
    insert into public.conversations (
      organization_id,
      organization_address,
      conversation_address,
      contact_address,
      service
    ) values (
      new.organization_id,
      new.organization_address,
      new.conversation_address,
      case
        when new.contact_address = new.conversation_address
        then new.contact_address
      end,
      new.service
    )
    returning id into new.conversation_id;
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
    return query select organization_id from public.agents
    where
      user_id = auth.uid()
    -- A deleted agent is a former member: this is what makes marking the row
    -- revoke access rather than merely rename it.
    and deleted_at is null
    and (
      extra->'invitation' is null
      or extra->'invitation'->>'status' = 'accepted'
    )
    and (
      case (extra->>'role')
        when 'owner' then 3
        when 'admin' then 2
        else 1 -- 'member'
      end
    ) >= req_level;

    -- Authenticated but lacking the requested role: return the empty set so RLS
    -- subqueries can fall through to other OR-combined policies (e.g. a member
    -- accepting their own invitation while an owner-only policy is also evaluated).
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

CREATE OR REPLACE FUNCTION public.get_participant_conversations()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select ca.conversation_id
  from public.conversations_agents ca
  join public.agents a on a.id = ca.agent_id
  where a.user_id = auth.uid() and a.deleted_at is null;
$function$
;

CREATE OR REPLACE FUNCTION public.get_visible_addresses()
 RETURNS TABLE(organization_id uuid, address text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Shared inboxes: any ownerless account in an org the caller belongs to. No
  -- auth.uid() in the ownerless test itself, so this is the only rule an API
  -- key can satisfy.
  --
  -- The org filter is redundant with every policy that calls this — each one
  -- already ANDs `organization_id in get_authorized_orgs(…)`. It is here
  -- because policies are not the only caller: this is a public, SECURITY
  -- DEFINER function, so PostgREST publishes it at /rpc/get_visible_addresses,
  -- where nothing wraps it and RLS does not apply. Without the filter that
  -- call answers with every shared inbox in the DATABASE — other tenants' org
  -- ids and account addresses, WhatsApp business numbers among them.
  select oa.organization_id, oa.address
  from public.organizations_addresses oa
  where oa.agent_id is null
    and oa.organization_id in (select public.get_authorized_orgs('member'))
  union
  -- Personal accounts owned by the caller (their Slack identity, a personal
  -- WhatsApp/mailbox).
  select oa.organization_id, oa.address
  from public.organizations_addresses oa
  join public.agents a on a.id = oa.agent_id
  where a.user_id = auth.uid() and a.deleted_at is null;
$function$
;

CREATE OR REPLACE FUNCTION public.is_media_visible(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with refs as (
    select m.conversation_id, m.organization_id, m.organization_address
    from public.messages m
    where m.content->'file'->>'uri' = 'internal://media/' || object_name
  )
  select
    not exists (select 1 from refs)
    or exists (
      select 1 from refs r
      where public.is_conversation_visible(
        r.conversation_id, r.organization_id, r.organization_address
      )
    );
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

  if old.extra->>'role' = 'owner' then
    select count(*) into owner_count
    from public.agents
    where organization_id = old.organization_id
      and extra->>'role' = 'owner'
      and (
        extra->>'invitation' is null
        or extra->'invitation'->>'status' = 'accepted'
      )
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

grant delete on table "public"."conversations_agents" to "authenticated";

grant insert on table "public"."conversations_agents" to "authenticated";

grant update on table "public"."conversations_agents" to "authenticated";

  create policy "members can create their orgs local conversations"
  on "public"."conversations"
  as permissive
  for insert
  to authenticated, anon
with check (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND (service = 'local'::public.service)));

  create policy "members can delete their orgs local conversations"
  on "public"."conversations"
  as permissive
  for delete
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND (service = 'local'::public.service) AND ((((organization_id, organization_address) IN ( SELECT v.organization_id,
    v.address
   FROM public.get_visible_addresses() v(organization_id, address))) AND (NOT (id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations)))) OR (id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));

  create policy "members can read their orgs conversations"
  on "public"."conversations"
  as permissive
  for select
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((((organization_id, organization_address) IN ( SELECT v.organization_id,
    v.address
   FROM public.get_visible_addresses() v(organization_id, address))) AND (NOT (id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations)))) OR (id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));

  create policy "members can update their orgs local conversations"
  on "public"."conversations"
  as permissive
  for update
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND (service = 'local'::public.service) AND ((((organization_id, organization_address) IN ( SELECT v.organization_id,
    v.address
   FROM public.get_visible_addresses() v(organization_id, address))) AND (NOT (id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations)))) OR (id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))))
with check (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND (service = 'local'::public.service)));

  create policy "members can create their own membership rows"
  on "public"."conversations_agents"
  as permissive
  for insert
  to authenticated
with check (((agent_id IN ( SELECT public.get_own_agents() AS get_own_agents)) AND (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversations_agents.conversation_id) AND (c.organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((c.organization_id, c.organization_address) IN ( SELECT v.organization_id,
            v.address
           FROM public.get_visible_addresses() v(organization_id, address))) AND (NOT (c.id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations))))))));

  create policy "members can delete local membership rows"
  on "public"."conversations_agents"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversations_agents.conversation_id) AND (c.service = 'local'::public.service) AND ((c.type = 'group'::text) OR ((c.type = 'channel'::text) AND (conversations_agents.agent_id IN ( SELECT public.get_own_agents() AS get_own_agents))))))));

  create policy "members can manage local group membership"
  on "public"."conversations_agents"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversations_agents.conversation_id) AND (c.service = 'local'::public.service) AND (c.type = 'group'::text)))));

  create policy "members can update their own membership rows"
  on "public"."conversations_agents"
  as permissive
  for update
  to authenticated
using (((agent_id IN ( SELECT public.get_own_agents() AS get_own_agents)) AND (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE (c.id = conversations_agents.conversation_id)))))
with check (((agent_id IN ( SELECT public.get_own_agents() AS get_own_agents)) AND (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE (c.id = conversations_agents.conversation_id)))));

  create policy "members can create their orgs messages"
  on "public"."messages"
  as permissive
  for insert
  to authenticated, anon
with check (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((((organization_id, organization_address) IN ( SELECT v.organization_id,
    v.address
   FROM public.get_visible_addresses() v(organization_id, address))) AND (NOT (conversation_id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations)))) OR (conversation_id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));

  create policy "members can read their orgs messages"
  on "public"."messages"
  as permissive
  for select
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((((organization_id, organization_address) IN ( SELECT v.organization_id,
    v.address
   FROM public.get_visible_addresses() v(organization_id, address))) AND (NOT (conversation_id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations)))) OR (conversation_id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));

CREATE TRIGGER preserve_deletion BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.preserve_agent_deletion();

CREATE TRIGGER z_mark_deleted BEFORE DELETE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.mark_agent_deleted();

CREATE TRIGGER add_local_participant AFTER INSERT ON public.conversations FOR EACH ROW WHEN ((new.service = 'local'::public.service)) EXECUTE FUNCTION public.after_insert_on_local_conversation();

CREATE TRIGGER preserve_identity BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.preserve_conversation_identity();

-- ============================================================================
-- Hand-ordered section. `db diff` emits DDL in its own order, which would drop
-- conversations_system before its rows could be carried across, set
-- conversation_address NOT NULL while local rows are still null, and build the
-- identity index while duplicates still exist. Data first, constraints last.
-- ============================================================================

-- User triggers off: these must not emit a webhook per row or bump updated_at,
-- and the messages repoint would otherwise re-check messages_content_schema on
-- legacy v0 rows (see 20260725154649).
alter table public.conversations disable trigger user;
alter table public.messages disable trigger user;
alter table public.conversations_agents disable trigger user;

-- 1. conversations_system -> the two places its facts belong now. channel_type
--    was Slack's own vocabulary; `type` is the cross-service one, and a
--    private channel is the same shape as a WhatsApp group. `private` meant
--    "the account rule does not apply here"; the fact underneath it is the
--    bot's presence, which is what we actually observe — so it inverts.
update public.conversations c
set type = case cs.channel_type
             when 'im' then 'direct'
             when 'mpim' then 'multiple'
             when 'private_channel' then 'group'
             when 'public_channel' then 'channel'
           end,
    extra = coalesce(c.extra, '{}'::jsonb) || jsonb_build_object(
      'is_bot_member', not coalesce(cs.private, true)
    )
from public.conversations_system cs
where cs.conversation_id = c.id;

-- 2. Every other service has one shape, except whatsapp-web, where the bridge
--    distinguishes them by address: a bare phone number for a direct chat, a
--    full JID otherwise whose domain names the kind — the same test its
--    dispatcher applies in reverse. Production carries 365 …@g.us groups and
--    one …@broadcast. Slack is excluded: a row with no conversations_system
--    entry was never classified, and null is what makes its ingestor
--    re-resolve.
update public.conversations
set type = case
             when service <> 'whatsapp-web'::public.service then 'direct'
             when conversation_address like '%@g.us' then 'group'
             when conversation_address like '%@broadcast' then 'broadcast'
             else 'direct'
           end
where type is null
  and service <> 'slack'::public.service;

-- 3. status was the session dimension. Its one real meaning — a Slack channel
--    was archived — is channel state, so it moves into extra, named
--    channel_archived to stay clear of the `archived` UI preference.
update public.conversations
set extra = coalesce(extra, '{}'::jsonb)
  || jsonb_build_object('channel_archived', true)
where status = 'archived';

-- 4. Peerless (local) conversations address themselves, matching the trigger.
update public.conversations
set conversation_address = id::text
where conversation_address is null;

-- 5. Merge duplicate channels: production accumulated 136 duplicated keys over
--    529 rows under lookup-then-insert. Identity is invariant now, so the
--    oldest row IS the channel — repoint everything at it and drop the rest.
create temporary table _conv_merge on commit drop as
select id,
       first_value(id) over (
         partition by organization_id, service, organization_address,
                      conversation_address
         order by created_at, id
       ) as keeper
from public.conversations;

delete from _conv_merge where id = keeper;

update public.messages m
set conversation_id = k.keeper
from _conv_merge k
where m.conversation_id = k.id;

-- conversations_agents is keyed (conversation_id, agent_id), so repointing can
-- collide with a row the keeper already has; drop those first.
delete from public.conversations_agents ca
using _conv_merge k
where ca.conversation_id = k.id
  and exists (
    select 1 from public.conversations_agents keep
    where keep.conversation_id = k.keeper and keep.agent_id = ca.agent_id
  );

update public.conversations_agents ca
set conversation_id = k.keeper
from _conv_merge k
where ca.conversation_id = k.id;

delete from public.conversations c using _conv_merge k where c.id = k.id;

alter table public.conversations_agents enable trigger user;
alter table public.messages enable trigger user;
alter table public.conversations enable trigger user;

-- Sources drained; now the structural changes.
drop table "public"."conversations_system";

drop table "public"."quick_replies";

alter table "public"."conversations" drop column "status";

alter table "public"."conversations" alter column "conversation_address" set not null;

CREATE UNIQUE INDEX conversations_identity_idx ON public.conversations USING btree (organization_id, service, organization_address, conversation_address);

alter table "public"."conversations" add constraint "conversations_type_check" CHECK (((type IS NULL) OR (type = ANY (ARRAY['direct'::text, 'multiple'::text, 'group'::text, 'channel'::text, 'broadcast'::text])))) not valid;

alter table "public"."conversations" validate constraint "conversations_type_check";
