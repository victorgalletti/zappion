drop policy "members can create their own membership rows" on "public"."conversations_agents";

drop policy "members can manage local group membership" on "public"."conversations_agents";

create policy "members can create local membership rows"
on "public"."conversations_agents"
as permissive
for insert
to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversations_agents.conversation_id) AND (c.service = 'local'::public.service) AND (((c.type = 'group'::text) AND (conversations_agents.conversation_id IN ( SELECT public.get_participant_conversations() AS get_participant_conversations))) OR ((c.type = 'channel'::text) AND (conversations_agents.agent_id IN ( SELECT public.get_own_agents() AS get_own_agents))))))));
