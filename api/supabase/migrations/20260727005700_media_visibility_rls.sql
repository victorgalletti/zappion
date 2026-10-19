CREATE INDEX messages_file_uri_idx ON public.messages USING btree ((((content -> 'file'::text) ->> 'uri'::text))) WHERE (((content -> 'file'::text) ->> 'uri'::text) IS NOT NULL);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.is_media_visible(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with refs as (
    select m.conversation_id, m.organization_id, m.organization_address, m.service
    from public.messages m
    where m.content->'file'->>'uri' = 'internal://media/' || object_name
  )
  select
    not exists (select 1 from refs)
    or exists (
      select 1 from refs r
      where public.is_conversation_visible(
        r.conversation_id, r.organization_id, r.organization_address, r.service
      )
    );
$function$
;

drop policy "members can download their orgs media" on "storage"."objects";


  create policy "members can download their orgs media"
  on "storage"."objects"
  as permissive
  for select
  to authenticated, anon
using (((bucket_id = 'media'::text) AND ((storage.foldername(name))[2] IN ( SELECT (public.get_authorized_orgs('member'::public.role))::text AS get_authorized_orgs)) AND public.is_media_visible(name)));



