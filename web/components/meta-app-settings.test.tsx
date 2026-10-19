// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MetaAppSettings } from "./meta-app-settings";
import { FunctionError } from "@/lib/supabase";
import { DEFAULT_PREFERENCES, setPreferences } from "@/lib/preferences";
import { en } from "@/lib/i18n/en";
import { ptBRMessages } from "@/lib/i18n/pt-BR";
import type { MetaApp } from "@/hooks/use-meta-app";

const mock = vi.hoisted(() => ({ callFunction: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/supabase", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/supabase")>(), callFunction: mock.callFunction }));
const configured: MetaApp = { app_id: "123456", has_app_secret: true, has_system_token: true, verify_token: "verification-value", updated_at: "2026-10-14", callback_url: "https://server.test/webhook?app_id=123456", webhook_fields: ["messages", "smb_message_echoes", "history", "smb_app_state_sync", "account_update", "user_id_update"] };
let stored: MetaApp | null;
let client: QueryClient;
beforeEach(() => {
  act(() => setPreferences(DEFAULT_PREFERENCES));
  stored = null;
  vi.stubEnv("NEXT_PUBLIC_WEBHOOK_BASE_URL", "https://webhook.test/");
  mock.callFunction.mockImplementation(async (_path, method, body) => {
    if (method === "PUT") { stored = { ...configured, app_id: body.app_id, has_system_token: body.system_user_token !== "" }; return stored; }
    if (method === "DELETE") return undefined;
    return stored;
  });
});
function open(role: "owner" | "admin" | "member" = "owner") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MetaAppSettings organizationId="org" role={role} /></QueryClientProvider>);
}
async function ready() { return await screen.findByRole("button", { name: stored ? "Test connection" : "Set up Meta App" }); }
async function edit(copy = en.metaApp) {
  fireEvent.click(await screen.findByRole("button", { name: stored ? `${copy.edit}: ${copy.appId}` : copy.setup }));
  return screen.findByLabelText(copy.appId);
}
function manual(copy = en.metaApp) { fireEvent.click(screen.getByText(copy.configureManually)); }
function disconnectMenu() { fireEvent.click(screen.getByRole("button", { name: "App actions" })); }

