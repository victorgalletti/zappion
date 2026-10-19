-- `content.internal: true` — the successor of `direction: 'internal'`.
--
-- A record-only row (tool trace, agent error, internal note) now declares
-- itself in the content, where the marker travels with the message. Clients
-- write it; the triggers only read it: before_insert strips status.pending,
-- preserve_message_direction keeps a later merge from re-arming, and the
-- dispatch WHEN clause refuses it outright. It is NOT translated back into
-- the direction column — the flag replaces the value, it does not feed it.

drop trigger if exists "handle_outgoing_message_to_dispatcher" on "public"."messages";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.before_insert_on_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
    -- No 'internal' branch on purpose: content.internal (the successor of
    -- direction = 'internal') is not translated back into the column it
    -- replaces. The only writer of internal rows still says direction
    -- explicitly, and a new writer that omits it gets 'outgoing' — harmless,
    -- since the strip below and the dispatch WHEN clause read the content,
    -- not the direction.
    new.direction := case
      when new.sender_address is not null then 'incoming'::public.direction
      else 'outgoing'::public.direction
    end;
  end if;

  -- Internal rows (tool traces, notes, agent errors) are record-only and
  -- never need the pending arm bit — strip it so no automation (dispatch,
  -- retry sweeps, media preprocessing) can ever pick them up. This also IS
  -- the deprecation of dispatching agent errors. The content test is the
  -- rule; the direction test covers legacy writers that still say it there.
  if new.direction = 'internal'::public.direction
    or new.content->>'internal' = 'true' then
    new.status := new.status - 'pending';
  end if;

  -- If conversation_id is already provided, proceed as is
  if new.conversation_id is not null then
    return new;
  end if;

  -- Look up conversation_id. A conversation IS a channel, so this is an exact
  -- hit on conversations_identity_idx — no `status` predicate (the session
  -- dimension is gone) and no most-recent tiebreak (the key is unique).
  --
  -- organization_id is in the predicate so the scan can start from the index's
  -- leading column. Plain equality throughout: conversation_address is never
  -- null, so the old `is not distinct from` — which is not indexable and
  -- degraded it to a filter over every conversation on the account — is gone.
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

  -- Internal rows can never be armed — not even by a later merged update.
  -- This runs BEFORE set_status (trigger order is alphabetical), so the
  -- merge never sees a pending key. content.internal is the marker;
  -- old.direction covers rows that predate it.
  if
    (
      old.direction = 'internal'::public.direction
      or old.content->>'internal' = 'true'
    )
    and new.status is not null
  then
    new.status := new.status - 'pending';
  end if;

  return new;
end;
$function$
;

CREATE TRIGGER handle_outgoing_message_to_dispatcher AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NULL) AND (new."timestamp" <= now()) AND ((new.status ->> 'pending'::text) IS NOT NULL) AND ((new.content ->> 'kind'::text) = ANY (ARRAY['text'::text, 'audio'::text, 'image'::text, 'video'::text, 'document'::text, 'sticker'::text, 'file'::text, 'media'::text, 'reaction'::text, 'location'::text, 'contacts'::text, 'template'::text])) AND ((new.content -> 'tool'::text) IS NULL) AND ((new.content ->> 'internal'::text) IS NULL))) EXECUTE FUNCTION public.dispatcher_edge_function();

-- DML (hand-written): mark the existing internal rows so readers can ask the
-- one key. Limited to rows that satisfy the v1 content shape — the
-- messages_content_schema constraint is NOT VALID but still checked on
-- UPDATE, so rewriting a v0-shaped content would abort the migration. The
-- v0-shaped internal rows that remain lean on the content.tool fallback (and
-- on `direction` itself while it lives).
--
-- User triggers off: merge_update would accept the merge fine, but every
-- webhook subscriber would hear about tens of thousands of rows changing.
alter table public.messages disable trigger user;

update public.messages
set content = content || jsonb_build_object('internal', true)
where direction = 'internal'::public.direction
  and content->>'internal' is distinct from 'true'
  and content <> '{}'::jsonb
  and content->>'version' is not null
  and content->>'type' in ('text', 'file', 'data')
  and content->>'kind' is not null;

alter table public.messages enable trigger user;
