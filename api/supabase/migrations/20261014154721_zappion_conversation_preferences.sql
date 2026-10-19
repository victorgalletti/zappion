-- SPDX-License-Identifier: AGPL-3.0-only

  create table "public"."conversation_preferences" (
    "agent_id" uuid not null,
    "conversation_id" uuid not null,
    "organization_id" uuid not null,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );

alter table "public"."conversation_preferences" enable row level security;

CREATE INDEX conversation_preferences_conversation_id_idx ON public.conversation_preferences USING btree (conversation_id);

CREATE UNIQUE INDEX conversation_preferences_pkey ON public.conversation_preferences USING btree (agent_id, conversation_id);

alter table "public"."conversation_preferences" add constraint "conversation_preferences_pkey" PRIMARY KEY using index "conversation_preferences_pkey";

alter table "public"."conversation_preferences" add constraint "conversation_preferences_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE not valid;

alter table "public"."conversation_preferences" validate constraint "conversation_preferences_agent_id_fkey";

alter table "public"."conversation_preferences" add constraint "conversation_preferences_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE not valid;

alter table "public"."conversation_preferences" validate constraint "conversation_preferences_conversation_id_fkey";

alter table "public"."conversation_preferences" add constraint "conversation_preferences_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."conversation_preferences" validate constraint "conversation_preferences_organization_id_fkey";

grant delete on table "public"."conversation_preferences" to "anon";

grant insert on table "public"."conversation_preferences" to "anon";

grant references on table "public"."conversation_preferences" to "anon";

grant select on table "public"."conversation_preferences" to "anon";

grant trigger on table "public"."conversation_preferences" to "anon";

grant truncate on table "public"."conversation_preferences" to "anon";

grant update on table "public"."conversation_preferences" to "anon";

grant delete on table "public"."conversation_preferences" to "authenticated";

grant insert on table "public"."conversation_preferences" to "authenticated";

grant references on table "public"."conversation_preferences" to "authenticated";

grant select on table "public"."conversation_preferences" to "authenticated";

grant trigger on table "public"."conversation_preferences" to "authenticated";

grant truncate on table "public"."conversation_preferences" to "authenticated";

grant update on table "public"."conversation_preferences" to "authenticated";

grant delete on table "public"."conversation_preferences" to "service_role";

grant insert on table "public"."conversation_preferences" to "service_role";

grant references on table "public"."conversation_preferences" to "service_role";

grant select on table "public"."conversation_preferences" to "service_role";

grant trigger on table "public"."conversation_preferences" to "service_role";

grant truncate on table "public"."conversation_preferences" to "service_role";

grant update on table "public"."conversation_preferences" to "service_role";

  create policy "members manage their own conversation preferences"
  on "public"."conversation_preferences"
  as permissive
  for all
  to authenticated
using ((agent_id IN ( SELECT public.get_own_agents() AS get_own_agents)))
with check (((agent_id IN ( SELECT public.get_own_agents() AS get_own_agents)) AND (organization_id IN ( SELECT public.get_authorized_orgs('member'::public.role) AS get_authorized_orgs)) AND (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversation_preferences.conversation_id) AND (c.organization_id = conversation_preferences.organization_id))))));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversation_preferences FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

