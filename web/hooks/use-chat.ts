// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
import { contactName } from "@/lib/contacts";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { callFunction, supabase } from "@/lib/supabase";
import type {
  ContactAddressRow,
  FileInfo,
  ConversationRow,
  ConversationView,
  MessageContent,
  MessageRow,
  Template,
} from "@/lib/types";
import { usePreferences } from "@/lib/preferences";
import { toStoredContent } from "@/lib/markdown";
import { signMessageContent } from "@/lib/signature";
import { formatPhone, isRenderable, phoneKey } from "@/lib/messages";
import { approvalKeys } from "./use-message-approvals";

const keys = {
  conversations: (org: string) => ["conversations", org] as const,
  recent: (org: string) => ["recent-messages", org] as const,
  contacts: (org: string) => ["contacts", org] as const,
  /** One cache per open chat, keyed by every conversation row it shows. */
  messages: (conversationIds: string[]) => ["messages", [...conversationIds].sort().join(",")] as const,
  templates: (org: string, address: string) => ["templates", org, address] as const,
};

const RECENT_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Read receipts on this side: what the agent has already seen, per conversation.
// Kept in localStorage; it is a per-browser convenience, not shared state.

const LAST_READ_KEY = "wa:last-read";
const EMPTY_READ: Record<string, string> = {};
const readListeners = new Set<() => void>();
let lastReadCache: Record<string, string> | null = null;

function readLastRead(): Record<string, string> {
  if (lastReadCache) return lastReadCache;
  try {
    lastReadCache = JSON.parse(localStorage.getItem(LAST_READ_KEY) ?? "{}");
  } catch {
    lastReadCache = {};
  }
  return lastReadCache!;
}

export function markConversationRead(conversationId: string, at: string) {
  const current = readLastRead();
  if (current[conversationId] && current[conversationId] >= at) return;
  lastReadCache = { ...current, [conversationId]: at };
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(lastReadCache));
  } catch {
    /* private mode: unread counts just reset on reload */
  }
  readListeners.forEach((l) => l());
}

function useLastRead() {
  return useSyncExternalStore(
    (cb) => {
      readListeners.add(cb);
      return () => readListeners.delete(cb);
    },
    () => readLastRead(),
    () => EMPTY_READ,
  );
}

// ---------------------------------------------------------------------------
// Conversations

/** Resolve a message deep link within the current organization. */
export function useFocusMessage(organizationId: string | undefined, messageId: string | null) {
  return useQuery({
    queryKey: ["focus-message", organizationId, messageId],
    enabled: !!organizationId && !!messageId,
    queryFn: async () => {
      const { data, error } = await supabase.from("messages").select("*")
        .eq("organization_id", organizationId!).eq("id", messageId!).maybeSingle();
      if (error) throw error;
      return data as MessageRow | null;
    },
  });
}

