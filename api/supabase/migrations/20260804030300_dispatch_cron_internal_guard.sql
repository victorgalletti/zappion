-- The retry sweep backstops handle_outgoing_message_to_dispatcher and must
-- ask the trigger's questions: with the before-insert pending strip gone,
-- pending-absence no longer proves a row is not record-only, so the sweep
-- states the internal guard itself — otherwise an armed internal row (a
-- text-kind tool trace from a writer less disciplined than agent-client)
-- would be re-dispatched to a contact every minute for 12 hours.
--
-- Hand-written: pg_cron schedules are imperative, db diff cannot model them.
select cron.unschedule('dispatch-outgoing-pending-messages');

select
  cron.schedule (
    'dispatch-outgoing-pending-messages',
    '* * * * *',
    $$
    select
      net.http_post(
        url:=(select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_url') || '/' || service || '-dispatcher',
        headers:=jsonb_build_object(
          'content-type', 'application/json',
          'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_token')
        ),
        body:=jsonb_build_object(
          'old_record', null,
          'record', m.*,
          'type', 'INSERT',
          'table', 'messages',
          'schema', 'public'
        ),
        timeout_milliseconds:=10000
      ) as request_id
    from
      public.messages as m
    where
      sender_address is null
      and content ->> 'internal' is null
      and timestamp >= now() - interval '12 hours'
      and timestamp <= now() - interval '1 minutes'
      and status ->> 'pending' is not null
      and status ->> 'held_for_quality_assessment' is null
      and status ->> 'accepted' is null
      and status ->> 'sent' is null
      and status ->> 'delivered' is null
      and status ->> 'read' is null
      and status ->> 'failed' is null
    $$
  );
