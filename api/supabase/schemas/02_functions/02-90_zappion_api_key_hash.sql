-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: API keys are stored as the hex SHA-256 of the key, never the key.
-- Keys are 192 random bits, so an unsalted hash is enough to make a leaked
-- table useless and still lets a request's key be found with one index probe.
create function public.zappion_hash_api_key(p_key text) returns text
language sql
immutable
strict
set search_path to ''
as $$
  select encode(extensions.digest(p_key, 'sha256'), 'hex');
$$;
