-- Two removals, same conviction: writers declare what a row is.
--
-- 1. The sendable-kind whitelist on handle_outgoing_message_to_dispatcher.
--    A kind no service can encode should not be inserted armed; a writer
--    that does gets a loud `failed` stamp from the dispatcher (all four
--    classify an unknown kind as permanent) instead of a silent no-op.
--    Record-only exclusion stays, as content.internal.
-- 2. The update-path pending strip in preserve_message_addressing — the
--    insert-path twin was removed in the previous migration.

drop trigger if exists "handle_outgoing_message_to_dispatcher" on "public"."messages";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.before_insert_on_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- The addressing, in two columns:
  --
  -- sender_address is a contact reference or null: the peer who authored the
  -- message (a phone/BSUID, a Slack workspace member — ties to
  -- contacts_addresses), or null when the account itself spoke. Deliverable
  -- vs record-only is decided by status.pending + content.internal, not by
  -- authorship (see the dispatch trigger).
  -- conversation_address is the peer the conversation is with.

  -- Internal rows (tool traces, agent errors) are record-only and are born
  -- unarmed by their writer: agent-client — the one client that writes them —
  -- inserts them with status {}. There is no strip here; pending is the
  -- declared arm bit, and not carrying it is also how history-synced rows
  -- pass through without waking any automation.

  -- If conversation_id is already provided, proceed as is
  if new.conversation_id is not null then
    return new;
  end if;

  -- Look up conversation_id. A conversation IS a channel, so this is an exact
  -- hit on conversations_identity_idx — the key is unique, no most-recent
  -- tiebreak.
  --
  -- organization_id is in the predicate so the scan can start from the index's
  -- leading column. Plain equality throughout: conversation_address is never
  -- null here, and equality (unlike `is not distinct from`) is indexable.
  --
  -- A peerless (local) message with neither conversation_id nor
  -- conversation_address matches nothing and falls through to the insert
  -- below, where the conversations trigger mints an id for it.
  if new.conversation_address is not null then
    select id into new.conversation_id
    from public.conversations
    where organization_id = new.organization_id
      and service = new.service
      and organization_address = new.organization_address
      and conversation_address = new.conversation_address;
  end if;

  -- Create conversation if it doesn't exist.
  if new.conversation_id is null then
    insert into public.conversations (
      organization_id,
      organization_address,
      conversation_address,
      service
    ) values (
      new.organization_id,
      new.organization_address,
      new.conversation_address,
      new.service
    )
    returning id into new.conversation_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.preserve_message_addressing()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.sender_address := coalesce(old.sender_address, new.sender_address);
  new.conversation_address := old.conversation_address;

  return new;
end;
$function$
;

CREATE TRIGGER handle_outgoing_message_to_dispatcher AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NULL) AND (new."timestamp" <= now()) AND ((new.status ->> 'pending'::text) IS NOT NULL) AND ((new.content ->> 'internal'::text) IS NULL))) EXECUTE FUNCTION public.dispatcher_edge_function();


