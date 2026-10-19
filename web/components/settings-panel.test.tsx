// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "@/hooks/use-session";
import { parseRoute, type SettingsSection } from "@/lib/routes";
import type { Role } from "@/lib/types";
import { SettingsPanel } from "./settings-panel";

const mock = vi.hoisted(() => ({
  from: vi.fn(), upload: vi.fn(), createSignedUrl: vi.fn(), update: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: mock.from,
    storage: { from: () => ({ upload: mock.upload, createSignedUrl: mock.createSignedUrl }) },
  },
}));

const originalLogo = "organizations/test-org/logo/original.png";
let organization: { name: string; extra: { logo: string | null; other: string } };
let role: Role;
let client: QueryClient;

function TestWorkspace({ section = "organization", onSectionChange = () => {} }: { section?: SettingsSection; onSectionChange?: (section: SettingsSection) => void }) {
  const workspace = useWorkspace("test-user");
  return workspace.data ? <SettingsPanel workspace={workspace.data} section={section} onSectionChange={onSectionChange} /> : null;
}

async function openSettings() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><TestWorkspace /></QueryClientProvider>);
  const logos = await screen.findAllByRole("img", { name: "Logo of Organização teste" });
  return logos.find((image) => image.getAttribute("width") === "80")!;
}

beforeEach(() => {
  role = "owner";
  organization = { name: "Organização teste", extra: { logo: originalLogo, other: "preserved" } };
  mock.upload.mockResolvedValue({ error: null });
  mock.createSignedUrl.mockImplementation(async (path: string) => ({ data: { signedUrl: `https://media.test/${path}` }, error: null }));
  mock.update.mockImplementation((patch: { name?: string; extra?: { logo: string | null } }) => {
    // Mirror the server's merge without any real Supabase connection.
    if (patch.name !== undefined) organization.name = patch.name;
    if (patch.extra) organization.extra = { ...organization.extra, ...patch.extra };
  });
  mock.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      limit: vi.fn(() => query),
      update: vi.fn((patch) => { mock.update(patch); return query; }),
      single: vi.fn(async () => ({ data: { id: "test-org" }, error: null })),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "test-agent", user_id: "test-user", organization_id: "test-org", name: "Agente teste", role,
          organizations: structuredClone(organization),
        }, error: null,
      })),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
        if (table !== "organizations_addresses") throw new Error(`Unexpected table: ${table}`);
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return query;
  });
});
afterEach(() => client?.clear());

describe("organization settings", () => {
  it("keeps organization settings separate from the profile and preferences", async () => {
    await openSettings();
    expect(screen.getByLabelText("Organization name").closest(".max-w-3xl")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Organization" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Instances" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "My profile" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Preferences" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
  it.each(["owner", "admin"] as const)("keeps the displayed logo and extra.logo when a %s saves a new name", async (editableRole) => {
    role = editableRole;
    const logo = await openSettings();
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Novo nome" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await screen.findAllByRole("img", { name: "Logo of Novo nome" });
    // A name change must not reset the already loaded image/form.
    expect(logo.isConnected).toBe(true);
    expect(logo.getAttribute("src")).toBe(`https://media.test/${originalLogo}`);
    expect(mock.update).toHaveBeenCalledExactlyOnceWith({ name: "Novo nome" });
    expect(organization.extra).toEqual({ logo: originalLogo, other: "preserved" });
    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.createSignedUrl).toHaveBeenCalledTimes(1);
    await screen.findByRole("status");
    expect((screen.getByLabelText("Organization name") as HTMLInputElement).value).toBe("Novo nome");
  });

  it("uploads and displays a replacement logo without changing other extra fields", async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Nome em edição" } });
    const file = new File(["mock image"], "new.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload organization logo"), { target: { files: [file] } });

    await waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(1));
    const path = mock.upload.mock.calls[0][0] as string;
    expect(path).toMatch(/^organizations\/test-org\/logo\/.+\.png$/);
    expect(mock.upload).toHaveBeenCalledWith(path, file, { contentType: "image/png" });
    expect(mock.update).toHaveBeenCalledExactlyOnceWith({ extra: { logo: path } });
    await waitFor(() => expect(screen.getAllByRole("img").every((image) => image.getAttribute("src") === `https://media.test/${path}`)).toBe(true));
    expect(organization.extra).toEqual({ logo: path, other: "preserved" });
    expect((screen.getByLabelText("Organization name") as HTMLInputElement).value).toBe("Nome em edição");
  });

  it("removes the logo and falls back to initials", async () => {
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryAllByRole("img")).toHaveLength(0));
    expect(mock.update).toHaveBeenCalledExactlyOnceWith({ extra: { logo: null } });
    expect(organization.extra).toEqual({ logo: null, other: "preserved" });
    expect(screen.getAllByText("OT")).toHaveLength(1);
    expect(screen.getByLabelText("Upload organization logo")).toBeTruthy();
    expect(mock.upload).not.toHaveBeenCalled();
  });

  it("lets a member read the name and logo without any write controls", async () => {
    role = "member";
    await openSettings();
    const name = screen.getByLabelText("Organization name") as HTMLInputElement;
    expect(name.disabled).toBe(true);
    expect(screen.getByText(/view these settings only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save name" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByLabelText("Upload organization logo")).toBeNull();
    await act(async () => { fireEvent.submit(name.closest("form")!); });
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.upload).not.toHaveBeenCalled();
  });
});

