-- SPDX-License-Identifier: AGPL-3.0-only
create type "public"."zappion_api_key_scope" as enum ('read', 'send', 'admin');

drop policy "owners can create their orgs api keys" on "public"."api_keys";

drop policy "owners can delete their orgs api keys" on "public"."api_keys";

drop policy "owners can read their orgs api keys" on "public"."api_keys";

alter table "public"."api_keys" drop constraint "api_keys_key_key";

drop index if exists "public"."api_keys_key_key";

  create table "public"."mcp_calls" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "api_key_id" uuid,
    "user_id" uuid,
    "tool" text not null,
    "contact_phone" text,
    "send_kind" text,
    "status" text not null default 'pending'::text,
    "error" text,
    "created_at" timestamp with time zone not null default now(),
    "finished_at" timestamp with time zone
      );

alter table "public"."mcp_calls" enable row level security;

alter table "public"."api_keys" add column "created_by" uuid;

alter table "public"."api_keys" add column "expires_at" timestamp with time zone;

alter table "public"."api_keys" add column "key_hash" text;

alter table "public"."api_keys" add column "key_prefix" text;

alter table "public"."api_keys" add column "last_used_at" timestamp with time zone;

alter table "public"."api_keys" add column "revoked_at" timestamp with time zone;

alter table "public"."api_keys" add column "scope" public.zappion_api_key_scope not null default 'read'::public.zappion_api_key_scope;

alter table "public"."api_keys" add column "send_limit_per_hour" integer not null default 60;

alter table "public"."api_keys" add column "template_limit_per_hour" integer not null default 10;

-- Hand-written backfill: existing keys keep working with the same key. They
-- are hashed here (the function is created below, so digest inline), and keep
-- what they could do before: member keys may send, admin and owner keys get
-- the admin scope.
update "public"."api_keys"
set key_hash = encode(extensions.digest(key, 'sha256'), 'hex'),
  key_prefix = left(key, 12),
  scope = case when role = 'member' then 'send' else 'admin' end::public.zappion_api_key_scope;

alter table "public"."api_keys" alter column "key_hash" set not null;

alter table "public"."api_keys" alter column "key_prefix" set not null;

alter table "public"."api_keys" drop column "key";

CREATE UNIQUE INDEX api_keys_key_hash_key ON public.api_keys USING btree (key_hash);

CREATE INDEX mcp_calls_key_sends_idx ON public.mcp_calls USING btree (api_key_id, created_at) WHERE (send_kind IS NOT NULL);

CREATE INDEX mcp_calls_organization_created_idx ON public.mcp_calls USING btree (organization_id, created_at DESC);

CREATE UNIQUE INDEX mcp_calls_pkey ON public.mcp_calls USING btree (id);

alter table "public"."mcp_calls" add constraint "mcp_calls_pkey" PRIMARY KEY using index "mcp_calls_pkey";

alter table "public"."api_keys" add constraint "api_keys_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.agents(id) ON DELETE SET NULL not valid;

alter table "public"."api_keys" validate constraint "api_keys_created_by_fkey";

alter table "public"."api_keys" add constraint "api_keys_key_hash_key" UNIQUE using index "api_keys_key_hash_key";

alter table "public"."api_keys" add constraint "api_keys_send_limit_check" CHECK ((send_limit_per_hour > 0)) not valid;

alter table "public"."api_keys" validate constraint "api_keys_send_limit_check";

alter table "public"."api_keys" add constraint "api_keys_template_limit_check" CHECK ((template_limit_per_hour >= 0)) not valid;

alter table "public"."api_keys" validate constraint "api_keys_template_limit_check";

alter table "public"."mcp_calls" add constraint "mcp_calls_api_key_id_fkey" FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL not valid;

alter table "public"."mcp_calls" validate constraint "mcp_calls_api_key_id_fkey";

alter table "public"."mcp_calls" add constraint "mcp_calls_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."mcp_calls" validate constraint "mcp_calls_organization_id_fkey";

alter table "public"."mcp_calls" add constraint "mcp_calls_send_kind_check" CHECK ((send_kind = ANY (ARRAY['message'::text, 'template'::text]))) not valid;

alter table "public"."mcp_calls" validate constraint "mcp_calls_send_kind_check";

alter table "public"."mcp_calls" add constraint "mcp_calls_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'ok'::text, 'error'::text, 'denied'::text, 'rate_limited'::text]))) not valid;

alter table "public"."mcp_calls" validate constraint "mcp_calls_status_check";

