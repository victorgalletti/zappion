// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { getT, useT } from "@/lib/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AgentRow, InvitationRow } from "@/lib/types";

// Resolve labels when read so imports never capture a language.
export const ROLE_LABELS = { get owner() { return getT().useSettings.owner; }, get admin() { return getT().useSettings.administrator; }, get member() { return getT().useSettings.member; } };
export const ROLE_DESCRIPTIONS = {
  get owner() { return getT().useSettings.managesMembersRolesInvitationsOrganizationAndInstances; },
  get admin() { return getT().useSettings.editsTheOrganizationAndInstancesCannotManageMembers; },
  get member() { return getT().useSettings.viewsOrganizationDetailsMembersAndInstances; },
};

export function useMembers(organizationId: string) {
  return useQuery({
    queryKey: ["members", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select("id, organization_id, name, picture, role, user_id")
        .eq("organization_id", organizationId).not("user_id", "is", null).is("deleted_at", null).order("name");
      if (error) throw error;
      return data as AgentRow[];
    },
  });
}

export function useInvitations(userId: string, organizationId?: string, enabled = true) {
  return useQuery({
    queryKey: ["invitations", userId, organizationId ?? "inbox"], enabled,
    queryFn: async () => {
      let query = supabase.from("invitations").select(organizationId
        ? "id, organization_id, email, role, status, created_at"
        : "id, organization_id, email, role, status, created_at, organization_name, invited_by_name").eq("status", "pending");
      if (organizationId) query = query.eq("organization_id", organizationId);
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as InvitationRow[];
    },
  });
}

/** Mutations share refresh/error handling, but only their relevant UI grants actions. */
export function useSettingsAction() {
  const t = useT();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (operation: () => Promise<void>) => {
      try { await operation(); }
      catch (error) {
        const message = (error as { message?: string }).message ?? "";
        if (/last.*owner|último.*(owner|propriet)|at least one owner/i.test(message))
          throw new Error(t.useSettings.theOrganizationMustHaveAtLeastOneOwner);
        if (/duplicate|unique/i.test(message)) throw new Error(t.useSettings.aRecordWithTheseDetailsAlreadyExistsCheck);
        if (/policy|permission|forbidden/i.test(message)) throw new Error(t.useSettings.youDoNotHavePermissionForThisAction);
        if (/no pending invitation/i.test(message)) throw new Error(t.useSettings.thisInvitationIsNoLongerPendingOrBelongs);
        throw new Error(t.useSettings.couldNotCompleteTheActionRefreshThePage);
      }
    },
    onSuccess: async () => {
      await Promise.all(["workspace", "members", "invitations", "instance-counts"].map((key) => client.invalidateQueries({ queryKey: [key] })));
    },
  });
}