it("selects the Meta App section from /settings/meta-app and uses the section in navigation", async () => {
  role = "member";
  const route = parseRoute("/settings/meta-app");
  if (route?.section !== "settings") throw new Error("Expected settings route");
  const onSectionChange = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TestWorkspace section={route.settings} onSectionChange={onSectionChange} /></QueryClientProvider>);
  const section = await screen.findByRole("button", { name: "Meta App" });
  expect(section.getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("heading", { name: "Meta App" })).toBeTruthy();
  expect(screen.getByText("An administrator manages the Meta App.")).toBeTruthy();
  fireEvent.click(section);
  expect(onSectionChange).toHaveBeenCalledWith("meta-app");
});

it("selects Integrations from its URL and hides the member read-only notice", async () => {
  role = "member";
  const route = parseRoute("/settings/integrations");
  if (route?.section !== "settings") throw new Error("Expected settings route");
  const onSectionChange = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TestWorkspace section={route.settings} onSectionChange={onSectionChange} /></QueryClientProvider>);
  const section = await screen.findByRole("button", { name: "Integrations" });
  expect(section.getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("heading", { name: "Integrations" })).toBeTruthy();
  expect(screen.getByText("Only administrators and owners can manage integrations.").closest(".max-w-5xl")).toBeTruthy();
  expect(screen.queryByText(/view these settings only/)).toBeNull();
  fireEvent.click(section);
  expect(onSectionChange).toHaveBeenCalledWith("integrations");
});


it("confirms member removal, keeps failures in the dialog and closes after a successful retry", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const owner = { id: "owner", user_id: "test-user", organization_id: "test-org", name: "Owner", role: "owner" as const };
  const member = { ...owner, id: "member", user_id: "other-user", name: "Member", role: "member" as const };
  client.setQueryData(["members", "test-org"], [owner, member]);
  client.setQueryData(["invitations", "test-user", "test-org"], []);
  vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const deletion = vi.fn();
  let fail = true;
  mock.from.mockImplementation(() => {
    const query = {
      delete: deletion.mockImplementation(() => query),
      eq: vi.fn(() => query),
      then: (resolve: (value: { error: { message: string } | null }) => unknown) => Promise.resolve({ error: fail ? { message: "permission denied" } : null }).then(resolve),
    };
    return query;
  });
  render(<QueryClientProvider client={client}><SettingsPanel workspace={{ agent: owner, organizationId: "test-org", organizationName: "Test", organizationLogo: null, numbers: [] }} section="members" onSectionChange={() => {}} /></QueryClientProvider>);
  const trigger = screen.getByTitle("Remove Member");
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole("alertdialog", { name: "Remove Member" });
  expect(dialog.textContent).toContain("Remove Member from the organization?");
  expect(deletion).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fail = false;
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(deletion).toHaveBeenCalledTimes(2);
});
