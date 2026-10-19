// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ApiKeyScope = "read" | "send" | "admin";

export interface ApiKey {
  id: string;
  organization_id: string;
  name: string;
  key_prefix: string;
  scope: ApiKeyScope;
  allowed_addresses: string[] | null;
  role: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  send_limit_per_hour: number;
  template_limit_per_hour: number;
  requires_approval: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateApiKeyInput {
  name: string;
  scope: ApiKeyScope;
  expires_at: string | null;
  allowed_addresses?: string[] | null;
  send_limit_per_hour?: number;
  template_limit_per_hour?: number;
  requires_approval?: boolean;
}

export interface CreatedApiKey {
  id: string;
  key: string;
  key_prefix: string;
}

export interface McpCall {
  id: string;
  organization_id: string;
  api_key_id: string | null;
  user_id: string | null;
  tool: string;
  contact_phone: string | null;
  send_kind: "message" | "template" | null;
  status: "pending" | "ok" | "error" | "denied" | "rate_limited";
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const key = (id: string) => ["api-keys", id];

export function useApiKeys(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: key(organizationId), enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("api_keys")
        .select("id, organization_id, name, key_prefix, scope, allowed_addresses, role, expires_at, last_used_at, revoked_at, send_limit_per_hour, template_limit_per_hour, requires_approval, created_by, created_at, updated_at")
        .eq("organization_id", organizationId).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data as ApiKey[];
    },
  });
}

export function useApiKeyActions(organizationId: string) {
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: CreateApiKeyInput) => {
      const { data, error } = await supabase.rpc("zappion_create_api_key", {
        p_organization_id: organizationId,
        p_name: input.name,
        p_scope: input.scope,
        p_expires_at: input.expires_at,
        p_allowed_addresses: input.allowed_addresses ?? null,
        ...(input.send_limit_per_hour !== undefined ? { p_send_limit_per_hour: input.send_limit_per_hour } : {}),
        ...(input.template_limit_per_hour !== undefined ? { p_template_limit_per_hour: input.template_limit_per_hour } : {}),
        ...(input.requires_approval !== undefined ? { p_requires_approval: input.requires_approval } : {}),
      });
      if (error) throw new Error(error.message);
      return data as CreatedApiKey;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key(organizationId) }),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("zappion_revoke_api_key", { p_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key(organizationId) }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("api_keys").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: key(organizationId) }),
      client.invalidateQueries({ queryKey: ["mcp-calls", organizationId] }),
    ]),
  });
  return { create, revoke, remove };
}

export function useMcpCalls(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: ["mcp-calls", organizationId], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("mcp_calls")
        .select("id, organization_id, api_key_id, user_id, tool, contact_phone, send_kind, status, error, created_at, finished_at")
        .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return data as McpCall[];
    },
  });
}
