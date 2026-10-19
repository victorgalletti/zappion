drop policy "members can delete themselves" on "public"."agents";

drop policy "members can read themselves" on "public"."agents";

drop policy "members can update themselves" on "public"."agents";

drop policy "owners can read their orgs api keys" on "public"."api_keys";

drop policy "members can delete their orgs local conversations" on "public"."conversations";

drop policy "members can read their orgs conversations" on "public"."conversations";

drop policy "members can update their orgs local conversations" on "public"."conversations";

drop policy "members can create their own membership rows" on "public"."conversations_agents";

drop policy "members can create their orgs messages" on "public"."messages";

drop policy "members can read their orgs messages" on "public"."messages";

alter table "public"."conversations" drop constraint "conversations_organization_address_fkey";

alter table "public"."conversations_agents" drop constraint "conversations_agents_organization_address_fkey";

alter table "public"."logs" drop constraint "logs_organization_address_fkey";

drop function if exists "public"."is_conversation_visible"(conv_id uuid, conv_org uuid, conv_addr text);

drop function if exists "public"."get_visible_addresses"();

alter table "public"."organizations_addresses" drop constraint "organizations_addresses_pkey";

drop index if exists "public"."contacts_addresses_phone_number_idx";

drop index if exists "public"."conversations_organization_address_idx";

drop index if exists "public"."conversations_organization_id_idx";

drop index if exists "public"."messages_organization_id_idx";

drop index if exists "public"."conversations_agents_organization_address_idx";

drop index if exists "public"."conversations_identity_idx";

drop index if exists "public"."idx_logs_organization_id_address";

drop index if exists "public"."organizations_addresses_pkey";

-- Hand-split from the generated `add column ... not null`, which assumes the
-- table is empty. It is empty on a fresh deploy, but DEV has already been
-- carrying rows for a while, and a membership's service is recoverable from
-- its conversation — so backfill rather than depend on the environment. This
-- is the same derivation set_conversation_agent_service applies from here on.
alter table "public"."conversations_agents" add column "service" public.service;

update public.conversations_agents ca
set service = c.service
from public.conversations c
where c.id = ca.conversation_id
  and ca.service is null;

alter table "public"."conversations_agents"
alter column "service" set not null;

CREATE INDEX messages_service_created_at_idx ON public.messages USING btree (service, created_at DESC);

CREATE INDEX conversations_agents_organization_address_idx ON public.conversations_agents USING btree (organization_id, service, organization_address);

CREATE UNIQUE INDEX conversations_identity_idx ON public.conversations USING btree (organization_id, organization_address, service, conversation_address);

CREATE INDEX idx_logs_organization_id_address ON public.logs USING btree (organization_id, organization_address, service);

CREATE UNIQUE INDEX organizations_addresses_pkey ON public.organizations_addresses USING btree (organization_id, service, address);

alter table "public"."organizations_addresses" add constraint "organizations_addresses_pkey" PRIMARY KEY using index "organizations_addresses_pkey";

alter table "public"."logs" add constraint "logs_organization_address_needs_service" CHECK (((organization_address IS NULL) OR (service IS NOT NULL))) not valid;

alter table "public"."logs" validate constraint "logs_organization_address_needs_service";

-- Hand-written DML (db diff emits schema only). The constraint below is the
-- first thing that can reject a conversation whose service disagrees with its
-- account, and production holds three such rows — so they have to go first or
-- the validation aborts the deploy.
--
-- All three are API sends that named 'whatsapp' against 237688481029, a
-- whatsapp-web account, on 2026-07-25 between 16:14 and 16:35. Each shadows a
-- live bridge conversation with the same peer, created at 14:07 that day and
-- holding 67 and 75 messages; the strays hold 6 between them, and the three
-- spellings involved (651084334, +237651084334, 237651084334) are one person.
-- Deleting the shadows loses nothing the real conversations do not already
-- have, and merging would have to invent a normalization rule to do it.
--
-- Written as a general predicate rather than three ids so it is also correct
-- against DEV, which drifted separately.
delete from public.conversations c
using public.organizations_addresses oa
where oa.organization_id = c.organization_id
  and oa.address = c.organization_address
  and oa.service is distinct from c.service;

alter table "public"."conversations" add constraint "conversations_organization_address_fkey" FOREIGN KEY (organization_id, service, organization_address) REFERENCES public.organizations_addresses(organization_id, service, address) ON DELETE CASCADE not valid;

alter table "public"."conversations" validate constraint "conversations_organization_address_fkey";

