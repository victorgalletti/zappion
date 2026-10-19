-- SPDX-License-Identifier: AGPL-3.0-only

  create table "public"."whatsapp_apps" (
    "organization_id" uuid not null,
    "app_id" text not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."whatsapp_apps" enable row level security;

CREATE UNIQUE INDEX whatsapp_apps_app_id_key ON public.whatsapp_apps USING btree (app_id);

CREATE UNIQUE INDEX whatsapp_apps_pkey ON public.whatsapp_apps USING btree (organization_id);

alter table "public"."whatsapp_apps" add constraint "whatsapp_apps_pkey" PRIMARY KEY using index "whatsapp_apps_pkey";

alter table "public"."whatsapp_apps" add constraint "whatsapp_apps_app_id_check" CHECK ((app_id ~ '^[0-9]{5,25}$'::text)) not valid;

alter table "public"."whatsapp_apps" validate constraint "whatsapp_apps_app_id_check";

alter table "public"."whatsapp_apps" add constraint "whatsapp_apps_app_id_key" UNIQUE using index "whatsapp_apps_app_id_key";

alter table "public"."whatsapp_apps" add constraint "whatsapp_apps_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."whatsapp_apps" validate constraint "whatsapp_apps_organization_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.whatsapp_access_token(p_organization_id uuid, p_address text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.zappion_get_secret('zappion:whatsapp_token:' || p_organization_id || ':' || p_address),
    public.zappion_get_secret('zappion:whatsapp_system_token:' || p_organization_id)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_address_token_set(p_organization_id uuid, p_address text, p_token text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.zappion_put_secret('zappion:whatsapp_token:' || p_organization_id || ':' || p_address, p_token);
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_app_credentials(p_app_id text)
 RETURNS TABLE(organization_id uuid, app_id text, app_secret text, system_token text, verify_token text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.organization_id, a.app_id,
    public.zappion_get_secret('zappion:whatsapp_app_secret:' || a.organization_id),
    public.zappion_get_secret('zappion:whatsapp_system_token:' || a.organization_id),
    public.zappion_get_secret('zappion:whatsapp_verify_token:' || a.organization_id)
  from public.whatsapp_apps a
  where a.app_id = btrim(p_app_id);
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_app_delete(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from public.whatsapp_apps where organization_id = p_organization_id;
  perform public.zappion_put_secret('zappion:whatsapp_app_secret:' || p_organization_id, null);
  perform public.zappion_put_secret('zappion:whatsapp_system_token:' || p_organization_id, null);
  perform public.zappion_put_secret('zappion:whatsapp_verify_token:' || p_organization_id, null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_app_save(p_organization_id uuid, p_app_id text, p_app_secret text DEFAULT NULL::text, p_system_token text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_app_settings(p_organization_id uuid)
 RETURNS TABLE(app_id text, has_app_secret boolean, has_system_token boolean, verify_token text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_org_app_credentials(p_organization_id uuid)
 RETURNS TABLE(organization_id uuid, app_id text, app_secret text, system_token text, verify_token text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.organization_id, a.app_id,
    public.zappion_get_secret('zappion:whatsapp_app_secret:' || a.organization_id),
    public.zappion_get_secret('zappion:whatsapp_system_token:' || a.organization_id),
    public.zappion_get_secret('zappion:whatsapp_verify_token:' || a.organization_id)
  from public.whatsapp_apps a
  where a.organization_id = p_organization_id;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_drop_whatsapp_secrets()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_get_secret(p_name text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select decrypted_secret from vault.decrypted_secrets where name = p_name;
$function$
;

CREATE OR REPLACE FUNCTION public.zappion_put_secret(p_name text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

grant delete on table "public"."whatsapp_apps" to "service_role";

grant insert on table "public"."whatsapp_apps" to "service_role";

grant references on table "public"."whatsapp_apps" to "service_role";

grant select on table "public"."whatsapp_apps" to "service_role";

grant trigger on table "public"."whatsapp_apps" to "service_role";

grant truncate on table "public"."whatsapp_apps" to "service_role";

grant update on table "public"."whatsapp_apps" to "service_role";

CREATE TRIGGER zappion_drop_whatsapp_secrets AFTER DELETE ON public.organizations_addresses FOR EACH ROW EXECUTE FUNCTION public.zappion_drop_whatsapp_secrets();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_apps FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

CREATE TRIGGER zappion_drop_whatsapp_secrets AFTER DELETE ON public.whatsapp_apps FOR EACH ROW EXECUTE FUNCTION public.zappion_drop_whatsapp_secrets();



-- Hand-written: db diff does not model function privileges, and functions are
-- executable by PUBLIC by default. Every function that touches a secret is
-- service-role only; whatsapp_app_settings checks the admin role itself.
revoke all on table public.whatsapp_apps from anon, authenticated;

revoke execute on function public.zappion_put_secret(text, text) from public, anon, authenticated, service_role;
revoke execute on function public.zappion_get_secret(text) from public, anon, authenticated, service_role;
revoke execute on function public.zappion_drop_whatsapp_secrets() from public, anon, authenticated;
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
revoke execute on function public.whatsapp_app_settings(uuid) from public, anon;
grant execute on function public.whatsapp_app_settings(uuid) to authenticated, service_role;

-- Hand-written backfill: move every number's Meta token out of
-- organizations_addresses.extra (readable by every member) into Vault. The
-- merge_update trigger treats a null value as "remove this key".
do $backfill$
declare
  r record;
begin
  for r in
    select organization_id, address, extra->>'access_token' as token
    from public.organizations_addresses
    where service = 'whatsapp' and extra ? 'access_token'
  loop
    perform public.whatsapp_address_token_set(r.organization_id, r.address, r.token);
    update public.organizations_addresses
    set extra = jsonb_build_object('access_token', null)
    where organization_id = r.organization_id and service = 'whatsapp' and address = r.address;
  end loop;
end;
$backfill$;
