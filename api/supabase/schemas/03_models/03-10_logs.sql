create type public.log_level as enum ('info', 'warning', 'error');

create table public.logs (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  organization_address text,
  level public.log_level not null,
  category text not null,
  service public.service,
  message text not null,
  metadata jsonb,
  created_at timestamp with time zone not null default now()
);

alter table only public.logs
add constraint logs_pkey
primary key (id);

-- Both columns are nullable (an org-level log names no account), and under
-- MATCH SIMPLE a null in either one skips the check entirely. The constraint
-- below is what keeps that from becoming a hole: state a service whenever you
-- state an address, so an addressed log is always checked.
alter table only public.logs
add constraint logs_organization_address_needs_service
check (organization_address is null or service is not null);

alter table only public.logs
add constraint logs_organization_address_fkey
foreign key (organization_id, service, organization_address)
references public.organizations_addresses(organization_id, service, address)
on delete cascade;

-- service last, so the leading pair still answers "logs for this account"
-- while all three columns are present for the account cascade above.
create index idx_logs_organization_id_address
on public.logs
using btree (organization_id, organization_address, service);

create index idx_logs_created_at
on public.logs
using btree (created_at desc);

create trigger z_notify_webhook_logs
after insert
on public.logs
for each row
execute function public.notify_webhook();