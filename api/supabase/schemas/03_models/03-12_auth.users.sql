create trigger prevent_owner_user_deletion
before delete
on auth.users
for each row
execute function public.prevent_owner_user_deletion();