export function useConversations(organizationId: string | undefined) {
  const lastRead = useLastRead();

  const conversations = useQuery({
    queryKey: keys.conversations(organizationId ?? ""),
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("service", "whatsapp")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as ConversationRow[];
    },
  });

  // The latest messages across the organization give each conversation its
  // preview and unread count without one query per row.
  const recent = useQuery({
    queryKey: keys.recent(organizationId ?? ""),
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("service", "whatsapp")
        .order("timestamp", { ascending: false })
        .limit(RECENT_LIMIT);
      if (error) throw error;
      return data as MessageRow[];
    },
  });

  const contacts = useQuery({
    queryKey: keys.contacts(organizationId ?? ""),
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts_addresses")
        .select("address, organization_address, extra")
        .eq("organization_id", organizationId!)
        .eq("service", "whatsapp");
      if (error) throw error;
      return data as ContactAddressRow[];
    },
  });

  const views = useMemo<ConversationView[]>(() => {
    const names = new Map<string, string>();
    for (const c of contacts.data ?? []) {
      const name = contactName(c.extra);
      if (name) names.set(`${c.organization_address}:${c.address}`, name);
    }
    const byConversation = new Map<string, MessageRow[]>();
    for (const m of recent.data ?? []) {
      if (!m.conversation_id || !isRenderable(m)) continue;
      const list = byConversation.get(m.conversation_id) ?? [];
      list.push(m);
      byConversation.set(m.conversation_id, list);
    }
    // One entry per person: rows whose numbers differ only by the ninth digit merge.
    const groups = new Map<string, ConversationRow[]>();
    for (const c of conversations.data ?? []) {
      const key = `${c.organization_address}:${phoneKey(c.address)}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    return [...groups.values()]
      .map((rows) => {
        const messages = rows
          .flatMap((c) => byConversation.get(c.id) ?? [])
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        // Reply on the form the contact last wrote from: that is Meta's wa_id.
        const lastIncoming = messages.find((m) => m.sender_address);
        const primary =
          rows.find((c) => c.id === lastIncoming?.conversation_id) ??
          rows.find((c) => c.id === messages[0]?.conversation_id) ??
          rows[0];
        const seen = lastRead[primary.id];
        const unread = messages.filter((m) => m.sender_address && (!seen || m.timestamp > seen)).length;
        const name = rows
          .map((c) => names.get(`${c.organization_address}:${c.address}`) ?? c.name)
          .find(Boolean);
        return {
          ...primary,
          memberIds: rows.map((c) => c.id),
          displayName: name ?? formatPhone(primary.address),
          lastMessage: messages[0] ?? null,
          unread,
        };
      })
      .sort((a, b) => (b.lastMessage?.timestamp ?? b.updated_at).localeCompare(a.lastMessage?.timestamp ?? a.updated_at));
  }, [conversations.data, recent.data, contacts.data, lastRead]);

  return {
    data: views,
    isLoading: conversations.isLoading || recent.isLoading,
    error: conversations.error ?? recent.error ?? contacts.error,
  };
}

// ---------------------------------------------------------------------------
// Messages of one conversation

export function useMessages(conversationIds: string[] | null) {
  return useQuery({
    queryKey: keys.messages(conversationIds ?? []),
    enabled: !!conversationIds?.length,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .in("conversation_id", conversationIds!)
        .order("timestamp", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as MessageRow[]).reverse();
    },
  });
}

/** Bounded context for a library item older than the recent chat history. */
export function useMessageContext(message: MessageRow | null | undefined, conversationIds: string[]) {
  return useQuery({
    queryKey: ["message-context", message?.id, conversationIds], enabled: !!message,
    queryFn: async () => {
      const [before, after] = await Promise.all([
        supabase.from("messages").select("*").in("conversation_id", conversationIds).lte("timestamp", message!.timestamp).order("timestamp", { ascending: false }).limit(30),
        supabase.from("messages").select("*").in("conversation_id", conversationIds).gt("timestamp", message!.timestamp).order("timestamp", { ascending: true }).limit(30),
      ]);
      if (before.error || after.error) throw before.error ?? after.error;
      return [...new Map([...(before.data ?? []).reverse(), message!, ...(after.data ?? [])].map((row) => [row.id, row as MessageRow])).values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    },
  });
}

/** Independent of the message history limit, so busy chats keep the right window. */
export function useLastIncoming(conversationIds: string[] | null) {
  return useQuery({
    queryKey: ["last-incoming", [...(conversationIds ?? [])].sort().join(",")],
    enabled: !!conversationIds?.length,
    queryFn: async () => {
      const { data, error } = await supabase.from("messages").select("*")
        .in("conversation_id", conversationIds!).not("sender_address", "is", null)
        .order("timestamp", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as MessageRow | null;
    },
  });
}

function upsertById(list: MessageRow[] | undefined, row: MessageRow, newestFirst: boolean): MessageRow[] {
  const current = list ?? [];
  const index = current.findIndex((m) => m.id === row.id);
  if (index >= 0) {
    const next = current.slice();
    next[index] = row;
    return next;
  }
  const next = [...current, row];
  next.sort((a, b) => (newestFirst ? b.timestamp.localeCompare(a.timestamp) : a.timestamp.localeCompare(b.timestamp)));
  return newestFirst ? next.slice(0, RECENT_LIMIT) : next;
}

function applyMessage(client: QueryClient, organizationId: string, row: MessageRow) {
  if (row.service !== "whatsapp") return;
  void client.invalidateQueries({ queryKey: ["media-library", organizationId] });
  client.setQueryData<MessageRow[]>(keys.recent(organizationId), (list) => upsertById(list, row, true));
  if (!row.conversation_id) return;
  if (row.sender_address !== null) {
    for (const [key] of client.getQueriesData({ queryKey: ["last-incoming"] })) {
      if (String(key[1]).split(",").includes(row.conversation_id)) {
        client.setQueryData<MessageRow | null>(key, (current) => !current || row.timestamp >= current.timestamp ? row : current);
      }
    }
  }
  // Every open chat that includes this row's conversation.
  for (const [key, list] of client.getQueriesData<MessageRow[]>({ queryKey: ["messages"] })) {
    if (!list || !String(key[1]).split(",").includes(row.conversation_id)) continue;
    client.setQueryData<MessageRow[]>(key, upsertById(list, row, false));
  }
}

/** One channel per organization: new and updated rows land straight in the caches. */
export function useRealtime(organizationId: string | undefined, onInsert?: (message: MessageRow) => void) {
  const insertRef = useRef(onInsert);
  useEffect(() => { insertRef.current = onInsert; }, [onInsert]);
  const client = useQueryClient();
  useEffect(() => {
    if (!organizationId) return;
    const filter = `organization_id=eq.${organizationId}`;
    const channel = supabase
      .channel(`org:${organizationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter }, (payload) => {
        if (payload.table !== "messages" || !payload.new) return;
        applyMessage(client, organizationId, payload.new as MessageRow);
        if (payload.eventType === "INSERT") insertRef.current?.(payload.new as MessageRow);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter }, (payload) => {
        if (payload.table !== "conversations") return;
        client.invalidateQueries({ queryKey: keys.conversations(organizationId) });
      })
      // Messages held for approval: the chat bubbles and the badges read this list.
      .on("postgres_changes", { event: "*", schema: "public", table: "zappion_message_approvals", filter }, (payload) => {
        if (payload.table !== "zappion_message_approvals") return;
        client.invalidateQueries({ queryKey: approvalKeys.waiting(organizationId) });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId, client]);
}

// ---------------------------------------------------------------------------
// Sending

export interface Target {
  organizationId: string;
  organizationAddress: string;
  /** The contact's address (phone digits). */
  address: string;
  /** The row to reply on. */
  conversationId?: string;
  /** All rows shown in this chat (the same person with and without the ninth digit). */
  conversationIds?: string[];
}

export function useSendMessage(agentId: string | undefined, agentName = "") {
  const t = useT();
  const client = useQueryClient();
  const { preferences } = usePreferences();
  return useMutation({
    mutationFn: async ({ target, content, file }: { target: Target; content: MessageContent; file?: File }) => {
      // The composer speaks WhatsApp formatting; messages store Markdown.
      let finalContent = signMessageContent(toStoredContent(content), preferences, agentName);
      if (file && content.type === "file") {
        const path = `organizations/${target.organizationId}/attachments/${crypto.randomUUID()}`;
        const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
        if (error) throw new Error(t.useChat.couldNotUploadTheFile(error.message));
        finalContent = {
          ...finalContent,
          file: {
            ...(content.file as FileInfo),
            uri: `internal://media/${path}`,
            mime_type: file.type,
            size: file.size,
            name: file.name,
          },
        } as MessageContent;
      }
      const row = {
        id: crypto.randomUUID(),
        organization_id: target.organizationId,
        organization_address: target.organizationAddress,
        conversation_address: target.address,
        conversation_id: target.conversationId,
        service: "whatsapp",
        sender_address: null,
        agent_id: agentId ?? null,
        content: { version: "1", ...finalContent },
      };
      const { data, error } = await supabase.from("messages").insert(row).select("*").single();
      if (error) throw error;
      return data as MessageRow;
    },
    onSuccess: (row, { target }) => {
      applyMessage(client, target.organizationId, row);
      if (!target.conversationId) client.invalidateQueries({ queryKey: keys.conversations(target.organizationId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Templates (Zappion API whatsapp-management)

export function useTemplates(organizationId: string | undefined, organizationAddress: string | undefined) {
  return useQuery({
    queryKey: keys.templates(organizationId ?? "", organizationAddress ?? ""),
    enabled: !!organizationId && !!organizationAddress,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await callFunction<{ data?: Template[] }>("whatsapp-management/templates", "PUT", {
        organization_id: organizationId,
        organization_address: organizationAddress,
      });
      return r.data ?? [];
    },
  });
}

export function useCreateTemplate(organizationId: string | undefined, organizationAddress: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (template: import("@/lib/templates/types").CreateTemplatePayload) =>
      callFunction<{ id: string; status: string }>("whatsapp-management/templates", "POST", {
        organization_id: organizationId,
        organization_address: organizationAddress,
        template,
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: keys.templates(organizationId ?? "", organizationAddress ?? "") }),
  });
}

// ---------------------------------------------------------------------------
// Media

/** A short-lived URL for a stored attachment; null while loading or for non-stored media. */
export function useMediaUrl(path: string | null) {
  return useQuery({
    queryKey: ["media", path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    refetchInterval: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("media").createSignedUrl(path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

// ---------------------------------------------------------------------------
// Read receipts and "typing…" for the customer (Zappion API mark_read RPC)

/**
 * Marks an incoming message read; with `typing`, also shows the customer the
 * typing bubble. The dispatcher sends both to WhatsApp, which applies the read
 * to every earlier message in the chat as well.
 */
export async function markRead(messageId: string, typing = false) {
  const { error } = await supabase.rpc("mark_read", { p_message_id: messageId, p_typing: typing });
  if (error) console.warn("mark_read:", error.message);
}
