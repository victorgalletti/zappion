drop trigger if exists "handle_incoming_message_to_agent" on "public"."messages";

drop trigger if exists "handle_mark_as_read_to_dispatcher" on "public"."messages";

drop trigger if exists "handle_outgoing_message_to_dispatcher" on "public"."messages";

drop trigger if exists "pause_conversation_on_human_message" on "public"."messages";

drop policy "members can manage their orgs conversations" on "public"."conversations";

drop policy "members can create their orgs messages" on "public"."messages";

drop policy "members can read their orgs messages" on "public"."messages";

alter table "public"."conversations" drop constraint "conversations_organization_address_fkey";

drop index if exists "public"."conversations_group_address_idx";


  create table "public"."conversations_agents" (
    "organization_id" uuid not null,
    "organization_address" text not null,
    "conversation_id" uuid not null,
    "agent_id" uuid not null,
    "extra" jsonb,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."conversations_agents" enable row level security;

alter table "public"."conversations" add column "conversation_address" text;

alter table "public"."messages" add column "conversation_address" text;

alter table "public"."messages" add column "sender_address" text;

alter table "public"."organizations_addresses" add column "agent_id" uuid;

CREATE INDEX conversations_agents_agent_id_idx ON public.conversations_agents USING btree (agent_id);

CREATE INDEX conversations_agents_organization_address_idx ON public.conversations_agents USING btree (organization_id, organization_address);

CREATE INDEX conversations_agents_organization_id_idx ON public.conversations_agents USING btree (organization_id);

CREATE UNIQUE INDEX conversations_agents_pkey ON public.conversations_agents USING btree (conversation_id, agent_id);

CREATE INDEX conversations_conversation_address_idx ON public.conversations USING btree (conversation_address);

CREATE INDEX organizations_addresses_agent_id_idx ON public.organizations_addresses USING btree (agent_id);

alter table "public"."conversations_agents" add constraint "conversations_agents_pkey" PRIMARY KEY using index "conversations_agents_pkey";

alter table "public"."conversations_agents" add constraint "conversations_agents_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE not valid;

alter table "public"."conversations_agents" validate constraint "conversations_agents_agent_id_fkey";

alter table "public"."conversations_agents" add constraint "conversations_agents_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE not valid;

alter table "public"."conversations_agents" validate constraint "conversations_agents_conversation_id_fkey";

alter table "public"."conversations_agents" add constraint "conversations_agents_organization_address_fkey" FOREIGN KEY (organization_id, organization_address) REFERENCES public.organizations_addresses(organization_id, address) ON DELETE CASCADE not valid;

alter table "public"."conversations_agents" validate constraint "conversations_agents_organization_address_fkey";

alter table "public"."conversations_agents" add constraint "conversations_agents_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."conversations_agents" validate constraint "conversations_agents_organization_id_fkey";

alter table "public"."organizations_addresses" add constraint "organizations_addresses_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE RESTRICT not valid;

alter table "public"."organizations_addresses" validate constraint "organizations_addresses_agent_id_fkey";

alter table "public"."conversations" add constraint "conversations_organization_address_fkey" FOREIGN KEY (organization_id, organization_address) REFERENCES public.organizations_addresses(organization_id, address) ON DELETE CASCADE not valid;

alter table "public"."conversations" validate constraint "conversations_organization_address_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.is_conversation_visible(conv_id uuid, conv_org uuid, conv_addr text, conv_service public.service)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    -- 1. Org-wide shared inbox: the conversation hangs off an ownerless
    --    account on a customer-facing service. No auth.uid() involved — the
    --    "is the caller in this org" half lives in the RLS policy
    --    (get_authorized_orgs). The service guard keeps the ownerless Slack
    --    workspace anchor out of this branch. This is also the only branch
    --    an API key (auth.uid() is null) can ever pass.
    (
      conv_service not in ('slack', 'discord', 'teams')
      and exists (
        select 1 from public.organizations_addresses oa
        where oa.organization_id = conv_org
          and oa.address = conv_addr
          and oa.agent_id is null
      )
    )
    -- 2. Account owner: the conversation hangs off a PERSONAL account whose
    --    owner is the caller (e.g. a future personal WhatsApp/mailbox).
    --    Slack conversations don't use this branch — they anchor to the
    --    workspace, not to the member's T…:U… row — they rely on 3.
    or exists (
      select 1
      from public.organizations_addresses oa
      join public.agents a on a.id = oa.agent_id
      where oa.organization_id = conv_org
        and oa.address = conv_addr
        and a.user_id = auth.uid()
    )
    -- 3. Participant: a conversations_agents row for THIS conversation names
    --    an agent that is the caller. The Slack path, mirroring channel/DM
    --    membership; keyed on the conversation id, not the account.
    or exists (
      select 1
      from public.conversations_agents ca
      join public.agents a on a.id = ca.agent_id
      where ca.conversation_id = conv_id
        and a.user_id = auth.uid()
    );
$function$
;

CREATE OR REPLACE FUNCTION public.before_insert_on_conversations()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  _existing_address text;
begin
  -- Transition compat: derive conversation_address from the legacy column.
  if new.conversation_address is null then
    new.conversation_address := new.contact_address;
  end if;

  -- Conversations with external services must have a peer
  if new.service <> 'local' and new.conversation_address is null then
    raise exception 'Conversations with external services require a conversation_address';
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
AS $function$
begin
  -- Transition compat (direction → sender_address, contact_address →
  -- conversation_address): legacy writers still send direction +
  -- contact_address; new writers send sender_address/conversation_address
  -- only. Derive whichever side is missing so both stay consistent until
  -- direction and contact_address are dropped.
  if new.conversation_address is null then
    new.conversation_address := new.contact_address;
  end if;

  if new.sender_address is null and new.direction is not null then
    new.sender_address := case new.direction
      when 'outgoing'::public.direction then new.organization_address
      when 'incoming'::public.direction then new.contact_address
      else null -- internal
    end;
  elsif new.direction is null then
    new.direction := case
      when new.sender_address is null then 'internal'::public.direction
      when new.sender_address = new.organization_address then 'outgoing'::public.direction
      else 'incoming'::public.direction
    end;
  end if;

  -- If conversation_id is already provided, proceed as is
  if new.conversation_id is not null then
    return new;
  end if;

  -- Look up conversation_id from conversation table. Conversations are keyed
  -- by conversation_address (the peer — individual or group/channel; the
  -- per-message author lives on messages.sender_address). Local-service
  -- messages have no peer, hence `is not distinct from`.
  select id into new.conversation_id
  from public.conversations
  where organization_address = new.organization_address
    and conversation_address is not distinct from new.conversation_address
    and service = new.service
    and status = 'active'
  order by created_at desc
  limit 1;

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

CREATE OR REPLACE FUNCTION public.preserve_message_direction()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.direction := old.direction;
  new.sender_address := old.sender_address;
  new.conversation_address := old.conversation_address;
  return new;
end;
$function$
;

grant references on table "public"."conversations_agents" to "anon";

grant trigger on table "public"."conversations_agents" to "anon";

grant truncate on table "public"."conversations_agents" to "anon";

grant references on table "public"."conversations_agents" to "authenticated";

grant select on table "public"."conversations_agents" to "authenticated";

grant trigger on table "public"."conversations_agents" to "authenticated";

grant truncate on table "public"."conversations_agents" to "authenticated";

grant delete on table "public"."conversations_agents" to "service_role";

grant insert on table "public"."conversations_agents" to "service_role";

grant references on table "public"."conversations_agents" to "service_role";

grant select on table "public"."conversations_agents" to "service_role";

grant trigger on table "public"."conversations_agents" to "service_role";

grant truncate on table "public"."conversations_agents" to "service_role";

grant update on table "public"."conversations_agents" to "service_role";


  create policy "members can read memberships of visible conversations"
  on "public"."conversations_agents"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE (c.id = conversations_agents.conversation_id))));



  create policy "members can manage their orgs conversations"
  on "public"."conversations"
  as permissive
  for all
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND public.is_conversation_visible(id, organization_id, organization_address, service)));



  create policy "members can create their orgs messages"
  on "public"."messages"
  as permissive
  for insert
  to authenticated, anon
