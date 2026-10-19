// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationView } from "@/lib/types";
import { Sidebar } from "./sidebar";

const conversation: ConversationView = {
  id: "chat", memberIds: ["chat"], organization_id: "org", service: "whatsapp",
  organization_address: "instance", address: "5511999990000", name: null, type: null, extra: null,
  created_at: "2026-01-01", updated_at: "2026-01-01", displayName: "Contact", unread: 2,
  lastMessage: {
    id: "message", organization_id: "org", conversation_id: "chat", service: "whatsapp",
    organization_address: "instance", conversation_address: "5511999990000",
    sender_address: "5511999990000", external_id: null, agent_id: null, status: null,
    timestamp: "2026-01-01T12:00:00Z", created_at: "2026-01-01T12:00:00Z",
    content: { type: "text", kind: "text", text: "A longer preview that can wrap onto a second line on phones." },
  },
};
const props = {
  numbers: [], conversations: [conversation], loading: false, activeId: null,
  onSelect: vi.fn(), onStartChat: vi.fn(), width: 360, section: "chats" as const,
  onSectionChange: vi.fn(), onToggleArchive: vi.fn(), archiving: false,
};

describe("phone chat list", () => {
  it("uses a large title on the same row as the new chat button and preserves desktop title sizing", () => {
    render(<Sidebar {...props} />);
    const header = screen.getByRole("heading", { name: "Chats" }).closest("header")!;
    expect(header.className).toContain("env(safe-area-inset-top)");
    expect(header.className).not.toContain("grid");
    expect(header.classList.contains("[&>h1]:text-4xl")).toBe(true);
    expect(header.classList.contains("md:[&>h1]:text-xl")).toBe(true);
    const newChat = screen.getByRole("button", { name: "New chat" });
    expect(newChat.classList.contains("size-11")).toBe(true);
    expect(newChat.classList.contains("md:size-8")).toBe(true);
    fireEvent.click(newChat);
    expect(screen.getByPlaceholderText("5561999999999")).toBeTruthy();
  });

  it("keeps search and unread filtering working with a phone-sized pill input", () => {
    render(<Sidebar {...props} conversations={[conversation, { ...conversation, id: "read", memberIds: ["read"], displayName: "Read contact", unread: 0 }]} />);
    const search = screen.getByRole("textbox", { name: "Search chats" });
    expect(search.classList.contains("text-base")).toBe(true);
    expect(search.classList.contains("md:text-sm")).toBe(true);
    expect(search.closest("label")!.classList.contains("rounded-full")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Unread/ }));
    expect(screen.queryByText("Read contact")).toBeNull();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.queryByText("Contact")).toBeNull();
    fireEvent.change(search, { target: { value: "Contact" } });
    expect(screen.getByText("Contact")).toBeTruthy();
  });

  it("marks rows with a message waiting for approval through any merged conversation id", () => {
    render(<Sidebar {...props} conversations={[{ ...conversation, memberIds: ["chat", "alias"] }, { ...conversation, id: "other", memberIds: ["other"], displayName: "Other contact" }]} approvalConversationIds={new Set(["alias"])} />);
    const marked = screen.getByRole("heading", { name: "Contact" }).closest("button")!;
    expect(within(marked).getByText("Approval").getAttribute("title")).toBe("A message is waiting for approval");
    expect(within(screen.getByRole("heading", { name: "Other contact" }).closest("button")!).queryByText("Approval")).toBeNull();
  });

  it("gives Archived the large title and keeps its back action", () => {
    const onSectionChange = vi.fn();
    render(<Sidebar {...props} section="archived" onSectionChange={onSectionChange} />);
    const header = screen.getByRole("heading", { name: "Archived" }).closest("header")!;
    expect(header.classList.contains("[&>h1]:text-4xl")).toBe(true);
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to chats" }));
    expect(onSectionChange).toHaveBeenCalledWith("chats");
  });

  it("selects the row by its preview and opens its touch menu without selecting it", () => {
    const onSelect = vi.fn();
    const onToggleArchive = vi.fn();
    render(<Sidebar {...props} onSelect={onSelect} onToggleArchive={onToggleArchive} />);
    const preview = screen.getByText(String(conversation.lastMessage!.content.text));
    expect(preview.classList.contains("line-clamp-2")).toBe(true);
    expect(preview.classList.contains("md:truncate")).toBe(true);
    fireEvent.click(preview);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(conversation);
    const trigger = screen.getByRole("button", { name: "Chat options" });
    expect(trigger.classList.contains("size-11")).toBe(true);
    expect(trigger.classList.contains("md:opacity-0")).toBe(true);
    expect(trigger.classList.contains("sm:opacity-0")).toBe(false);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive chat" }));
    expect(onToggleArchive).toHaveBeenCalledExactlyOnceWith(conversation);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
