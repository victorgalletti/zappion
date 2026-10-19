set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.preserve_message_direction()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.direction := old.direction;
  new.sender_address := coalesce(old.sender_address, new.sender_address);
  new.conversation_address := old.conversation_address;

  -- Internal rows can never be armed — not even by a later merged update.
  -- This runs BEFORE set_status (trigger order is alphabetical), so the
  -- merge never sees a pending key.
  if old.direction = 'internal'::public.direction and new.status is not null then
    new.status := new.status - 'pending';
  end if;

  return new;
end;
$function$
;