alter table "public"."mcp_calls" add constraint "mcp_calls_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."mcp_calls" validate constraint "mcp_calls_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.zappion_api_key_refusal(
  p_id uuid,
  p_revoked_at timestamp with time zone,
  p_expires_at timestamp with time zone
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when p_id is null then jsonb_build_object(
      'code', 'invalid_key',
      'message', 'This API key does not exist.'
    )
    when p_revoked_at is not null then jsonb_build_object(
      'code', 'key_revoked',
      'message', 'This API key was revoked.',
      'revoked_at', p_revoked_at
    )
    when p_expires_at is not null and p_expires_at <= now() then jsonb_build_object(
      'code', 'key_expired',
      'message', 'This API key expired.',
      'expires_at', p_expires_at
    )
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_create_api_key(p_organization_id uuid, p_name text, p_scope public.zappion_api_key_scope DEFAULT 'read'::public.zappion_api_key_scope, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_send_limit_per_hour integer DEFAULT 60, p_template_limit_per_hour integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text;
  v_id uuid;
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

  -- 24 random bytes are 32 base64 characters, with no padding.
  v_key := 'zpn_' ||
    translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');

  insert into public.api_keys (
    organization_id, role, name, key_hash, key_prefix, scope, expires_at,
    send_limit_per_hour, template_limit_per_hour, created_by
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

CREATE OR REPLACE FUNCTION public.zappion_hash_api_key(p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select encode(extensions.digest(p_key, 'sha256'), 'hex');
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_mcp_authenticate()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  k public.api_keys;
  v_refusal jsonb;
begin
  k := public.zappion_request_api_key();
  v_refusal := public.zappion_api_key_refusal(k.id, k.revoked_at, k.expires_at);

  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;

  if k.last_used_at is null or k.last_used_at < now() - interval '1 minute' then
    update public.api_keys set last_used_at = now() where id = k.id;
  end if;

  return jsonb_build_object(
    'id', k.id,
    'organization_id', k.organization_id,
    'scope', k.scope
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_mcp_begin_call(p_organization_id uuid, p_tool text, p_scope public.zappion_api_key_scope, p_contact_phone text DEFAULT NULL::text, p_send_kind text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_has_key boolean :=
    current_setting('request.headers', true)::json->>'api-key' is not null;
  k public.api_keys;
  v_org uuid;
  v_refusal jsonb;
  v_kind text;
  v_limit integer;
  v_count integer;
  v_retry_at timestamp with time zone;
  v_id uuid;
begin
  if v_has_key then
    select * into k from public.api_keys
    where id = (public.zappion_request_api_key()).id
    for update;

    if k.id is null then
      raise exception using errcode = '42501', message = 'invalid api key';
    end if;

    v_org := k.organization_id;
    v_refusal := public.zappion_api_key_refusal(k.id, k.revoked_at, k.expires_at);

    if v_refusal is null and k.scope < p_scope then
      v_refusal := jsonb_build_object(
        'code', 'insufficient_scope',
        'message', format(
          'This API key has the %s scope; %s needs %s.', k.scope, p_tool, p_scope
        ),
        'scope', k.scope,
        'required_scope', p_scope
      );
    end if;

    -- Messages first, then templates: the first limit reached is reported.
    if v_refusal is null and p_send_kind is not null then
      foreach v_kind in array array['messages', 'templates'] loop
        continue when v_kind = 'templates' and p_send_kind <> 'template';

        v_limit := case v_kind
          when 'messages' then k.send_limit_per_hour
          else k.template_limit_per_hour
        end;

        select count(*) into v_count
        from public.mcp_calls c
        where c.api_key_id = k.id
          and c.send_kind is not null
          and (v_kind = 'messages' or c.send_kind = 'template')
          and c.status in ('pending', 'ok')
          and c.created_at > now() - interval '1 hour';

        continue when v_count < v_limit;

        -- A slot frees when the oldest send over the limit leaves the hour.
        select c.created_at + interval '1 hour' into v_retry_at
        from public.mcp_calls c
        where c.api_key_id = k.id
          and c.send_kind is not null
          and (v_kind = 'messages' or c.send_kind = 'template')
          and c.status in ('pending', 'ok')
          and c.created_at > now() - interval '1 hour'
        order by c.created_at
        offset v_count - v_limit
        limit 1;

        v_refusal := jsonb_build_object(
          'code', 'rate_limited',
          'limit', v_kind,
          'limit_per_hour', v_limit,
          'retry_at', v_retry_at,
          'message', case
            when v_retry_at is null then 'This API key may not send templates.'
            else format(
              'This API key reached its hourly limit for %s (%s). Retry after %s.',
              v_kind, v_limit, to_jsonb(v_retry_at) #>> '{}'
            )
          end
        );
        exit;
      end loop;
    end if;
  else
    if auth.uid() is null
      or p_organization_id not in (select public.get_authorized_orgs('member'))
    then
      raise exception using errcode = '42501', message = 'authentication required';
    end if;

    v_org := p_organization_id;
  end if;

  insert into public.mcp_calls (
    organization_id, api_key_id, user_id, tool, contact_phone, send_kind,
    status, error, finished_at
  ) values (
    v_org,
    k.id,
    case when not v_has_key then auth.uid() end,
    p_tool,
    p_contact_phone,
    p_send_kind,
    case
      when v_refusal is null then 'pending'
      when v_refusal->>'code' = 'rate_limited' then 'rate_limited'
      else 'denied'
    end,
    v_refusal->>'message',
    case when v_refusal is not null then now() end
  )
  returning id into v_id;

  if v_refusal is not null then
    return v_refusal || jsonb_build_object('allowed', false);
  end if;

  return jsonb_build_object('allowed', true, 'call_id', v_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_mcp_finish_call(p_call_id uuid, p_ok boolean, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key_id uuid := (public.zappion_request_api_key()).id;
begin
  update public.mcp_calls
  set status = case when p_ok then 'ok' else 'error' end,
    error = left(p_error, 2000),
    finished_at = now()
  where id = p_call_id
    and status = 'pending'
    and (
      (v_key_id is not null and api_key_id = v_key_id)
      or (v_key_id is null and user_id = auth.uid())
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_request_api_key()
 RETURNS public.api_keys
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select * from public.api_keys
  where key_hash = public.zappion_hash_api_key(
    current_setting('request.headers', true)::json->>'api-key'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_revoke_api_key(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.api_keys
  set revoked_at = coalesce(revoked_at, now())
  where id = p_id
    and auth.uid() is not null
    and organization_id in (select public.get_authorized_orgs('admin'));

  if not found then
    raise exception using errcode = '42501', message = 'api key not found';
  end if;
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
    -- Zappion: matched by hash, and only while the key is live. A read-scoped
    -- key authorizes reads only: on any request but GET/HEAD it gets nothing,
    -- so it cannot write through PostgREST or Storage either.
    select a.organization_id into org_id
    from public.api_keys a
    where a.key_hash = public.zappion_hash_api_key(api_key)
    and a.revoked_at is null
    and (a.expires_at is null or a.expires_at > now())
    and (
      a.scope <> 'read'
      or coalesce(current_setting('request.method', true), '') in ('GET', 'HEAD')
    )
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

grant references on table "public"."mcp_calls" to "anon";

grant select on table "public"."mcp_calls" to "anon";

grant trigger on table "public"."mcp_calls" to "anon";

grant truncate on table "public"."mcp_calls" to "anon";

grant references on table "public"."mcp_calls" to "authenticated";

grant select on table "public"."mcp_calls" to "authenticated";

grant trigger on table "public"."mcp_calls" to "authenticated";

grant truncate on table "public"."mcp_calls" to "authenticated";

grant delete on table "public"."mcp_calls" to "service_role";

grant insert on table "public"."mcp_calls" to "service_role";

grant references on table "public"."mcp_calls" to "service_role";

grant select on table "public"."mcp_calls" to "service_role";

grant trigger on table "public"."mcp_calls" to "service_role";

grant truncate on table "public"."mcp_calls" to "service_role";

grant update on table "public"."mcp_calls" to "service_role";

  create policy "admins can delete their orgs api keys"
  on "public"."api_keys"
  as permissive
  for delete
  to authenticated
using ((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)));

  create policy "admins can read their orgs api keys"
  on "public"."api_keys"
  as permissive
  for select
  to authenticated, anon
using ((((key_hash = ( SELECT public.zappion_hash_api_key(((current_setting('request.headers'::text, true))::json ->> 'api-key'::text)) AS zappion_hash_api_key)) AND (revoked_at IS NULL) AND ((expires_at IS NULL) OR (expires_at > now()))) OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)))));

  create policy "admins can read their orgs mcp calls"
  on "public"."mcp_calls"
  as permissive
  for select
  to authenticated
using ((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)));

-- Hand-written: db diff does not carry function privileges (04-93).
revoke execute on function public.zappion_create_api_key(uuid, text, public.zappion_api_key_scope, timestamp with time zone, integer, integer) from public, anon;
revoke execute on function public.zappion_revoke_api_key(uuid) from public, anon;
revoke execute on function public.zappion_request_api_key() from public, anon, authenticated;
