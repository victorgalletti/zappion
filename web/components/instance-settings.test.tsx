// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Workspace } from "@/hooks/use-session";
import { SettingsPanel } from "./settings-panel";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), countError: false }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mock.rpc, from: () => {
  const query = { select: () => query, eq: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: 7, error: mock.countError ? { message: "count failed" } : null }).then(resolve) };
  return query;
} } }));
const workspace: Workspace = {
  organizationId: "mock-org", organizationName: "Teste", organizationLogo: null,
  agent: { id: "mock-agent", user_id: "mock-user", organization_id: "mock-org", name: "Teste", role: "member" },
  numbers: [
    { organization_id: "mock-org", service: "whatsapp", address: "123456", status: "connected", extra: { label: "São Paulo", verified_name: "Acme Brazil", phone_number: "5511999998888", waba_id: "987654" } },
    { organization_id: "mock-org", service: "whatsapp", address: "222222", status: "disconnected", extra: { label: "Suporte", phone_number: "5521988887777", waba_id: "777777" } },
  ],
};
let client: QueryClient;
function open(role: Workspace["agent"]["role"] = "member") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SettingsPanel workspace={{ ...workspace, agent: { ...workspace.agent, role } }} section="instances" onSectionChange={() => {}} /></QueryClientProvider>);
}
beforeEach(() => { mock.countError = false; mock.rpc.mockReset().mockResolvedValue({ error: null }); vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { client.clear(); vi.unstubAllGlobals(); });
it.each(["sao paulo", "Acme Brazil", "(11) 99999-8888", "987654", "123456"])("searches name, phone, WABA or ID: %s", (term) => {
  open(); fireEvent.change(screen.getByLabelText("Search instances"), { target: { value: term } });
  expect(screen.getByRole("button", { name: "Details: São Paulo" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Details: Suporte" })).toBeNull();
});
it("combines search and status with an empty state", () => {
  open(); fireEvent.change(screen.getByLabelText("Search instances"), { target: { value: "Suporte" } });
  fireEvent.click(screen.getByRole("combobox", { name: "Filter instances by status" }));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Connected" }));
  expect(screen.getByText(/No instances match/)).toBeTruthy();
});
it("members only read instances", () => {
  open(); expect(screen.queryByRole("button", { name: "Connect number" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save name" })).toBeNull();
  expect(screen.getAllByRole("article")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Instance actions: São Paulo" }));
  expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
});
it.each(["owner", "admin"] as const)("allows %s to connect", (role) => {
  open(role); expect(screen.getByRole("button", { name: "Connect number" })).toBeTruthy();
});
it("reloads workspace when returning from Embedded Signup", async () => {
  open("admin"); const invalidate = vi.spyOn(client, "invalidateQueries");
  fireEvent.click(screen.getByRole("button", { name: "Connect number" }));
  fireEvent.click(screen.getByRole("link", { name: "Open connection page" }));
  fireEvent.focus(window);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["workspace"] }, { throwOnError: true });
});

it("keeps identifiers and edit fields out of the list, shows counts and copyable details on demand", async () => {
  open();
  expect(screen.getByText("2 instances · 1 connected")).toBeTruthy();
  expect(screen.queryByText("987654")).toBeNull();
  expect(screen.queryByLabelText("Instance name")).toBeNull();
  await waitFor(() => expect(screen.getAllByText("7")).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Details: São Paulo" }));
  const dialog = screen.getByRole("dialog", { name: "São Paulo" });
  expect(within(dialog).getByText("987654")).toBeTruthy();
  expect(within(dialog).getByText("123456")).toBeTruthy();
  expect(within(dialog).getByText("Acme Brazil")).toBeTruthy();
  expect(within(dialog).getByText("7")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy: WABA ID" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("987654"));
});
it("copies both identifiers from the row menu", async () => {
  open();
  for (const [label, value] of [["Copy phone number ID", "123456"], ["Copy WABA ID", "987654"]]) {
    fireEvent.click(screen.getByRole("button", { name: "Instance actions: São Paulo" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(value));
  }
});
it.each(["New name", ""])("renames through a dialog using the existing RPC: %s", async (name) => {
  open("admin");
  vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  fireEvent.click(screen.getByRole("button", { name: "Instance actions: São Paulo" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  const dialog = screen.getByRole("dialog", { name: "Rename" });
  expect(within(dialog).getByText("Leave blank to use the verified name.")).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Instance name"), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("set_address_label", { p_service: "whatsapp", p_address: "123456", p_label: name }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Changes saved.")).toBeTruthy();
});
it("cancels rename without saving and restores focus", () => {
  open("owner");
  const trigger = screen.getByRole("button", { name: "Instance actions: São Paulo" });
  fireEvent.click(trigger); fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mock.rpc).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
});
it("keeps a rename error in the dialog and allows retry", async () => {
  open("admin");
  mock.rpc.mockResolvedValueOnce({ error: { message: "failed" } });
  fireEvent.click(screen.getByRole("button", { name: "Instance actions: São Paulo" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.change(screen.getByLabelText("Instance name"), { target: { value: "New" } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("refreshes workspace and counts, disabling the icon while pending", async () => {
  open();
  let finish!: () => void;
  const invalidate = vi.spyOn(client, "invalidateQueries").mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue();
  const refresh = screen.getByRole("button", { name: "Refresh instances" });
  fireEvent.click(refresh);
  expect((refresh as HTMLButtonElement).disabled).toBe(true);
  expect(refresh.getAttribute("aria-busy")).toBe("true");
  await act(async () => finish());
  await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["workspace"] }, { throwOnError: true });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["instance-counts", "mock-org"] }, { throwOnError: true });
});
it("announces refresh failures", async () => {
  open(); vi.spyOn(client, "invalidateQueries").mockRejectedValue(new Error("failed"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh instances" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Could not refresh instances");
});
it("announces chat count failures and leaves unavailable counts as dashes", async () => {
  mock.countError = true; open();
  expect((await screen.findByRole("alert")).textContent).toContain("Could not load chat counts");
  expect(screen.getAllByText("—")).toHaveLength(2);
});
it.each(["admin", "member"] as const)("shows the empty state with appropriate connect access for %s", role => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SettingsPanel workspace={{ ...workspace, numbers: [], agent: { ...workspace.agent, role } }} section="instances" onSectionChange={() => {}} /></QueryClientProvider>);
  expect(screen.getByText("No instances connected.")).toBeTruthy();
  expect(screen.queryAllByRole("button", { name: "Connect number" })).toHaveLength(role === "admin" ? 2 : 0);
});

it("filters by status and updates the visible totals", () => {
  open();
  fireEvent.click(screen.getByRole("combobox", { name: "Filter instances by status" }));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Disconnected" }));
  expect(screen.getByRole("button", { name: "Details: Suporte" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Details: São Paulo" })).toBeNull();
  expect(screen.getByText("1 instance · 0 connected")).toBeTruthy();
});
