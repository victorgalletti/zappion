-- The deprecation lands: messages.direction, messages.contact_address and
-- conversations.contact_address are dropped, and the `direction` enum with
-- them. Consumers were warned; the CHANGELOG carries the mapping.
--
-- What replaces them was already load-bearing:
--   sender_address        who authored the row (a contact, or null = us)
--   conversation_address  the peer the conversation is with
--   content.internal      record-only rows, the ONE marker
--
-- The v0 rows that direction used to classify are not migrated — v0 is out of
-- support; readers filter on content.version.

drop trigger if exists "preserve_direction" on "public"."messages";

drop trigger if exists "handle_outgoing_message_to_dispatcher" on "public"."messages";

alter table "public"."conversations" drop constraint "conversations_contact_address_fkey";

drop function if exists "public"."preserve_message_direction"();

drop index if exists "public"."conversations_contact_address_idx";

alter table "public"."conversations" drop column "contact_address";

alter table "public"."messages" drop column "contact_address";

alter table "public"."messages" drop column "direction";

drop type "public"."direction";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.preserve_message_addressing()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.sender_address := coalesce(old.sender_address, new.sender_address);
  new.conversation_address := old.conversation_address;

  -- Internal rows can never be armed — not even by a later merged update.
  -- This runs BEFORE set_status (trigger order is alphabetical), so the
  -- merge never sees a pending key.
  if old.content->>'internal' = 'true' and new.status is not null then
    new.status := new.status - 'pending';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.before_insert_on_conversations()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  _declared text[];
  _unknown text[];
  _roster uuid[];
  _caller uuid;
