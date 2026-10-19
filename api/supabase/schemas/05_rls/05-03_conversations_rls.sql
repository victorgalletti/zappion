alter table public.conversations enable row level security;

-- A conversation is a MIRROR of state that lives on someone else's server: a
-- Slack channel, a WhatsApp chat. Renaming one here does not rename it there,
-- deleting one here does not leave the channel — it just drops our copy, and
-- takes the messages with it (messages.conversation_id cascades). So members
-- get SELECT and nothing else on every service but `local`.
--
-- It is also why `extra` needs no protection of its own. Facts the ingestor
-- owns (is_bot_member, channel_archived, topic, purpose) sit in the same bag
-- as cosmetic ones and stay safe, because no API role holds UPDATE here at
-- all — for the same reason `type` is safe.
--
-- Creation is not granted either. A member starts a conversation by inserting
-- the first MESSAGE; before_insert_on_messages (SECURITY DEFINER) mints the
-- conversation row. That keeps one path for "this chat now exists" instead of
-- two, and means a member cannot pre-seed a row for, say, a Slack channel the
-- bot has not joined. Services that cannot be initiated at all (Instagram,
-- which only allows replies inside its window) fail in the dispatcher, where
-- the real rule lives — not here.
create policy "members can read their orgs conversations"
on public.conversations
for select
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  -- Account rule, minus the restricted set; or participation. All three
  -- subqueries are InitPlans (evaluated once, then hash-probed per row). See
  -- 04-02_visibility_helpers.sql.
  and (
    (
      (organization_id, service, organization_address) in (
        select v.organization_id, v.service, v.address
        from public.get_visible_addresses() v
      )
      and id not in (select public.get_restricted_conversations())
    )
    or id in (select public.get_participant_conversations())
  )
);

-- `local` is ours, so the mirror argument does not apply: there is no other
-- server holding the truth. Members create, rename, retype and delete their
-- own internal conversations directly.
--
-- INSERT cannot test visibility (the row does not exist yet, and its
-- participants are written by the after-insert trigger), so it checks only
-- that the caller is a member of the org. UPDATE and DELETE reuse the SELECT
-- rule: you may change what you can see.
create policy "members can create their orgs local conversations"
on public.conversations
for insert
to authenticated, anon
with check (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  and service = 'local'::public.service
);

create policy "members can update their orgs local conversations"
on public.conversations
for update
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  and service = 'local'::public.service
  and (
    (
      (organization_id, service, organization_address) in (
        select v.organization_id, v.service, v.address
        from public.get_visible_addresses() v
      )
      and id not in (select public.get_restricted_conversations())
    )
    or id in (select public.get_participant_conversations())
  )
)
with check (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  and service = 'local'::public.service
);

create policy "members can delete their orgs local conversations"
on public.conversations
for delete
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  and service = 'local'::public.service
  and (
    (
      (organization_id, service, organization_address) in (
        select v.organization_id, v.service, v.address
        from public.get_visible_addresses() v
      )
      and id not in (select public.get_restricted_conversations())
    )
    or id in (select public.get_participant_conversations())
  )
);
