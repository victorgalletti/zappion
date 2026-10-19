drop policy "admins can manage their orgs webhooks" on "public"."webhooks";


  create policy "owners can manage their orgs webhooks"
  on "public"."webhooks"
  as permissive
  for all
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs)))
with check ((organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs)));
