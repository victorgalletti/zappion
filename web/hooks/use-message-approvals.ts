// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** A message an API key that requires approval tried to send (zappion_message_approvals). */
export interface MessageApproval {
  message_id: string;
  organization_id: string;
  conversation_id: string;
  api_key_id: string | null;
  api_key_name: string;
  send_kind: "message" | "template";
  requested_at: string;
  decision: "approved" | "rejected" | null;
  decided_by: string | null;
  decided_at: string | null;
}

export type ApprovalDecision = "approved" | "rejected";

export const approvalKeys = {
  waiting: (organizationId: string) => ["message-approvals", organizationId] as const,
};

/** Every approval still waiting for a decision in the organization, oldest first. Kept live by useRealtime. */
export function useWaitingApprovals(organizationId: string | undefined) {
  return useQuery({
    queryKey: approvalKeys.waiting(organizationId ?? ""),
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase.from("zappion_message_approvals")
        .select("message_id, organization_id, conversation_id, api_key_id, api_key_name, send_kind, requested_at, decision, decided_by, decided_at")
        .eq("organization_id", organizationId!).is("decision", null).order("requested_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data as MessageApproval[];
    },
  });
}

/** Approves or rejects a held message; the RPC errors are human-readable and surface as the mutation error. */
export function useDecideMessage(organizationId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, decision }: { messageId: string; decision: ApprovalDecision }) => {
      const { data, error } = await supabase.rpc(decision === "approved" ? "zappion_approve_message" : "zappion_reject_message", { p_message_id: messageId });
      if (error) throw new Error(error.message);
      return data as { id: string; status: ApprovalDecision };
    },
    onSettled: (_data, error) => Promise.all([
      client.invalidateQueries({ queryKey: approvalKeys.waiting(organizationId ?? "") }),
      // Realtime brings the new status too; this covers a missed event.
      ...(error ? [] : [client.invalidateQueries({ queryKey: ["messages"] })]),
    ]),
  });
}
