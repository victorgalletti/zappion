drop policy "owners can create their orgs agents" on "public"."agents";

drop policy "owners can create onboarding tokens" on "public"."onboarding_tokens";

drop policy "owners can delete onboarding tokens" on "public"."onboarding_tokens";

drop policy "owners can read their org onboarding tokens" on "public"."onboarding_tokens";

drop policy "admins can update their orgs, without changing their name" on "public"."organizations";

drop policy "owners can update their orgs" on "public"."organizations";


drop function if exists "public"."org_update_by_admin_rules"(p_id uuid, p_name text);


  create policy "admins can create their orgs ai agents"
  on "public"."agents"
  as permissive
  for insert
  to authenticated, anon
with check (((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)) AND (user_id IS NULL)));


  create policy "admins can delete their orgs ai agents"
  on "public"."agents"
  as permissive
  for delete
  to authenticated, anon
using (((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)) AND (user_id IS NULL)));


  create policy "admins can create onboarding tokens"
  on "public"."onboarding_tokens"
  as permissive
  for insert
  to authenticated, anon
with check ((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)));


  create policy "admins can delete onboarding tokens"
  on "public"."onboarding_tokens"
  as permissive
  for delete
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)));


  create policy "admins can read their org onboarding tokens"
  on "public"."onboarding_tokens"
  as permissive
  for select
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)));


  create policy "admins can update their orgs"
  on "public"."organizations"
  as permissive
  for update
  to authenticated, anon
using ((id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)))
with check ((id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)));
