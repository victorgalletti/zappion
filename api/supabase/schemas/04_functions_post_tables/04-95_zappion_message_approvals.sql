-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: approval before an API key sends (03-93).
--
-- The hold is in the database, not in the MCP server, so it also covers a key
-- that inserts messages through PostgREST. A row the dispatcher would send
-- (sender null, armed with status.pending, not record-only) inserted with a
-- key that requires approval is stored unarmed instead: status
-- {awaiting_approval}, which neither the dispatch trigger nor the retry sweep
-- picks up, since both need status.pending.

-- BEFORE INSERT, named to run after handle_new_message (triggers fire in name
-- order), so conversation_id is already resolved.
create function public.zappion_hold_for_approval()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

-- AFTER INSERT: the approval row needs the message to exist (its foreign key).
-- Rechecks the key, so a status written by hand never opens an approval.
create function public.zappion_record_approval()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

revoke execute on function public.zappion_hold_for_approval() from public, anon, authenticated;
revoke execute on function public.zappion_record_approval() from public, anon, authenticated;

create trigger zappion_hold_for_approval
before insert
on public.messages
for each row
execute function public.zappion_hold_for_approval();

create trigger zappion_record_approval
after insert
on public.messages
for each row
when (
  new.sender_address is null
  and (new.status ->> 'awaiting_approval') is not null
  and (new.status ->> 'pending') is null
)
execute function public.zappion_record_approval();

-- Approval arms the row; this sends it. The insert trigger cannot, since it
-- only fires on insert, and the retry sweep would wait a minute.
create trigger zappion_dispatch_approved_message
after update
on public.messages
for each row
when (
  new.sender_address is null
  and (old.status ->> 'approved') is null
  and (new.status ->> 'approved') is not null
  and (new.status ->> 'pending') is not null
  and new.content ->> 'internal' is null
)
execute function public.dispatcher_edge_function();

-- The waiting approval for a member's decision, locked. Raises unless the
-- caller is a signed-in member who can see the conversation: an API key never
-- approves, not even its own messages.
create function public.zappion_lock_approval(p_message_id uuid)
returns public.zappion_message_approvals
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

-- Sends a held message. The same rules as a direct send still apply: outside
-- the 24h service window only a template may go, and the key's hourly limits
-- count approved sends, so approving a backlog cannot burst past them.
create function public.zappion_approve_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

create function public.zappion_reject_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

revoke execute on function public.zappion_lock_approval(uuid) from public, anon, authenticated;
revoke execute on function public.zappion_approve_message(uuid) from public, anon;
revoke execute on function public.zappion_reject_message(uuid) from public, anon;
grant execute on function public.zappion_approve_message(uuid) to authenticated;
grant execute on function public.zappion_reject_message(uuid) to authenticated;
