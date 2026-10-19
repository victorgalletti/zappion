// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApiKeyActions, useApiKeys, useMcpCalls, type ApiKey, type McpCall } from "./use-api-keys";

const mocks = vi.hoisted(() => ({ from: vi.fn(), delete: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe("API keys with mocked Supabase", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.from.mockReturnValue({ select: mocks.select, delete: mocks.delete });
    mocks.delete.mockReturnValue({ eq: mocks.eq });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ order: mocks.order });
    mocks.order.mockResolvedValue({ data: [], error: null });
    mocks.limit.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("lists the organization's keys newest first with explicit columns", async () => {
    const rows: ApiKey[] = [{
      id: "key-id", organization_id: "org", name: "MCP", key_prefix: "zpn_AbC123xy", scope: "read", allowed_addresses: ["meta-id"], role: "admin",
      expires_at: null, last_used_at: null, revoked_at: null, send_limit_per_hour: 60, template_limit_per_hour: 10, requires_approval: false,
      created_by: null, created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z",
    }];
    mocks.order.mockResolvedValueOnce({ data: rows, error: null });
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useApiKeys("org"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.from).toHaveBeenCalledWith("api_keys");
    expect(mocks.select).toHaveBeenCalledWith(Object.keys(rows[0]).join(", "));
    expect(mocks.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(mocks.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result.current.data).toEqual(rows);
    client.clear();
  });

  it("creates a key with null expiry and omitted default limits, returns the key, and invalidates the organization's keys", async () => {
    const created = { id: "key-id", key: "zpn_full-secret", key_prefix: "zpn_AbC123xy" };
    mocks.rpc.mockResolvedValueOnce({ data: created, error: null });
    const { wrapper, client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useApiKeyActions("org"), { wrapper });
    await act(async () => {
      expect(await result.current.create.mutateAsync({ name: "MCP", scope: "read", expires_at: null })).toEqual(created);
    });
    expect(mocks.rpc).toHaveBeenCalledWith("zappion_create_api_key", {
      p_organization_id: "org", p_name: "MCP", p_scope: "read", p_expires_at: null, p_allowed_addresses: null,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["api-keys", "org"] });
    expect(client.getQueryData(["api-keys", "org"])).toBeUndefined();
    client.clear();
  });

  it("passes explicit expiry and limits when creating a key", async () => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useApiKeyActions("org"), { wrapper });
    await act(async () => {
      await result.current.create.mutateAsync({
        name: "Sender", scope: "send", allowed_addresses: ["meta-id-1", "meta-id-2"], expires_at: "2026-12-01T00:00:00Z", send_limit_per_hour: 120, template_limit_per_hour: 0,
      });
    });
    expect(mocks.rpc).toHaveBeenCalledWith("zappion_create_api_key", {
      p_organization_id: "org", p_name: "Sender", p_scope: "send", p_expires_at: "2026-12-01T00:00:00Z",
      p_send_limit_per_hour: 120, p_template_limit_per_hour: 0, p_allowed_addresses: ["meta-id-1", "meta-id-2"],
    });
    client.clear();
  });

  it("passes the approval requirement when creating a key", async () => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useApiKeyActions("org"), { wrapper });
    await act(async () => {
      await result.current.create.mutateAsync({ name: "Agent", scope: "send", expires_at: null, requires_approval: true });
    });
    expect(mocks.rpc).toHaveBeenCalledWith("zappion_create_api_key", {
      p_organization_id: "org", p_name: "Agent", p_scope: "send", p_expires_at: null, p_allowed_addresses: null, p_requires_approval: true,
    });
    client.clear();
  });

  it("revokes a key and invalidates the organization's keys", async () => {
    const { wrapper, client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useApiKeyActions("org"), { wrapper });
    await act(async () => { await result.current.revoke.mutateAsync("key-id"); });
    expect(mocks.rpc).toHaveBeenCalledWith("zappion_revoke_api_key", { p_id: "key-id" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["api-keys", "org"] });
    client.clear();
  });

  it.each([null, { message: "Delete denied" }])("deletes a key and invalidates both queries only on success (%j)", async (error) => {
    mocks.eq.mockResolvedValueOnce({ error });
    const { wrapper, client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useApiKeyActions("org"), { wrapper });
    await act(async () => {
      const mutation = result.current.remove.mutateAsync("key-id");
      if (error) await expect(mutation).rejects.toThrow("Delete denied");
      else await mutation;
    });
    expect(mocks.from).toHaveBeenCalledWith("api_keys");
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.eq).toHaveBeenCalledWith("id", "key-id");
    if (error) expect(invalidate).not.toHaveBeenCalled();
    else {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["api-keys", "org"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["mcp-calls", "org"] });
    }
    client.clear();
  });

  it.each(["create", "revoke"] as const)("rejects a %s RPC error with the server message", async (action) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "Admin access required" } });
    const { wrapper, client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useApiKeyActions("org"), { wrapper });
    await act(async () => {
      const mutation = action === "create"
        ? result.current.create.mutateAsync({ name: "MCP", scope: "read", expires_at: null })
        : result.current.revoke.mutateAsync("key-id");
      await expect(mutation).rejects.toThrow(new Error("Admin access required"));
    });
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });

  it("lists the organization's latest 50 MCP calls newest first", async () => {
    const rows: McpCall[] = [{
      id: "call-id", organization_id: "org", api_key_id: "key-id", user_id: null, tool: "contacts_list",
      contact_phone: null, send_kind: null, status: "ok", error: null, created_at: "2026-10-15T00:00:00Z", finished_at: null,
    }];
    mocks.order.mockReturnValueOnce({ limit: mocks.limit });
    mocks.limit.mockResolvedValueOnce({ data: rows, error: null });
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useMcpCalls("org"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.from).toHaveBeenCalledWith("mcp_calls");
    expect(mocks.select).toHaveBeenCalledWith(Object.keys(rows[0]).join(", "));
    expect(mocks.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(mocks.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(mocks.limit).toHaveBeenCalledWith(50);
    expect(result.current.data).toEqual(rows);
    client.clear();
  });

  it.each([useApiKeys, useMcpCalls])("does not fetch when disabled (%#)", (useHook) => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useHook("org", false), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mocks.from).not.toHaveBeenCalled();
    client.clear();
  });
});
