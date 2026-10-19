// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { preferenceRows, type ConversationPreference } from "@/lib/conversation-preferences";

export const preferenceKey = (organizationId?: string, agentId?: string) => ["conversation-preferences", organizationId ?? "", agentId ?? ""] as const;

export function useConversationPreferences(organizationId?: string, agentId?: string) {
  return useQuery({
    queryKey: preferenceKey(organizationId, agentId),
    enabled: !!organizationId && !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase.from("conversation_preferences")
        .select("agent_id, conversation_id, organization_id, archived_at")
        .eq("organization_id", organizationId!).eq("agent_id", agentId!);
      if (error) throw error;
      return data as ConversationPreference[];
    },
  });
}

export function useArchiveConversation(organizationId?: string, agentId?: string) {
  const t = useT();
  const client = useQueryClient();
  const queryKey = preferenceKey(organizationId, agentId);
  return useMutation({
    mutationFn: async ({ memberIds, archived }: { memberIds: string[]; archived: boolean }) => {
      if (!organizationId || !agentId || !memberIds.length) throw new Error(t.useConversationPreferences.memberOrChatUnavailable);
      const { error } = await supabase.from("conversation_preferences").upsert(
        preferenceRows(agentId, organizationId, memberIds, archived ? new Date().toISOString() : null),
        { onConflict: "agent_id,conversation_id" },
      );
      if (error) throw error;
    },
    onMutate: async ({ memberIds, archived }) => {
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<ConversationPreference[]>(queryKey) ?? [];
      const ids = new Set(memberIds);
      client.setQueryData<ConversationPreference[]>(queryKey, [
        ...previous.filter((p) => !ids.has(p.conversation_id)),
        ...preferenceRows(agentId!, organizationId!, memberIds, archived ? new Date().toISOString() : null),
      ]);
      return { previous };
    },
    onError: (_error, { memberIds }, context) => {
      if (!context) return;
      const ids = new Set(memberIds);
      client.setQueryData<ConversationPreference[]>(queryKey, (current = []) => [
        ...current.filter((p) => !ids.has(p.conversation_id)),
        ...context.previous.filter((p) => ids.has(p.conversation_id)),
      ]);
    },
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
}
