alter table public.conversations_agents enable row level security;

-- This table does two jobs, and the difference decides every policy below:
--
--   PARTICIPATION  On a mirror service it reflects membership of the external
--                  container (a Slack channel's members), and it GRANTS
--                  VISIBILITY — it is the only way into a restricted
--                  conversation. Service-managed, therefore: a member who
--                  could insert here at will could read any private DM in the
--                  workspace by naming its id.
--
--   MEMBER STATE   A row also carries the caller's own state for the
--                  conversation (extra) — read receipts, mute.
--
-- One row does both, so a write for the second reaches the first: UPDATE
-- MOVES rows, and a row that lands on another conversation is a participation
-- its owner just granted themselves — the grant INSERT refuses, arriving by a
-- different verb. So all three write commands take the same line, drawn the
-- way 05-03 draws it on conversations: every write is `local`, where
-- participation is a thing members legitimately manage, and a mirror service
-- is read-only because the truth is on someone else's server. Mirror state
-- included: the row is the sync's, and so is what it carries.
--
-- UI preferences (archived, pinned, drafts) are not member state and do not
-- belong here. A preference has to be settable on any conversation you can
-- SEE — which is every service, and this table is writable on one.
--
-- No recursion: the conversations subqueries below run with the caller's
-- rights and are scoped by conversations RLS, which decides membership
-- through SECURITY DEFINER helpers that read this table without re-entering
-- its policies.

-- Anyone who can see a conversation can see who else is in it (the
-- participant list — same information Slack itself shows).
--
-- `to authenticated` only — no anon, unlike the other policies: anon is the
-- API-key path, and membership can never matter to an API key (the only
-- visibility branch that reads this table requires auth.uid(); API keys see
-- org-wide content only). Membership is a user concept. The table grants
-- match (select granted to authenticated, not anon).
create policy "members can read memberships of visible conversations"
on public.conversations_agents
for select
to authenticated
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id
  )
);

-- Your own row, on a local conversation you can see: editing `extra`, the
-- one column here that is nobody else's business. The visibility test is the
-- plain one — no group/channel split like the two policies below — because
-- this command adds nobody: whichever way you got the row, changing your own
-- state on it changes nothing about who is in the room.
--
-- WITH CHECK re-tests every half, so the row cannot be re-pointed — not at
-- another agent, not at a conversation you cannot see, and not off `local`.
-- (The participation branch of that test reads this table's pre-statement
-- snapshot, so a row cannot bootstrap its own visibility by moving.)
create policy "members can update their own local membership rows"
on public.conversations_agents
for update
to authenticated
using (
  agent_id in (select public.get_own_agents())
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and c.service = 'local'::public.service
  )
)
with check (
  agent_id in (select public.get_own_agents())
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and c.service = 'local'::public.service
  )
);

-- Adding someone to a group, and joining a channel — the two acts the delete
-- policy below undoes, so this is its mirror image: one policy, the same two
-- branches.
--
-- `local` only, like every other write here. A Slack membership is Slack's
-- fact, written by the sync and the webhook with the service role, and a row
-- a member wrote for themselves would desync us until the next sync
-- overwrote it.
--
-- A row for yourself on a conversation that is visible WITHOUT participation
-- is not an exception worth carving out, however harmless it looks: it grants
-- nothing only for as long as the other branch holds. Visibility is `(account
-- rule and not restricted) or participation`, and the two are independent, so
-- when a Slack channel stops being shared because the bot left it, the
-- account branch fails for the whole organization and a self-written row is
-- what keeps its author reading the history everyone else just lost.
--
-- `direct` is absent on purpose, at any size: its roster IS its identity (it
-- is literally its address), so adding a person would not extend the
-- conversation, it would name a different one. Starting that conversation is
-- how you get it.
--
-- One policy, not two, because permissive with-checks OR across every policy
-- on the command (see the header on 05-04): each half would have to restate
-- the other's authority test to avoid handing its permission over.
create policy "members can create local membership rows"
on public.conversations_agents
for insert
to authenticated
with check (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and c.service = 'local'::public.service
      and (
        -- Adding: a group you are in. There are no roles yet, so this is
        -- deliberately flat. "You can only add people to rooms you are in" —
        -- stated, not implied: a clause describing only the SHAPE of the
        -- target would let any authenticated user add anyone to any local
        -- group in the database, other tenants' included.
        (
          c.type = 'group'
          and conversation_id in (select public.get_participant_conversations())
        )
        -- Joining: self-service, since a local channel is open to the
        -- organization by shape. Naming your own agent is the authority.
        or (
          c.type = 'channel'
          and agent_id in (select public.get_own_agents())
        )
      )
  )
);

-- Kicking (local groups) and leaving (local channels). Same rosters-are-fixed
-- rule as above: there is no leaving a direct, because the room
-- without you is a different room.
--
-- Mirror services are absent: a Slack membership row is Slack's fact, and
-- deleting it here would only desync us until the next sync put it back.
create policy "members can delete local membership rows"
on public.conversations_agents
for delete
to authenticated
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and c.service = 'local'::public.service
      and (
        -- Kicking: same rule as adding, and for the same reason — shape alone
        -- would let anyone empty any group in the database.
        (
          c.type = 'group'
          and conversation_id in (select public.get_participant_conversations())
        )
        -- Leaving: naming your own agent is the authority.
        or (
          c.type = 'channel'
          and agent_id in (select public.get_own_agents())
        )
      )
  )
);
