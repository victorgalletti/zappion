// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "@/hooks/use-session";
import { CHAT_BACKGROUNDS, DEFAULT_PREFERENCES, setPreferences } from "@/lib/preferences";
import type { AgentRow } from "@/lib/types";
import { SettingsPanel } from "./settings-panel";
import { NavigationRail, type NavigationSection } from "./navigation-rail";
import type { SettingsSection, ProfileSection } from "@/lib/routes";
import { ProfilePanel } from "./profile-panel";

const mock = vi.hoisted(() => ({ from: vi.fn(), upload: vi.fn(), sign: vi.fn(), update: vi.fn(), eq: vi.fn(), single: vi.fn(), signOut: vi.fn(), setPreference: vi.fn(), testSound: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mock.from, auth: { signOut: mock.signOut }, storage: { from: () => ({ upload: mock.upload, createSignedUrl: mock.sign }) } } }));
vi.mock("./providers", () => ({ useTheme: () => ({ preference: "system", setPreference: mock.setPreference }) }));
vi.mock("@/lib/notification-sound", () => ({ testNotificationSound: mock.testSound }));
const originalPhoto = "organizations/test-org/agents/test-agent/original.png";
let agent: AgentRow;
let client: QueryClient;
function TestProfile() {
  const workspace = useWorkspace("test-user");
  const [section, setSection] = useState<NavigationSection>("profile");
  const [profileSection, setProfileSection] = useState<ProfileSection>("profile");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("organization");
  return workspace.data ? <><NavigationRail section={section} onSelect={setSection} organizationName="Teste" unread={0} agent={workspace.data.agent} onOpenOrganization={() => { setSettingsSection("organization"); setSection("settings"); }} onOpenProfile={() => setSection("profile")} />{section === "profile" ? <ProfilePanel workspace={workspace.data} section={profileSection} onSectionChange={setProfileSection} /> : <SettingsPanel workspace={workspace.data} section={settingsSection} onSectionChange={setSettingsSection} />}</> : null;
}
async function openProfile() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><TestProfile /></QueryClientProvider>);
  await screen.findAllByRole("img", { name: "Photo of Membro teste" });
}
beforeEach(() => {
  localStorage.clear();
  act(() => setPreferences(DEFAULT_PREFERENCES));
  agent = { id: "test-agent", user_id: "test-user", organization_id: "test-org", name: "Membro teste", role: "member", picture: originalPhoto };
  mock.upload.mockResolvedValue({ error: null });
  mock.sign.mockImplementation(async (path: string) => ({ data: { signedUrl: `https://media.test/${path}` }, error: null }));
  mock.single.mockResolvedValue({ data: { id: agent.id }, error: null });
  mock.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query), eq: vi.fn((...args) => { mock.eq(...args); return query; }),
      not: vi.fn(() => query), order: vi.fn(() => query), is: vi.fn(() => query), limit: vi.fn(() => query),
      update: vi.fn((patch) => { mock.update(patch); agent = { ...agent, ...patch }; return query; }),
      single: mock.single,
      maybeSingle: vi.fn(async () => ({ data: { ...agent, organizations: { name: "Teste", extra: null } }, error: null })),
      then: (resolve: (value: unknown) => unknown) => {
        if (table === "agents") return Promise.resolve({ data: [{ ...agent }], error: null }).then(resolve);
        if (table !== "organizations_addresses") throw new Error(`Unexpected table ${table}`);
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return query;
  });
});
afterEach(() => { client?.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("My profile (member, with mocked storage and database)", () => {
  it("opens organization and profile from the rail and shows the member photo in the member list", async () => {
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Organization name")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    await waitFor(() => expect(screen.getAllByRole("img", { name: "Photo of Membro teste" })).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Organization: Teste" }));
    expect(screen.getByLabelText("Organization name")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "My profile: Membro teste" }));
    expect(screen.getByLabelText("Your name")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My profile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Profile" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Preferences" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Settings sections" })).toBeNull();
    expect(screen.queryByText(/view these settings only/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("shows theme and sign out only in preferences and can return to the profile", async () => {
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preferences" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "System" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(mock.setPreference).toHaveBeenCalledWith("dark");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(mock.setPreference).toHaveBeenCalledWith("light");
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Chats" })).toBeTruthy();
    expect((within(screen.getByRole("group", { name: "Font size" })).getByRole("radio", { name: "Default" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Large" }));
    expect((screen.getByRole("radio", { name: "Large" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("This is how your messages look at this size.")).toBeTruthy();
    const enterSwitch = screen.getByRole("switch", { name: "Press Enter to send" }) as HTMLInputElement;
    expect(enterSwitch.checked).toBe(true);
    fireEvent.click(enterSwitch);
    expect(enterSwitch.checked).toBe(false);
    expect(screen.getByText("Enter adds a new line. Ctrl + Enter or ⌘ + Enter sends.")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("preferences")!)).toEqual({ ...DEFAULT_PREFERENCES, fontSize: "large", enterToSend: false, audioRate: 1, notificationSound: true, desktopNotifications: false });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mock.signOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    expect(screen.getByLabelText("Your name")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
  });
  it("resets settings to organization when its rail button is clicked again", async () => {
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Organization name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Organization" }).getAttribute("aria-current")).toBe("page");
  });
  it("saves only the name and keeps the signed photo in the profile and rail", async () => {
    await openProfile();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: " Novo nome " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    const photos = await screen.findAllByRole("img", { name: "Photo of Novo nome" });
    expect(photos).toHaveLength(2);
    expect(photos.every(photo => photo.getAttribute("src") === `https://media.test/${originalPhoto}`)).toBe(true);
    expect(mock.update).toHaveBeenCalledExactlyOnceWith({ name: "Novo nome" });
    expect(agent.picture).toBe(originalPhoto);
    expect(mock.eq).toHaveBeenCalledWith("id", "test-agent");
    expect(mock.eq).toHaveBeenCalledWith("user_id", "test-user");
    expect(mock.eq).toHaveBeenCalledWith("organization_id", "test-org");
    expect(mock.upload).not.toHaveBeenCalled();
  });
  it.each([["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"]])("replaces a %s photo and preserves the unsaved name", async (type, ext) => {
    await openProfile();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Nome em edição" } });
    const file = new File(["mock image"], `photo.${ext}`, { type });
    fireEvent.change(screen.getByLabelText("Upload profile photo"), { target: { files: [file] } });
    await waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(1));
    const path = mock.upload.mock.calls[0][0];
    expect(path).toMatch(new RegExp(`^organizations/test-org/agents/test-agent/[a-f0-9-]+\\.${ext}$`));
    expect(mock.upload).toHaveBeenCalledWith(path, file, { contentType: type });
    expect(mock.update).toHaveBeenCalledExactlyOnceWith({ picture: path });
    await waitFor(() => expect(screen.getAllByRole("img").every(photo => photo.getAttribute("src") === `https://media.test/${path}`)).toBe(true));
    expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Nome em edição");
    expect(agent.name).toBe("Membro teste");
  });
  it("removes the picture reference and shows initials in profile and rail", async () => {
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(screen.queryAllByRole("img")).toHaveLength(0));
    expect(mock.update).toHaveBeenCalledExactlyOnceWith({ picture: null });
    expect(agent.name).toBe("Membro teste");
    expect(screen.getAllByText("MT")).toHaveLength(2);
    expect(mock.upload).not.toHaveBeenCalled();
  });
  it.each([new File(["gif"], "bad.gif", { type: "image/gif" }), new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })])("rejects invalid files before writing", async file => {
    await openProfile();
    fireEvent.change(screen.getByLabelText("Upload profile photo"), { target: { files: [file] } });
    expect(screen.getByRole("alert").textContent).toContain("up to 2 MB");
    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("does not change the profile when upload fails", async () => {
    mock.upload.mockResolvedValue({ error: new Error("upload failed") });
    await openProfile();
    fireEvent.change(screen.getByLabelText("Upload profile photo"), { target: { files: [new File(["image"], "new.png", { type: "image/png" })] } });
    await screen.findByRole("alert");
    expect(mock.update).not.toHaveBeenCalled();
    expect(agent.picture).toBe(originalPhoto);
  });
});


describe("notification preferences", () => {
  it.each(["granted", "denied", "default", "error"])("handles desktop permission %s and persists only browser preferences", async (permission) => {
    const requestPermission = permission === "error" ? vi.fn().mockRejectedValue(new Error("blocked")) : vi.fn().mockResolvedValue(permission);
    vi.stubGlobal("Notification", { requestPermission });
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    const sound = screen.getByRole("switch", { name: "Play sound for incoming messages" }) as HTMLInputElement;
    expect(sound.checked).toBe(true);
    fireEvent.click(sound);
    expect(sound.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(mock.testSound).toHaveBeenCalledTimes(1);
    const desktop = screen.getByRole("switch", { name: "Desktop notifications" }) as HTMLInputElement;
    expect(desktop.checked).toBe(false);
    fireEvent.click(desktop);
    await waitFor(() => expect(desktop.disabled).toBe(false));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(desktop.checked).toBe(permission === "granted");
    if (permission !== "granted") expect(screen.getByRole("status").textContent).toContain("browser settings for this site");
    else {
      fireEvent.click(desktop);
      expect(desktop.checked).toBe(false);
      expect(requestPermission).toHaveBeenCalledTimes(1);
    }
    expect(JSON.parse(localStorage.getItem("preferences")!).notificationSound).toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("disables desktop notifications when unsupported and still works with blocked storage", async () => {
    vi.stubGlobal("Notification", undefined);
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    const desktop = screen.getByRole("switch", { name: "Desktop notifications" }) as HTMLInputElement;
    expect(desktop.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("does not support desktop notifications");
    const sound = screen.getByRole("switch", { name: "Play sound for incoming messages" }) as HTMLInputElement;
    fireEvent.click(sound);
    expect(sound.checked).toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
  });
});


describe("signature preferences", () => {
  it.each([false, true])("previews and saves only in the browser (storage blocked: %s)", async (blocked) => {
    if (blocked) vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    const toggle = screen.getByRole("switch", { name: "Sign my messages" }) as HTMLInputElement;
    const input = screen.getByRole("textbox", { name: "Signature name" }) as HTMLInputElement;
    const preview = screen.getByLabelText("Signature preview");
    expect(toggle.checked).toBe(false);
    expect(input.placeholder).toBe("Membro teste");
    expect(input.maxLength).toBe(40);
    expect(preview.querySelector("strong")).toBeNull();
    fireEvent.click(toggle);
    expect(preview.querySelector("strong")?.textContent).toBe("Membro teste:");
    fireEvent.change(input, { target: { value: "  Ana  " } });
    expect(preview.querySelector("strong")?.textContent).toBe("Ana:");
    expect(preview.textContent).toBe("Ana:\nHi! How can I help?");
    if (!blocked) expect(JSON.parse(localStorage.getItem("preferences")!)).toMatchObject({ signatureEnabled: true, signatureName: "  Ana  " });
    fireEvent.change(input, { target: { value: "   " } });
    expect(preview.querySelector("strong")?.textContent).toBe("Membro teste:");
    fireEvent.click(toggle);
    expect(preview.querySelector("strong")).toBeNull();
    expect(mock.update).not.toHaveBeenCalled();
  });
});

describe("chat background preferences", () => {
  it.each([false, true])("selects swatches and toggles doodles (storage blocked: %s)", async (blocked) => {
    if (blocked) vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    const group = screen.getByRole("radiogroup", { name: "Chat background" });
    const toggle = screen.getByRole("switch", { name: "Show background doodles" }) as HTMLInputElement;
    expect((within(group).getByRole("radio", { name: "Default" }) as HTMLInputElement).checked).toBe(true);
    expect(toggle.checked).toBe(true);
    const preview = screen.getByLabelText("Chat background preview");
    expect(preview.classList.contains("chat-wallpaper")).toBe(true);
    expect(preview.querySelector(".bg-received")?.textContent).toBe("Hi! How can I help?");
    expect(preview.querySelector(".bg-sent")?.textContent).toBe("I'd like to learn more, please.");
    for (const { id, label } of CHAT_BACKGROUNDS) {
      const radio = within(group).getByRole("radio", { name: label }) as HTMLInputElement;
      fireEvent.click(radio);
      expect(radio.checked).toBe(true);
      expect(within(group).getAllByRole("radio").filter((input) => (input as HTMLInputElement).checked)).toHaveLength(1);
      expect(radio.parentElement?.querySelector("svg")).toBeTruthy();
      if (!blocked) expect(JSON.parse(localStorage.getItem("preferences")!).chatBackground).toBe(id);
    }
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    if (!blocked) expect(JSON.parse(localStorage.getItem("preferences")!).chatWallpaper).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    expect((screen.getByRole("switch", { name: "Show background doodles" }) as HTMLInputElement).checked).toBe(false);
    expect((within(screen.getByRole("radiogroup", { name: "Chat background" })).getByRole("radio", { name: "Gray" }) as HTMLInputElement).checked).toBe(true);
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.upload).not.toHaveBeenCalled();
  });
});
