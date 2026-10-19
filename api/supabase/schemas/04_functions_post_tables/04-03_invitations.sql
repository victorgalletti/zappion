-- Answering an invitation is the one operation that crosses the membership
-- boundary: the caller is not in the organization, and the row it has to write
-- is an agents row there. No policy can express that without also opening
-- agents to strangers, so it lives in a function instead — the invitee holds
-- SELECT on invitations and nothing else (05-13), and these two are the only
-- doors.

-- Returns the agent id the caller now holds in the organization.
create function public.accept_invitation(invitation_id uuid) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  claims jsonb := auth.jwt();
  caller uuid := auth.uid();
  caller_email text := claims->>'email';
  inv public.invitations;
  agent_id uuid;
begin
  if caller is null or caller_email is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  -- `for update` so two clicks on the same link cannot both pass the pending
  -- test and race to insert.
  select * into inv
  from public.invitations
  where id = invitation_id
    and status = 'pending'
    and lower(email) = lower(caller_email)
  for update;

  if not found then
    raise exception 'no pending invitation for this account'
      using errcode = '42501';
  end if;

  -- Revive a former member rather than mint a second agent: the agent id is
  -- named by message authorship and by the ADDRESS of every local direct
  -- they were in, so a new id would strand both — the old DM would
  -- have no live participant and a new one would appear beside it. This is
  -- also why the unique index on (organization_id, user_id) is total rather
  -- than partial on deleted_at: it has to see the marked row to conflict with
  -- it.
  --
  -- SECURITY DEFINER carries this past preserve_agent_deletion, which pins
  -- deleted_at for every role but the owner's — clearing it is exactly the
  -- privilege being exercised here, and only here.
  insert into public.agents (organization_id, user_id, name, role)
  values (
    inv.organization_id,
    caller,
    coalesce(claims->'user_metadata'->>'full_name', caller_email),
    inv.role
  )
  on conflict (organization_id, user_id) do update
    set deleted_at = null,
        -- The invitation decides the role of someone coming back, so a
        -- re-added owner does not silently return as one. An agent who never
        -- left keeps theirs: an invitation must not be a side channel for
        -- demoting a sitting member.
        role = case
          when public.agents.deleted_at is not null then excluded.role
          else public.agents.role
        end
  returning id into agent_id;

  update public.invitations
  set status = 'accepted'
  where id = inv.id;

  return agent_id;
end;
$$;

create function public.reject_invitation(invitation_id uuid) returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  caller_email text := auth.jwt()->>'email';
begin
  if caller_email is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  update public.invitations
  set status = 'rejected'
  where id = invitation_id
    and status = 'pending'
    and lower(email) = lower(caller_email);

  if not found then
    raise exception 'no pending invitation for this account'
      using errcode = '42501';
  end if;
end;
$$;
