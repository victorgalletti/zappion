-- Slack rotated user tokens (xoxe.xoxp-…) expire ~12 hours after issuance.
-- The dispatcher refreshes inline when it needs a token, but idle connections
-- would silently expire, so this cron sweeps every 4 hours and asks
-- slack-management to refresh any token expiring within the next 12h
-- (connections without a refresh_token — rotation not enabled on the app —
-- are skipped, making this a no-op until rotation is turned on). Mirrors
-- 20260611114049_instagram_token_refresh_cron.sql: net.http_post to the edge
-- function with the edge_functions_token (validated against the service-role
-- key).
select
  cron.schedule(
    'refresh-slack-tokens',
    '30 */4 * * *', -- every 4 hours at :30, offset from the daily jobs
    $$
    select
      net.http_post(
        url:=(select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_url') || '/slack-management/refresh-tokens',
        headers:=jsonb_build_object(
          'content-type', 'application/json',
          'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_token')
        ),
        body:='{}'::jsonb,
        timeout_milliseconds:=10000
      ) as request_id
    $$
  );
