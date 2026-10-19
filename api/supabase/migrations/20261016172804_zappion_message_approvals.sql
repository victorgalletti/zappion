-- SPDX-License-Identifier: AGPL-3.0-only
drop function if exists "public"."zappion_create_api_key"(p_organization_id uuid, p_name text, p_scope public.zappion_api_key_scope, p_expires_at timestamp with time zone, p_send_limit_per_hour integer, p_template_limit_per_hour integer, p_allowed_addresses text[]);

  create table "public"."zappion_message_approvals" (
    "message_id" uuid not null,
    "organization_id" uuid not null,
    "conversation_id" uuid not null,
    "api_key_id" uuid,
    "api_key_name" text not null,
    "send_kind" text not null,
    "requested_at" timestamp with time zone not null default now(),
    "decision" text,
    "decided_by" uuid,
    "decided_at" timestamp with time zone
      );

alter table "public"."zappion_message_approvals" enable row level security;

alter table "public"."api_keys" add column "requires_approval" boolean not null default false;

CREATE INDEX zappion_message_approvals_conversation_idx ON public.zappion_message_approvals USING btree (conversation_id);

CREATE INDEX zappion_message_approvals_key_approved_idx ON public.zappion_message_approvals USING btree (api_key_id, decided_at) WHERE (decision = 'approved'::text);

CREATE UNIQUE INDEX zappion_message_approvals_pkey ON public.zappion_message_approvals USING btree (message_id);

CREATE INDEX zappion_message_approvals_waiting_idx ON public.zappion_message_approvals USING btree (organization_id, requested_at) WHERE (decision IS NULL);

alter table "public"."zappion_message_approvals" add constraint "zappion_message_approvals_pkey" PRIMARY KEY using index "zappion_message_approvals_pkey";

alter table "public"."zappion_message_approvals" add constraint "zappion_message_approvals_api_key_id_fkey" FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL not valid;

alter table "public"."zappion_message_approvals" validate constraint "zappion_message_approvals_api_key_id_fkey";

alter table "public"."zappion_message_approvals" add constraint "zappion_message_approvals_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE not valid;

alter table "public"."zappion_message_approvals" validate constraint "zappion_message_approvals_conversation_id_fkey";

alter table "public"."zappion_message_approvals" add constraint "zappion_message_approvals_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES public.agents(id) ON DELETE SET NULL not valid;

alter table "public"."zappion_message_approvals" validate constraint "zappion_message_approvals_decided_by_fkey";

alter table "public"."zappion_message_approvals" add constraint "zappion_message_approvals_decided_check" CHECK (((decision IS NULL) = (decided_at IS NULL))) not valid;

alter table "public"."zappion_message_approvals" validate constraint "zappion_message_approvals_decided_check";

alter table "public"."zappion_message_approvals" add constraint "zappion_message_approvals_decision_check" CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text]))) not valid;

alter table "public"."zappion_message_approvals" validate constraint "zappion_message_approvals_decision_check";

alter table "public"."zappion_message_approvals" add constraint "zappion_message_approvals_message_id_fkey" FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE not valid;

alter table "public"."zappion_message_approvals" validate constraint "zappion_message_approvals_message_id_fkey";

alter table "public"."zappion_message_approvals" add constraint "zappion_message_approvals_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."zappion_message_approvals" validate constraint "zappion_message_approvals_organization_id_fkey";

alter table "public"."zappion_message_approvals" add constraint "zappion_message_approvals_send_kind_check" CHECK ((send_kind = ANY (ARRAY['message'::text, 'template'::text]))) not valid;

alter table "public"."zappion_message_approvals" validate constraint "zappion_message_approvals_send_kind_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.zappion_approve_message(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.zappion_message_approvals;
  m public.messages;
  k public.api_keys;
  v_agent_id uuid;
  v_last_incoming timestamp with time zone;
  v_kind text;
  v_limit integer;
  v_count integer;
  v_retry_at timestamp with time zone;