it("saves an empty configuration, clears credentials and does not retain secrets in mutations", async () => {
  open(); await ready(); await edit();
  expect(screen.getByRole("button", { name: /Partner provider/ }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("link", { name: /Open Settings/ }).getAttribute("href")).toBe("/settings/instances");
  expect(screen.queryByLabelText("Callback URL")).toBeNull();
  fireEvent.change(screen.getByLabelText("App ID"), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("App Secret"), { target: { value: "secret-value" } });
  fireEvent.change(screen.getByLabelText("System user token (optional)"), { target: { value: "token-value" } });
  fireEvent.click(screen.getByRole("button", { name: "Save App" }));
  await screen.findByText("App saved.");
  expect(mock.callFunction).toHaveBeenCalledWith("whatsapp-management/app", "PUT", { organization_id: "org", app_id: "123456", app_secret: "secret-value", system_user_token: "token-value" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await edit();
  expect((screen.getByLabelText("App Secret") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("System user token (optional)") as HTMLInputElement).value).toBe("");
  expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state))).not.toMatch(/secret-value|token-value/);
  expect(screen.getAllByText("•••• Set")).toHaveLength(2);
});
it("shows configured credentials without prefilling, omits blanks on edits, and copies webhook settings", async () => {
  stored = configured; const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  open(); await ready(); manual(); await edit();
  expect(screen.getAllByPlaceholderText("Leave blank to keep the current one")).toHaveLength(2);
  const callback = screen.getByLabelText("Callback URL");
  expect(callback.textContent).toBe(configured.callback_url);
  fireEvent.click(screen.getByRole("button", { name: "Copy: Callback URL" }));
  expect(writeText).toHaveBeenCalledWith(configured.callback_url);
  expect((screen.getByLabelText("Verify token") as HTMLInputElement).type).toBe("password");
  fireEvent.click(screen.getByRole("button", { name: "Show verify token" }));
  expect((screen.getByLabelText("Verify token") as HTMLInputElement).type).toBe("text");
  fireEvent.click(screen.getByRole("button", { name: "Copy: Verify token" }));
  expect(writeText).toHaveBeenCalledWith(configured.verify_token);
  for (const field of ["messages", "smb_message_echoes", "history", "smb_app_state_sync", "account_update", "user_id_update"]) expect(screen.getByText(field)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save App" }));
  await screen.findByText("App saved.");
  expect(mock.callFunction).toHaveBeenCalledWith("whatsapp-management/app", "PUT", { organization_id: "org", app_id: "123456" });
});
it("requires a fresh secret when the App ID changes", async () => {
  stored = configured; open(); await ready(); await edit();
  fireEvent.change(screen.getByLabelText("App ID"), { target: { value: "999" } });
  expect((screen.getByLabelText("App Secret") as HTMLInputElement).required).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save App" }));
  expect(mock.callFunction.mock.calls.filter((call) => call[1] === "PUT")).toHaveLength(0);
});
it.each([
  [{ app: { ok: true, name: "Example App" }, token: { ok: true, scopes: ["whatsapp_business_messaging"], expires_at: null } }, "Example App", "never"],
  [{ app: { ok: false, message: "Wrong secret" }, token: { ok: false, message: "Missing permissions" } }, "Wrong secret", "Missing permissions"],
  [{ app: { ok: true, name: "Example App" }, token: null }, "Example App", "not set"],
])("renders both connection test results: %j", async (result, appResult, tokenResult) => {
  stored = configured; open(); await ready();
  mock.callFunction.mockResolvedValueOnce(result);
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  const status = await screen.findByRole("status");
  expect(status.textContent).toContain(appResult); expect(status.textContent).toContain(tokenResult);
  expect(mock.callFunction).toHaveBeenCalledWith("whatsapp-management/app/test", "POST", { organization_id: "org" });
});
it("shows readable backend errors", async () => {
  stored = configured; open(); await ready(); await edit();
  mock.callFunction.mockRejectedValueOnce(new Error("This App is already used by another organization"));
  fireEvent.click(screen.getByRole("button", { name: "Save App" }));
  expect((await screen.findByRole("alert")).textContent).toContain("This App is already used by another organization");
});
it("removes the system token with an explicit empty string", async () => {
  stored = configured; open(); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Remove system user token" }));
  await screen.findByText("App saved.");
  expect(mock.callFunction).toHaveBeenCalledWith("whatsapp-management/app", "PUT", { organization_id: "org", app_id: "123456", system_user_token: "" });
  expect(screen.getAllByText("•••• Set")).toHaveLength(1);
});
it("confirms disconnection with the consequences and clears the saved configuration", async () => {
  stored = configured;
  open(); await ready();
  disconnectMenu();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect App" }));
  expect(mock.callFunction.mock.calls.filter((call) => call[1] === "DELETE")).toHaveLength(0);
  expect(screen.getByRole("alertdialog").textContent).toContain("Numbers with their own tokens keep working");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  disconnectMenu();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect App" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect App" }));
  await screen.findByText("App disconnected.");
  expect(mock.callFunction).toHaveBeenCalledWith("whatsapp-management/app?organization_id=org", "DELETE");
  expect(screen.queryByLabelText("Callback URL")).toBeNull();
});
it("does not call the API for members", async () => {
  open("member");
  expect(screen.getByText("An administrator manages the Meta App.")).toBeTruthy();
  await waitFor(() => expect(mock.callFunction).not.toHaveBeenCalled());
  expect(screen.queryByLabelText("App ID")).toBeNull();
});

