alter table "public"."invitations" add column "organization_name" text;

alter table "public"."invitations" add column "invited_by_name" text;

alter table "public"."invitations" add column "invited_by_email" text;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.before_insert_or_update_on_invitations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  select o.name into new.organization_name
  from public.organizations o
  where o.id = new.organization_id;

  -- Scoped to the invitation's own organization: invitations_invited_by_fkey
  -- points at agents(id) alone, so nothing stops an owner from naming an
  -- agent in someone else's tenant, and copying that name here would be the
  -- one place it becomes readable. A mismatch leaves both columns null —
  -- `select into` assigns null when no row is found.
  select a.name, u.email
  into new.invited_by_name, new.invited_by_email
  from public.agents a
  left join auth.users u on u.id = a.user_id
  where a.id = new.invited_by
    and a.organization_id = new.organization_id;

  return new;
end;
$function$
;

CREATE TRIGGER handle_invitation_snapshot BEFORE INSERT OR UPDATE ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.before_insert_or_update_on_invitations();

-- Backfill. Rows written before the columns existed carry three nulls, and a
-- pending one is exactly the row the banner has to render. The trigger above
-- computes all three on any write, so TOUCHING each row is the backfill —
-- and is the version that cannot drift from the trigger, unlike a hand-copied
-- query here. set_updated_at is disabled around it so a bookkeeping write
-- does not make every open offer look freshly edited.
alter table public.invitations disable trigger set_updated_at;

update public.invitations set organization_id = organization_id;

alter table public.invitations enable trigger set_updated_at;
