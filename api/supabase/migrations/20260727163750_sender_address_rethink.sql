drop trigger if exists "handle_incoming_message_to_agent" on "public"."messages";

drop trigger if exists "handle_mark_as_read_to_dispatcher" on "public"."messages";

drop trigger if exists "handle_message_to_media_preprocessor" on "public"."messages";

drop trigger if exists "handle_outgoing_message_to_dispatcher" on "public"."messages";

drop trigger if exists "pause_conversation_on_human_message" on "public"."messages";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.before_insert_on_messages()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- Transition compat (direction → sender_address, contact_address →
  -- conversation_address): legacy writers still send direction +
  -- contact_address; new writers send sender_address/conversation_address
  -- only. Derive whichever side is missing so both stay consistent until
  -- direction and contact_address are dropped.
  --
  -- sender_address is a contact reference or null: the peer who authored the
  -- message (a phone/BSUID, a Slack workspace member — ties to
  -- contacts_addresses), or null when the account itself spoke. Deliverable
  -- vs record-only is decided by content kind + status.pending, not by
  -- authorship (see the dispatch trigger's kind whitelist).
  if new.conversation_address is null then
    new.conversation_address := new.contact_address;
  end if;

  if new.sender_address is null and new.direction = 'incoming'::public.direction then
    new.sender_address := new.contact_address;
  elsif new.direction is null then
    new.direction := case
      when new.sender_address is not null then 'incoming'::public.direction
      when new.content->'tool' is not null then 'internal'::public.direction
      else 'outgoing'::public.direction
    end;
  end if;

  -- Internal rows (tool traces, notes, agent errors) are record-only and
  -- never need the pending arm bit — strip it so no automation (dispatch,
  -- retry sweeps, media preprocessing) can ever pick them up. This also IS
  -- the deprecation of dispatching agent errors.
  if new.direction = 'internal'::public.direction then
    new.status := new.status - 'pending';
  end if;

  -- If conversation_id is already provided, proceed as is
  if new.conversation_id is not null then
    return new;
  end if;

  -- Look up conversation_id from conversation table. Conversations are keyed
  -- by conversation_address (the peer — individual or group/channel; the
  -- per-message author lives on messages.sender_address). Local-service
  -- messages have no peer, hence `is not distinct from`.
  select id into new.conversation_id
  from public.conversations
  where organization_address = new.organization_address
    and conversation_address is not distinct from new.conversation_address
    and service = new.service
    and status = 'active'
  order by created_at desc
  limit 1;

  -- Create conversation if it doesn't exist. The legacy contact_address is
  -- only meaningful on direct chats (peer = a contact); in group messages
  -- contact_address carries the per-message sender, which must not become
  -- the conversation's peer.
  if new.conversation_id is null then
    insert into public.conversations (
      organization_id,
      organization_address,
      conversation_address,
      contact_address,
      service
    ) values (
      new.organization_id,
      new.organization_address,
      new.conversation_address,
      case
        when new.contact_address = new.conversation_address
        then new.contact_address
      end,
      new.service
    )
    returning id into new.conversation_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.preserve_message_direction()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.direction := old.direction;
  new.sender_address := coalesce(old.sender_address, new.sender_address);
  new.conversation_address := old.conversation_address;
  return new;
end;
$function$
;

CREATE TRIGGER handle_incoming_message_to_agent AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NOT NULL) AND ((new.status ->> 'pending'::text) IS NOT NULL))) EXECUTE FUNCTION public.edge_function('/agent-client', 'post');

CREATE TRIGGER handle_mark_as_read_to_dispatcher AFTER UPDATE ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NOT NULL) AND (new.service <> 'local'::public.service) AND (((old.status ->> 'read'::text) <> (new.status ->> 'read'::text)) OR ((old.status ->> 'typing'::text) <> (new.status ->> 'typing'::text))) AND ((new.status ->> 'pending'::text) IS NOT NULL))) EXECUTE FUNCTION public.dispatcher_edge_function();

CREATE TRIGGER handle_message_to_media_preprocessor AFTER INSERT ON public.messages FOR EACH ROW WHEN ((((new.status ->> 'pending'::text) IS NOT NULL) AND ((new.content ->> 'type'::text) = 'file'::text))) EXECUTE FUNCTION public.edge_function('/media-preprocessor', 'post');

CREATE TRIGGER handle_outgoing_message_to_dispatcher AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NULL) AND (new."timestamp" <= now()) AND ((new.status ->> 'pending'::text) IS NOT NULL) AND ((new.content ->> 'kind'::text) = ANY (ARRAY['text'::text, 'audio'::text, 'image'::text, 'video'::text, 'document'::text, 'sticker'::text, 'file'::text, 'media'::text, 'reaction'::text, 'location'::text, 'contacts'::text, 'template'::text])) AND ((new.content -> 'tool'::text) IS NULL))) EXECUTE FUNCTION public.dispatcher_edge_function();

CREATE TRIGGER pause_conversation_on_human_message AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NULL) AND ((new.content -> 'tool'::text) IS NULL) AND (new.service <> 'local'::public.service) AND (new."timestamp" <= now()) AND (new."timestamp" >= (now() - '00:00:10'::interval)))) EXECUTE FUNCTION public.pause_conversation_on_human_message();



-- No backfill here on purpose. This migration only changes the semantics of
-- sender_address (contact reference or null) and the pending arm bit on
-- internal rows; both are already written that way by the single backfill
-- pass in 20260725154649_unified_addressing_and_visibility.sql, which ships
-- in the same deploy. Correcting those ~135k rows in a second pass would
-- rewrite them across all six indexes of a 360 MB table for no change in
-- outcome.
