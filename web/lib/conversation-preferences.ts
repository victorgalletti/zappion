// SPDX-License-Identifier: AGPL-3.0-only
import type { ConversationView } from "./types";

export interface ConversationPreference {
  agent_id: string;
  conversation_id: string;
  organization_id: string;
  archived_at: string | null;
}

/** A partially archived group stays together, including newly discovered rows. */
export function withConversationPreferences(conversations: ConversationView[], preferences: ConversationPreference[]) {
  const archived = new Set(preferences.filter((p) => p.archived_at !== null).map((p) => p.conversation_id));
  return conversations.map((c) => ({ ...c, archived: c.memberIds.some((id) => archived.has(id)) }));
}

export function filterConversations(conversations: ConversationView[], { archived = false, unreadOnly = false, instance = "", query = "" } = {}) {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  return conversations.filter((c) => Boolean(c.archived) === archived
    && (!unreadOnly || c.unread > 0)
    && (!instance || c.organization_address === instance)
    && (!q || c.displayName.toLowerCase().includes(q) || Boolean(digits && c.address.includes(digits))));
}

export function preferenceRows(agentId: string, organizationId: string, memberIds: string[], archivedAt: string | null): ConversationPreference[] {
  return [...new Set(memberIds)].map((id) => ({
    agent_id: agentId, organization_id: organizationId, conversation_id: id, archived_at: archivedAt,
  }));
}
