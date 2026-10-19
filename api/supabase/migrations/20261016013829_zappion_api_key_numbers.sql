-- SPDX-License-Identifier: AGPL-3.0-only

drop function if exists "public"."zappion_create_api_key"(p_organization_id uuid, p_name text, p_scope public.zappion_api_key_scope, p_expires_at timestamp with time zone, p_send_limit_per_hour integer, p_template_limit_per_hour integer);

alter table "public"."api_keys" add column "allowed_addresses" text[];

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.zappion_create_api_key(p_organization_id uuid, p_name text, p_scope public.zappion_api_key_scope DEFAULT 'read'::public.zappion_api_key_scope, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_send_limit_per_hour integer DEFAULT 60, p_template_limit_per_hour integer DEFAULT 10, p_allowed_addresses text[] DEFAULT NULL::text[])
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
    send_limit_per_hour, template_limit_per_hour, allowed_addresses, created_by
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
    -- Zappion: a key's number restriction also applies to REST/RLS callers.
    -- Match the request header by hash, as in get_authorized_orgs (04-01).
    and not exists (
      select 1 from public.api_keys k
      where k.key_hash = public.zappion_hash_api_key(
        current_setting('request.headers', true)::json->>'api-key'
      )
        and k.allowed_addresses is not null
        and (oa.service = 'whatsapp' and oa.address = any(k.allowed_addresses)) is not true
    )
  union
  -- Personal accounts owned by the caller (their Slack identity, a personal
  -- WhatsApp/mailbox).
  select oa.organization_id, oa.service, oa.address
  from public.organizations_addresses oa
  join public.agents a on a.id = oa.agent_id
  where a.user_id = auth.uid() and a.deleted_at is null;
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
    'scope', k.scope,
    'allowed_addresses', k.allowed_addresses
  );
end;
$function$
;


-- Hand-written: db diff does not emit function privileges.
revoke execute on function public.zappion_create_api_key(uuid, text, public.zappion_api_key_scope, timestamp with time zone, integer, integer, text[]) from public, anon;
