create policy "members can download their orgs media"
on storage.objects
for select
to authenticated, anon
using (
  bucket_id = 'media'
  and (storage.foldername(name))[2] in ( select get_authorized_orgs('member')::text ) -- message v1 path is organizations/<org_id>/attachments/<file_id>
  -- Attachments of membership-scoped conversations (e.g. a private Slack
  -- DM) are only downloadable by members who can see a referencing message;
  -- unreferenced objects (just-uploaded, legacy) stay org-scoped.
  and public.is_media_visible(name)
);

create policy "members can upload their orgs media"
on storage.objects
for insert
to authenticated, anon
with check (
  bucket_id = 'media'
  and (storage.foldername(name))[2] in ( select get_authorized_orgs('member')::text ) -- message v1 path is organizations/<org_id>/attachments/<file_id>
);
-- Zappion: the organization logo (organizations/<org_id>/logo/<file>) is
-- admin-only. Restrictive, so it narrows the member upload policy above for
-- that one folder and leaves every other path alone.
create policy "only admins can upload their orgs logo"
on storage.objects
as restrictive
for insert
to authenticated, anon
with check (
  bucket_id <> 'media'
  or (storage.foldername(name))[3] is distinct from 'logo'
  or (storage.foldername(name))[2] in ( select get_authorized_orgs('admin')::text )
);
