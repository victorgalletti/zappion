-- conversations_agents.service was derived by the a_set_service trigger so a
-- client could not state a service that disagrees with the conversation. The
-- guard defended a collision that cannot occur: a wrong service only passes
-- the account FK if the same address string exists under two services, and
-- the services that populate this table have disjoint address formats
-- (`local` = org uuid, slack = T…:U…). The FK alone is the rule now; every
-- writer states service like any other column.
drop trigger if exists "a_set_service" on "public"."conversations_agents";

drop function if exists "public"."set_conversation_agent_service"();

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.after_insert_on_local_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.conversations_agents (
    organization_id,
    service,
    organization_address,
    conversation_id,
    agent_id
  )
  select
    new.organization_id,
    new.service,
    new.organization_address,
    new.id,
    a.id
  from public.agents a
  where a.organization_id = new.organization_id
    and case
      when new.type in ('direct', 'multiple')
      then a.id::text = any (string_to_array(new.conversation_address, ':'))
      else a.user_id = auth.uid()
    end
  on conflict do nothing;

  return new;
end;
$function$
;


