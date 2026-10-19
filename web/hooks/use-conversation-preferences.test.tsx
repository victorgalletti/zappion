// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preferenceKey, useArchiveConversation, useConversationPreferences } from "./use-conversation-preferences";
import { preferenceRows, type ConversationPreference } from "@/lib/conversation-preferences";

const mocks = vi.hoisted(() => ({ from: vi.fn(), upsert: vi.fn(), select: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe("conversation preferences with mocked Supabase", () => {
  beforeEach(() => {
    mocks.from.mockReturnValue({ upsert: mocks.upsert, select: mocks.select });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ eq: mocks.eq });
    mocks.upsert.mockResolvedValue({ error: null });
  });

  it("reads only the workspace agent's preferences in the current organization", async () => {
    const rows = preferenceRows("agent", "org", ["one"], "2026-01-01");
    mocks.eq.mockReturnValueOnce({ eq: mocks.eq }).mockResolvedValueOnce({ data: rows, error: null });
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useConversationPreferences("org", "agent"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(mocks.eq).toHaveBeenCalledWith("agent_id", "agent");
    expect(result.current.data).toEqual(rows);
    expect(preferenceKey("org", "agent")).not.toEqual(preferenceKey("org", "another-agent"));
    client.clear();
  });

  it.each([true, false])("optimistically updates and persists all memberIds (archived=%s)", async (archived) => {
    let resolve!: (value: { error: null }) => void;
    mocks.upsert.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { wrapper, client } = setup();
    const key = preferenceKey("org", "agent");
    client.setQueryData(key, preferenceRows("agent", "org", ["unrelated"], "2026-01-01"));
    const { result } = renderHook(() => useArchiveConversation("org", "agent"), { wrapper });
    act(() => result.current.mutate({ memberIds: ["with-nine", "without-nine"], archived }));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());
    const optimistic = client.getQueryData<ConversationPreference[]>(key)!;
    expect(optimistic.map((p) => p.conversation_id)).toEqual(["unrelated", "with-nine", "without-nine"]);
    expect(optimistic.slice(1).every((p) => archived ? !!p.archived_at : p.archived_at === null)).toBe(true);
    expect(mocks.from).toHaveBeenCalledWith("conversation_preferences");
    expect(mocks.upsert).toHaveBeenCalledWith(optimistic.slice(1).map((p) => ({ ...p, archived_at: archived ? expect.any(String) : null })), { onConflict: "agent_id,conversation_id" });
    await act(async () => resolve({ error: null }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    client.clear();
  });

  it("restores previous group preferences when persistence fails", async () => {
    let resolve!: (value: { error: Error }) => void;
    mocks.upsert.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { wrapper, client } = setup();
    const key = preferenceKey("org", "agent");
    const previous = preferenceRows("agent", "org", ["one", "two"], null);
    client.setQueryData(key, previous);
    const { result } = renderHook(() => useArchiveConversation("org", "agent"), { wrapper });
    act(() => result.current.mutate({ memberIds: ["one", "two"], archived: true }));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());
    expect(client.getQueryData(key)).not.toEqual(previous);
    await act(async () => resolve({ error: new Error("mock failure") }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(key)).toEqual(previous);
    client.clear();
  });
});
