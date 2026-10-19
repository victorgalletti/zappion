-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: organization API keys for the MCP server (and the rest of the API).
--
-- A key is `zpn_` plus 32 base64url characters. Only its hash is stored
-- (03-06). Admins create keys here and see the key once; a key never creates,
-- lists or revokes keys, so a leaked one cannot mint another.
--
-- The zappion_mcp_* functions are the MCP server's (functions/mcp): they read
-- the key from the request's `api-key` header themselves, so a caller can only
-- ever act as, and be counted against, the key it holds.

create function public.zappion_create_api_key(
  p_organization_id uuid,
  p_name text,
  p_scope public.zappion_api_key_scope default 'read',
  p_expires_at timestamp with time zone default null,
  -- Same defaults as the table's (03-06).
  p_send_limit_per_hour integer default 60,
  p_template_limit_per_hour integer default 10,
  p_allowed_addresses text[] default null,
  p_requires_approval boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

-- Revoking is immediate: get_authorized_orgs and every zappion_mcp_* function
-- check revoked_at on each request. The row stays, for the call log.
create function public.zappion_revoke_api_key(p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

revoke execute on function public.zappion_create_api_key(uuid, text, public.zappion_api_key_scope, timestamp with time zone, integer, integer, text[], boolean) from public, anon;
revoke execute on function public.zappion_revoke_api_key(uuid) from public, anon;

-- The key in this request's `api-key` header, live or not. Null without one.
create function public.zappion_request_api_key()
returns public.api_keys
language sql
stable
security definer
set search_path to ''
as $function$
  select * from public.api_keys
  where key_hash = public.zappion_hash_api_key(
    current_setting('request.headers', true)::json->>'api-key'
  );
$function$;

revoke execute on function public.zappion_request_api_key() from public, anon, authenticated;

-- Why a key cannot be used now, as an error code, or null when it can.
create function public.zappion_api_key_refusal(
  p_id uuid,
  p_revoked_at timestamp with time zone,
  p_expires_at timestamp with time zone
)
returns jsonb
language sql
stable
set search_path to ''
as $function$
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
$function$;

-- The MCP server's sign-in: the key's org and scope, or why it is refused.
-- Notes when the key was last used (at most once a minute).
create function public.zappion_mcp_authenticate()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

-- Opens a row in the call log before a tool runs, and says whether it may.
--
-- With an API key: refused when the key is no longer live, lacks p_scope, or
-- (for a send, p_send_kind set) is over its hourly limits. Limits count the
-- key's sends in the last rolling hour that did not fail; a template counts
-- against both. The key's row is locked for the count, so concurrent calls
-- of one key cannot both take the last slot.
--
-- Without one (an OAuth session): the user must be a member of
-- p_organization_id; there are no scopes or limits, the call is only logged.
--
-- Returns {allowed: true, call_id} or {allowed: false, code, message, …}.
create function public.zappion_mcp_begin_call(
  p_organization_id uuid,
  p_tool text,
  p_scope public.zappion_api_key_scope,
  p_contact_phone text default null,
  p_send_kind text default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

-- Closes a call opened by zappion_mcp_begin_call. Only the same key (or the
-- same user, for an OAuth session) can close it. A failed send stops counting
-- against the key's limits.
create function public.zappion_mcp_finish_call(
  p_call_id uuid,
  p_ok boolean,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;