begin
  -- `local` addresses itself, in one of two ways, and the client chooses by
  -- stating a type:
  --
  --   group / channel   A named container whose membership changes. Identity
  --                     is its own; it gets the row's id, further down.
  --   anything else     A ROSTER. The client says who is in it ('A:B:C', any
  --                     order) and this canonicalises to sorted agent ids.
  --                     That canonical form IS the identity, so the unique
  --                     index answers "does this conversation already exist
  --                     between these people" with a conflict — for two
  --                     participants and for eight alike. direct and multiple
  --                     differ only in how many ids there are, so neither is
  --                     a special case of the other.
  --
  -- The author is always in the room they open, so it is added rather than
  -- demanded: you cannot start a conversation you are not in, and omitting the
  -- address entirely is then just a roster of one — a note to self, which is
  -- what the UI's "new conversation" has always produced. One of those per
  -- member, for the same reason there is one DM per pair.
  if new.service = 'local'
    and (new.type is null or new.type in ('direct', 'multiple'))
  then
    -- Null for the service role, which has no agent of its own; a roster it
    -- states is taken as given.
    select a.id into _caller
    from public.agents a
    where a.organization_id = new.organization_id
      and a.user_id = auth.uid();

    _declared := array_remove(
      coalesce(string_to_array(new.conversation_address, ':'), '{}'), ''
    );

    if _caller is not null then
      _declared := _declared || _caller::text;
    end if;

    -- Named before resolved, so the error can say WHICH id failed. Every
    -- malformed roster arrives here: a stranger's id, an agent of another
    -- organization, an uppercased uuid (agent ids render lowercase), a word
    -- that is not a uuid at all.
    _unknown := array(
      select distinct d
      from unnest(_declared) d
      where not exists (
        select 1 from public.agents a
        where a.organization_id = new.organization_id and a.id::text = d
      )
    );

    if array_length(_unknown, 1) is not null then
      raise exception 'Roster names %, not an agent of this organization',
        array_to_string(_unknown, ', ');
    end if;

    -- distinct: naming someone twice is a typo, not a bigger room.
    select array_agg(distinct a.id order by a.id) into _roster
    from public.agents a
    where a.organization_id = new.organization_id
      and a.id::text = any (_declared);

    if _roster is not null then
      new.conversation_address := array_to_string(_roster, ':');

      -- Size decides the shape, so the two can never disagree.
      if array_length(_roster, 1) > 2 then
        new.type := 'multiple';
      else
        new.type := 'direct';
      end if;
    end if;
  end if;

  -- A named container is identified by ITSELF, so its address is not the
  -- client's to choose. A supplied address could name the canonical roster of
  -- two other people — a `group` addressed 'B:C' would occupy the identity
  -- index and make the DM between B and C impossible forever, while neither
  -- could see or delete the row holding it.
  if new.service = 'local' and new.type in ('group', 'channel') then
    new.conversation_address := new.id::text;
  end if;

  -- A conversation minted without a stated shape is 1:1 — that is what an
  -- inbound message from an unknown peer means, and it is the only shape
  -- WhatsApp Cloud and Instagram have. Connectors that know better state it
  -- before the message lands (generic-webhook, for whatsapp-web group JIDs and
  -- broadcast lists).
  --
  -- `slack` is exempt: its ingestor classifies asynchronously and relies on a
  -- null meaning "ask conversations.info again", which a default would erase.
  if new.type is null and new.service <> 'slack' then
    new.type := 'direct';
  end if;

  -- Conversations with external services must have a peer.
  if new.service <> 'local' and new.conversation_address is null then
    raise exception 'Conversations with external services require a conversation_address';
  end if;

  -- A `local` group or channel is identified by itself, not by who is in it,
  -- so it addresses itself: the conversation's own id. Column defaults are
  -- applied before BEFORE-INSERT triggers run, so new.id is already there.
  -- Keeping the column NOT NULL is what lets the identity index be a plain
  -- unique constraint rather than one whose behaviour depends on NULL
  -- semantics.
  if new.conversation_address is null then
    new.conversation_address := new.id::text;
  end if;

  -- No contact bootstrap: writers manage contacts_addresses themselves
  -- (conversation_address is a soft reference by design).
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.before_insert_on_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- The addressing, in two columns (direction and contact_address are gone):
  --
  -- sender_address is a contact reference or null: the peer who authored the
  -- message (a phone/BSUID, a Slack workspace member — ties to
  -- contacts_addresses), or null when the account itself spoke. Deliverable
  -- vs record-only is decided by content kind + status.pending, not by
  -- authorship (see the dispatch trigger's kind whitelist).
  -- conversation_address is the peer the conversation is with.

  -- Internal rows (tool traces, notes, agent errors) are record-only and
  -- never need the pending arm bit — strip it so no automation (dispatch,
  -- retry sweeps, media preprocessing) can ever pick them up. This also IS
  -- the deprecation of dispatching agent errors. content.internal is the one
  -- marker — a tool trace says it too, because its writer says it.
  if new.content->>'internal' = 'true' then
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

CREATE OR REPLACE FUNCTION public.cleanup_unlinked_address_if_empty()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Only if we became unlinked (contact_id IS NULL)
  if new.contact_id is null and old.contact_id is not null then
    -- If no conversations, delete the address. conversation_address equals
    -- the contact's address exactly on direct chats — the only shape that
    -- links a contact in the first place.
    if not exists (
      select 1 from public.conversations c
      where c.organization_id = new.organization_id
        and c.service = new.service
        and c.conversation_address = new.address
    ) then
      delete from public.contacts_addresses
      where organization_id = new.organization_id
        and service = new.service
        and address = new.address;
    end if;
  end if;

  return null;
end;
$function$
;

CREATE TRIGGER preserve_addressing BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.preserve_message_addressing();

CREATE TRIGGER handle_outgoing_message_to_dispatcher AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NULL) AND (new."timestamp" <= now()) AND ((new.status ->> 'pending'::text) IS NOT NULL) AND ((new.content ->> 'kind'::text) = ANY (ARRAY['text'::text, 'audio'::text, 'image'::text, 'video'::text, 'document'::text, 'sticker'::text, 'file'::text, 'media'::text, 'reaction'::text, 'location'::text, 'contacts'::text, 'template'::text])) AND ((new.content ->> 'internal'::text) IS NULL))) EXECUTE FUNCTION public.dispatcher_edge_function();
