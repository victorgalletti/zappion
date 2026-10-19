-- FRONTEND NOTE: PostgreSQL checks INSERT policy BEFORE conflict detection.
-- A member upsert whose payload carries synced.action='add' fails even if the
-- row exists — use .update() to touch a synced row.

create table public.contacts_addresses (
  organization_id uuid not null,
  organization_address text not null,
  service public.service not null,
  address text not null,
  extra jsonb,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- A row is an entry in ONE connection's address book, so the account key
-- (organization_id, service, organization_address) is part of the PK:
--
--   * service: the same canonical address (e.g. bare phone digits shared by
--     'whatsapp' and 'whatsapp-web') is a separate row per service.
--   * organization_address: opaque counterpart ids (BSUID, LID) are only
--     meaningful relative to the account that observed them, and each
--     connection syncs its own contact list — the same person reachable
--     through two of the org's numbers is a row per number. Visibility
--     follows the account too (a personal connection's contacts are the
--     owner's, see 05-02).
--
-- There is deliberately no cross-service/cross-account identity layer:
-- zappion is a comm layer, and who-is-who across services belongs to the
-- consumer.
alter table only public.contacts_addresses
add constraint contacts_addresses_pkey
primary key (organization_id, organization_address, service, address);

-- service is inside the reference so a contact row can never claim an account
-- of a different service, exactly as conversations does.
alter table only public.contacts_addresses
add constraint contacts_addresses_organization_address_fkey
foreign key (organization_id, service, organization_address)
references public.organizations_addresses(organization_id, service, address)
on delete cascade;

alter table only public.contacts_addresses
add constraint contacts_addresses_organization_id_fkey
foreign key (organization_id)
references public.organizations(id)
on delete cascade;

create trigger set_extra
before update
on public.contacts_addresses
for each row
when (
  new.extra is not null
)
execute function public.merge_update('extra');

create trigger set_updated_at
before update
on public.contacts_addresses
for each row
execute function public.moddatetime('updated_at');

create trigger z_notify_webhook_contacts_addresses
after insert or update
on public.contacts_addresses
for each row
execute function public.notify_webhook();

-- A synced REMOVE means the entry left the service's address book: drop the
-- row too, unless conversation history still references the address — then it
-- stays (its extra keeps naming that history), flagged by synced.action.
create trigger cleanup_removed_address_if_empty
after update
on public.contacts_addresses
for each row
when (
  new.extra->'synced'->>'action' = 'remove'
  and old.extra->'synced'->>'action' is distinct from 'remove'
)
execute function public.cleanup_removed_address_if_empty();

-- Lookup by BSUID (e.g. the user_id_update handler matching extra.bsuid).
create index contacts_addresses_bsuid_idx
on public.contacts_addresses
using btree ((extra->>'bsuid'))
where service = 'whatsapp';

-- Lookup by the replaced_by_bsuid trail when linking a new address back to the
-- old contact after a BSUID change.
create index contacts_addresses_replaced_by_bsuid_idx
on public.contacts_addresses
using btree ((extra->>'replaced_by_bsuid'))
where service = 'whatsapp';