const reasons = Object.keys(en.metaApp.errors) as (keyof typeof en.metaApp.errors)[];
const translatedCases = (["en", "pt-BR"] as const).flatMap((language) => reasons.map((reason) => ({ language, reason, copy: (language === "en" ? en : ptBRMessages).metaApp })));

it.each(translatedCases)("translates save errors for $reason in $language", async ({ language, reason, copy }) => {
  act(() => setPreferences({ language }));
  stored = configured; open(); await screen.findByRole("button", { name: copy.test });
  await edit(copy);
  mock.callFunction.mockRejectedValueOnce(new FunctionError("Raw Meta error", 400, reason));
  fireEvent.click(screen.getByRole("button", { name: copy.save }));
  expect((await screen.findByRole("alert")).textContent).toBe(copy.errors[reason]);
});

it.each(translatedCases)("translates both test results for $reason in $language", async ({ language, reason, copy }) => {
  act(() => setPreferences({ language }));
  stored = configured; open(); await screen.findByRole("button", { name: copy.test });
  mock.callFunction.mockResolvedValueOnce({ app: { ok: false, reason, message: "Raw app error" }, token: { ok: false, reason, message: "Raw token error" } });
  fireEvent.click(screen.getByRole("button", { name: copy.test }));
  const status = await screen.findByRole("status");
  expect(status.textContent).toContain(`${copy.app}:${copy.errors[reason]}`);
  expect(status.textContent).toContain(`${copy.token}:${copy.errors[reason]}`);
});

