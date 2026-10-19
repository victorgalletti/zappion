-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: an organization's own Meta App ("my own Meta App" connection).
--
-- Only the public App ID lives here. The App Secret, the system user token
-- and the webhook verify token are Vault secrets named after the
-- organization (see 04-92), and so is each connected number's access token.
-- Nothing in this table or in Vault is readable by members: the edge
-- functions resolve credentials with the service role, and admins only see
-- "configured" flags plus the verify token they must paste into Meta.
--
-- The App, not the organization, is what Meta signs webhooks with, so the
-- webhook URL carries `?app_id=`. One App belongs to one organization; an
-- App shared by several organizations stays in the environment variables.
create table public.whatsapp_apps (
  organization_id uuid not null,
  app_id text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint whatsapp_apps_app_id_check check (app_id ~ '^[0-9]{5,25}$')
);

alter table only public.whatsapp_apps
add constraint whatsapp_apps_pkey primary key (organization_id);

alter table only public.whatsapp_apps
add constraint whatsapp_apps_app_id_key unique (app_id);

alter table only public.whatsapp_apps
add constraint whatsapp_apps_organization_id_fkey
foreign key (organization_id)
references public.organizations(id)
on delete cascade;

create trigger set_updated_at
before update
on public.whatsapp_apps
for each row
execute function public.moddatetime('updated_at');
