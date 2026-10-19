-- SPDX-License-Identifier: AGPL-3.0-only
-- Zappion: members see the approvals of messages they can see. Nobody writes
-- them through the API: the triggers and zappion_approve_message /
-- zappion_reject_message (04-95) do, as security definer.
alter table public.zappion_message_approvals enable row level security;

revoke insert, update, delete on table public.zappion_message_approvals from anon, authenticated;

-- The subquery on messages runs under the caller's own messages policy, so
-- visibility is exactly the message's.
create policy "members can read their orgs message approvals"
on public.zappion_message_approvals
for select
to authenticated
using (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  and message_id in (select m.id from public.messages m)
);
