// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ApiKey, CreateApiKeyInput, CreatedApiKey, McpCall } from "@/hooks/use-api-keys";
import { DEFAULT_PREFERENCES, setPreferences } from "@/lib/preferences";
import { IntegrationsSettings } from "./integrations-settings";

const mock = vi.hoisted(() => ({ keys: vi.fn(), calls: vi.fn(), create: vi.fn(), revoke: vi.fn(), remove: vi.fn(), reset: vi.fn(), copy: vi.fn(), retryKeys: vi.fn(), retryCalls: vi.fn(), pending: false, error: null as Error | null, revokeError: null as Error | null }));
vi.mock("@/hooks/use-api-keys", () => ({
  useApiKeys: mock.keys,
  useMcpCalls: mock.calls,
  useApiKeyActions: () => ({ create: { mutate: mock.create, reset: mock.reset, isPending: mock.pending, error: mock.error }, remove: { mutate: mock.remove, reset: mock.reset, isPending: false, error: null }, revoke: { mutate: mock.revoke, reset: mock.reset, isPending: false, error: mock.revokeError } }),
}));
const key: ApiKey = { id: "key-1", organization_id: "org", name: "Assistant", key_prefix: "zpn_123", scope: "read", allowed_addresses: null, role: "member", expires_at: null, last_used_at: null, revoked_at: null, send_limit_per_hour: 60, template_limit_per_hour: 10, requires_approval: false, created_by: null, created_at: "2026-01-01T12:00:00Z", updated_at: "2026-01-01T12:00:00Z" };
const call: McpCall = { id: "1", organization_id: "org", api_key_id: key.id, user_id: null, tool: "list_contacts", contact_phone: "5511999999999", status: "rate_limited", error: "Retry later", created_at: key.created_at, finished_at: null, send_kind: null };
const numbers = [
  { organization_id: "org", service: "whatsapp", address: "meta-sales", status: "connected", extra: { label: "Sales", verified_name: "Business", phone_number: "15550001" } },
  { organization_id: "org", service: "whatsapp", address: "meta-support", status: "connected", extra: { verified_name: "Support", phone_number: "15550002" } },
  { organization_id: "org", service: "whatsapp", address: "meta-old", status: "disconnected", extra: { label: "Old", phone_number: "15550003" } },
];
beforeEach(() => {
  mock.error = null; mock.revokeError = null; mock.pending = false;
  act(() => setPreferences(DEFAULT_PREFERENCES));
  vi.stubEnv("NEXT_PUBLIC_WEBHOOK_BASE_URL", "https://webhook.test///");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  mock.keys.mockReturnValue({ data: [], isPending: false, error: null, refetch: mock.retryKeys });
  mock.calls.mockReturnValue({ data: [], isPending: false, error: null, refetch: mock.retryCalls });
  mock.create.mockImplementation((_input: CreateApiKeyInput, options: { onSuccess: (result: CreatedApiKey) => void }) => options.onSuccess({ id: "key-1", key: "zpn_full-secret", key_prefix: "zpn_123" }));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mock.copy.mockResolvedValue(undefined) } });
});
const renderSettings = () => render(<IntegrationsSettings organizationId="org" role="admin" />);
const switchTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
function openUseCase(name = "Read only") {
  fireEvent.click(screen.getAllByRole("button", { name: "Create a key" })[0]);
  fireEvent.click(screen.getByRole("button", { name: `Use: ${name}` }));
}
function select(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

it("defaults to all numbers, requires a selection in selected mode, and submits account addresses", () => {
  render(<IntegrationsSettings organizationId="org" role="admin" numbers={numbers} />);
  openUseCase();
  expect(screen.getByRole("combobox", { name: "Numbers" }).textContent).toContain("All numbers");
  select("Numbers", "Selected numbers");
  expect(screen.queryByRole("checkbox", { name: /Old/ })).toBeNull();
  expect((screen.getByRole("button", { name: "Create a key" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
  expect(mock.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Sales · 15550001" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Support · 15550002" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Sales · 15550001" }));
  fireEvent.click(screen.getByRole("button", { name: "Create a key" }));
  expect(mock.create.mock.calls[0][0].allowed_addresses).toEqual(["meta-support"]);
});

it("switches selected numbers back to all and resets the restriction for a new key", () => {
  render(<IntegrationsSettings organizationId="org" role="admin" numbers={numbers} />);
  openUseCase();
  select("Numbers", "Selected numbers");
  fireEvent.click(screen.getByRole("checkbox", { name: "Sales · 15550001" }));
  select("Numbers", "All numbers");
  fireEvent.click(screen.getByRole("button", { name: "Create a key" }));
  expect(mock.create.mock.calls[0][0].allowed_addresses).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  openUseCase();
  expect(screen.getByRole("combobox", { name: "Numbers" }).textContent).toContain("All numbers");
  select("Numbers", "Selected numbers");
  expect((screen.getByRole("checkbox", { name: "Sales · 15550001" }) as HTMLInputElement).checked).toBe(false);
});

it("shows permitted numbers on keys, retaining deleted addresses as a fallback", () => {
  mock.keys.mockReturnValue({ data: [key, { ...key, id: "scoped", name: "Scoped key", allowed_addresses: ["meta-sales", "meta-support", "deleted-id"] }] });
  render(<IntegrationsSettings organizationId="org" role="admin" numbers={numbers} />);
  expect(screen.getByText("All numbers")).toBeTruthy();
  expect(screen.getByText("Sales · 15550001")).toBeTruthy();
  expect(screen.getByText("Support · 15550002")).toBeTruthy();
  expect(screen.getByText("deleted-id")).toBeTruthy();
});

it("cannot create a restricted key when there are no connected numbers", () => {
  renderSettings(); openUseCase();
  select("Numbers", "Selected numbers");
  expect(screen.getByText("No connected WhatsApp numbers.")).toBeTruthy();
  fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
  expect(mock.create).not.toHaveBeenCalled();
});

it("shows only the admins-only message to members without fetching data", () => {
  render(<IntegrationsSettings organizationId="org" role="member" />);
  expect(screen.getByText("Only administrators and owners can manage integrations.")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(mock.keys).not.toHaveBeenCalled(); expect(mock.calls).not.toHaveBeenCalled();
});

it("starts on API keys with an empty state, API headers and keyboard-accessible tabs", async () => {
  renderSettings();
  expect(screen.getByRole("tablist")).toBeTruthy();
  const first = screen.getByRole("tab", { name: "API keys" });
  expect(first.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("No API keys yet.")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("API base URL").textContent).toBe("https://webhook.test/rest/v1");
  expect(screen.getByLabelText("API request example").textContent).toContain("apikey: public-anon-key");
  expect(screen.getByLabelText("API request example").textContent).toContain("api-key: <API_KEY>");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy: API request example" })));
  expect(mock.copy).toHaveBeenCalledWith(expect.stringContaining("curl 'https://webhook.test/rest/v1/"));
  fireEvent.keyDown(first, { key: "ArrowRight" });
  const mcp = screen.getByRole("tab", { name: "MCP" });
  expect(document.activeElement).toBe(mcp); expect(mcp.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").id).toBe(mcp.getAttribute("aria-controls"));
  fireEvent.keyDown(mcp, { key: "End" });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Activity" }));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "ArrowLeft" });
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(first);
});

it.each(["admin", "owner"] as const)("creates a key for an %s with the original trimmed payload and expiry", async role => {
  render(<IntegrationsSettings organizationId="org" role={role} />);
  openUseCase();
  expect(screen.getByRole("dialog", { name: "Configure key" })).toBeTruthy();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Read only");
  expect((screen.getByRole("radio", { name: "Read" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: " My assistant " } });
  const now = Date.now();
  fireEvent.click(screen.getByRole("button", { name: "Create a key" }));
  const input = mock.create.mock.calls[0][0];
  expect(input).toMatchObject({ name: "My assistant", scope: "read", send_limit_per_hour: 60, template_limit_per_hour: 10 });
  expect(new Date(input.expires_at).getTime()).toBeGreaterThanOrEqual(now + 90 * 86400000);
  expect(new Date(input.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 90 * 86400000);
  expect(screen.getByText("Copy this key now. You won't be able to see it again.")).toBeTruthy();
  expect(screen.getByLabelText("Full API key").textContent).toBe("zpn_full-secret");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy: Full API key" })));
  expect(mock.copy).toHaveBeenCalledWith("zpn_full-secret");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByLabelText("Full API key")).toBeNull();
  switchTab("MCP");
  expect(screen.getByLabelText("Configuration snippet").textContent).toContain("zpn_full-secret");
});

it.each([
  ["Read only", "read", 60, 10], ["Send messages", "send", 60, 10], ["AI agent (MCP)", "send", 30, 0], ["Admin", "admin", 60, 10], ["Custom", "read", 60, 10],
])("prefills the %s use case and allows returning to use cases", (useCase, scope, messages, templates) => {
  renderSettings(); openUseCase(String(useCase));
  const expected = { read: "Read", send: "Send", admin: "Admin" }[scope as string];
  expect((screen.getByRole("radio", { name: expected }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText("Messages per hour") as HTMLInputElement).value).toBe(String(messages));
  expect((screen.getByLabelText("Templates per hour") as HTMLInputElement).value).toBe(String(templates));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("dialog", { name: "Start from a use case" })).toBeTruthy();
});

it("edits custom permissions, expiry and limits and rejects invalid values", () => {
  renderSettings(); openUseCase("Custom");
  fireEvent.click(screen.getByRole("radio", { name: "Admin" }));
  select("Expiry", "Never");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: " " } });
  fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
  expect(mock.create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Custom key" } });
  for (const [messages, templates] of [[0, 10], [1.5, 10], [1, -1], [1, 0.5]]) {
    fireEvent.change(screen.getByLabelText("Messages per hour"), { target: { value: messages } });
    fireEvent.change(screen.getByLabelText("Templates per hour"), { target: { value: templates } });
    fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
  }
  expect(mock.create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Messages per hour"), { target: { value: 20 } });
  fireEvent.change(screen.getByLabelText("Templates per hour"), { target: { value: 0 } });
  fireEvent.click(screen.getByRole("button", { name: "Create a key" }));
  expect(mock.create.mock.calls[0][0]).toEqual({ name: "Custom key", scope: "admin", allowed_addresses: null, expires_at: null, send_limit_per_hour: 20, template_limit_per_hour: 0, requires_approval: false });
});

it("offers approval before sending only for scopes that can send and submits it", () => {
  renderSettings(); openUseCase("Read only");
  expect(screen.queryByRole("checkbox", { name: /Require approval before sending/ })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Send" }));
  const approval = screen.getByRole("checkbox", { name: /Require approval before sending/ }) as HTMLInputElement;
  expect(approval.checked).toBe(false);
  expect(approval.getAttribute("aria-describedby") && document.getElementById(approval.getAttribute("aria-describedby")!)?.textContent).toBe("Messages this key sends wait in the chat until a member approves them.");
  fireEvent.click(approval);
  fireEvent.click(screen.getByRole("button", { name: "Create a key" }));
  expect(mock.create.mock.calls[0][0]).toMatchObject({ scope: "send", requires_approval: true });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  openUseCase("Admin");
  expect((screen.getByRole("checkbox", { name: /Require approval before sending/ }) as HTMLInputElement).checked).toBe(false);
});

it("never submits approval for a read key, even after toggling it on another scope", () => {
  renderSettings(); openUseCase("Custom");
  fireEvent.click(screen.getByRole("radio", { name: "Admin" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Require approval before sending/ }));
  fireEvent.click(screen.getByRole("radio", { name: "Read" }));
  fireEvent.click(screen.getByRole("button", { name: "Create a key" }));
  expect(mock.create.mock.calls[0][0]).toMatchObject({ scope: "read", requires_approval: false });
});

it("marks keys that require approval in the keys list", () => {
  mock.keys.mockReturnValue({ data: [key, { ...key, id: "held", name: "Held key", scope: "send", requires_approval: true }] });
  renderSettings();
  const table = screen.getByRole("table", { name: "API keys" });
  const held = within(table).getByRole("rowheader", { name: /Held key/ }).closest("tr")!;
  expect(within(held).getByText("Approval required")).toBeTruthy();
  const plain = within(table).getByRole("rowheader", { name: /Assistant/ }).closest("tr")!;
  expect(within(plain).queryByText("Approval required")).toBeNull();
});

it("traps dialog focus, closes with Escape and restores focus", () => {
  renderSettings(); const trigger = screen.getAllByRole("button", { name: "Create a key" })[0];
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog");
  expect(document.activeElement).toBe(dialog);
  const first = within(dialog).getByRole("button", { name: "Close" });
  const last = within(dialog).getByRole("button", { name: "Cancel" });
  fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Tab" }); expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(last);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(trigger);
});

it("shows compact key rows and confirms the key name before revoking", () => {
  mock.keys.mockReturnValue({ data: [key, { ...key, id: "expired", name: "Old key", expires_at: "2000-01-01" }, { ...key, id: "revoked", name: "Revoked key", revoked_at: "2000-01-01", expires_at: "2000-01-01" }] });
  renderSettings();
  const table = screen.getByRole("table", { name: "API keys" });
  expect(screen.queryByText("Old key")).toBeNull();
  expect(screen.queryByText("Revoked key")).toBeNull();
  const toggle = screen.getByRole("button", { name: "Show revoked (2)" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(within(table).getByRole("columnheader", { name: "Key actions" }).firstElementChild?.className).toBe("sr-only");
  for (const [name, status] of [["Assistant", "Active"], ["Old key", "Expired"], ["Revoked key", "Revoked"]]) {
    const row = within(table).getByRole("rowheader", { name: new RegExp(name) }).closest("tr")!;
    expect(within(row).getByText(status)).toBeTruthy();
    const created = within(row).getByTitle(new Date(key.created_at).toLocaleString("en-US"));
    expect(created.textContent).toBe(new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(key.created_at)));
    expect(created.getAttribute("datetime")).toBe(key.created_at);
    expect(within(row).getByText("zpn_123…")).toBeTruthy();
  }
  expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  expect(screen.getAllByRole("button", { name: /Key actions:/ })).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Key actions: Assistant" }));
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  expect(screen.getByRole("alertdialog", { name: 'Revoke the key “Assistant”?' })).toBeTruthy();
  expect(mock.revoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Key actions: Assistant" }));
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revoke" }));
  expect(mock.revoke).toHaveBeenCalledWith("key-1", expect.objectContaining({ onSuccess: expect.any(Function) }));
});

it("keeps exact client configurations and the OAuth callout visible for every client", () => {
  renderSettings(); switchTab("MCP");
  const url = "https://webhook.test/functions/v1/mcp";
  expect(screen.getByLabelText("Server URL").textContent).toBe(url);
  expect(screen.getByLabelText("Configuration snippet").textContent).toBe(`claude mcp add --transport http zappion ${url} --header "api-key: <API_KEY>"`);
  expect(screen.getByText(/custom connectors cannot send an API key/)).toBeTruthy();
  select("Connect a client", "Claude Desktop");
  expect(JSON.parse(screen.getByLabelText("Configuration snippet").textContent!).mcpServers.zappion).toEqual({ command: "npx", args: ["-y", "mcp-remote", url, "--header", "api-key:${ZAPPION_API_KEY}"], env: { ZAPPION_API_KEY: "<API_KEY>" } });
  expect(screen.getByText(/needs Node.js/)).toBeTruthy();
  select("Connect a client", "Cursor");
  expect(JSON.parse(screen.getByLabelText("Configuration snippet").textContent!).mcpServers.zappion).toEqual({ url, headers: { "api-key": "<API_KEY>" } });
  select("Connect a client", "OpenAI API");
  expect(JSON.parse(screen.getByLabelText("Configuration snippet").textContent!)).toEqual({ type: "mcp", server_label: "zappion", server_url: url, headers: { "api-key": "<API_KEY>" }, require_approval: "never" });
  fireEvent.click(screen.getByRole("button", { name: "Create a key" }));
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("AI agent (MCP)");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create a key" }));
  expect(mock.create.mock.calls[0][0]).toMatchObject({ scope: "send", send_limit_per_hour: 30, template_limit_per_hour: 0 });
  expect(within(screen.getByRole("dialog")).getByLabelText("Configuration snippet").textContent).toContain("zpn_full-secret");
});

it("filters activity by key, signed-in user and status and shows row errors", () => {
  mock.keys.mockReturnValue({ data: [key] });
  mock.calls.mockReturnValue({ data: [call, { ...call, id: "2", api_key_id: null, user_id: "user-1", tool: "list_conversations", error: null, status: "ok" }] });
  renderSettings(); switchTab("Activity");
  expect(screen.getByRole("table", { name: "Activity" })).toBeTruthy();
  expect(screen.getByText("Signed-in user")).toBeTruthy();
  expect(screen.getByText("Retry later").getAttribute("title")).toBe("Retry later");
  expect(screen.getByText("Retry later").classList.contains("line-clamp-2")).toBe(true);
  expect(screen.getByText("list_conversations").classList.contains("whitespace-nowrap")).toBe(true);
  select("Key", "Assistant");
  expect(screen.queryByText("list_conversations")).toBeNull(); expect(screen.getByText("list_contacts")).toBeTruthy();
  select("Status", "OK"); expect(screen.getByText("No calls match these filters.")).toBeTruthy();
  select("Key", "Signed-in user"); expect(screen.getByText("list_conversations")).toBeTruthy();
  expect(screen.queryByText("list_contacts")).toBeNull();
});

it("shows loading, query failures with retries, and empty activity", () => {
  mock.keys.mockReturnValue({ isPending: true });
  const view = renderSettings(); expect(screen.getByRole("status").textContent).toBe("Loading…");
  mock.keys.mockReturnValue({ error: new Error("Keys failed"), refetch: mock.retryKeys });
  mock.calls.mockReturnValue({ error: new Error("Calls failed"), refetch: mock.retryCalls });
  view.rerender(<IntegrationsSettings organizationId="org" role="admin" />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(mock.retryKeys).toHaveBeenCalled();
  switchTab("Activity");
  fireEvent.click(within(screen.getByText(/Calls failed/)).getByRole("button", { name: "Try again" }));
  expect(mock.retryCalls).toHaveBeenCalled(); expect(screen.getAllByRole("alert")).toHaveLength(2);
  mock.keys.mockReturnValue({ data: [] }); mock.calls.mockReturnValue({ data: [] });
  view.rerender(<IntegrationsSettings organizationId="org" role="admin" />);
  expect(screen.getByText("No MCP calls yet.")).toBeTruthy();
});

it("shows mutation and clipboard failures as alerts and disables duplicate creation", async () => {
  renderSettings(); openUseCase();
  mock.error = new Error("Could not create key"); mock.pending = true;
  // Trigger a local render with current mutation state.
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Retry" } });
  expect(screen.getByRole("alert").textContent).toBe("Could not create key");
  expect((screen.getByRole("button", { name: "Creating…" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(screen.getByLabelText("Name").closest("form")!); expect(mock.create).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  mock.copy.mockRejectedValueOnce(new Error("denied"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy: API base URL" })));
  expect(screen.getByText("Could not copy. Try again.").getAttribute("role")).toBe("alert");
});

it("localizes tabs, use cases and dates in Brazilian Portuguese", () => {
  act(() => setPreferences({ ...DEFAULT_PREFERENCES, language: "pt-BR" }));
  mock.keys.mockReturnValue({ data: [key] }); renderSettings();
  expect(screen.getByRole("tab", { name: "Chaves de API" })).toBeTruthy();
  expect(screen.getByTitle(new Date(key.created_at).toLocaleString("pt-BR"))).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Criar uma chave" }));
  expect(screen.getByRole("dialog", { name: "Comece por um caso de uso" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Usar: Agente de IA (MCP)" }));
  expect(screen.getByRole("dialog", { name: "Configurar chave" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Números" }).textContent).toContain("Todos os números");
  select("Números", "Números selecionados");
  expect(screen.getByText("Nenhum número de WhatsApp conectado.")).toBeTruthy();
});

it("sorts active keys first when showing history and can hide history again", () => {
  mock.keys.mockReturnValue({ data: [{ ...key, id: "revoked", name: "Revoked key", revoked_at: "2000-01-01" }, key, { ...key, id: "expired", name: "Expired key", expires_at: "2000-01-01" }] });
  renderSettings();
  fireEvent.click(screen.getByRole("button", { name: "Show revoked (2)" }));
  const rows = within(screen.getByRole("table", { name: "API keys" })).getAllByRole("rowheader");
  expect(rows.map(row => row.textContent)).toEqual(["NameAssistantAll numbers", "NameRevoked keyAll numbers", "NameExpired keyAll numbers"]);
  expect(screen.getAllByText("zpn_123…")[0].classList.contains("whitespace-nowrap")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Hide revoked (2)" }));
  expect(screen.queryByText("Revoked key")).toBeNull();
  expect(screen.queryByText("Expired key")).toBeNull();
});

it("keeps revoked and expired keys visible when there are no active keys", () => {
  mock.keys.mockReturnValue({ data: [{ ...key, revoked_at: "2000-01-01" }, { ...key, id: "expired", name: "Expired key", expires_at: "2000-01-01" }] });
  renderSettings();
  expect(screen.getByText("Revoked")).toBeTruthy();
  expect(screen.getByText("Expired")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Show revoked/ })).toBeNull();
});

it.each(["active", "revoked", "expired"])("deletes %s keys with an explicit confirmation", (state) => {
  mock.keys.mockReturnValue({ data: [{ ...key, revoked_at: state === "revoked" ? "2000-01-01" : null, expires_at: state === "expired" ? "2000-01-01" : null }] });
  mock.remove.mockImplementation((_id, options) => options.onSuccess());
  renderSettings();
  fireEvent.click(screen.getByRole("button", { name: "Key actions: Assistant" }));
  expect(!!screen.queryByRole("button", { name: "Revoke" })).toBe(state === "active");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("alertdialog", { name: 'Delete the key “Assistant”?' });
  expect(dialog.textContent).toContain("its past activity will show as a deleted key");
  expect(mock.remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  expect(mock.remove).toHaveBeenCalledWith("key-1", expect.objectContaining({ onSuccess: expect.any(Function) }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("Key deleted.");
});

it("labels deleted activity and filters it separately from unknown keys and signed in users", () => {
  mock.keys.mockReturnValue({ data: [key] });
  mock.calls.mockReturnValue({ data: [call, { ...call, id: "deleted", api_key_id: null, tool: "deleted_tool" }, { ...call, id: "user", api_key_id: null, user_id: "user", tool: "user_tool" }, { ...call, id: "unknown", api_key_id: "missing", tool: "unknown_tool" }] });
  renderSettings(); switchTab("Activity");
  const table = screen.getByRole("table");
  expect(within(table).getByText("Deleted key")).toBeTruthy();
  expect(within(table).getByText("Unknown key")).toBeTruthy();
  select("Key", "Deleted key");
  expect(screen.getByText("deleted_tool")).toBeTruthy();
  expect(screen.queryByText("user_tool")).toBeNull();
  expect(screen.queryByText("unknown_tool")).toBeNull();
  expect(screen.queryByText("list_contacts")).toBeNull();
});
