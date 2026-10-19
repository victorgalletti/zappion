-- The AI-DM flow's trigger: a member's armed message in a local DIRECT
-- conversation whose other roster slot is an AI agent POSTs /agent-client.
-- The address IS the roster and direct rosters are immutable, so a member
-- cannot pull the AI into a real team conversation; the author exclusion
-- makes the AI's own replies a no-op. See 02-02_edge_functions.sql.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.local_message_to_agent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  segments text[] := string_to_array(new.conversation_address, ':');
  base_url text;
  auth_token text;
  request_id bigint;
begin
  -- Direct only, for now: deleting this guard is the entire `multiple`
  -- extension. Group/channel addresses are a single uuid and fail it too,
  -- and `is distinct from` keeps a peerless row (null address) out.
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
$function$
;

CREATE TRIGGER handle_local_message_to_agent AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.agent_id IS NOT NULL) AND (new.service = 'local'::public.service) AND ((new.status ->> 'pending'::text) IS NOT NULL))) EXECUTE FUNCTION public.local_message_to_agent();
