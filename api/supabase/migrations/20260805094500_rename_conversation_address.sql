-- conversations.conversation_address -> conversations.address, matching
-- organizations_addresses.address and contacts_addresses.address. Hand-written:
-- db diff models a rename as drop + add, which would destroy the column.
-- Index and policy definitions follow the rename automatically; function
-- bodies are stored text and are redefined in the follow-up migration.
alter table public.conversations
rename column conversation_address to address;

alter index public.conversations_conversation_address_idx
rename to conversations_address_idx;
