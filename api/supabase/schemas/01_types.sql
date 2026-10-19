
create type public.service as enum (
  'whatsapp',
  'instagram',
  'local',
  'slack',
  'discord',
  'teams',
  'whatsapp-web'
);

create type public.webhook_operation as enum ('insert', 'update');

create type public.webhook_table as enum (
  'messages',
  'conversations',
  'organizations_addresses',
  'contacts_addresses',
  'logs'
);

create type public.role as enum ('owner', 'admin', 'member');

-- Zappion: what an organization API key may do in the MCP server. Ordered:
-- each scope includes the ones before it (read < send < admin).
create type public.zappion_api_key_scope as enum ('read', 'send', 'admin');
