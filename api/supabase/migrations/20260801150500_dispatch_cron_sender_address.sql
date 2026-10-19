-- The dispatch retry sweep still selected on `direction`, a column on its way
-- out. The trigger it backstops (handle_outgoing_message_to_dispatcher) arms
-- on `sender_address is null` — nobody but the account itself authored the row
-- — so the sweep must ask the same question, or the two disagree the day
-- direction is dropped.
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
