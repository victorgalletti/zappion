alter table public.contacts_addresses enable row level security;

-- A contact row is an entry in one connection's address book, so every policy
-- applies the ACCOUNT rule via get_visible_addresses(): shared inboxes
-- (ownerless accounts) are org-wide, a personal connection's contacts belong
-- to its owner — same rule the account's conversations follow. The org filter
-- is redundant with the visibility set but kept for symmetry with the other
-- policies (and as belt-and-braces, see 04-02).

create policy "members can read visible contacts addresses"
on public.contacts_addresses
for select
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  and (organization_id, service, organization_address) in (
    select v.organization_id, v.service, v.address
    from public.get_visible_addresses() v
  )
);

-- Members can insert addresses (BUT NOT synced "add" ones)
create policy "members can insert contacts addresses"
on public.contacts_addresses
for insert
to authenticated, anon
with check (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  and (organization_id, service, organization_address) in (
    select v.organization_id, v.service, v.address
    from public.get_visible_addresses() v
  )
  and (extra->'synced'->>'action') is distinct from 'add'
);

-- Members can update non-synced addresses. Synced entries mirror the
-- service's address book — only the service writes them, same rule as
-- insert/delete below; the with check keeps a member from turning a row
-- into a synced one.
create policy "members can update non-synced contacts addresses"
on public.contacts_addresses
for update
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  and (organization_id, service, organization_address) in (
    select v.organization_id, v.service, v.address
    from public.get_visible_addresses() v
  )
  and (extra->'synced'->>'action') is distinct from 'add'
)
with check (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  and (organization_id, service, organization_address) in (
    select v.organization_id, v.service, v.address
    from public.get_visible_addresses() v
  )
  and (extra->'synced'->>'action') is distinct from 'add'
);

-- Members can delete non-synced addresses
create policy "members can delete non-synced contacts addresses"
on public.contacts_addresses
for delete
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  and (organization_id, service, organization_address) in (
    select v.organization_id, v.service, v.address
    from public.get_visible_addresses() v
  )
  and (extra->'synced'->>'action') is distinct from 'add'
);
