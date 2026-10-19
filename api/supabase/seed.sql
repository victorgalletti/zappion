-- Set vault secrets for edge functions

select vault.create_secret(
  'http://api.supabase.internal:8000/functions/v1',
  'edge_functions_url',
  'Edge Functions base URL'
);

-- The service role key is the same for every local project
-- Note: the new secret auth key is not yet available in the Edge Functions environment variables
select vault.create_secret(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  'edge_functions_token',
  'Service role key'
);

-- ============================================================================
-- SEED DATA - Minecraft Creature-Themed Organizations & Users
-- ============================================================================
--
-- Organization Structure:
-- 1. Mountain Peaks (Org 1) - Neutral creatures - Most complete, has all test data
--    - goat@craft.com (owner) - also admin of Plains, pending admin invite from Dark Forest
--    - spider@craft.com (admin)
--    - enderman@craft.com (member)
--    - bat@craft.com (pending invitation - not registered)
--
-- 2. Plains (Org 2) - Passive creatures - For cross-org testing
--    - sheep@craft.com (owner)
--    - goat@craft.com (admin - from Org 1)
--
-- 3. Dark Forest (Org 3) - Aggressive creatures - For invitation testing
--    - zombie@craft.com (owner)
--    - goat@craft.com (pending admin invitation - from Org 1)
--
-- ============================================================================

-- Create all 3 organizations
insert into public.organizations (id, name, extra) values
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', 'Mountain Peaks', '{"media_preprocessing": {"mode": "active"}}'),
  ('4b293e9e-5f4a-5b7c-9d0e-1f2a3b4c5d6e', 'Plains', '{"media_preprocessing": {"mode": "active"}}'),
  ('5c3a4f0f-6e5b-6c8d-0e1f-2a3b4c5d6e7f', 'Dark Forest', '{"media_preprocessing": {"mode": "active"}}')
;

-- Create all users
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change) values
  -- Org 1 users (neutral creatures)
  ('00000000-0000-0000-0000-000000000000', '185f2f83-d63a-4c9b-b4a0-7e4a885799e2', 'authenticated', 'authenticated', 'goat@craft.com', crypt('goat', gen_salt('bf')), '{"provider":"email","providers":["email"]}', '{"name": "Goat", "email": "goat@craft.com"}', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '7c8a9b2d-4e3f-5a6b-8c9d-0e1f2a3b4c5d', 'authenticated', 'authenticated', 'spider@craft.com', crypt('spider', gen_salt('bf')), '{"provider":"email","providers":["email"]}', '{"name": "Spider", "email": "spider@craft.com"}', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9d0e1f2a-3b4c-5d6e-7f8a-9b0c1d2e3f4a', 'authenticated', 'authenticated', 'enderman@craft.com', crypt('enderman', gen_salt('bf')), '{"provider":"email","providers":["email"]}', '{"name": "Enderman", "email": "enderman@craft.com"}', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), '', '', '', ''),
  -- Org 2 owner (passive creature)
  ('00000000-0000-0000-0000-000000000000', '296f4de0-7f6c-7d9e-1f2a-3b4c5d6e7f8a', 'authenticated', 'authenticated', 'sheep@craft.com', crypt('sheep', gen_salt('bf')), '{"provider":"email","providers":["email"]}', '{"name": "Sheep", "email": "sheep@craft.com"}', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), '', '', '', ''),
  -- Org 3 owner (aggressive creature)
  ('00000000-0000-0000-0000-000000000000', '3a7f5ef1-8e7d-8e0f-2a3b-4c5d6e7f8a9b', 'authenticated', 'authenticated', 'zombie@craft.com', crypt('zombie', gen_salt('bf')), '{"provider":"email","providers":["email"]}', '{"name": "Zombie", "email": "zombie@craft.com"}', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), '', '', '', '')
;

