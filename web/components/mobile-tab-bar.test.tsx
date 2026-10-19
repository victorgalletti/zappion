// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentRow } from "@/lib/types";
import { MobileTabBar } from "./mobile-tab-bar";

vi.mock("./member-avatar", () => ({ MemberAvatar: ({ name }: { name: string }) => <span>{name}</span> }));

const agent: AgentRow = { id: "agent", user_id: "user", organization_id: "org", name: "Test agent", role: "member" };
const props = { agent, unread: 0, section: "chats" as const, onSelect: vi.fn() };

describe("mobile tab bar", () => {
  it("renders the five tabs in order with the agent avatar and no settings tab", () => {
    render(<MobileTabBar {...props} />);
    const buttons = within(screen.getByRole("navigation", { name: "Main navigation" })).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Chats", "Templates", "Archived", "Media", "My profile: Test agent",
    ]);
    expect(within(buttons[4]).getByText("Test agent")).toBeTruthy();
    expect(within(buttons[4]).getByText("My profile")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("shows waiting approvals on Chats next to the unread count", () => {
    render(<MobileTabBar {...props} unread={3} approvals={1} />);
    const chats = screen.getByRole("button", { name: "Chats, 3 unread messages, 1 message waiting for approval" });
    expect(within(chats).getByText("3")).toBeTruthy();
    expect(within(chats).getByText("1").className).toContain("bg-orange-500");
    expect(screen.getByRole("button", { name: "Archived" })).toBeTruthy();
  });

  it("marks only the selected tab current and highlights it with the accent", () => {
    render(<MobileTabBar {...props} section="profile" />);
    const profile = screen.getByRole("button", { name: "My profile: Test agent" });
    expect(profile.getAttribute("aria-current")).toBe("page");
    expect(profile.classList.contains("text-accent")).toBe(true);
    expect(screen.getAllByRole("button").filter((button) => button.hasAttribute("aria-current"))).toEqual([profile]);
  });

  it("shows capped chat and archived badges with the rail's unread labels", () => {
    render(<MobileTabBar {...props} unread={120} archivedUnread={3} />);
    const chats = screen.getByRole("button", { name: "Chats, 120 unread messages" });
    const archived = screen.getByRole("button", { name: "Archived, 3 chats with unread messages" });
    expect(within(chats).getByText("99+").getAttribute("aria-hidden")).toBe("true");
    expect(within(archived).getByText("3").getAttribute("aria-hidden")).toBe("true");
  });

  it("selects each tab", () => {
    const onSelect = vi.fn();
    render(<MobileTabBar {...props} onSelect={onSelect} />);
    screen.getAllByRole("button").forEach((button) => fireEvent.click(button));
    expect(onSelect.mock.calls.map(([section]) => section)).toEqual(["chats", "templates", "archived", "media", "profile"]);
  });
});
