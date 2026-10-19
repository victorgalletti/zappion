// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES, setPreferences } from "@/lib/preferences";
import type { MessageContent } from "@/lib/types";
import { useSendMessage } from "./use-chat";

const mock = vi.hoisted(() => ({ insert: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  from: () => ({ insert: mock.insert }), storage: { from: () => ({ upload: mock.upload }) },
} }));
const target = { organizationId: "org", organizationAddress: "123", address: "456", conversationId: "conversation" };
let client: QueryClient;
function setup() {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useSendMessage("agent", "Agente teste"), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => {
  localStorage.clear();
  act(() => setPreferences(DEFAULT_PREFERENCES));
  mock.upload.mockResolvedValue({ error: null });
  mock.insert.mockImplementation((row) => ({ select: () => ({ single: async () => ({ data: { ...row, timestamp: "2026-10-14" }, error: null }) }) }));
});
afterEach(() => { client?.clear(); vi.restoreAllMocks(); });

describe("outgoing signature payload", () => {
  it.each(["  Ana  ", "", "   "])("signs text with the resolved name (%s) and preserves reply context", async (name) => {
    const { result } = setup();
    act(() => setPreferences({ signatureEnabled: true, signatureName: name }));
    const content: MessageContent = { type: "text", kind: "text", text: "Olá", re_message_id: "reply" };
    await act(async () => { await result.current.mutateAsync({ target, content }); });
    expect(mock.insert.mock.calls[0][0].content).toEqual({ ...content, version: "1", text: `**${name.trim() || "Agente teste"}:**\nOlá` });
    expect(content.text).toBe("Olá");
  });
  it.each(["image", "video", "document"])("signs an uploaded %s caption and preserves file metadata", async (kind) => {
    const { result } = setup();
    act(() => setPreferences({ signatureEnabled: true }));
    const file = new File(["file"], "attachment", { type: "application/octet-stream" });
    await act(async () => { await result.current.mutateAsync({ target, file, content: { type: "file", kind, text: "Legenda", file: { uri: "", mime_type: file.type } } }); });
    expect(mock.upload).toHaveBeenCalledTimes(1);
    expect(mock.insert.mock.calls[0][0].content).toMatchObject({ text: "**Agente teste:**\nLegenda", file: { uri: expect.stringMatching(/^internal:\/\/media\//), size: file.size, name: file.name } });
  });
  it.each([
    { type: "data", kind: "template", text: "Modelo", data: {} },
    { type: "data", kind: "reaction", text: "Reação", data: {} },
    { type: "file", kind: "audio", text: "Áudio", file: { uri: "https://test/audio", mime_type: "audio/ogg", duration: 3 } },
    { type: "file", kind: "image", file: { uri: "https://test/file", mime_type: "image/png" } },
    { type: "file", kind: "video", text: "", file: { uri: "https://test/file", mime_type: "video/mp4" } },
  ])("does not sign templates, reactions, audio or absent captions: $kind", async (content) => {
    const { result } = setup();
    act(() => setPreferences({ signatureEnabled: true }));
    await act(async () => { await result.current.mutateAsync({ target, content }); });
    expect(mock.insert.mock.calls[0][0].content).toEqual({ version: "1", ...content });
  });
  it.each(["text", "image"])("keeps edited/resubmitted %s unchanged with the exact prefix or disabled signing", async (kind) => {
    const { result } = setup();
    const content: MessageContent = kind === "text" ? { type: "text", kind, text: "Olá" } : { type: "file", kind, text: "Legenda", file: { uri: "https://test/file", mime_type: "image/png" } };
    await act(async () => { await result.current.mutateAsync({ target, content }); });
    expect(mock.insert.mock.calls.at(-1)![0].content.text).toBe(content.text);
    act(() => setPreferences({ signatureEnabled: true }));
    // Typed in WhatsApp flavor (*bold*), stored as Markdown (**bold**).
    const signed = { ...content, text: `*Agente teste:*\n${content.text}` };
    for (let i = 0; i < 2; i++) {
      await act(async () => { await result.current.mutateAsync({ target, content: signed }); });
      expect(mock.insert.mock.calls.at(-1)![0].content.text).toBe(`**Agente teste:**\n${content.text}`);
    }
  });
  it("signs with blocked storage and retains a different existing prefix", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = setup();
    act(() => setPreferences({ signatureEnabled: true }));
    await act(async () => { await result.current.mutateAsync({ target, content: { type: "text", kind: "text", text: "*Outro:*\nOlá" } }); });
    expect(mock.insert.mock.calls[0][0].content.text).toBe("**Agente teste:**\n**Outro:**\nOlá");
  });
});

describe("outgoing formatting", () => {
  it.each([
    { type: "text", kind: "text", text: "*negrito* _itálico_ ~riscado~ `*mono*`" },
    { type: "file", kind: "image", text: "*negrito* _itálico_ ~riscado~ `*mono*`", file: { uri: "https://test/file", mime_type: "image/png" } },
  ] as MessageContent[])("stores what was typed in WhatsApp flavor as Markdown: $kind", async (content) => {
    const { result } = setup();
    await act(async () => { await result.current.mutateAsync({ target, content }); });
    expect(mock.insert.mock.calls[0][0].content.text).toBe("**negrito** _itálico_ ~~riscado~~ `*mono*`");
  });
  it("leaves template text alone", async () => {
    const { result } = setup();
    const content: MessageContent = { type: "data", kind: "template", text: "*Modelo*", data: {} };
    await act(async () => { await result.current.mutateAsync({ target, content }); });
    expect(mock.insert.mock.calls[0][0].content.text).toBe("*Modelo*");
  });
});