begin
  a := public.zappion_lock_approval(p_message_id);

  select * into m from public.messages where id = a.message_id;

  select ag.id into v_agent_id from public.agents ag
  where ag.user_id = auth.uid()
    and ag.organization_id = a.organization_id
    and ag.deleted_at is null;

  if a.send_kind <> 'template' then
    select max(timestamp) into v_last_incoming
    from public.messages
    where organization_id = m.organization_id
      and conversation_id = m.conversation_id
      and sender_address is not null;

    if v_last_incoming is null or v_last_incoming <= now() - interval '24 hours' then
      raise exception using
        errcode = '22023',
        message = 'the service window is closed: no message from the contact in the last 24 hours, so only a template can be sent';
    end if;
  end if;

  -- Locks the key, so two approvals at once cannot both take its last slot.
  select * into k from public.api_keys where id = a.api_key_id for update;

  if k.id is not null then
    foreach v_kind in array array['messages', 'templates'] loop
      continue when v_kind = 'templates' and a.send_kind <> 'template';

      v_limit := case v_kind
        when 'messages' then k.send_limit_per_hour
        else k.template_limit_per_hour
      end;

      select count(*) into v_count
      from public.zappion_message_approvals ap
      where ap.api_key_id = k.id
        and ap.decision = 'approved'
        and (v_kind = 'messages' or ap.send_kind = 'template')
        and ap.decided_at > now() - interval '1 hour';

      continue when v_count < v_limit;

      select ap.decided_at + interval '1 hour' into v_retry_at
      from public.zappion_message_approvals ap
      where ap.api_key_id = k.id
        and ap.decision = 'approved'
        and (v_kind = 'messages' or ap.send_kind = 'template')
        and ap.decided_at > now() - interval '1 hour'
      order by ap.decided_at
      offset v_count - v_limit
      limit 1;

      raise exception using
        errcode = '22023',
        message = case
          when v_retry_at is null then 'this API key may not send templates'
          else format(
            'the API key reached its hourly limit for %s (%s); approve again after %s',
            v_kind, v_limit, to_jsonb(v_retry_at) #>> '{}'
          )
        end;
    end loop;
  end if;

  update public.zappion_message_approvals
  set decision = 'approved', decided_by = v_agent_id, decided_at = now()
  where message_id = a.message_id;

  -- Armed now, and dated now: the retry sweep works off the row's timestamp.
  -- The approving member becomes the sender, as for a send from the inbox.
  update public.messages
  set status = jsonb_build_object('pending', now(), 'approved', now()),
    timestamp = now(),
    agent_id = coalesce(v_agent_id, agent_id)
  where id = a.message_id;

  return jsonb_build_object('id', a.message_id, 'status', 'approved');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_create_api_key(p_organization_id uuid, p_name text, p_scope public.zappion_api_key_scope DEFAULT 'read'::public.zappion_api_key_scope, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_send_limit_per_hour integer DEFAULT 60, p_template_limit_per_hour integer DEFAULT 10, p_allowed_addresses text[] DEFAULT NULL::text[], p_requires_approval boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text;
  v_id uuid;
  v_allowed_addresses text[];
begin
  if auth.uid() is null
    or p_organization_id not in (select public.get_authorized_orgs('admin'))
  then
    raise exception using
      errcode = '42501',
      message = 'only an admin of the organization can create api keys';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'a name is required';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception using
      errcode = '22023',
      message = 'the expiry must be in the future';
  end if;

  if p_allowed_addresses is not null then
    if cardinality(p_allowed_addresses) = 0 or exists (
      select 1 from unnest(p_allowed_addresses) requested(address)
      where not exists (
        select 1 from public.organizations_addresses oa
        where oa.organization_id = p_organization_id
          and oa.service = 'whatsapp'
          and oa.address = requested.address
      )
    ) then
      raise exception using errcode = '22023',
        message = 'select one or more WhatsApp addresses of this organization';
    end if;
    select array_agg(distinct address order by address) into v_allowed_addresses
    from unnest(p_allowed_addresses) requested(address);
  end if;

  -- 24 random bytes are 32 base64 characters, with no padding.
  v_key := 'zpn_' ||
    translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');

  insert into public.api_keys (
    organization_id, role, name, key_hash, key_prefix, scope, expires_at,
    send_limit_per_hour, template_limit_per_hour, allowed_addresses, requires_approval,
    created_by
  ) values (
    p_organization_id,
    -- The role bounds what the key reaches outside the MCP (RLS): an admin
    -- key may manage the org like an admin; read and send keys are members.
    case when p_scope = 'admin' then 'admin' else 'member' end::public.role,
    btrim(p_name),
    public.zappion_hash_api_key(v_key),
    left(v_key, 12),
    p_scope,
    p_expires_at,
    p_send_limit_per_hour,
    p_template_limit_per_hour,
    v_allowed_addresses,
    coalesce(p_requires_approval, false),
    (
      select a.id from public.agents a
      where a.user_id = auth.uid()
        and a.organization_id = p_organization_id
        and a.deleted_at is null
    )
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'key', v_key, 'key_prefix', left(v_key, 12));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_hold_for_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  k public.api_keys;
begin
  if current_setting('request.headers', true)::json->>'api-key' is null
    or new.sender_address is not null
    or new.status->>'pending' is null
    or new.content->>'internal' is not null
  then
    return new;
  end if;

  k := public.zappion_request_api_key();

  if k.id is not null and k.requires_approval then
    new.status := jsonb_build_object('awaiting_approval', now());
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_lock_approval(p_message_id uuid)
 RETURNS public.zappion_message_approvals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.zappion_message_approvals;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'only a signed-in member can approve or reject messages';
  end if;

  select * into a from public.zappion_message_approvals
  where message_id = p_message_id
  for update;

  if a.message_id is null
    or a.organization_id not in (select public.get_authorized_orgs('member'))
    or not exists (
      select 1 from public.conversations c
      where c.id = a.conversation_id
        and public.is_conversation_visible(
          c.id, c.organization_id, c.organization_address, c.service
        )
    )
  then
    raise exception using errcode = '42501', message = 'message not found';
  end if;

  if a.decision is not null then
    raise exception using
      errcode = '22023',
      message = format('this message was already %s', a.decision);
  end if;

  return a;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_record_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  k public.api_keys;
begin
  k := public.zappion_request_api_key();

  if k.id is not null and k.requires_approval then
    insert into public.zappion_message_approvals (
      message_id, organization_id, conversation_id, api_key_id, api_key_name,
      send_kind
    ) values (
      new.id,
      new.organization_id,
      new.conversation_id,
      k.id,
      k.name,
      case when new.content->>'kind' = 'template' then 'template' else 'message' end
    );
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_reject_message(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.zappion_message_approvals;
begin
  a := public.zappion_lock_approval(p_message_id);

  update public.zappion_message_approvals
  set decision = 'rejected',
    decided_by = (
      select ag.id from public.agents ag
      where ag.user_id = auth.uid()
        and ag.organization_id = a.organization_id
        and ag.deleted_at is null
    ),
    decided_at = now()
  where message_id = a.message_id;

  update public.messages
  set status = jsonb_build_object('rejected', now())
  where id = a.message_id;

  return jsonb_build_object('id', a.message_id, 'status', 'rejected');
end;
$function$
;

grant references on table "public"."zappion_message_approvals" to "anon";

grant select on table "public"."zappion_message_approvals" to "anon";

grant trigger on table "public"."zappion_message_approvals" to "anon";

grant truncate on table "public"."zappion_message_approvals" to "anon";

grant references on table "public"."zappion_message_approvals" to "authenticated";

grant select on table "public"."zappion_message_approvals" to "authenticated";

grant trigger on table "public"."zappion_message_approvals" to "authenticated";

grant truncate on table "public"."zappion_message_approvals" to "authenticated";

grant delete on table "public"."zappion_message_approvals" to "service_role";

grant insert on table "public"."zappion_message_approvals" to "service_role";

grant references on table "public"."zappion_message_approvals" to "service_role";

grant select on table "public"."zappion_message_approvals" to "service_role";

grant trigger on table "public"."zappion_message_approvals" to "service_role";

grant truncate on table "public"."zappion_message_approvals" to "service_role";

grant update on table "public"."zappion_message_approvals" to "service_role";

  create policy "members can read their orgs message approvals"
  on "public"."zappion_message_approvals"
  as permissive
  for select
  to authenticated
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND (message_id IN ( SELECT m.id
   FROM public.messages m))));

