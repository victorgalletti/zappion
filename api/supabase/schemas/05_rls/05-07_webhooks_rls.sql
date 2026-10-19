alter table public.webhooks enable row level security;

-- Owners only: a webhook receives the org's traffic, and its headers can
-- carry secrets — pointing one at your own server is exfiltration, so this
-- sits with API keys on the control side of the admin line.
create policy "owners can manage their orgs webhooks"
on public.webhooks
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