with check (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND public.is_conversation_visible(conversation_id, organization_id, organization_address, service)));



  create policy "members can read their orgs messages"
  on "public"."messages"
  as permissive
  for select
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND public.is_conversation_visible(conversation_id, organization_id, organization_address, service)));


CREATE TRIGGER set_extra BEFORE UPDATE ON public.conversations_agents FOR EACH ROW WHEN ((new.extra IS NOT NULL)) EXECUTE FUNCTION public.merge_update('extra');

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversations_agents FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

CREATE TRIGGER handle_incoming_message_to_agent AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NOT NULL) AND (new.sender_address <> new.organization_address) AND ((new.status ->> 'pending'::text) IS NOT NULL))) EXECUTE FUNCTION public.edge_function('/agent-client', 'post');

CREATE TRIGGER handle_mark_as_read_to_dispatcher AFTER UPDATE ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NOT NULL) AND (new.sender_address <> new.organization_address) AND (new.service <> 'local'::public.service) AND (((old.status ->> 'read'::text) <> (new.status ->> 'read'::text)) OR ((old.status ->> 'typing'::text) <> (new.status ->> 'typing'::text))) AND ((new.status ->> 'pending'::text) IS NOT NULL))) EXECUTE FUNCTION public.dispatcher_edge_function();

