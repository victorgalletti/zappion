// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatTarget } from "./chat-room";
import type { ConversationView, MessageRow } from "@/lib/types";
import AppShell from "./app-shell";

const mock = vi.hoisted(() => ({
  pathname: "/chats", search: new URLSearchParams(), push: vi.fn(), replace: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not found"); }),
  session: { user: { id: "user" } } as { user: { id: string } } | null,
  conversations: [] as ConversationView[], message: null as MessageRow | null,
  archived: false, eq: vi.fn(), from: vi.fn(), chat: vi.fn(),
  approvals: [] as { message_id: string; conversation_id: string }[],
  notifyClick: undefined as undefined | ((id: string) => void),
  startChat: undefined as undefined | ((address: string, instance: string) => void),
}));
const router = { push: mock.push, replace: mock.replace };
vi.mock("next/navigation", () => ({
  useRouter: () => router, usePathname: () => mock.pathname,
  useSearchParams: () => mock.search, notFound: mock.notFound,
}));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mock.from } }));
vi.mock("@/hooks/use-session", () => ({
  useSession: () => mock.session,
  useWorkspace: () => ({ data: {
    organizationId: "org", organizationName: "Test", numbers: [],
    agent: { id: "agent", name: "Agent", role: "member" },
  }, isLoading: false }),
}));
vi.mock("@/hooks/use-chat", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-chat")>(),
  useConversations: () => ({ data: mock.conversations, isLoading: false }),
  useRealtime: vi.fn(),
}));
vi.mock("@/hooks/use-message-approvals", () => ({
  useWaitingApprovals: () => ({ data: mock.approvals }),
}));
vi.mock("@/hooks/use-conversation-preferences", () => ({
  useConversationPreferences: () => ({ data: mock.archived ? [{ conversation_id: "one", archived_at: "2026-01-01" }] : [], isLoading: false }),
  useArchiveConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-message-notifications", () => ({
  useMessageNotifications: (_org: unknown, _views: unknown, _ids: unknown, onClick: (id: string) => void) => { mock.notifyClick = onClick; },
}));
vi.mock("./providers", () => ({ OrganizationProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("./member-avatar", () => ({ MemberAvatar: () => null }));
vi.mock("./organization-avatar", () => ({ OrganizationAvatar: () => null }));
vi.mock("./templates-manager", () => ({ TemplatesManager: () => null }));
vi.mock("./invitation-inbox", () => ({ InvitationInbox: () => null }));
vi.mock("./settings-panel", () => ({ SettingsPanel: ({ section, onSectionChange }: { section: string; onSectionChange: (s: string) => void }) => <button onClick={() => onSectionChange("members")}>{section}</button> }));
vi.mock("./profile-panel", () => ({ ProfilePanel: ({ section, onSectionChange }: { section: string; onSectionChange: (s: string) => void }) => <button onClick={() => onSectionChange("preferences")}>{section}</button> }));
vi.mock("./media-library", () => ({ MediaLibrary: ({ onOpenMessage }: { onOpenMessage: (row: MessageRow) => void }) => <button onClick={() => onOpenMessage(mock.message!)}>Open media message</button> }));
vi.mock("./chat-room", () => ({ ChatRoom: (props: { target: ChatTarget; focusMessage?: MessageRow; onBackToRecent: () => void; onBack: () => void }) => {
  mock.chat(props);
  return <><button onClick={props.onBackToRecent}>Recent messages</button><button onClick={props.onBack}>Back</button></>;
} }));
vi.mock("./sidebar", async (importOriginal) => {
  const { Sidebar } = await importOriginal<typeof import("./sidebar")>();
  return { Sidebar: (props: Parameters<typeof Sidebar>[0]) => {
    mock.startChat = props.onStartChat;
    return <Sidebar {...props} />;
  } };
});

const conversation: ConversationView = {
  id: "one", memberIds: ["one", "two"], organization_id: "org", service: "whatsapp",
  organization_address: "instance", address: "5511999990000", name: null, type: null, extra: null,
  created_at: "2026-01-01", updated_at: "2026-01-01", displayName: "Merged contact", lastMessage: null,
  unread: 0,
};
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = () => <QueryClientProvider client={client}><AppShell /></QueryClientProvider>;
  return { ...render(tree()), tree };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.pathname = "/chats";
  mock.search = new URLSearchParams();
  mock.session = { user: { id: "user" } };
  mock.conversations = [conversation];
  mock.archived = false;
  mock.approvals = [];
  mock.message = { id: "message", conversation_id: "two", organization_id: "org", organization_address: "instance", conversation_address: conversation.address } as MessageRow;
  mock.from.mockImplementation(() => {
    const query = { select: () => query, eq: (...args: unknown[]) => { mock.eq(...args); return query; }, maybeSingle: async () => ({ data: mock.message, error: null }) };
    return query;
  });
});

describe("URL-driven app shell", () => {
  it.each([
    ["Chats", "/chats"], ["Archived", "/archived"], ["Message templates", "/templates"],
    ["Media", "/media"], ["Settings", "/settings/organization"], ["My profile: Agent", "/profile"],
  ])("pushes the URL for the %s rail item", (name, href) => {
    open();
    fireEvent.click(within(screen.getAllByRole("navigation", { name: "Main navigation" })[0]).getByRole("button", { name }));
    expect(mock.push).toHaveBeenLastCalledWith(href);
  });

  it("pushes the archive URL from the sidebar entry", () => {
    open();
    fireEvent.click(within(screen.getByRole("complementary", { name: "Chats" })).getByRole("button", { name: "Archived" }));
    expect(mock.push).toHaveBeenCalledWith("/archived");
  });

  it.each(["chats", "archived"])("keeps the %s sidebar, search and scroll position on opening and returning from a conversation", (section) => {
    mock.pathname = `/${section}`;
    mock.archived = section === "archived";
    const { rerender, tree } = open();
    const name = section === "archived" ? "Archived" : "Chats";
    const sidebar = screen.getByRole("complementary", { name });
    const scroll = sidebar.querySelector(".thin-scroll")!;
    scroll.scrollTop = 120;
    fireEvent.change(screen.getByRole("textbox", { name: "Search chats" }), { target: { value: "Merged" } });
    mock.pathname = `/${section}/two`;
    rerender(tree());
    expect(screen.getByRole("complementary", { name })).toBe(sidebar);
    expect(sidebar.parentElement?.classList.contains("hidden")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(mock.push).toHaveBeenLastCalledWith(`/${section}`);
    mock.pathname = `/${section}`;
    rerender(tree());
    expect(screen.getByRole("complementary", { name })).toBe(sidebar);
    expect(sidebar.querySelector(".thin-scroll")).toBe(scroll);
    expect(sidebar.parentElement?.classList.contains("hidden")).toBe(false);
    expect(scroll.scrollTop).toBe(120);
    expect((screen.getByRole("textbox", { name: "Search chats" }) as HTMLInputElement).value).toBe("Merged");
  });

  it("badges Chats with waiting approvals and marks the merged conversation row", () => {
    mock.approvals = [{ message_id: "m1", conversation_id: "two" }, { message_id: "m2", conversation_id: "elsewhere" }];
    open();
    const rail = screen.getAllByRole("navigation", { name: "Main navigation" })[0];
    expect(within(rail).getByRole("button", { name: "Chats, 2 messages waiting for approval" })).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /Merged contact/ })).getByText("Approval")).toBeTruthy();
  });

  it("opens a conversation using the view id", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Merged contact/ }));
    expect(mock.push).toHaveBeenLastCalledWith("/chats/one");
  });

  it("fits the phone conversation to the visual viewport and releases it on return", () => {
    const viewport = Object.assign(new EventTarget(), { height: 800 });
    vi.stubGlobal("visualViewport", viewport);
    const { rerender, tree, unmount } = open();
    try {
      mock.pathname = "/chats/one";
      rerender(tree());
      const shell = screen.getByRole("complementary", { name: "Chats" }).parentElement!.parentElement!.parentElement!;
      expect(shell.style.getPropertyValue("--conversation-height")).toBe("800px");
      act(() => {
        viewport.height = 420;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(shell.style.getPropertyValue("--conversation-height")).toBe("420px");
      expect(shell.classList.contains("h-dvh")).toBe(true);
      expect(shell.classList.contains("max-md:h-[var(--conversation-height,100dvh)]")).toBe(true);
      mock.pathname = "/chats";
      rerender(tree());
      expect(shell.style.getPropertyValue("--conversation-height")).toBe("");
      viewport.height = 800;
      viewport.dispatchEvent(new Event("resize"));
      expect(shell.style.getPropertyValue("--conversation-height")).toBe("");
    } finally {
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it.each(["one", "two"])("opens the merged view from member id %s", (id) => {
    mock.pathname = `/chats/${id}`;
    open();
    expect(mock.chat.mock.lastCall?.[0].target.conversationIds).toEqual(["one", "two"]);
    expect(screen.getByRole("button", { name: /Merged contact/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("fetches a message on direct load and passes the row as focus, then replaces the URL on return", async () => {
    mock.pathname = "/chats/two";
    mock.search = new URLSearchParams("message=message");
    open();
    await waitFor(() => expect(mock.chat.mock.lastCall?.[0].focusMessage).toEqual(mock.message));
    expect(mock.from).toHaveBeenCalledWith("messages");
    expect(mock.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(mock.eq).toHaveBeenCalledWith("id", "message");
    fireEvent.click(screen.getByRole("button", { name: "Recent messages" }));
    expect(mock.replace).toHaveBeenCalledWith("/chats/two");
  });

  it("shows Unselected for an unknown conversation", () => {
    mock.pathname = "/chats/missing";
    open();
    expect(mock.chat).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Zappion" })).toBeTruthy();
  });

  it("opens archived conversations and navigates back to chats", () => {
    mock.pathname = "/archived";
    mock.archived = true;
    open();
    fireEvent.click(screen.getByRole("button", { name: /Merged contact/ }));
    expect(mock.push).toHaveBeenCalledWith("/archived/one");
    fireEvent.click(screen.getByRole("button", { name: "Back to chats" }));
    expect(mock.push).toHaveBeenLastCalledWith("/chats");
  });

  it("opens notification clicks in chats", () => {
    open();
    mock.notifyClick!("two");
    expect(mock.push).toHaveBeenCalledWith("/chats/two");
  });

  it("opens media messages with a message query", () => {
    mock.pathname = "/media";
    open();
    fireEvent.click(screen.getByRole("button", { name: "Open media message" }));
    expect(mock.push).toHaveBeenCalledWith("/chats/two?message=message");
  });

  it.each([["/settings/instances", "instances", "/settings/members"], ["/profile/preferences", "preferences", "/profile/preferences"]])("controls subsection navigation at %s", (path, label, href) => {
    mock.pathname = path;
    open();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(mock.push).toHaveBeenCalledWith(href);
  });

  it("keeps new-number drafts at /chats and replaces the URL when the conversation arrives", () => {
    const { rerender, tree } = open();
    act(() => mock.startChat!("5511888880000", "instance"));
    expect(mock.push).toHaveBeenCalledWith("/chats");
    expect(mock.chat.mock.lastCall?.[0].target.conversationId).toBeUndefined();
    mock.conversations = [...mock.conversations, { ...conversation, id: "new", memberIds: ["new"], address: "5511888880000" }];
    rerender(tree());
    expect(mock.replace).toHaveBeenCalledWith("/chats/new");
  });

  it("clears a new-number draft when returning to the list", () => {
    open();
    act(() => mock.startChat!("5511888880000", "instance"));
    expect(mock.chat.mock.lastCall?.[0].target.address).toBe("5511888880000");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(mock.push).toHaveBeenLastCalledWith("/chats");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Chats" }).parentElement?.classList.contains("hidden")).toBe(false);
  });

  it("preserves the full path and search when redirecting to login", () => {
    mock.session = null;
    mock.pathname = "/chats/two";
    mock.search = new URLSearchParams("message=message");
    open();
    expect(mock.replace).toHaveBeenCalledWith("/login?next=%2Fchats%2Ftwo%3Fmessage%3Dmessage");
  });

  it("rejects invalid routes", () => {
    mock.pathname = "/settings/invalid";
    expect(() => open()).toThrow("not found");
  });
});
