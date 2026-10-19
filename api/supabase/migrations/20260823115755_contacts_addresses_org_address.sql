drop policy "members can read their orgs contacts addresses" on "public"."contacts_addresses";

drop policy "members can delete non-synced contacts addresses" on "public"."contacts_addresses";

drop policy "members can insert contacts addresses" on "public"."contacts_addresses";

drop policy "members can update contacts addresses" on "public"."contacts_addresses";

drop function if exists "public"."contact_address_update_rules"(p_organization_id uuid, p_service public.service, p_address text, p_extra jsonb, p_status text);

alter table "public"."contacts_addresses" drop constraint "contacts_addresses_pkey";

drop index if exists "public"."contacts_addresses_pkey";

alter table "public"."contacts_addresses" add column "organization_address" text;

-- Backfill: every write path observes contacts through exactly one of the
-- org's connections; the column simply was never recorded. Recover it from
-- the best available source, in order of confidence. Webhook notifications
-- stay off while rows are rewritten.
alter table "public"."contacts_addresses" disable trigger "z_notify_webhook_contacts_addresses";

-- 1. Slack rows carry the workspace (= org address) in extra.
update public.contacts_addresses ca
set organization_address = ca.extra->>'team_id'
where ca.service = 'slack'
  and ca.extra->>'team_id' is not null;

-- 2. Orgs with a single connection of the service: unambiguous.
update public.contacts_addresses ca
set organization_address = oa.address
from public.organizations_addresses oa
where ca.organization_address is null
  and oa.organization_id = ca.organization_id
  and oa.service = ca.service
  and not exists (
    select 1 from public.organizations_addresses oa2
    where oa2.organization_id = ca.organization_id
      and oa2.service = ca.service
      and oa2.address <> oa.address
  );

-- 3. Multi-connection orgs: the direct conversation with the same address
-- names the connection (conversations.address = contacts_addresses.address on
-- direct chats). Ties pick one arbitrarily; the next sync event rewrites it.
update public.contacts_addresses ca
set organization_address = c.organization_address
from (
  select distinct on (organization_id, service, address)
    organization_id, service, address, organization_address
  from public.conversations
) c
where ca.organization_address is null
  and c.organization_id = ca.organization_id
  and c.service = ca.service
  and c.address = ca.address;

-- 4. Rows with no recoverable connection (their account was disconnected):
-- they would be unreachable under the new key and would fail the FK; the next
-- contact sync recreates anything still real.
delete from public.contacts_addresses
where organization_address is null;

alter table "public"."contacts_addresses" enable trigger "z_notify_webhook_contacts_addresses";

alter table "public"."contacts_addresses" alter column "organization_address" set not null;

CREATE UNIQUE INDEX contacts_addresses_pkey ON public.contacts_addresses USING btree (organization_id, organization_address, service, address);

alter table "public"."contacts_addresses" add constraint "contacts_addresses_pkey" PRIMARY KEY using index "contacts_addresses_pkey";

alter table "public"."contacts_addresses" add constraint "contacts_addresses_organization_address_fkey" FOREIGN KEY (organization_id, service, organization_address) REFERENCES public.organizations_addresses(organization_id, service, address) ON DELETE CASCADE not valid;

alter table "public"."contacts_addresses" validate constraint "contacts_addresses_organization_address_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.contact_address_update_rules(p_organization_id uuid, p_organization_address text, p_service public.service, p_address text, p_extra jsonb, p_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return exists (
    select 1 from public.contacts_addresses
    where organization_id = p_organization_id
      and organization_address = p_organization_address
      and address = p_address
      and service = p_service
      and status = p_status
      and extra is not distinct from p_extra
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_unlinked_address_if_empty()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Only if we became unlinked (contact_id IS NULL)
  if new.contact_id is null and old.contact_id is not null then
    -- If no conversations, delete the address. The conversation's address
    -- equals the contact's exactly on direct chats — the only shape that
    -- links a contact in the first place.
    if not exists (
      select 1 from public.conversations c
      where c.organization_id = new.organization_id
        and c.organization_address = new.organization_address
        and c.service = new.service
        and c.address = new.address
    ) then
      delete from public.contacts_addresses
      where organization_id = new.organization_id
        and organization_address = new.organization_address
        and service = new.service
        and address = new.address;
    end if;
  end if;

  return null;
end;
$function$
;


  create policy "members can read visible contacts addresses"
  on "public"."contacts_addresses"
  as permissive
  for select
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address)))));



  create policy "members can delete non-synced contacts addresses"
  on "public"."contacts_addresses"
  as permissive
  for delete
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address))) AND (((extra -> 'synced'::text) ->> 'action'::text) IS DISTINCT FROM 'add'::text)));



  create policy "members can insert contacts addresses"
  on "public"."contacts_addresses"
  as permissive
  for insert
  to authenticated, anon
with check (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address))) AND (((extra -> 'synced'::text) ->> 'action'::text) IS DISTINCT FROM 'add'::text)));



  create policy "members can update contacts addresses"
  on "public"."contacts_addresses"
  as permissive
  for update
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address)))))
with check (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address))) AND public.contact_address_update_rules(organization_id, organization_address, service, address, extra, status)));
