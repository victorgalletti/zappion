// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentRow } from "@/lib/types";
import { NavigationRail } from "./navigation-rail";

vi.mock("./member-avatar", () => ({ MemberAvatar: () => <span>MT</span> }));
vi.mock("./organization-avatar", () => ({ OrganizationAvatar: () => <span>OT</span> }));

const agent: AgentRow = { id: "agent", user_id: "user", organization_id: "org", name: "Membro teste", role: "member" };
const props = { organizationName: "Teste", unread: 0, agent };

describe("navigation rail", () => {
  it("places settings directly above the profile in the bottom wrapper with the usual active styling", () => {
    const onOpenOrganization = vi.fn();
    const onSelect = vi.fn();
    render(<NavigationRail {...props} section="settings" onSelect={onSelect} onOpenOrganization={onOpenOrganization} />);
    const settings = screen.getByRole("button", { name: "Settings" });
    const profile = screen.getByRole("button", { name: "My profile: Membro teste" });
    expect(settings.parentElement?.classList.contains("mt-auto")).toBe(true);
    expect(settings.nextElementSibling).toBe(profile);
    expect(settings.getAttribute("aria-current")).toBe("page");
    expect(settings.className).toContain("after:bg-accent");
    expect(profile.getAttribute("aria-current")).toBeNull();
    fireEvent.click(settings);
    fireEvent.click(screen.getByRole("button", { name: "Organization: Teste" }));
    expect(onOpenOrganization).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("badges Chats with the count of messages waiting for approval", () => {
    render(<NavigationRail {...props} section="chats" onSelect={vi.fn()} approvals={120} />);
    const chats = screen.getByRole("button", { name: "Chats, 120 messages waiting for approval" });
    expect(chats.textContent).toBe("99+");
    expect(screen.getByRole("button", { name: "Archived" }).textContent).toBe("");
  });

  it("opens the standalone profile and highlights its avatar", () => {
    const onSelect = vi.fn();
    render(<NavigationRail {...props} section="profile" onSelect={onSelect} />);
    const profile = screen.getByRole("button", { name: "My profile: Membro teste" });
    expect(profile.getAttribute("aria-current")).toBe("page");
    expect(profile.classList.contains("ring-2")).toBe(true);
    expect(profile.classList.contains("ring-accent")).toBe(true);
    expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(profile);
    expect(onSelect).toHaveBeenCalledWith("profile");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSelect).toHaveBeenLastCalledWith("settings");
  });

  it("uses the profile callback when supplied", () => {
    const onSelect = vi.fn();
    const onOpenProfile = vi.fn();
    render(<NavigationRail {...props} section="chats" onSelect={onSelect} onOpenProfile={onOpenProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "My profile: Membro teste" }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
