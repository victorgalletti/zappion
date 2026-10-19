alter table public.onboarding_tokens enable row level security;

create policy "admins can read their org onboarding tokens"
on public.onboarding_tokens
for select
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('admin')
  )
);

create policy "admins can create onboarding tokens"
on public.onboarding_tokens
for insert
to authenticated, anon
with check (
  organization_id in (
    select public.get_authorized_orgs('admin')
  )
);

create policy "admins can delete onboarding tokens"
on public.onboarding_tokens
for delete
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('admin')
  )
);
