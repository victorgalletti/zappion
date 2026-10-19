set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.before_insert_on_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _conv record;
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
  -- inserts them with status {}. pending is the declared arm bit, and not
  -- carrying it is also how history-synced rows pass through without waking
  -- any automation.

  -- If conversation_id is stated, the conversation is the authority on the
  -- denormalized addressing: fill what the writer omitted, refuse what they
  -- misstated. These columns are load-bearing at dispatch time — the peer
  -- address is the recipient, organization_address picks the account and its
  -- token, service picks the dispatcher — so drift here is a message to the
  -- wrong place. Together with the update-time freezes (both preserve_*
  -- triggers) this gives the composite-FK guarantee for one PK lookup,
  -- without widening the messages indexes to a four-column text key.
  if new.conversation_id is not null then
    select c.organization_id, c.service, c.organization_address, c.address
    into _conv
    from public.conversations c
    where c.id = new.conversation_id;

    if not found then
      raise exception 'Conversation % does not exist', new.conversation_id;
    end if;

    if new.organization_id is null then
      new.organization_id := _conv.organization_id;
    elsif new.organization_id <> _conv.organization_id then
      raise exception 'organization_id % disagrees with the conversation''s %',
        new.organization_id, _conv.organization_id;
    end if;

    if new.service is null then
      new.service := _conv.service;
    elsif new.service <> _conv.service then
      raise exception 'service % disagrees with the conversation''s %',
        new.service, _conv.service;
    end if;

    if new.organization_address is null then
      new.organization_address := _conv.organization_address;
    elsif new.organization_address <> _conv.organization_address then
      raise exception 'organization_address % disagrees with the conversation''s %',
        new.organization_address, _conv.organization_address;
    end if;

    if new.conversation_address is null then
      new.conversation_address := _conv.address;
    elsif new.conversation_address <> _conv.address then
      raise exception 'conversation_address % disagrees with the conversation''s %',
        new.conversation_address, _conv.address;
    end if;

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
      and address = new.conversation_address;
  end if;

  -- Create conversation if it doesn't exist. Two messages for a peer nobody
  -- has spoken to yet can arrive at once — a webhook batch, or two batches in
  -- flight — and both find nothing above, so the insert has to survive losing
  -- that race rather than raise on conversations_identity_idx. `do nothing`
  -- returns no row when the other writer won; read its id back instead.
  --
  -- A peerless (local) conversation_address is null, which is distinct from
  -- itself in a unique index, so that path never conflicts and always mints.
  if new.conversation_id is null then
    insert into public.conversations (
      organization_id,
      organization_address,
      address,
      service
    ) values (
      new.organization_id,
      new.organization_address,
      new.conversation_address,
      new.service
    )
    on conflict (organization_id, organization_address, service, address)
    do nothing
    returning id into new.conversation_id;

    if new.conversation_id is null then
      select id into new.conversation_id
      from public.conversations
      where organization_id = new.organization_id
        and service = new.service
        and organization_address = new.organization_address
        and address = new.conversation_address;
    end if;
  end if;

  return new;
end;
$function$
;