-- Create auth identities for all users
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
  ('185f2f83-d63a-4c9b-b4a0-7e4a885799e2', '185f2f83-d63a-4c9b-b4a0-7e4a885799e2', '185f2f83-d63a-4c9b-b4a0-7e4a885799e2', '{"sub": "185f2f83-d63a-4c9b-b4a0-7e4a885799e2", "email":"goat@craft.com"}', 'email', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())),
  ('7c8a9b2d-4e3f-5a6b-8c9d-0e1f2a3b4c5d', '7c8a9b2d-4e3f-5a6b-8c9d-0e1f2a3b4c5d', '7c8a9b2d-4e3f-5a6b-8c9d-0e1f2a3b4c5d', '{"sub": "7c8a9b2d-4e3f-5a6b-8c9d-0e1f2a3b4c5d", "email":"spider@craft.com"}', 'email', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())),
  ('9d0e1f2a-3b4c-5d6e-7f8a-9b0c1d2e3f4a', '9d0e1f2a-3b4c-5d6e-7f8a-9b0c1d2e3f4a', '9d0e1f2a-3b4c-5d6e-7f8a-9b0c1d2e3f4a', '{"sub": "9d0e1f2a-3b4c-5d6e-7f8a-9b0c1d2e3f4a", "email":"enderman@craft.com"}', 'email', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())),
  ('296f4de0-7f6c-7d9e-1f2a-3b4c5d6e7f8a', '296f4de0-7f6c-7d9e-1f2a-3b4c5d6e7f8a', '296f4de0-7f6c-7d9e-1f2a-3b4c5d6e7f8a', '{"sub": "296f4de0-7f6c-7d9e-1f2a-3b4c5d6e7f8a", "email":"sheep@craft.com"}', 'email', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())),
  ('3a7f5ef1-8e7d-8e0f-2a3b-4c5d6e7f8a9b', '3a7f5ef1-8e7d-8e0f-2a3b-4c5d6e7f8a9b', '3a7f5ef1-8e7d-8e0f-2a3b-4c5d6e7f8a9b', '{"sub": "3a7f5ef1-8e7d-8e0f-2a3b-4c5d6e7f8a9b", "email":"zombie@craft.com"}', 'email', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()))
;

-- Create agents (org memberships). A member has a user_id; an agent without
-- one is an AI agent (see the AI Agents block below). Invitations are rows in
-- public.invitations now, not agents.
insert into public.agents (name, user_id, organization_id, role) values
  -- Mountain Peaks (Org 1) - Neutral creatures - Complete setup
  ('Goat', '185f2f83-d63a-4c9b-b4a0-7e4a885799e2', '3a182d8d-d6d8-44bd-b021-029915476b8c', 'owner'),
  ('Spider', '7c8a9b2d-4e3f-5a6b-8c9d-0e1f2a3b4c5d', '3a182d8d-d6d8-44bd-b021-029915476b8c', 'admin'),
  ('Enderman', '9d0e1f2a-3b4c-5d6e-7f8a-9b0c1d2e3f4a', '3a182d8d-d6d8-44bd-b021-029915476b8c', 'member'),

  -- Plains (Org 2) - Passive creatures - Owner + Goat as admin
  ('Sheep', '296f4de0-7f6c-7d9e-1f2a-3b4c5d6e7f8a', '4b293e9e-5f4a-5b7c-9d0e-1f2a3b4c5d6e', 'owner'),
  ('Goat', '185f2f83-d63a-4c9b-b4a0-7e4a885799e2', '4b293e9e-5f4a-5b7c-9d0e-1f2a3b4c5d6e', 'admin'),

  -- Dark Forest (Org 3) - Aggressive creatures - Owner only; Goat is invited
  ('Zombie', '3a7f5ef1-8e7d-8e0f-2a3b-4c5d6e7f8a9b', '5c3a4f0f-6e5b-6c8d-0e1f-2a3b4c5d6e7f', 'owner')
;

-- Pending invitations (keyed by email; accept_invitation mints the agent)
insert into public.invitations (organization_id, email, role, invited_by) values
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', 'bat@craft.com', 'member',
   (select id from public.agents where name = 'Goat' and organization_id = '3a182d8d-d6d8-44bd-b021-029915476b8c')),
  ('5c3a4f0f-6e5b-6c8d-0e1f-2a3b4c5d6e7f', 'goat@craft.com', 'admin',
   (select id from public.agents where name = 'Zombie' and organization_id = '5c3a4f0f-6e5b-6c8d-0e1f-2a3b4c5d6e7f'))
;

-- API Keys (for Mountain Peaks)
-- Zappion: stored hashed; the key itself is still 1234567890.
insert into public.api_keys (organization_id, key_hash, key_prefix, role, scope, name) values
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', public.zappion_hash_api_key('1234567890'), '1234567890', 'member', 'send', 'Default')
;

-- Onboarding Tokens (for Mountain Peaks - created by Goat)
insert into public.onboarding_tokens (name, organization_id, expires_at, status, used_at, service) values
  ('Villager Trading Co', '3a182d8d-d6d8-44bd-b021-029915476b8c', now() + interval '7 days', 'active', null, 'whatsapp'),
  ('Old Nether Portal', '3a182d8d-d6d8-44bd-b021-029915476b8c', now() - interval '1 day', 'expired', null, 'whatsapp'),
  ('Witch Hut Supply', '3a182d8d-d6d8-44bd-b021-029915476b8c', now() + interval '30 days', 'used', now() - interval '2 days', 'whatsapp')
;

