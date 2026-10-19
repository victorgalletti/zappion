// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES, setPreferences } from "@/lib/preferences";
import type { ConversationView, MessageRow } from "@/lib/types";
import { useMessageNotifications } from "./use-message-notifications";
import { useRealtime } from "./use-chat";

const mock = vi.hoisted(() => ({ tone: vi.fn(() => true), unlock: vi.fn(), on: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/notification-sound", () => ({ playNotificationTone: mock.tone, unlockNotificationSound: mock.unlock }));
vi.mock("@/lib/supabase", () => ({ callFunction: vi.fn(), supabase: { channel: () => channel, removeChannel: mock.remove } }));
const channel = { on: mock.on, subscribe: vi.fn(() => channel) };
let messageEvent: (payload: unknown) => void;
let created: { title: string; options: NotificationOptions; onclick?: () => void; close: ReturnType<typeof vi.fn> }[];
let permission: NotificationPermission;
const conversation = { id: "chat", memberIds: ["chat", "alias"], displayName: "Ana", archived: true } as ConversationView;
const onOpen = vi.fn();
function message(patch: Partial<MessageRow> = {}): MessageRow {
  return { id: "message", organization_id: "org", conversation_id: "chat", service: "whatsapp", sender_address: "5511999999999", conversation_address: "5511999999999", timestamp: new Date(Date.now()).toISOString(), content: { type: "text", kind: "text", text: "Olá" }, ...patch } as MessageRow;
}
function setup(openIds: string[] = []) {
  return renderHook(({ open }) => useMessageNotifications("org", [conversation], open, onOpen), { initialProps: { open: openIds } });
}
beforeEach(() => {
  localStorage.clear(); act(() => setPreferences(DEFAULT_PREFERENCES));
  vi.spyOn(Date, "now").mockReturnValue(100000);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  created = []; permission = "granted";
  vi.stubGlobal("Notification", class {
    static get permission() { return permission; }
    close = vi.fn();
    constructor(public title: string, public options: NotificationOptions) { created.push(this); }
  });
  mock.tone.mockReturnValue(true);
  mock.on.mockImplementation((_event, options, callback) => { if (options.table === "messages") messageEvent = callback; return channel; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("suppresses the open grouped conversation only while visible and focused", () => {
  const { result, rerender } = setup(["chat", "alias"]);
  act(() => result.current(message({ conversation_id: "alias" })));
  expect(mock.tone).not.toHaveBeenCalled();
  vi.mocked(document.hasFocus).mockReturnValue(false);
  act(() => result.current(message({ id: "second" })));
  expect(mock.tone).toHaveBeenCalledTimes(1);
  vi.mocked(Date.now).mockReturnValue(103000); vi.mocked(document.hasFocus).mockReturnValue(true);
  rerender({ open: [] }); act(() => result.current(message({ id: "third" })));
  expect(mock.tone).toHaveBeenCalledTimes(2);
});
it("throttles bursts, deduplicates inserts and honors changed preferences", () => {
  const { result } = setup();
  act(() => { result.current(message()); result.current(message({ id: "two" })); });
  expect(mock.tone).toHaveBeenCalledTimes(1);
  vi.mocked(Date.now).mockReturnValue(102000); act(() => result.current(message()));
  expect(mock.tone).toHaveBeenCalledTimes(1);
  act(() => result.current(message({ id: "three" })));
  expect(mock.tone).toHaveBeenCalledTimes(2);
  act(() => setPreferences({ notificationSound: false })); vi.mocked(Date.now).mockReturnValue(105000);
  act(() => result.current(message({ id: "four" })));
  expect(mock.tone).toHaveBeenCalledTimes(2);
});
it("ignores outgoing, backfilled, reaction-only, empty and unrelated rows", () => {
  const { result } = setup();
  for (const patch of [{ sender_address: null }, { timestamp: new Date(99000).toISOString() }, { content: { type: "data", kind: "reaction", data: {} } }, { content: { type: "text", kind: "text", text: "" } }, { content: { type: "data", kind: "typing", data: {} } }, { content: { type: "data", kind: "status", data: {} } }, { timestamp: "invalid" }, { conversation_id: null }, { service: "other" }, { organization_id: "other" }] as Partial<MessageRow>[]) act(() => result.current(message(patch)));
  expect(mock.tone).not.toHaveBeenCalled(); expect(created).toHaveLength(0);
});
it("notifies archived conversations with a shared media preview and opens on click", () => {
  act(() => setPreferences({ desktopNotifications: true }));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
  const { result, unmount } = setup(["chat"]);
  act(() => result.current(message({ content: { type: "file", kind: "image", file: { uri: "test", mime_type: "image/png" } } })));
  expect(created[0].title).toBe("Ana");
  expect(created[0].options).toEqual({ body: "📷 Photo", tag: "chat", silent: true });
  act(() => result.current(message({ id: "second" })));
  expect(created[1].options.tag).toBe("chat"); expect(created[0].close).toHaveBeenCalled();
  act(() => created[1].onclick?.());
  expect(focus).toHaveBeenCalled(); expect(onOpen).toHaveBeenCalledWith("chat"); expect(conversation.archived).toBe(true);
  unmount(); expect(created[1].close).toHaveBeenCalled();
});
it("requires the preference, permission and a background window", () => {
  const { result } = setup(); act(() => result.current(message()));
  act(() => setPreferences({ desktopNotifications: true })); act(() => result.current(message({ id: "foreground" })));
  vi.mocked(document.hasFocus).mockReturnValue(false); permission = "denied";
  act(() => result.current(message({ id: "denied" }))); expect(created).toHaveLength(0);
  permission = "granted"; act(() => result.current(message({ id: "allowed" }))); expect(created).toHaveLength(1);
  vi.stubGlobal("Notification", undefined);
  expect(() => act(() => result.current(message({ id: "unsupported" })))).not.toThrow();
});
it("unlocks audio on gestures and removes listeners on unmount", () => {
  const { unmount } = setup(); fireEvent.pointerDown(window); fireEvent.keyDown(window, { key: "Enter" });
  expect(mock.unlock).toHaveBeenCalledTimes(2); unmount(); fireEvent.pointerDown(window);
  expect(mock.unlock).toHaveBeenCalledTimes(2);
});
it("delivers only realtime INSERT events, never query loads or UPDATE/status events", () => {
  const client = new QueryClient(), onInsert = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { unmount } = renderHook(() => useRealtime("org", onInsert), { wrapper });
  client.setQueryData(["recent-messages", "org"], [message()]); expect(onInsert).not.toHaveBeenCalled();
  act(() => messageEvent({ table: "messages", eventType: "UPDATE", new: message() })); expect(onInsert).not.toHaveBeenCalled();
  act(() => messageEvent({ table: "messages", eventType: "INSERT", new: message() })); expect(onInsert).toHaveBeenCalledExactlyOnceWith(message());
  unmount(); expect(mock.remove).toHaveBeenCalledWith(channel); client.clear();
});

it("silently tolerates blocked desktop notification construction", () => {
  act(() => setPreferences({ desktopNotifications: true }));
  vi.mocked(document.hasFocus).mockReturnValue(false);
  vi.stubGlobal("Notification", class {
    static permission = "granted";
    constructor() { throw new Error("blocked"); }
  });
  const { result } = setup();
  expect(() => act(() => result.current(message()))).not.toThrow();
});
it("reads the latest callback without resubscribing realtime", () => {
  const client = new QueryClient(), first = vi.fn(), second = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { rerender, unmount } = renderHook(({ callback }) => useRealtime("org", callback), { initialProps: { callback: first }, wrapper });
  const subscriptions = mock.on.mock.calls.length;
  rerender({ callback: second });
  act(() => messageEvent({ table: "messages", eventType: "INSERT", new: message() }));
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1);
  expect(mock.on.mock.calls.length).toBe(subscriptions);
  unmount(); client.clear();
});

it("refreshes the waiting approvals when zappion_message_approvals changes", () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { unmount } = renderHook(() => useRealtime("org"), { wrapper });
  const [, options, callback] = mock.on.mock.calls.find(([, options]) => options.table === "zappion_message_approvals")!;
  expect(options).toEqual({ event: "*", schema: "public", table: "zappion_message_approvals", filter: "organization_id=eq.org" });
  act(() => callback({ table: "zappion_message_approvals", eventType: "UPDATE", new: { message_id: "m", decision: "approved" } }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["message-approvals", "org"] });
  unmount(); client.clear();
});