alter table "public"."conversations_agents" add constraint "conversations_agents_organization_address_fkey" FOREIGN KEY (organization_id, service, organization_address) REFERENCES public.organizations_addresses(organization_id, service, address) ON DELETE CASCADE not valid;

alter table "public"."conversations_agents" validate constraint "conversations_agents_organization_address_fkey";

alter table "public"."logs" add constraint "logs_organization_address_fkey" FOREIGN KEY (organization_id, service, organization_address) REFERENCES public.organizations_addresses(organization_id, service, address) ON DELETE CASCADE not valid;

alter table "public"."logs" validate constraint "logs_organization_address_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.is_conversation_visible(conv_id uuid, conv_org uuid, conv_addr text, conv_service public.service)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (
      (conv_org, conv_service, conv_addr) in (
        select v.organization_id, v.service, v.address
        from public.get_visible_addresses() v
      )
      and conv_id not in (select public.get_restricted_conversations())
    )
    or conv_id in (select public.get_participant_conversations());
$function$
;

CREATE OR REPLACE FUNCTION public.set_conversation_agent_service()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  select c.service into new.service
  from public.conversations c
  where c.id = new.conversation_id;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.after_insert_on_local_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- service is omitted on purpose: set_conversation_agent_service derives it,
  -- here as for every other writer.
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

CREATE OR REPLACE FUNCTION public.get_visible_addresses()
 RETURNS TABLE(organization_id uuid, service public.service, address text)
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
  select oa.organization_id, oa.service, oa.address
  from public.organizations_addresses oa
  where oa.agent_id is null
    and oa.organization_id in (select public.get_authorized_orgs('member'))
  union
  -- Personal accounts owned by the caller (their Slack identity, a personal
  -- WhatsApp/mailbox).
  select oa.organization_id, oa.service, oa.address
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
    select m.conversation_id, m.organization_id, m.service, m.organization_address
    from public.messages m
    where m.content->'file'->>'uri' = 'internal://media/' || object_name
  )
  select
    not exists (select 1 from refs)
    or exists (
      select 1 from refs r
      where public.is_conversation_visible(
        r.conversation_id, r.organization_id, r.organization_address, r.service
      )
    );
$function$
;


  create policy "members can delete themselves"
  on "public"."agents"
  as permissive
  for delete
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "members can read themselves"
  on "public"."agents"
  as permissive
  for select
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "members can update themselves"
  on "public"."agents"
  as permissive
  for update
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check (public.member_self_update_rules(id, user_id, organization_id, ai, extra));



  create policy "owners can read their orgs api keys"
  on "public"."api_keys"
  as permissive
  for select
  to authenticated, anon
using (((key = ( SELECT ((current_setting('request.headers'::text, true))::json ->> 'api-key'::text))) OR (organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs))));



  create policy "members can delete their orgs local conversations"
  on "public"."conversations"
  as permissive
  for delete
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND (service = 'local'::public.service) AND ((((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address))) AND (NOT (id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations)))) OR (id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));



  create policy "members can read their orgs conversations"
  on "public"."conversations"
  as permissive
  for select
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address))) AND (NOT (id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations)))) OR (id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));



  create policy "members can update their orgs local conversations"
  on "public"."conversations"
  as permissive
  for update
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND (service = 'local'::public.service) AND ((((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address))) AND (NOT (id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations)))) OR (id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))))
with check (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND (service = 'local'::public.service)));



  create policy "members can create their own membership rows"
  on "public"."conversations_agents"
  as permissive
  for insert
  to authenticated
with check (((agent_id IN ( SELECT public.get_own_agents() AS get_own_agents)) AND (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversations_agents.conversation_id) AND (c.organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((c.organization_id, c.service, c.organization_address) IN ( SELECT v.organization_id,
            v.service,
            v.address
           FROM public.get_visible_addresses() v(organization_id, service, address))) AND (NOT (c.id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations))))))));



  create policy "members can create their orgs messages"
  on "public"."messages"
  as permissive
  for insert
  to authenticated, anon
with check (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address))) AND (NOT (conversation_id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations)))) OR (conversation_id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));



  create policy "members can read their orgs messages"
  on "public"."messages"
  as permissive
  for select
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address))) AND (NOT (conversation_id IN ( SELECT public.get_restricted_conversations() AS get_restricted_conversations)))) OR (conversation_id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));


CREATE TRIGGER a_set_service BEFORE INSERT OR UPDATE ON public.conversations_agents FOR EACH ROW EXECUTE FUNCTION public.set_conversation_agent_service();


