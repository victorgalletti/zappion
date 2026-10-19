-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: whatsapp_apps has no policies on purpose. Members and admins never
-- read or write it directly; admins use whatsapp_app_settings and the
-- whatsapp-management function, which goes through the service role.
alter table public.whatsapp_apps enable row level security;

revoke all on table public.whatsapp_apps from anon, authenticated;
