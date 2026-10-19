drop policy "members can manage their orgs conversations" on "public"."conversations";

drop policy "members can create their orgs messages" on "public"."messages";

drop policy "members can read their orgs messages" on "public"."messages";


  create table "public"."conversations_system" (
    "conversation_id" uuid not null,
    "organization_id" uuid not null,
    "channel_type" text,
    "private" boolean not null default true,
    "extra" jsonb,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."conversations_system" enable row level security;

CREATE UNIQUE INDEX conversations_system_pkey ON public.conversations_system USING btree (conversation_id);

CREATE INDEX conversations_system_private_idx ON public.conversations_system USING btree (organization_id) WHERE private;

alter table "public"."conversations_system" add constraint "conversations_system_pkey" PRIMARY KEY using index "conversations_system_pkey";

alter table "public"."conversations_system" add constraint "conversations_system_channel_type_check" CHECK (((channel_type IS NULL) OR (channel_type = ANY (ARRAY['im'::text, 'mpim'::text, 'private_channel'::text, 'public_channel'::text])))) not valid;

alter table "public"."conversations_system" validate constraint "conversations_system_channel_type_check";

alter table "public"."conversations_system" add constraint "conversations_system_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE not valid;

alter table "public"."conversations_system" validate constraint "conversations_system_conversation_id_fkey";

alter table "public"."conversations_system" add constraint "conversations_system_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."conversations_system" validate constraint "conversations_system_organization_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_participant_conversations()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select ca.conversation_id
  from public.conversations_agents ca
  join public.agents a on a.id = ca.agent_id
  where a.user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.get_private_conversations()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select cs.conversation_id
  from public.conversations_system cs
  where cs.private
    and cs.organization_id in (select public.get_authorized_orgs('member'));
$function$
;

CREATE OR REPLACE FUNCTION public.get_visible_addresses()
 RETURNS TABLE(organization_id uuid, address text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Shared inboxes: any ownerless account. No auth.uid() involved — "is the
  -- caller in this org" lives in the policy — so this is the only rule an
  -- API key can satisfy.
  select oa.organization_id, oa.address
  from public.organizations_addresses oa
  where oa.agent_id is null
  union
  -- Personal accounts owned by the caller (their Slack identity, a personal
  -- WhatsApp/mailbox).
  select oa.organization_id, oa.address
  from public.organizations_addresses oa
  join public.agents a on a.id = oa.agent_id
  where a.user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.is_conversation_visible(conv_id uuid, conv_org uuid, conv_addr text, conv_service public.service)
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
      and conv_id not in (select public.get_private_conversations())
    )
    or conv_id in (select public.get_participant_conversations());
$function$
;

grant references on table "public"."conversations_system" to "anon";

grant select on table "public"."conversations_system" to "anon";

grant trigger on table "public"."conversations_system" to "anon";

grant truncate on table "public"."conversations_system" to "anon";

grant references on table "public"."conversations_system" to "authenticated";

grant select on table "public"."conversations_system" to "authenticated";

grant trigger on table "public"."conversations_system" to "authenticated";

grant truncate on table "public"."conversations_system" to "authenticated";

grant delete on table "public"."conversations_system" to "service_role";

grant insert on table "public"."conversations_system" to "service_role";

grant references on table "public"."conversations_system" to "service_role";

grant select on table "public"."conversations_system" to "service_role";

grant trigger on table "public"."conversations_system" to "service_role";

grant truncate on table "public"."conversations_system" to "service_role";

grant update on table "public"."conversations_system" to "service_role";


  create policy "members can read system facts of visible conversations"
  on "public"."conversations_system"
  as permissive
  for select
  to authenticated, anon
using ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE (c.id = conversations_system.conversation_id))));



  create policy "members can manage their orgs conversations"
  on "public"."conversations"
  as permissive
  for all
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((((organization_id, organization_address) IN ( SELECT v.organization_id,
    v.address
   FROM public.get_visible_addresses() v(organization_id, address))) AND (NOT (id IN ( SELECT public.get_private_conversations() AS get_private_conversations)))) OR (id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));



  create policy "members can create their orgs messages"
  on "public"."messages"
  as permissive
  for insert
  to authenticated, anon
with check (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((((organization_id, organization_address) IN ( SELECT v.organization_id,
    v.address
   FROM public.get_visible_addresses() v(organization_id, address))) AND (NOT (conversation_id IN ( SELECT public.get_private_conversations() AS get_private_conversations)))) OR (conversation_id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));



  create policy "members can read their orgs messages"
  on "public"."messages"
  as permissive
  for select
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((((organization_id, organization_address) IN ( SELECT v.organization_id,
    v.address
   FROM public.get_visible_addresses() v(organization_id, address))) AND (NOT (conversation_id IN ( SELECT public.get_private_conversations() AS get_private_conversations)))) OR (conversation_id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)))));


CREATE TRIGGER set_extra BEFORE UPDATE ON public.conversations_system FOR EACH ROW WHEN ((new.extra IS NOT NULL)) EXECUTE FUNCTION public.merge_update('extra');

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversations_system FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');


