-- Remove the before-insert strip of status.pending on content.internal rows.
-- Record-only rows are born unarmed by their writer (agent-client inserts
-- them with status {}); pending is the declared arm bit. The WHEN clauses
-- that must not depend on writer discipline restate the internal guard —
-- which handle_local_message_to_agent now does too, mirroring the dispatch
-- trigger.

drop trigger if exists "handle_local_message_to_agent" on "public"."messages";

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
  -- vs record-only is decided by content kind + status.pending, not by
  -- authorship (see the dispatch trigger's kind whitelist).
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

CREATE TRIGGER handle_local_message_to_agent AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.agent_id IS NOT NULL) AND (new.service = 'local'::public.service) AND ((new.status ->> 'pending'::text) IS NOT NULL) AND ((new.content ->> 'internal'::text) IS NULL))) EXECUTE FUNCTION public.local_message_to_agent();


