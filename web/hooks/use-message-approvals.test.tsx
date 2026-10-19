// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDecideMessage, useWaitingApprovals, type MessageApproval } from "./use-message-approvals";

const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe("message approvals with mocked Supabase", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ is: mocks.is });
    mocks.is.mockReturnValue({ order: mocks.order });
    mocks.order.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("lists the organization's undecided approvals oldest first with explicit columns", async () => {
    const rows: MessageApproval[] = [{
      message_id: "message", organization_id: "org", conversation_id: "chat", api_key_id: "key", api_key_name: "Support bot",
      send_kind: "message", requested_at: "2026-10-16T10:00:00Z", decision: null, decided_by: null, decided_at: null,
    }];
    mocks.order.mockResolvedValueOnce({ data: rows, error: null });
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useWaitingApprovals("org"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.from).toHaveBeenCalledWith("zappion_message_approvals");
    expect(mocks.select).toHaveBeenCalledWith(Object.keys(rows[0]).join(", "));
    expect(mocks.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(mocks.is).toHaveBeenCalledWith("decision", null);
    expect(mocks.order).toHaveBeenCalledWith("requested_at", { ascending: true });
    expect(result.current.data).toEqual(rows);
    client.clear();
  });

  it("does not fetch without an organization", () => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useWaitingApprovals(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mocks.from).not.toHaveBeenCalled();
    client.clear();
  });

  it.each([["approved", "zappion_approve_message"], ["rejected", "zappion_reject_message"]] as const)("%s calls %s and refreshes approvals and messages", async (decision, rpc) => {
    mocks.rpc.mockResolvedValueOnce({ data: { id: "message", status: decision }, error: null });
    const { wrapper, client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDecideMessage("org"), { wrapper });
    await act(async () => {
      expect(await result.current.mutateAsync({ messageId: "message", decision })).toEqual({ id: "message", status: decision });
    });
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, { p_message_id: "message" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["message-approvals", "org"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages"] });
    client.clear();
  });

  it("rejects with the server message and still refreshes the approvals", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "this message was already rejected" } });
    const { wrapper, client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDecideMessage("org"), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ messageId: "message", decision: "approved" })).rejects.toThrow(new Error("this message was already rejected"));
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["message-approvals", "org"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["messages"] });
    client.clear();
  });
});