it("falls back to messages for unknown reasons in save and test errors", async () => {
  stored = configured; open(); await ready(); await edit();
  mock.callFunction.mockRejectedValueOnce(new FunctionError("Unknown save failure", 400, "future_reason"));
  fireEvent.click(screen.getByRole("button", { name: "Save App" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Unknown save failure");
  mock.callFunction.mockResolvedValueOnce({ app: { ok: false, reason: "future_reason", message: "Unknown app failure" }, token: { ok: false, reason: "toString", message: "Unknown token failure" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  const status = await screen.findByRole("status");
  expect(status.textContent).toContain("Unknown app failure");
  expect(status.textContent).toContain("Unknown token failure");
});

it("keeps entered credentials on failure, scrubs mutation data, and clears inputs after retry succeeds", async () => {
  open(); await ready(); await edit();
  fireEvent.change(screen.getByLabelText("App ID"), { target: { value: "123456" } });
  const secret = screen.getByLabelText("App Secret") as HTMLInputElement;
  const token = screen.getByLabelText("System user token (optional)") as HTMLInputElement;
  fireEvent.change(secret, { target: { value: "secret-value" } });
  fireEvent.change(token, { target: { value: "token-value" } });
  mock.callFunction.mockRejectedValueOnce(new FunctionError("Rejected secret-value and token-value", 400, "future_reason"));
  fireEvent.click(screen.getByRole("button", { name: "Save App" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Rejected •••••••• and ••••••••");
  expect(secret.value).toBe("secret-value"); expect(token.value).toBe("token-value");
  const mutation = client.getMutationCache().getAll()[0].state;
  expect(mutation.error).toMatchObject({ status: 400, reason: "future_reason" });
  expect(JSON.stringify(mutation)).not.toMatch(/secret-value|token-value/);
  fireEvent.click(screen.getByRole("button", { name: "Save App" }));
  await screen.findByText("App saved.");
  expect(screen.queryByRole("dialog")).toBeNull();
  await edit();
  expect((screen.getByLabelText("App Secret") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("System user token (optional)") as HTMLInputElement).value).toBe("");
});

it.each(["en", "pt-BR"] as const)("disables automatic setup without a public URL in %s and keeps the manual fallback", async (language) => {
  act(() => setPreferences({ language }));
  const copy = (language === "en" ? en : ptBRMessages).metaApp;
  stored = { ...configured, callback_url: null, webhook_fields: ["server_field"] };
  open(); await screen.findByRole("button", { name: copy.test }); manual(copy);
  expect((screen.getByRole("button", { name: copy.configureWebhook }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(copy.errors.no_public_url)).toBeTruthy();
  expect(screen.getByLabelText(copy.callback).textContent).toBe("https://webhook.test/functions/v1/whatsapp-webhook?app_id=123456");
  expect(screen.getByText("server_field")).toBeTruthy();
  expect(screen.queryByText("smb_message_echoes")).toBeNull();
});

it.each(["en", "pt-BR"] as const)("configures the webhook, shows pending and the returned URL and missing fields in %s", async (language) => {
  act(() => setPreferences({ language }));
  const copy = (language === "en" ? en : ptBRMessages).metaApp;
  stored = configured; open(); await screen.findByRole("button", { name: copy.test });
  let finish!: (value: unknown) => void;
  mock.callFunction.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: copy.configureWebhook }));
  expect((await screen.findByRole("button", { name: copy.configuringWebhook }) as HTMLButtonElement).disabled).toBe(true);
  expect(mock.callFunction).toHaveBeenCalledWith("whatsapp-management/app/webhook", "POST", { organization_id: "org" });
  await act(async () => finish({ callback_url: "https://meta.test/callback", active: true, matches: true, missing_fields: ["history"] }));
  expect(await screen.findByText(copy.webhookConfigured)).toBeTruthy();
  expect(screen.getByText("https://meta.test/callback")).toBeTruthy();
  expect(screen.getByText(`${copy.missingWebhookFields} history`)).toBeTruthy();
  expect(screen.getByText(copy.manualWebhook)).toBeTruthy();
});

it.each(["en", "pt-BR"] as const)("translates webhook rejection and shows Meta's details in %s", async (language) => {
  act(() => setPreferences({ language }));
  const copy = (language === "en" ? en : ptBRMessages).metaApp;
  stored = configured; open(); await screen.findByRole("button", { name: copy.test });
  mock.callFunction.mockRejectedValueOnce(new FunctionError("Callback verification failed: timeout", 400, "webhook_rejected"));
  fireEvent.click(screen.getByRole("button", { name: copy.configureWebhook }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(copy.errors.webhook_rejected);
  expect(alert.querySelector(".text-xs")?.textContent).toBe("Callback verification failed: timeout");
});

const webhookCases = [
  { webhook: null, key: "webhookNotConfigured" },
  { webhook: { callback_url: null, active: false, matches: false, missing_fields: [] }, key: "webhookNotConfigured" },
  { webhook: { callback_url: "https://server.test/callback", active: true, matches: true, missing_fields: [] }, key: "configured" },
  { webhook: { callback_url: "https://other.test/callback", active: true, matches: false, missing_fields: ["history"] }, key: "webhookOtherAddress" },
  { webhook: { callback_url: "https://server.test/callback", active: false, matches: true, missing_fields: ["messages"] }, key: "webhookInactive" },
  { webhook: { ok: false, reason: "webhook_rejected", message: "Meta callback timeout" }, reason: "webhook_rejected" },
  { webhook: { ok: false, reason: "no_public_url", message: "No URL" }, reason: "no_public_url" },
  { webhook: { ok: false, reason: "meta_unavailable", message: "Offline" }, reason: "meta_unavailable" },
  { webhook: { ok: false, reason: "app_secret_rejected", message: "Invalid secret" }, reason: "app_secret_rejected" },
  { webhook: { ok: false, reason: "future_reason", message: "Unknown webhook failure" }, raw: "Unknown webhook failure" },
] as const;
it.each((["en", "pt-BR"] as const).flatMap((language) => webhookCases.map((result) => ({ language, ...result }))))("renders the webhook test state in $language: $webhook", async (result) => {
  act(() => setPreferences({ language: result.language }));
  const copy = (result.language === "en" ? en : ptBRMessages).metaApp;
  stored = configured; open(); await screen.findByRole("button", { name: copy.test });
  mock.callFunction.mockResolvedValueOnce({ app: { ok: true, name: "Example" }, token: null, webhook: result.webhook });
  fireEvent.click(screen.getByRole("button", { name: copy.test }));
  const status = await screen.findByRole("status");
  const expected = "key" in result ? copy[result.key] : "reason" in result ? copy.errors[result.reason] : result.raw;
  expect(status.textContent).toContain(expected);
  if (result.webhook && "callback_url" in result.webhook && !result.webhook.matches && result.webhook.callback_url) expect(status.textContent).toContain(result.webhook.callback_url);
  if (result.webhook && "missing_fields" in result.webhook && result.webhook.missing_fields.length) expect(status.textContent).toContain(`${copy.missingWebhookFields} ${result.webhook.missing_fields.join(", ")}`);
  if (result.webhook && "reason" in result.webhook && result.webhook.reason === "webhook_rejected") expect(within(status).getByText(result.webhook.message)).toBeTruthy();
});

it("starts with a setup empty state and opens credentials only on demand", async () => {
  open(); await ready();
  expect(screen.getByText(en.metaApp.emptyDescription)).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByLabelText("App ID")).toBeNull();
  await edit();
  expect(screen.getByRole("dialog").textContent).toContain(en.metaApp.appIdHint);
  fireEvent.change(screen.getByLabelText("App Secret"), { target: { value: "discard-me" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await edit();
  expect((screen.getByLabelText("App Secret") as HTMLInputElement).value).toBe("");
  expect(mock.callFunction.mock.calls.filter(call => call[1] === "PUT")).toHaveLength(0);
});

it("shows summaries, explicit edit actions, and collapsed manual settings", async () => {
  stored = configured; open(); await ready();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Webhook: Not checked")).toBeTruthy();
  const credentials = screen.getByRole("region", { name: "Credentials" });
  expect(within(credentials).getAllByText("•••• Set")).toHaveLength(2);
  expect(within(credentials).getByRole("button", { name: "Edit: App ID" })).toBeTruthy();
  fireEvent.click(within(credentials).getByRole("button", { name: "Replace: App Secret" }));
  expect((screen.getByLabelText("App Secret") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Configure manually").closest("details")?.open).toBe(false);
  manual();
  expect(screen.getByText("Configure manually").closest("details")?.open).toBe(true);
});

it("updates header badges from the latest check and timestamps the three result rows", async () => {
  stored = configured; open(); await ready();
  mock.callFunction.mockResolvedValueOnce({ app: { ok: true, name: "Example App" }, token: { ok: true, expires_at: 1900000000, scopes: ["whatsapp_business_management"] }, webhook: { callback_url: configured.callback_url, active: true, matches: true, missing_fields: [] } });
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  const status = await screen.findByRole("status");
  expect(within(status).getAllByRole("listitem")).toHaveLength(3);
  expect(status.querySelector("time")?.getAttribute("datetime")).toBeTruthy();
  expect(status.textContent).toContain("whatsapp_business_management");
  expect(status.textContent).toContain("Expires:");
  expect(screen.getByRole("heading", { name: "Example App" })).toBeTruthy();
  expect(screen.getByText(`Webhook: ${en.metaApp.configured}`)).toBeTruthy();
  mock.callFunction.mockRejectedValueOnce(new FunctionError("Meta timeout", 400, "webhook_rejected"));
  fireEvent.click(screen.getByRole("button", { name: "Configure webhook automatically" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Webhook: Problem")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Last tested");
});

it("disables automatic setup after a no_public_url response", async () => {
  stored = configured; open(); await ready();
  mock.callFunction.mockRejectedValueOnce(new FunctionError("No public URL", 400, "no_public_url"));
  fireEvent.click(screen.getByRole("button", { name: "Configure webhook automatically" }));
  expect((await screen.findByRole("alert")).textContent).toContain(en.metaApp.errors.no_public_url);
  expect((screen.getByRole("button", { name: "Configure webhook automatically" }) as HTMLButtonElement).disabled).toBe(true);
});