CREATE TRIGGER zappion_dispatch_approved_message AFTER UPDATE ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NULL) AND ((old.status ->> 'approved'::text) IS NULL) AND ((new.status ->> 'approved'::text) IS NOT NULL) AND ((new.status ->> 'pending'::text) IS NOT NULL) AND ((new.content ->> 'internal'::text) IS NULL))) EXECUTE FUNCTION public.dispatcher_edge_function();

CREATE TRIGGER zappion_hold_for_approval BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.zappion_hold_for_approval();

CREATE TRIGGER zappion_record_approval AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NULL) AND ((new.status ->> 'awaiting_approval'::text) IS NOT NULL) AND ((new.status ->> 'pending'::text) IS NULL))) EXECUTE FUNCTION public.zappion_record_approval();


-- Hand-written: db diff does not emit function privileges.
revoke execute on function public.zappion_create_api_key(uuid, text, public.zappion_api_key_scope, timestamp with time zone, integer, integer, text[], boolean) from public, anon;
revoke execute on function public.zappion_hold_for_approval() from public, anon, authenticated;
revoke execute on function public.zappion_record_approval() from public, anon, authenticated;
revoke execute on function public.zappion_lock_approval(uuid) from public, anon, authenticated;
revoke execute on function public.zappion_approve_message(uuid) from public, anon;
revoke execute on function public.zappion_reject_message(uuid) from public, anon;
grant execute on function public.zappion_approve_message(uuid) to authenticated;
grant execute on function public.zappion_reject_message(uuid) to authenticated;

-- Hand-written: publications are outside the declarative schema. The inbox
-- badge follows approvals live.
alter publication supabase_realtime add table only public.zappion_message_approvals;