CREATE TRIGGER handle_outgoing_message_to_dispatcher AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address = new.organization_address) AND (new."timestamp" <= now()) AND ((new.status ->> 'pending'::text) IS NOT NULL))) EXECUTE FUNCTION public.dispatcher_edge_function();

CREATE TRIGGER pause_conversation_on_human_message AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address = new.organization_address) AND (new.service <> 'local'::public.service) AND (new."timestamp" <= now()) AND (new."timestamp" >= (now() - '00:00:10'::interval)))) EXECUTE FUNCTION public.pause_conversation_on_human_message();



-- ============================================================================
-- Hand-written tail (db diff emits DDL only, and in its own order):
-- 1. backfill the new addressing columns — needs group_address as a source,
--    so its drop is moved below the backfill;
-- 2. drop the never-productive group_address columns;
-- 3. explicit grants for the new table (default privileges for
--    postgres-created tables only grant truncate/references/trigger to the
--    API roles).
-- ============================================================================

-- Backfill. Derivation on existing rows:
--   conversation_address = coalesce(group_address, contact_address)
--   sender_address       = contact_address for incoming, null otherwise
--                          (a contact reference or null — see the later
--                          sender_address_rethink migration for the rationale)
--   status               = pending stripped from internal rows
-- Single pass, final semantics: messages is ~450k rows / 360 MB with six
-- indexes, so every extra pass is another full set of row versions plus WAL.
-- Writing an intermediate sender_address here and correcting it in a second
-- migration would rewrite the outgoing rows for nothing.
-- User triggers are disabled during the backfill: without this,
-- z_notify_webhook_* would enqueue one pg_net HTTP post per historic row and
-- set_updated_at would rewrite updated_at (breaking sync ordering). ALTER
-- TABLE takes an access-exclusive lock, so concurrent writes queue until the
-- migration transaction commits — no row sneaks past the disabled triggers.

alter table public.conversations disable trigger user;
alter table public.messages disable trigger user;

-- messages_content_schema is NOT VALID: ~46k legacy rows predate the v1
-- content shape and were grandfathered in when it was added. A CHECK is
-- re-evaluated for every row an UPDATE touches — even when the update does
-- not touch `content` — so the backfill below fails on every one of them
-- (SQLSTATE 23514). Drop it for the duration and re-add it NOT VALID, which
-- restores exactly the prior state: legacy rows stay grandfathered, new and
-- updated rows are still checked. Same transaction as the backfill and under
-- the access-exclusive lock, so no writer ever sees the table unconstrained.
alter table public.messages drop constraint messages_content_schema;

update public.conversations
set conversation_address = coalesce(group_address, contact_address)
where conversation_address is null
  and (group_address is not null or contact_address is not null);

update public.messages
set
  conversation_address = coalesce(group_address, contact_address),
  sender_address = case
    when direction = 'incoming'::public.direction then contact_address
  end, -- outgoing (the account spoke) and internal stay null
  status = case
    when direction = 'internal'::public.direction then status - 'pending'
    else status
  end
where conversation_address is null
  and direction is not null;

alter table public.messages
add constraint messages_content_schema check (
  content = '{}'::jsonb -- status-only upserts (content merged later)
  or (
    content->>'version' is not null
    and content->>'type' in ('text', 'file', 'data')
    and content->>'kind' is not null
  )
) not valid;

alter table public.conversations enable trigger user;
alter table public.messages enable trigger user;

-- group_address is in real use (WhatsApp group keying, added by
-- 20260715042918) — the backfill above copied it into conversation_address,
-- which is what makes dropping it safe. Verify that backfill ran before this
-- point; there is no way back once the column is gone.
alter table "public"."conversations" drop column "group_address";

alter table "public"."messages" drop column "group_address";

-- Grants for the new table. service_role writes memberships (webhook/
-- management functions); members only read (RLS narrows rows to their own
-- visible conversations; no anon — API keys never see membership-gated
-- content).
grant select, insert, update, delete on table public.conversations_agents to service_role;
grant select on table public.conversations_agents to authenticated;
