alter table public.messages enable row level security;

-- Note: messages cannot be edited or deleted by the user.

create policy "members can read their orgs messages"
on public.messages
for select
to authenticated, anon
using (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  -- Account rule, minus the restricted set; or
  -- participation. All three subqueries are InitPlans (evaluated once, then
  -- hash-probed per row). See 04-02_visibility_helpers.sql.
  and (
    (
      (organization_id, service, organization_address) in (
        select v.organization_id, v.service, v.address
        from public.get_visible_addresses() v
      )
      and conversation_id not in (select public.get_restricted_conversations())
    )
    or conversation_id in (select public.get_participant_conversations())
  )
);

-- conversation_id is filled by before_insert_on_messages when missing; RLS
-- WITH CHECK runs after BEFORE triggers, so the visibility check sees it.
create policy "members can create their orgs messages"
on public.messages
for insert
to authenticated, anon
with check (
  organization_id in (
    select public.get_authorized_orgs('member')
  )
  -- Account rule, minus the restricted set; or
  -- participation. All three subqueries are InitPlans (evaluated once, then
  -- hash-probed per row). See 04-02_visibility_helpers.sql.
  and (
    (
      (organization_id, service, organization_address) in (
        select v.organization_id, v.service, v.address
        from public.get_visible_addresses() v
      )
      and conversation_id not in (select public.get_restricted_conversations())
    )
    or conversation_id in (select public.get_participant_conversations())
  )
);
