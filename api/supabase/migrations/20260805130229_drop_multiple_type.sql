-- `multiple` was write-only: derived from roster size on local, mapped from
-- Slack's mpim, and read by nobody — every branch listed it alongside
-- `direct`. The cut that matters is identity, not arity: a direct IS its
-- member set at any size, so mpim is a multi-party direct. Where the address
-- cannot show the arity (mirror services), it rides as extra.is_multiple.
-- No rows to recast: prod predates the type column and no `multiple` exists.
alter table "public"."conversations" drop constraint "conversations_type_check";

alter table "public"."conversations" add constraint "conversations_type_check" CHECK (((type IS NULL) OR (type = ANY (ARRAY['direct'::text, 'group'::text, 'channel'::text, 'broadcast'::text])))) not valid;

alter table "public"."conversations" validate constraint "conversations_type_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.accept_invitation(invitation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  claims jsonb := auth.jwt();
  caller uuid := auth.uid();
  caller_email text := claims->>'email';
  inv public.invitations;
  agent_id uuid;
begin
  if caller is null or caller_email is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  -- `for update` so two clicks on the same link cannot both pass the pending
  -- test and race to insert.
  select * into inv
  from public.invitations
  where id = invitation_id
    and status = 'pending'
    and lower(email) = lower(caller_email)
  for update;

  if not found then
    raise exception 'no pending invitation for this account'
      using errcode = '42501';
  end if;

  -- Revive a former member rather than mint a second agent: the agent id is
  -- named by message authorship and by the ADDRESS of every local direct
  -- they were in, so a new id would strand both — the old DM would
  -- have no live participant and a new one would appear beside it. This is
  -- also why the unique index on (organization_id, user_id) is total rather
  -- than partial on deleted_at: it has to see the marked row to conflict with
  -- it.
  --
  -- SECURITY DEFINER carries this past preserve_agent_deletion, which pins
  -- deleted_at for every role but the owner's — clearing it is exactly the
  -- privilege being exercised here, and only here.
  insert into public.agents (organization_id, user_id, name, role)
  values (
    inv.organization_id,
    caller,
    coalesce(claims->'user_metadata'->>'full_name', caller_email),
    inv.role
  )
  on conflict (organization_id, user_id) do update
    set deleted_at = null,
        -- The invitation decides the role of someone coming back, so a
        -- re-added owner does not silently return as one. An agent who never
        -- left keeps theirs: an invitation must not be a side channel for
        -- demoting a sitting member.
        role = case
          when public.agents.deleted_at is not null then excluded.role
          else public.agents.role
        end
  returning id into agent_id;

  update public.invitations
  set status = 'accepted'
  where id = inv.id;

  return agent_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.after_insert_on_local_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.conversations_agents (
    organization_id,
    service,
    organization_address,
    conversation_id,
    agent_id
  )
  select
    new.organization_id,
    new.service,
    new.organization_address,
    new.id,
    a.id
  from public.agents a
  where a.organization_id = new.organization_id
    and case
      when new.type = 'direct'
      then a.id::text = any (string_to_array(new.address, ':'))
      else a.user_id = auth.uid()
    end
  on conflict do nothing;

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
  --                     between these people" with a conflict — a pair and a
  --                     party of eight are the same shape: `direct`.
  --
  -- The author is always in the room they open, so it is added rather than
  -- demanded: you cannot start a conversation you are not in, and omitting the
  -- address entirely is then just a roster of one — a note to self, which is
  -- what the UI's "new conversation" has always produced. One of those per
  -- member, for the same reason there is one DM per pair.
  if new.service = 'local'
    and (new.type is null or new.type = 'direct')
  then
    -- Null for the service role, which has no agent of its own; a roster it
    -- states is taken as given.
    select a.id into _caller
    from public.agents a
    where a.organization_id = new.organization_id
      and a.user_id = auth.uid();

    _declared := array_remove(
      coalesce(string_to_array(new.address, ':'), '{}'), ''
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
      new.address := array_to_string(_roster, ':');
      new.type := 'direct';
    end if;
  end if;

  -- A named container is identified by ITSELF, so its address is not the
  -- client's to choose. A supplied address could name the canonical roster of
  -- two other people — a `group` addressed 'B:C' would occupy the identity
  -- index and make the DM between B and C impossible forever, while neither
  -- could see or delete the row holding it.
  if new.service = 'local' and new.type in ('group', 'channel') then
    new.address := new.id::text;
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
  if new.service <> 'local' and new.address is null then
    raise exception 'Conversations with external services require an address';
  end if;

  -- A `local` group or channel is identified by itself, not by who is in it,
  -- so it addresses itself: the conversation's own id. Column defaults are
  -- applied before BEFORE-INSERT triggers run, so new.id is already there.
  -- Keeping the column NOT NULL is what lets the identity index be a plain
  -- unique constraint rather than one whose behaviour depends on NULL
  -- semantics.
  if new.address is null then
    new.address := new.id::text;
  end if;

  -- No contact bootstrap: writers manage contacts_addresses themselves
  -- (the address is a soft reference by design).
  return new;
end;
$function$
;

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
  -- Two-member rosters only, for now: deleting this guard is the entire
  -- multi-party extension. Group/channel addresses are a single uuid and fail
  -- it too, and `is distinct from` keeps a peerless row (null address) out.
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


