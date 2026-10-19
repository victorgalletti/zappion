-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: WhatsApp credentials kept in Supabase Vault instead of plain
-- columns (see 03-91). Secret names:
--
--   zappion:whatsapp_app_secret:<org>         the org's Meta App Secret
--   zappion:whatsapp_system_token:<org>       the org's system user token
--   zappion:whatsapp_verify_token:<org>       the org's webhook verify token
--   zappion:whatsapp_token:<org>:<address>    a connected number's token
--
-- Every function that returns a secret is service-role only; the edge
-- functions call them. Admins get whatsapp_app_settings, which returns flags
-- and the verify token, never the App Secret or a token.

-- Upserts a Vault secret by name; a null or blank value deletes it.
create function public.zappion_put_secret(p_name text, p_value text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;

  if nullif(btrim(p_value), '') is null then
    if v_id is not null then
      delete from vault.secrets where id = v_id;
    end if;
  elsif v_id is null then
    perform vault.create_secret(btrim(p_value), p_name);
  else
    perform vault.update_secret(v_id, btrim(p_value), p_name);
  end if;
end;
$function$;

create function public.zappion_get_secret(p_name text)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select decrypted_secret from vault.decrypted_secrets where name = p_name;
$function$;

revoke execute on function public.zappion_put_secret(text, text) from public, anon, authenticated, service_role;
revoke execute on function public.zappion_get_secret(text) from public, anon, authenticated, service_role;

-- Saves the org's own Meta App. A null secret/token keeps the stored one; a
-- blank one removes it. Returns the verify token, created on first save.
create function public.whatsapp_app_save(
  p_organization_id uuid,
  p_app_id text,
  p_app_secret text default null,
  p_system_token text default null
) returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_verify text;
begin
  insert into public.whatsapp_apps (organization_id, app_id)
  values (p_organization_id, btrim(p_app_id))
  on conflict (organization_id) do update set app_id = excluded.app_id;

  if p_app_secret is not null then
    perform public.zappion_put_secret('zappion:whatsapp_app_secret:' || p_organization_id, p_app_secret);
  end if;

  if p_system_token is not null then
    perform public.zappion_put_secret('zappion:whatsapp_system_token:' || p_organization_id, p_system_token);
  end if;

  v_verify := public.zappion_get_secret('zappion:whatsapp_verify_token:' || p_organization_id);
  if v_verify is null then
    v_verify := encode(extensions.gen_random_bytes(24), 'hex');
    perform public.zappion_put_secret('zappion:whatsapp_verify_token:' || p_organization_id, v_verify);
  end if;

  return v_verify;
end;
$function$;

-- Removes the org's App and its secrets. Number tokens stay: the numbers keep
-- working with them.
create function public.whatsapp_app_delete(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  delete from public.whatsapp_apps where organization_id = p_organization_id;
  perform public.zappion_put_secret('zappion:whatsapp_app_secret:' || p_organization_id, null);
  perform public.zappion_put_secret('zappion:whatsapp_system_token:' || p_organization_id, null);
  perform public.zappion_put_secret('zappion:whatsapp_verify_token:' || p_organization_id, null);
end;
$function$;

-- The webhook's lookup: who owns this App and with which secrets.
create function public.whatsapp_app_credentials(p_app_id text)
returns table (organization_id uuid, app_id text, app_secret text, system_token text, verify_token text)
language sql
stable
security definer
set search_path to ''
as $function$
  select a.organization_id, a.app_id,
    public.zappion_get_secret('zappion:whatsapp_app_secret:' || a.organization_id),
    public.zappion_get_secret('zappion:whatsapp_system_token:' || a.organization_id),
    public.zappion_get_secret('zappion:whatsapp_verify_token:' || a.organization_id)
  from public.whatsapp_apps a
  where a.app_id = btrim(p_app_id);
$function$;

create function public.whatsapp_org_app_credentials(p_organization_id uuid)
returns table (organization_id uuid, app_id text, app_secret text, system_token text, verify_token text)
language sql
stable
security definer
set search_path to ''
as $function$
  select a.organization_id, a.app_id,
    public.zappion_get_secret('zappion:whatsapp_app_secret:' || a.organization_id),
    public.zappion_get_secret('zappion:whatsapp_system_token:' || a.organization_id),
    public.zappion_get_secret('zappion:whatsapp_verify_token:' || a.organization_id)
  from public.whatsapp_apps a
  where a.organization_id = p_organization_id;
$function$;

-- A number's own token; a null or blank token removes it.
create function public.whatsapp_address_token_set(p_organization_id uuid, p_address text, p_token text)
returns void
language sql
security definer
set search_path to ''
as $function$
  select public.zappion_put_secret('zappion:whatsapp_token:' || p_organization_id || ':' || p_address, p_token);
$function$;

-- The token to call Meta for a number: its own, else the org's system user
-- token. null means "fall back to the environment" (decided by the caller).
create function public.whatsapp_access_token(p_organization_id uuid, p_address text)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    public.zappion_get_secret('zappion:whatsapp_token:' || p_organization_id || ':' || p_address),
    public.zappion_get_secret('zappion:whatsapp_system_token:' || p_organization_id)
  );
$function$;

revoke execute on function public.whatsapp_app_save(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.whatsapp_app_delete(uuid) from public, anon, authenticated;
revoke execute on function public.whatsapp_app_credentials(text) from public, anon, authenticated;
revoke execute on function public.whatsapp_org_app_credentials(uuid) from public, anon, authenticated;
revoke execute on function public.whatsapp_address_token_set(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.whatsapp_access_token(uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_app_save(uuid, text, text, text) to service_role;
grant execute on function public.whatsapp_app_delete(uuid) to service_role;
grant execute on function public.whatsapp_app_credentials(text) to service_role;
grant execute on function public.whatsapp_org_app_credentials(uuid) to service_role;
grant execute on function public.whatsapp_address_token_set(uuid, text, text) to service_role;
grant execute on function public.whatsapp_access_token(uuid, text) to service_role;

-- What an admin may see about the org's App: never a secret, only whether it
-- is set, plus the verify token, which they paste into the Meta dashboard.
create function public.whatsapp_app_settings(p_organization_id uuid)
returns table (app_id text, has_app_secret boolean, has_system_token boolean, verify_token text, updated_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if p_organization_id not in (select public.get_authorized_orgs('admin')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select a.app_id,
    public.zappion_get_secret('zappion:whatsapp_app_secret:' || a.organization_id) is not null,
    public.zappion_get_secret('zappion:whatsapp_system_token:' || a.organization_id) is not null,
    public.zappion_get_secret('zappion:whatsapp_verify_token:' || a.organization_id),
    a.updated_at
  from public.whatsapp_apps a
  where a.organization_id = p_organization_id;
end;
$function$;

revoke execute on function public.whatsapp_app_settings(uuid) from public, anon;
grant execute on function public.whatsapp_app_settings(uuid) to authenticated, service_role;

-- Secrets follow their rows: deleting an App or a number drops its secrets,
-- so a deleted organization leaves nothing behind in Vault.
create function public.zappion_drop_whatsapp_secrets()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_table_name = 'whatsapp_apps' then
    perform public.zappion_put_secret('zappion:whatsapp_app_secret:' || old.organization_id, null);
    perform public.zappion_put_secret('zappion:whatsapp_system_token:' || old.organization_id, null);
    perform public.zappion_put_secret('zappion:whatsapp_verify_token:' || old.organization_id, null);
  elsif old.service = 'whatsapp' then
    perform public.zappion_put_secret('zappion:whatsapp_token:' || old.organization_id || ':' || old.address, null);
  end if;
  return old;
end;
$function$;

revoke execute on function public.zappion_drop_whatsapp_secrets() from public, anon, authenticated;

create trigger zappion_drop_whatsapp_secrets
after delete
on public.whatsapp_apps
for each row
execute function public.zappion_drop_whatsapp_secrets();

create trigger zappion_drop_whatsapp_secrets
after delete
on public.organizations_addresses
for each row
execute function public.zappion_drop_whatsapp_secrets();
