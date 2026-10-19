create table public.conversations (
  organization_id uuid not null,
  id uuid default gen_random_uuid() not null,
  service public.service not null,
  organization_address text not null,
  -- The peer this conversation is with — an individual or a group/channel
  -- address (e.g. WhatsApp phone/group JID, Slack channel id). Soft reference
  -- (no FK): peers span contacts and external containers.
  --
  -- Always present. For services with a real peer it is that peer's address.
  -- `local` has no external peer, so it addresses itself, in one of two ways
  -- (before_insert_on_conversations):
  --
  --   roster   a direct is DEFINED by who is in it — at any arity — so the
  --            address IS the participant list: agent ids, sorted, joined by
  --            ':'. Canonical, so the unique index below is what answers "does
  --            this conversation already exist between these people", for two
  --            participants and for eight alike.
  --   own id   group and channel have a name and a mutable membership, so
  --            their identity is their own, and the address is the row's id.
  --
  -- Keeping it NOT NULL is what lets the identity index below be a plain
  -- unique constraint instead of one whose behaviour depends on NULL
  -- semantics.
  address text not null,
  name text,
  -- The shape of the channel, in one cross-service vocabulary:
  --
  --   direct     member-defined  WhatsApp/Instagram DM, Slack im AND mpim
  --   group      private N       WhatsApp group, Slack/Teams private channel
  --   channel    public N        Slack public channel
  --   broadcast  fan-out         WhatsApp broadcast list
  --
  -- The cut is identity, not arity: a direct IS its member set — at any size
  -- (a Slack mpim is a multi-party direct) — so it can be neither joined nor
  -- left; adding a person names a different conversation. group and channel
  -- are named containers with a membership that changes. broadcast is not a
  -- conversation anyone is in — it fans out to N individual chats on the
  -- receiving side — and exists here because production already carries one
  -- (`…@broadcast`).
  --
  -- `text` + a check, deliberately not an enum: this column is referenced by
  -- an RLS policy, and `db diff` cannot add a value to an enum in that
  -- position (it attempts a recast and fails — see CLAUDE.md). More values
  -- are coming from whatsapp-web (newsletters/Channels), so the enum would
  -- cost a hand-written migration every time.
  --
  -- Set at creation and never changed afterwards, except on `local` where
  -- retyping a group as a channel is a real operation (Slack calls it
  -- "convert to public"). No API role can UPDATE a conversation on any other
  -- service (05-03), so a mirror row cannot be reclassified by a member.
  --
  -- Nullable, with no column default, so that "not classified yet" stays
  -- distinguishable from "classified as direct". Slack needs that: a reaction
  -- or a member_joined can create the row before anything knows the channel's
  -- kind, and ensureConversation re-resolves precisely while it is null. Every
  -- other path fills it — before_insert_on_conversations defaults it to
  -- `direct`, which is what a conversation minted from an incoming message is
  -- unless a connector said otherwise (generic-webhook states `group` for
  -- whatsapp-web group JIDs before the message lands).
  type text,
  -- Holds ingestor-owned facts (is_bot_member, is_multiple, channel_archived,
  -- topic, purpose) as well as cosmetic ones. Safe together because 05-03 grants no
  -- API role UPDATE on any service but `local`: the policy is what keeps
  -- members out, so nothing here needs a column of its own.
  extra jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table only public.conversations
add constraint conversations_organization_id_fkey
foreign key (organization_id)
references public.organizations(id)
on delete cascade;

alter table only public.conversations
add constraint conversations_pkey
primary key (id);

-- Not the identity — `id` alone is already unique — but the target a child
-- table needs to reference a conversation AND its tenant in one constraint,
-- so the two can never drift apart. See conversations_agents.
alter table only public.conversations
add constraint conversations_organization_id_id_key
unique (organization_id, id);

alter table only public.conversations
add constraint conversations_type_check
check (
  type is null
  or type in ('direct', 'group', 'channel', 'broadcast')
);

-- A conversation IS a channel: one row per peer on an account, for the life of
-- that peer. `id` is a convenience surrogate, not the identity.
--
-- This is what removes the lookup-then-insert race: every writer can upsert on
-- this key instead of select-then-maybe-insert.
--
-- Column ORDER is load-bearing, though uniqueness does not depend on it. With
-- organization_address second, the leading columns also serve:
--
--   (organization_id, organization_address, service)  the account FK below, so
--       deleting a connected account cascades by index scan (that cascade took
--       5.4 s against a sequential scan). Equality quals match the leading
--       columns in any order, so the FK's own column order need not agree.
--   (organization_id, organization_address)  "every conversation on this
--       account", the hottest lookup there is — 279k scans reading 539M tuples
--       through a single-column index, ~1.9k rows per probe on a shared number
--       carrying 13k conversations.
--   (organization_id)  the organization cascade.
--
-- Those three single-column indexes are therefore absent by design: this one
-- answers all of them, and each extra index is write cost on an insert path
-- that already runs a trigger cascade.
create unique index conversations_identity_idx
on public.conversations
using btree (organization_id, organization_address, service, address);

-- Cascade (decided 2026-07-24): deleting a connected account deletes its
-- conversations, and messages cascade via conversations_id in turn.
--
-- service is in the reference so a conversation cannot name an account that
-- exists under a DIFFERENT service — the account rule in 04-02 reads visibility
-- off organizations_addresses.agent_id, so a mismatched anchor would decide who
-- sees the conversation.
alter table only public.conversations
add constraint conversations_organization_address_fkey
foreign key (organization_id, service, organization_address)
references public.organizations_addresses(organization_id, service, address)
on delete cascade;

create index conversations_updated_at_idx
on public.conversations
using btree (updated_at);

create index conversations_address_idx
on public.conversations
using btree (address);

create trigger handle_new_conversation
before insert
on public.conversations
for each row
execute function public.before_insert_on_conversations();

create trigger z_notify_webhook_conversations
after insert or update
on public.conversations
for each row
execute function public.notify_webhook();

create trigger preserve_addressing
before update
on public.conversations
for each row
execute function public.preserve_conversation_addressing();

create trigger set_extra
before update
on public.conversations
for each row
when (
  new.extra is not null
)
execute function public.merge_update('extra');

-- A `local` conversation is created by the member who starts it, through
-- PostgREST, so nothing else would record that they are in it — and under the
-- local rule (05-03) a non-`channel` conversation is visible to participants
-- only. Without this the creator would immediately lose sight of what they
-- just made. Service-role and API-key inserts have no auth.uid() and are
-- skipped.
create trigger add_local_participant
after insert
on public.conversations
for each row
when (
  new.service = 'local'::public.service
)
execute function public.after_insert_on_local_conversation();

create trigger set_updated_at
before update
on public.conversations
for each row
execute function public.moddatetime('updated_at');