-- AI Agents (for Mountain Peaks) — an agent with no user_id
insert into public.agents (id, name, user_id, organization_id, extra) values
  ('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', 'Creeper', null, '3a182d8d-d6d8-44bd-b021-029915476b8c',
   '{"api_url": "groq", "protocol": "chat_completions", "instructions": "You are a Creeper. You hiss and threaten to explode if anyone gets too close.", "mode": "inactive"}'),
  ('b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e', 'Cartographer', null, '3a182d8d-d6d8-44bd-b021-029915476b8c',
   '{"api_url": "groq", "protocol": "chat_completions", "instructions": "You are a Cartographer villager. You trade emeralds for maps.", "mode": "active", "response_delay_seconds": 0, "tools": [{"name": "calculator", "type": "function", "provider": "local"}, {"type": "http", "label": "Fetch", "config": {"methods": ["GET"], "url": "https://www.wikiloc.com"}, "provider": "local"}]}')
;

-- Organization Addresses - WhatsApp Integration (for Mountain Peaks)
insert into public.organizations_addresses (organization_id, service, address, extra, status) values
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', 'whatsapp', '318232498042593', 
   '{"waba_id": "309222208943804", "phone_number": "5492604237115", "flow_type": "existing_phone_number", "verified_name": "Jaspers Market"}', 'connected'),
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', 'whatsapp', '9876543210',
   '{"waba_id": "309222208943804", "phone_number": "5492604237116", "flow_type": "new_phone_number"}', 'disconnected')
;

-- Contacts Addresses (for Mountain Peaks) - required for conversations FK
insert into public.contacts_addresses (organization_id, organization_address, service, address, extra) values
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', 'whatsapp', '541133525394', '{"name": "Dolphin"}'),
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', 'whatsapp', '541133525395', '{"name": "Wolf"}'),
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', 'whatsapp', '541133525396', '{"name": "Fox"}'),
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', 'whatsapp', '541133525397', '{"name": "Bee", "synced": {"name": "Bee", "action": "add"}}'),
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', 'whatsapp', '541133525398', '{"name": "Polar Bear", "synced": {"name": "Polar Bear", "action": "add"}}'),
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', 'whatsapp', '541133525399', '{"name": "Ocelot"}'), -- Address without contact (Ocelot)
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', 'whatsapp', '541133525400', '{"name": "Axolotl 1"}'), -- Axolotl Address 1
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', 'whatsapp', '541133525401', '{"name": "Axolotl 2"}') -- Axolotl Address 2
;

-- Conversations & Messages (for Mountain Peaks)
insert into public.conversations (id, organization_id, organization_address, address, service, name) values
  ('e5f6a7b8-c9d0-1e2f-3a4b-5c6d7e8f9a0b', '3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', '541133525394', 'whatsapp', 'Map trade'),
  ('f6a7b8c9-d0e1-2f3a-4b5c-6d7e8f9a0b1c', '3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', '541133525395', 'whatsapp', 'Emerald exchange')
;

insert into public.messages (id, conversation_id, organization_id, organization_address, conversation_address, sender_address, service, agent_id, content, status, timestamp) values
  ('a7b8c9d0-e1f2-3a4b-5c6d-7e8f9a0b1c2d', 'e5f6a7b8-c9d0-1e2f-3a4b-5c6d7e8f9a0b', '3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', '541133525394', '541133525394', 'whatsapp', null,
   '{"kind": "text", "text": "Do you have any ocean explorer maps?", "type": "text", "version": "1"}', '{"delivered": "2024-01-01T09:00:00Z"}', now() - interval '10 minutes'),
  ('b8c9d0e1-f2a3-4b5c-6d7e-8f9a0b1c2d3e', 'e5f6a7b8-c9d0-1e2f-3a4b-5c6d7e8f9a0b', '3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', '541133525394', null, 'whatsapp', 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e',
   '{"kind": "text", "text": "Yes, for 13 emeralds and a compass.", "type": "text", "version": "1"}', '{"sent": "2024-01-01T09:01:00Z", "delivered": "2024-01-01T09:01:05Z"}', now() - interval '5 minutes'),
  ('c9d0e1f2-a3b4-5c6d-7e8f-9a0b1c2d3e4f', 'f6a7b8c9-d0e1-2f3a-4b5c-6d7e8f9a0b1c', '3a182d8d-d6d8-44bd-b021-029915476b8c', '318232498042593', '541133525395', '541133525395', 'whatsapp', null,
   '{"kind": "text", "text": "I have 32 rotten flesh to trade.", "type": "text", "version": "1"}', '{"delivered": "2024-01-01T14:00:00Z"}', now() - interval '1 minute')
;

-- Webhooks (for Mountain Peaks)
insert into public.webhooks (organization_id, table_name, operations, url, token) values
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', 'messages',
   ARRAY['insert', 'update']::webhook_operation[],
   'http://127.0.0.1:54321/rest/v1/messages', 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'),
  ('3a182d8d-d6d8-44bd-b021-029915476b8c', 'conversations',
   ARRAY['insert']::webhook_operation[],
   'http://127.0.0.1:54321/rest/v1/conversations', 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz')
;

