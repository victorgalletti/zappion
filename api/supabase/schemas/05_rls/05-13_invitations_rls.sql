alter table public.invitations enable row level security;

-- Everyone in the organization sees its invitations, because the members list
-- shows pending ones alongside members — which is how it worked when an
-- invitation WAS an agents row covered by "members can read their orgs
-- agents".
create policy "members can read their orgs invitations"
on public.invitations
for select
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
);

-- The invitee, who is by definition not in the organization yet and so cannot
-- reach the policy above. Matched on the JWT's email: an API key authenticates
-- without one, so `anon` is absent here on purpose.
--
-- Only pending rows. There is no reason to hand someone the history of offers
-- they already answered, and the partial index is on the same predicate.
create policy "invitees can read their own invitations"
on public.invitations
for select
to authenticated
using (
  status = 'pending'
  and lower(email) = lower((select auth.jwt()->>'email'))
);

-- Sending, editing, revoking and deleting — owners only, matching who may
-- manage agents. Note that this deliberately does NOT let an owner mark an
-- invitation accepted into existence: status is bookkeeping, and membership
-- comes from an agents row, which only accept_invitation() writes.
create policy "owners can manage their orgs invitations"
on public.invitations
for all
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
);
