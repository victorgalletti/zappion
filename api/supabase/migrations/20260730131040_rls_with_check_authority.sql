drop policy "admins can update their orgs agents" on "public"."agents";

drop policy "members can update themselves" on "public"."agents";

drop policy "owners can update their orgs agents" on "public"."agents";

drop policy "members can delete local membership rows" on "public"."conversations_agents";

drop policy "members can manage local group membership" on "public"."conversations_agents";


  create policy "admins can update their orgs agents"
  on "public"."agents"
  as permissive
  for update
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)))
with check (((organization_id IN ( SELECT public.get_authorized_orgs('admin'::public.role) AS get_authorized_orgs)) AND public.agent_identity_and_role_unchanged(id, user_id, organization_id, ai, role)));



  create policy "members can update themselves"
  on "public"."agents"
  as permissive
  for update
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check (((user_id = ( SELECT auth.uid() AS uid)) AND public.agent_identity_and_role_unchanged(id, user_id, organization_id, ai, role)));



  create policy "owners can update their orgs agents"
  on "public"."agents"
  as permissive
  for update
  to authenticated, anon
using ((organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs)))
with check (((organization_id IN ( SELECT public.get_authorized_orgs('owner'::public.role) AS get_authorized_orgs)) AND public.agent_identity_unchanged(id, user_id, organization_id, ai)));



  create policy "members can delete local membership rows"
  on "public"."conversations_agents"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversations_agents.conversation_id) AND (c.service = 'local'::public.service) AND (((c.type = 'group'::text) AND (conversations_agents.conversation_id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations))) OR ((c.type = 'channel'::text) AND (conversations_agents.agent_id IN ( SELECT public.get_own_agents() AS get_own_agents))))))));



  create policy "members can manage local group membership"
  on "public"."conversations_agents"
  as permissive
  for insert
  to authenticated
with check (((conversation_id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations)) AND (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversations_agents.conversation_id) AND (c.service = 'local'::public.service) AND (c.type = 'group'::text))))));



