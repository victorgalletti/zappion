-- SPDX-License-Identifier: AGPL-3.0-only
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.set_address_label(p_service public.service, p_address text, p_label text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.organizations_addresses
  set extra = jsonb_build_object('label', to_jsonb(nullif(btrim(p_label), '')))
  where service = p_service
    and address = p_address
    and organization_id in (select public.get_authorized_orgs('admin'));

  if not found then
    raise exception 'address not found' using errcode = 'P0002';
  end if;
end;
$function$
;

  create policy "only admins can upload their orgs logo"
  on "storage"."objects"
  as restrictive
  for insert
  to authenticated, anon
with check (((bucket_id <> 'media'::text) OR ((storage.foldername(name))[3] IS DISTINCT FROM 'logo'::text) OR ((storage.foldername(name))[2] IN ( SELECT (public.get_authorized_orgs('admin'::public.role))::text AS get_authorized_orgs))));

revoke execute on function public.set_address_label(public.service, text, text) from public, anon;
grant execute on function public.set_address_label(public.service, text, text) to authenticated;
