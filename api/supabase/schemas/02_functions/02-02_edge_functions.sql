create function public.dispatcher_edge_function() returns trigger
language plpgsql
security definer
as $$
declare
  service text := new.service::text;
  path text := concat('/', service, '-dispatcher');
  request_id bigint;
  payload jsonb;
  base_url text;
  auth_token text;
  headers jsonb;
  timeout_ms integer := 10000;
begin
  if service = 'local' then
    update public.messages set status = jsonb_build_object('delivered', now()) where id = new.id;

    return new;
  end if;

  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'edge_functions_url';
  select decrypted_secret into auth_token from vault.decrypted_secrets where name = 'edge_functions_token';
  
  headers = jsonb_build_object(
    'content-type', 'application/json',
    'authorization', 'Bearer ' || auth_token
  );
  
  payload = jsonb_build_object(
    'old_record', old,
    'record', new,
    'type', tg_op,
    'table', tg_table_name,
    'schema', tg_table_schema
  );

  select http_post into request_id from net.http_post(
    base_url || path,
    payload,
    '{}'::jsonb,
    headers,
    timeout_ms
  );

  insert into supabase_functions.hooks
    (hook_table_id, hook_name, request_id)
  values
    (tg_relid, tg_name, request_id);

  return new;
end;
$$;

create function public.edge_function() returns trigger
language plpgsql
security definer
as $$
declare
  request_id bigint;
  payload jsonb;
  base_url text;
  auth_token text;
  path text := tg_argv[0]::text;
  method text := tg_argv[1]::text;
  headers jsonb default '{}'::jsonb;
  params jsonb default '{}'::jsonb;
  timeout_ms integer := 10000;
begin
  if path is null or path = 'null' then
    raise exception 'path argument is missing';
  end if;

  if method is null or method = 'null' then
    raise exception 'method argument is missing';
  end if;

  if tg_argv[2] is null or tg_argv[2] = 'null' then
    select decrypted_secret into auth_token from vault.decrypted_secrets where name = 'edge_functions_token';

    headers = jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || auth_token
    );
  else
    headers = tg_argv[2]::jsonb;
  end if;

  if tg_argv[3] is null or tg_argv[3] = 'null' then
    params = '{}'::jsonb;
  else
    params = tg_argv[3]::jsonb;
  end if;

  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'edge_functions_url';

  case
    when method = 'get' then
      select http_get into request_id from net.http_get(
        base_url || path,
        params,
        headers,
        timeout_ms
      );
    when method = 'post' then
      payload = jsonb_build_object(
        'old_record', old,
        'record', new,
        'type', tg_op,
        'table', tg_table_name,
        'schema', tg_table_schema
      );

      select http_post into request_id from net.http_post(
        base_url || path,
        payload,
        params,
        headers,
        timeout_ms
      );
    else
      raise exception 'method argument % is invalid', method;
  end case;

  insert into supabase_functions.hooks
    (hook_table_id, hook_name, request_id)
  values
    (tg_relid, tg_name, request_id);

  return new;
end
$$;

-- The internal mirror of edge_function('/agent-client', 'post'), for the
-- AI-DM flow (see handle_local_message_to_agent on messages). The trigger's
-- WHEN prefilters — local, a member author, armed — and the one fact a WHEN
-- cannot express lives here: is the other roster slot an AI agent?
--
-- A local direct's address IS its roster (agent ids, sorted, ':'-joined),
-- and RLS only allows roster edits on `group` — so "the AI answers where its
-- own id is in the address" is safe by construction: a member cannot pull
-- the AI into a real team conversation, and DMing the AI is not a mode, it
-- is just a conversation. Excluding the author (`a.id <> new.agent_id`) also
-- makes the AI's own replies a no-op here, with no special case. Everything
-- that enters and is not an AI DM — a group message, a human-human DM —
-- costs one indexed exists and exits.
create function public.local_message_to_agent() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  segments text[] := string_to_array(new.conversation_address, ':');
  base_url text;
  auth_token text;
  request_id bigint;
begin
  -- Two-member rosters only, for now: deleting this guard is the entire
  -- multi-party extension. Group/channel addresses are a single uuid and fail
  -- it too, and `is distinct from` keeps a peerless row (null address) out.
  if array_length(segments, 1) is distinct from 2 then
    return new;
  end if;

  if not exists (
    select 1 from public.agents a
    where a.organization_id = new.organization_id
      and a.id::text = any (segments)
      and a.id <> new.agent_id
      and a.user_id is null
      and a.deleted_at is null
  ) then
    return new;
  end if;

  select decrypted_secret into base_url
  from vault.decrypted_secrets where name = 'edge_functions_url';
  select decrypted_secret into auth_token
  from vault.decrypted_secrets where name = 'edge_functions_token';

  select http_post into request_id from net.http_post(
    base_url || '/agent-client',
    jsonb_build_object(
      'old_record', old,
      'record', new,
      'type', tg_op,
      'table', tg_table_name,
      'schema', tg_table_schema
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || auth_token
    ),
    10000
  );

  insert into supabase_functions.hooks
    (hook_table_id, hook_name, request_id)
  values
    (tg_relid, tg_name, request_id);

  return new;
end
$$; 