// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AgentRow, OrganizationAddressRow } from "@/lib/types";

/** undefined while loading, null when signed out. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

export interface Workspace {
  agent: AgentRow;
  organizationId: string;
  organizationName: string;
  organizationLogo: string | null;
  /** The WhatsApp numbers connected to the organization. */
  numbers: OrganizationAddressRow[];
}

/** The signed-in agent's organization and its connected WhatsApp numbers. */
export function useWorkspace(userId: string | undefined) {
  return useQuery({
    queryKey: ["workspace", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Workspace | null> => {
      const { data: agent, error } = await supabase
        .from("agents")
        .select("id, organization_id, user_id, name, picture, role, organizations(name, extra)")
        .eq("user_id", userId!)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!agent) return null;
      const { data: numbers, error: numbersError } = await supabase
        .from("organizations_addresses")
        .select("organization_id, address, service, status, extra")
        .eq("organization_id", agent.organization_id)
        .eq("service", "whatsapp");
      if (numbersError) throw numbersError;
      const org = agent.organizations as unknown as { name: string; extra: { logo?: string } | null } | null;
      return {
        agent: agent as unknown as AgentRow,
        organizationId: agent.organization_id,
        organizationName: org?.name ?? "",
        organizationLogo: org?.extra?.logo ?? null,
        numbers: (numbers ?? []) as OrganizationAddressRow[],
      };
    },
  });
}
