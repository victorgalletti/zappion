-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: a display name for each connected number ("instância").
--
-- organizations_addresses is read-only to members (05-01: managed by the
-- system), so admins get this one narrow write: extra.label. An empty label
-- removes it (null is merge_update's removal sentinel).
create function public.set_address_label(
  p_service public.service,
  p_address text,
  p_label text
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

revoke execute on function public.set_address_label(public.service, text, text) from public, anon;
grant execute on function public.set_address_label(public.service, text, text) to authenticated;
