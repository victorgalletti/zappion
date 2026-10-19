// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AgentRow, MessageRow } from "@/lib/types";
import type { MediaTab } from "@/lib/media-library";

export interface MediaFilters {
  tab: MediaTab; search: string; sender: string; conversations: string[]; instance: string; from: string; to: string; matchingAddresses: string[];
}
const PAGE_SIZE = 60;
export function useMediaLibrary(org: string, filters: MediaFilters) {
  return useInfiniteQuery({
    queryKey: ["media-library", org, filters],
    initialPageParam: null as { timestamp: string; id: string } | null,
    queryFn: async ({ pageParam }) => {
      let query = supabase.from("messages").select("*", { count: "exact" }).eq("organization_id", org).eq("service", "whatsapp");
      if (filters.tab === "links") {
        query = query.eq("content->>type", "text").filter("content->>text", "imatch", "(https?://|www\\.)([[:alnum:]-]+\\.)+[[:alnum:]-]+");
      } else {
        query = query.eq("content->>type", "file");
        if (filters.tab === "media") query = query.or('content->file->>mime_type.ilike.image/*,content->file->>mime_type.ilike.video/*');
        else query = query.or('content->file->>mime_type.is.null,and(content->file->>mime_type.not.ilike.image/*,content->file->>mime_type.not.ilike.video/*)');
      }
      if (filters.sender === "team") query = query.is("sender_address", null);
      else if (filters.sender) query = query.eq("sender_address", filters.sender);
      if (filters.conversations.length) query = query.in("conversation_id", filters.conversations);
      if (filters.instance) query = query.eq("organization_address", filters.instance);
      if (filters.from) query = query.gte("timestamp", new Date(`${filters.from}T00:00:00`).toISOString());
      if (filters.to) query = query.lt("timestamp", new Date(new Date(`${filters.to}T00:00:00`).setDate(new Date(`${filters.to}T00:00:00`).getDate() + 1)).toISOString());
      // Quote PostgREST operands and escape pattern characters: user text never becomes a filter expression.
      const term = filters.search.trim();
      if (term) {
        const pattern = JSON.stringify(`%${term.replace(/[\\%_*]/g, "\\$&")}%`);
        const expressions = [`content->>text.ilike.${pattern}`, `content->file->>name.ilike.${pattern}`];
        if (filters.matchingAddresses.length) expressions.push(`conversation_address.in.(${filters.matchingAddresses.map((a) => JSON.stringify(a)).join(",")})`);
        query = query.or(expressions.join(","));
      }
      if (pageParam) query = query.or(`timestamp.lt.${pageParam.timestamp},and(timestamp.eq.${pageParam.timestamp},id.lt.${pageParam.id})`);
      const { data, error, count } = await query.order("timestamp", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE);
      if (error) throw error;
      return { rows: data as MessageRow[], count: count ?? 0 };
    },
    getNextPageParam: (page) => page.rows.length === PAGE_SIZE ? { timestamp: page.rows.at(-1)!.timestamp, id: page.rows.at(-1)!.id } : undefined,
  });
}
/** Metadata is paged too, so selectors do not silently stop at the API row limit. */
async function readPeopleTable(table: string, columns: string, org: string, order: string, whatsapp = false) {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabase.from(table).select(columns).eq("organization_id", org).order(order).range(offset, offset + 499);
    if (whatsapp) query = query.eq("service", "whatsapp");
    if (table === "contacts_addresses") query = query.order("organization_address");
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}
export function useMediaPeople(org: string) {
  return useQuery({ queryKey: ["media-people", org], queryFn: async () => {
    const [agents, contacts, conversations] = await Promise.all([
      readPeopleTable("agents", "id,name,picture", org, "id"),
      readPeopleTable("contacts_addresses", "address,organization_address,extra", org, "address", true),
      readPeopleTable("conversations", "*", org, "id", true),
    ]);
    return { agents: agents as Pick<AgentRow, "id" | "name" | "picture">[], contacts: contacts as import("@/lib/types").ContactAddressRow[], conversations: conversations as import("@/lib/types").ConversationRow[] };
  } });
}
