-- EVERY with-check restates its own authority test, and that is not
-- redundancy with the using clause above it. Permissive policies OR by CLAUSE,
-- not by policy: the new row is accepted if ANY policy's with-check passes,
-- whether or not that policy's using clause is what admitted the row. A
-- with-check that only pins columns therefore hands its permission to every
-- other policy on the table.
--
-- That is exactly how a member could promote themselves before this file was
-- rewritten. "owners can update their orgs agents" checked `using (owner)` but
-- its with-check was the column pin alone, and the column pin said nothing
-- about role — so a member selected their own row through "members can update
-- themselves", set role to owner, failed that policy's with-check, and passed
-- the owner policy's. Fixed here; see the CHANGELOG.
--
-- The whole model, in one place: you see everyone in your organizations, you
-- edit yourself, admins edit anyone and run the AI roster, owners do
-- anything, and you can leave. Only owners grant roles and remove people —
-- control over PEOPLE is the owner's line, and `user_id is null` is how these
-- policies draw it: an AI agent is staff, not membership.

alter table public.agents enable row level security;

create policy "members can read their orgs agents"
on public.agents
for select
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
);

-- Name, picture, extra. Not your own role — that is the whole point of the
-- role check in the helper.
create policy "members can update themselves"
on public.agents
for update
to authenticated
using (
  user_id = (select auth.uid())
)
with check (
  user_id = (select auth.uid())
  and public.agent_identity_and_role_unchanged(id, user_id, organization_id, role)
);

-- Admins maintain the roster: renaming a colleague, retiring an AI agent's
-- prompt. Everything except who anyone is and what they may do.
create policy "admins can update their orgs agents"
on public.agents
for update
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('admin')
  )
)
with check (
  organization_id in (
    select public.get_authorized_orgs('admin')
  )
  and public.agent_identity_and_role_unchanged(id, user_id, organization_id, role)
);

-- `user_id is null` here is what makes invitations the only door for people.
-- An admin may mint AI agents freely; conjuring a row that names a human
-- would hand that person a membership they never accepted. The two paths that
-- legitimately insert a row with a user_id — organization creation and
-- accept_invitation — are SECURITY DEFINER and never see this policy.
create policy "admins can create their orgs ai agents"
on public.agents
for insert
to authenticated, anon
with check (
  organization_id in (
    select public.get_authorized_orgs('admin')
  )
  and user_id is null
);

-- The AI half of the delete below, at admin. Removing a PERSON stays with
-- owners: it is membership control, like roles and invitations.
create policy "admins can delete their orgs ai agents"
on public.agents
for delete
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('admin')
  )
  and user_id is null
);

-- Owners additionally set roles. Identity still cannot move — even an owner
-- gets no tenant escape or impersonation.
create policy "owners can update their orgs agents"
on public.agents
for update
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('owner')
  )
)
with check (
  organization_id in (
    select public.get_authorized_orgs('owner')
  )
  and public.agent_identity_unchanged(id, user_id, organization_id)
);

create policy "owners can delete their orgs agents"
on public.agents
for delete
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('owner')
  )
);

-- Leaving. The delete is turned into a mark by mark_agent_deleted, and refused
-- outright by prevent_last_owner_deletion if you are the last owner — hand the
-- organization over first.
create policy "members can delete themselves"
on public.agents
for delete
to authenticated
using (
  user_id = (select auth.uid())
);
