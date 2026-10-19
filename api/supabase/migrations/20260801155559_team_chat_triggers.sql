-- Team chat is not the AI's, and Slack is team chat.
--
-- Two triggers stop firing for it. The agent trigger, because agent-client
-- refuses those services anyway and a mirrored workspace would burn an
-- invocation per message to hear it. The mark-as-read trigger, because
-- reading a colleague's message is not a receipt owed to anyone outside — and
-- on Slack there is no user-token API to deliver one with. Both matter now
-- that Slack rows carry status.pending like every other inbound message.

drop trigger if exists "handle_incoming_message_to_agent" on "public"."messages";

drop trigger if exists "handle_mark_as_read_to_dispatcher" on "public"."messages";

CREATE TRIGGER handle_incoming_message_to_agent AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NOT NULL) AND (new.service <> ALL (ARRAY['local'::public.service, 'slack'::public.service])) AND ((new.status ->> 'pending'::text) IS NOT NULL))) EXECUTE FUNCTION public.edge_function('/agent-client', 'post');

CREATE TRIGGER handle_mark_as_read_to_dispatcher AFTER UPDATE ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NOT NULL) AND (new.service <> ALL (ARRAY['local'::public.service, 'slack'::public.service])) AND (((old.status ->> 'read'::text) <> (new.status ->> 'read'::text)) OR ((old.status ->> 'typing'::text) <> (new.status ->> 'typing'::text))) AND ((new.status ->> 'pending'::text) IS NOT NULL))) EXECUTE FUNCTION public.dispatcher_edge_function();
