// SPDX-License-Identifier: AGPL-3.0-only
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useMediaLibrary, type MediaFilters } from "./use-media-library";
const mocks = vi.hoisted(() => ({ requests: [] as { method: string; args: unknown[] }[][], responses: [] as unknown[] }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: (table: string) => {
  const calls: { method: string; args: unknown[] }[] = [{ method: 'from', args: [table] }]; mocks.requests.push(calls);
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'or', 'order', 'is', 'in', 'gte', 'lt', 'filter']) builder[method] = (...args: unknown[]) => { calls.push({ method, args }); return builder; };
  builder.limit = (...args: unknown[]) => { calls.push({ method: 'limit', args }); return Promise.resolve(mocks.responses.shift()); };
  return builder;
} } }));
const filters: MediaFilters = { tab: 'media', search: '', sender: '', conversations: [], instance: '', from: '', to: '', matchingAddresses: [] };
const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
};
describe('media server pagination', () => {
  it('uses timestamp and ID as cursor, keeps total from the first page and scopes to the organization', async () => {
    mocks.requests.length = 0;
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `id-${i}`, timestamp: '2026-10-14T10:00:00Z' }));
    mocks.responses = [{ data: rows, count: 100, error: null }, { data: [{ id: 'older', timestamp: '2026-10-13T10:00:00Z' }], count: 40, error: null }];
    const { result } = renderHook(() => useMediaLibrary('org', filters), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => { await result.current.fetchNextPage(); });
    expect(result.current.data?.pages[0].count).toBe(100);
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(mocks.requests[0]).toContainEqual({ method: 'eq', args: ['organization_id', 'org'] });
    expect(mocks.requests[1]).toContainEqual({ method: 'or', args: ['timestamp.lt.2026-10-14T10:00:00Z,and(timestamp.eq.2026-10-14T10:00:00Z,id.lt.id-59)'] });
    expect(mocks.requests[0]).toContainEqual({ method: 'limit', args: [60] });
  });
  it('escapes search operands and applies sender, conversation and instance filters on the server', async () => {
    mocks.requests.length = 0; mocks.responses = [{ data: [], count: 0, error: null }];
    const { result } = renderHook(() => useMediaLibrary('org', { ...filters, tab: 'docs', search: 'a,b"_%', sender: 'team', conversations: ['conversation'], instance: 'number' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calls = mocks.requests[0];
    expect(calls).toContainEqual({ method: 'is', args: ['sender_address', null] });
    expect(calls).toContainEqual({ method: 'in', args: ['conversation_id', ['conversation']] });
    expect(calls).toContainEqual({ method: 'eq', args: ['organization_address', 'number'] });
    const pattern = JSON.stringify('%a,b"\\_\\%%');
    expect(calls).toContainEqual({ method: 'or', args: [`content->>text.ilike.${pattern},content->file->>name.ilike.${pattern}`] });
  });
});
