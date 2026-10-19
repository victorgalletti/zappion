// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";
import { ConversationItem } from "./conversation-item";
import { NavigationRail } from "./navigation-rail";
import type { ConversationView } from "@/lib/types";

vi.mock("./templates-manager", () => ({ TemplatesManager: () => null }));
vi.mock("./member-avatar", () => ({ MemberAvatar: () => null }));
vi.mock("./organization-avatar", () => ({ OrganizationAvatar: () => null }));

const archived: ConversationView = {
  id: "one", memberIds: ["one", "two"], organization_id: "org", service: "whatsapp",
  organization_address: "instance", address: "5511999990000", name: null, type: null, extra: null,
  created_at: "2026-01-01", updated_at: "2026-01-01", displayName: "Contato arquivado", lastMessage: null,
  unread: 12, archived: true,
};
const readArchive = { ...archived, id: "read", memberIds: ["read"], displayName: "Arquivo lido", unread: 0 };
const normal = { ...archived, id: "normal", memberIds: ["normal"], displayName: "Contato principal", archived: false };

describe("archived conversation UI", () => {
  it("opens archives in the same sidebar, with unread conversation count and a back button", () => {
    const onSectionChange = vi.fn();
    const props = {
      numbers: [], conversations: [archived, readArchive, normal], loading: false, activeId: null,
      onSelect: vi.fn(), onStartChat: vi.fn(), width: 360, onSectionChange,
      onToggleArchive: vi.fn(), archiving: false,
    };
    const { rerender } = render(<Sidebar {...props} section="chats" />);
    expect(screen.queryByText("Contato arquivado")).toBeNull();
    expect(screen.getByText("Contato principal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Archived, 1 chat with unread messages" }));
    expect(onSectionChange).toHaveBeenCalledWith("archived");
    rerender(<Sidebar {...props} section="archived" />);
    expect(screen.getByText("Contato arquivado")).toBeTruthy();
    expect(screen.getByText("Arquivo lido")).toBeTruthy();
    expect(screen.queryByText("Contato principal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to chats" }));
    expect(onSectionChange).toHaveBeenLastCalledWith("chats");
  });

  it("supports right-click and chevron actions without selecting the conversation", () => {
    const onSelect = vi.fn();
    const onToggleArchive = vi.fn();
    render(<ConversationItem conversation={archived} active={false} onSelect={onSelect} onToggleArchive={onToggleArchive} archiving={false} />);
    fireEvent.contextMenu(screen.getByText("Contato arquivado"));
    const action = screen.getByRole("menuitem", { name: "Unarchive chat" });
    expect(document.activeElement).toBe(action);
    fireEvent.keyDown(action, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Chat options" });
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive chat" }));
    expect(onToggleArchive).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers the archive action for a conversation in the main list", () => {
    render(<ConversationItem conversation={normal} active={false} onSelect={vi.fn()} onToggleArchive={vi.fn()} archiving={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
    expect(screen.getByRole("menuitem", { name: "Archive chat" })).toBeTruthy();
  });

  it("provides a separate archive destination and badge in the navigation rail", () => {
    const onSelect = vi.fn();
    render(<NavigationRail section="archived" onSelect={onSelect} organizationName="Teste" unread={12} archivedUnread={1} />);
    const button = screen.getByRole("button", { name: "Archived, 1 chat with unread messages" });
    expect(button.getAttribute("aria-current")).toBe("page");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("archived");
  });
});
