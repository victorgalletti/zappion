-- SPDX-License-Identifier: AGPL-3.0-only

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.zappion_mcp_set_archived(p_organization_id uuid, p_conversation_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  k public.api_keys;
  v_agent_id uuid;
begin
  if p_archived is null then
    raise exception using errcode = '22023', message = 'archived is required';
  end if;

  if current_setting('request.headers', true)::json->>'api-key' is not null then
    k := public.zappion_request_api_key();
    if public.zappion_api_key_refusal(k.id, k.revoked_at, k.expires_at) is not null
      or k.organization_id is distinct from p_organization_id
      or k.scope < 'send'::public.zappion_api_key_scope
    then
      raise exception using errcode = '42501', message = 'a live send-scoped api key for this organization is required';
    end if;

    if k.created_by is null then
      raise exception using errcode = '42501', message = 'this api key has no creator; per-member archive preferences require a key creator';
    end if;

    select a.id into v_agent_id from public.agents a
    where a.id = k.created_by
      and a.organization_id = p_organization_id
      and a.deleted_at is null;
  else
    select a.id into v_agent_id from public.agents a
    where a.user_id = auth.uid()
      and a.organization_id = p_organization_id
      and a.deleted_at is null;
  end if;

  if v_agent_id is null then
    raise exception using errcode = '42501', message = 'an active member of this organization is required';
  end if;

  -- Same organization and visibility checks as messages / mark_read. Keys
  -- retain their own shared-inbox visibility, never their creator's private
  -- access; the creator must still be an active member to own preferences.
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.organization_id = p_organization_id
      and c.organization_id in (select public.get_authorized_orgs('member'))
      and public.is_conversation_visible(
        c.id, c.organization_id, c.organization_address, c.service
      )
  ) then
    raise exception using errcode = 'P0002', message = 'conversation not found';
  end if;

  -- Match the web app's upsert, including a null timestamp on unarchive.
  insert into public.conversation_preferences (
    agent_id, conversation_id, organization_id, archived_at
  ) values (
    v_agent_id, p_conversation_id, p_organization_id,
    case when p_archived then now() else null end
  )
  on conflict (agent_id, conversation_id) do update
    set archived_at = excluded.archived_at;
end;
$function$
;


-- Hand-written: db diff does not emit function privileges.
revoke all on function public.zappion_mcp_set_archived(uuid, uuid, boolean) from public;
grant execute on function public.zappion_mcp_set_archived(uuid, uuid, boolean) to anon, authenticated;

-- MCP API-key requests run as anon (see 04-90_zappion_mark_read.sql).
revoke all on function public.mark_read(uuid, boolean) from public;
grant execute on function public.mark_read(uuid, boolean) to anon, authenticated;
