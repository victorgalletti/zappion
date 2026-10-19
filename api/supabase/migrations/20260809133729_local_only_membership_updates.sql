drop policy "members can update their own membership rows" on "public"."conversations_agents";


  create policy "members can update their own local membership rows"
  on "public"."conversations_agents"
  as permissive
  for update
  to authenticated
using (((agent_id IN ( SELECT public.get_own_agents() AS get_own_agents)) AND (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversations_agents.conversation_id) AND (c.service = 'local'::public.service))))))
with check (((agent_id IN ( SELECT public.get_own_agents() AS get_own_agents)) AND (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversations_agents.conversation_id) AND (c.service = 'local'::public.service))))));
