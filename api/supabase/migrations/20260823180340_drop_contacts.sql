drop trigger if exists "set_extra" on "public"."contacts";

drop trigger if exists "set_updated_at" on "public"."contacts";

drop trigger if exists "z_notify_webhook_contacts" on "public"."contacts";

drop trigger if exists "cleanup_orphaned_contact_on_sync" on "public"."contacts_addresses";

drop trigger if exists "cleanup_unlinked_address_if_empty" on "public"."contacts_addresses";

drop trigger if exists "manage_contact_on_address_sync" on "public"."contacts_addresses";

drop policy "members can manage their orgs contacts" on "public"."contacts";

drop policy "members can update contacts addresses" on "public"."contacts_addresses";

alter table "public"."contacts" drop constraint "contacts_organization_id_fkey";

alter table "public"."contacts_addresses" drop constraint "contacts_addresses_contact_id_fkey";

drop function if exists "public"."cleanup_orphaned_contact_on_sync"();

drop function if exists "public"."cleanup_unlinked_address_if_empty"();

drop function if exists "public"."contact_address_update_rules"(p_organization_id uuid, p_organization_address text, p_service public.service, p_address text, p_extra jsonb, p_status text);

drop function if exists "public"."manage_contact_on_address_sync"();

alter table "public"."contacts" drop constraint "contacts_pkey";

drop index if exists "public"."contacts_addresses_contact_id_idx";

drop index if exists "public"."contacts_organization_id_idx";

drop index if exists "public"."contacts_pkey";

drop table "public"."contacts";

delete from "public"."webhooks" where table_name = 'contacts';

alter type "public"."webhook_table" rename to "webhook_table__old_version_to_be_dropped";

create type "public"."webhook_table" as enum ('messages', 'conversations', 'organizations_addresses', 'contacts_addresses', 'logs');

alter table "public"."webhooks" alter column table_name type "public"."webhook_table" using table_name::text::"public"."webhook_table";

drop type "public"."webhook_table__old_version_to_be_dropped";

alter table "public"."contacts_addresses" drop column "contact_id";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.cleanup_removed_address_if_empty()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
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

  return null;
end;
$function$
;


  create policy "members can update non-synced contacts addresses"
  on "public"."contacts_addresses"
  as permissive
  for update
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address))) AND (((extra -> 'synced'::text) ->> 'action'::text) IS DISTINCT FROM 'add'::text)))
with check (((organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND ((organization_id, service, organization_address) IN ( SELECT v.organization_id,
    v.service,
    v.address
   FROM public.get_visible_addresses() v(organization_id, service, address))) AND (((extra -> 'synced'::text) ->> 'action'::text) IS DISTINCT FROM 'add'::text)));


CREATE TRIGGER cleanup_removed_address_if_empty AFTER UPDATE ON public.contacts_addresses FOR EACH ROW WHEN (((((new.extra -> 'synced'::text) ->> 'action'::text) = 'remove'::text) AND (((old.extra -> 'synced'::text) ->> 'action'::text) IS DISTINCT FROM 'remove'::text))) EXECUTE FUNCTION public.cleanup_removed_address_if_empty();


