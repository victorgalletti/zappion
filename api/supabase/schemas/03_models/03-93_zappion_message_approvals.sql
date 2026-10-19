-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: messages held for a member's approval. An API key with
-- requires_approval (03-06) cannot send on its own: every outgoing message it
-- inserts is stored unarmed and gets a row here (zappion_hold_for_approval,
-- 04-95). A member approves it, which arms and dispatches it, or rejects it.
create table public.zappion_message_approvals (
  message_id uuid not null,
  organization_id uuid not null,
  conversation_id uuid not null,
  api_key_id uuid,
  -- The key's name when the message was held, so members (who cannot read
  -- api_keys) see who asked.
  api_key_name text not null,
  -- 'message' or 'template': what an approval counts against (04-95).
  send_kind text not null,
  requested_at timestamp with time zone default now() not null,
  -- null while waiting; then 'approved' or 'rejected', by whom and when.
  decision text,
  decided_by uuid,
  decided_at timestamp with time zone,
  constraint zappion_message_approvals_send_kind_check check (
    send_kind in ('message', 'template')
  ),
  constraint zappion_message_approvals_decision_check check (
    decision in ('approved', 'rejected')
  ),
  constraint zappion_message_approvals_decided_check check (
    (decision is null) = (decided_at is null)
  )
);

alter table only public.zappion_message_approvals
add constraint zappion_message_approvals_pkey
primary key (message_id);

alter table only public.zappion_message_approvals
add constraint zappion_message_approvals_message_id_fkey
foreign key (message_id)
references public.messages(id)
on delete cascade;

alter table only public.zappion_message_approvals
add constraint zappion_message_approvals_organization_id_fkey
foreign key (organization_id)
references public.organizations(id)
on delete cascade;

alter table only public.zappion_message_approvals
add constraint zappion_message_approvals_conversation_id_fkey
foreign key (conversation_id)
references public.conversations(id)
on delete cascade;

alter table only public.zappion_message_approvals
add constraint zappion_message_approvals_api_key_id_fkey
foreign key (api_key_id)
references public.api_keys(id)
on delete set null;

alter table only public.zappion_message_approvals
add constraint zappion_message_approvals_decided_by_fkey
foreign key (decided_by)
references public.agents(id)
on delete set null;

-- The inbox badge: what is still waiting, per organization.
create index zappion_message_approvals_waiting_idx
on public.zappion_message_approvals
using btree (organization_id, requested_at)
where decision is null;

-- The approval-time limit: a key's approved sends in the last hour.
create index zappion_message_approvals_key_approved_idx
on public.zappion_message_approvals
using btree (api_key_id, decided_at)
where decision = 'approved';

create index zappion_message_approvals_conversation_idx
on public.zappion_message_approvals
using btree (conversation_id);
