-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: read receipts and typing indicator from the human inbox.
--
-- Agents cannot update messages (no UPDATE policy), so this function is the one
-- narrow write they get: stamp `read` (and, while they type, `typing`) on an
-- incoming message they can see. handle_mark_as_read_to_dispatcher then sends
-- WhatsApp the blue ticks and the "typing…" bubble.
create function public.mark_read(p_message_id uuid, p_typing boolean default false)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  -- Same visibility as the "members can read their orgs messages" policy.
  if not exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and m.sender_address is not null
      and m.organization_id in (select public.get_authorized_orgs('member'))
      and (
        (
          (m.organization_id, m.service, m.organization_address) in (
            select v.organization_id, v.service, v.address
            from public.get_visible_addresses() v
          )
          and m.conversation_id not in (select public.get_restricted_conversations())
        )
        or m.conversation_id in (select public.get_participant_conversations())
      )
  ) then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  -- set_status merges this into the existing status.
  update public.messages
  set status = jsonb_build_object('read', v_now)
    || case when p_typing then jsonb_build_object('typing', v_now) else '{}'::jsonb end
  where id = p_message_id;
end;
$function$;

-- MCP API-key requests run as anon with the api-key header. The organization
-- and visibility checks above still apply: get_authorized_orgs resolves the
-- live key and gives read-scoped keys nothing on POST.
revoke all on function public.mark_read(uuid, boolean) from public;
grant execute on function public.mark_read(uuid, boolean) to anon, authenticated;
