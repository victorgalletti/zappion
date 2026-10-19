// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConnectNumber } from "./connect-number";
const mock = vi.hoisted(() => ({ callFunction: vi.fn(), refresh: vi.fn(), signup: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ callFunction: mock.callFunction }));
beforeEach(() => { mock.callFunction.mockImplementation(async (path: string) => path.includes("?organization_id=") ? null : { status: "connected" }); mock.refresh.mockResolvedValue(undefined); });
function render(ui: React.ReactNode) {
  return rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}
function openManual() {
  render(<ConnectNumber organizationId="mock-org" onConnected={mock.refresh} onEmbeddedSignup={mock.signup} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect number" }));
  fireEvent.click(screen.getByRole("button", { name: "Use credentials" }));
}
function fill() {
  fireEvent.change(screen.getByLabelText("Phone number ID"), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("WhatsApp Business Account ID (WABA)"), { target: { value: "654321" } });
  fireEvent.change(screen.getByLabelText("Permanent access token"), { target: { value: "mock-secret-token" } });
}
it("offers Embedded Signup with explanations and return refresh callback", () => {
  render(<ConnectNumber organizationId="mock-org" onConnected={mock.refresh} onEmbeddedSignup={mock.signup} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect number" }));
  expect(screen.getByText(/Coexistence:/)).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Open connection page" }));
  expect(mock.signup).toHaveBeenCalledTimes(1);
});
it("requires credentials and a six-digit PIN when registering", async () => {
  openManual();
  fireEvent.click(screen.getByRole("button", { name: "Connect with credentials" }));
  expect(screen.getByRole("alert").textContent).toContain("Phone number ID");
  fill(); fireEvent.click(screen.getByLabelText("Register the number with the Cloud API"));
  fireEvent.click(screen.getByRole("button", { name: "Connect with credentials" }));
  expect(screen.getByRole("alert").textContent).toContain("6-digit");
  expect(mock.callFunction.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Two-step verification PIN"), { target: { value: "001234" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect with credentials" }));
  await screen.findByRole("status");
  expect(mock.callFunction.mock.calls.find((call) => call[1] === "POST")?.[2]).toMatchObject({ register: true, pin: "001234", organization_id: "mock-org" });
  expect(mock.refresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Permanent access token")).toBeNull();
});
it("hides/shows the token and clears secrets during pending submission and on errors", async () => {
  let reject!: (reason: Error) => void;
  mock.callFunction.mockImplementation((path: string) => path.includes("?organization_id=") ? Promise.resolve(null) : new Promise((_, rejectPromise) => { reject = rejectPromise; }));
  openManual(); fill();
  const token = screen.getByLabelText("Permanent access token") as HTMLInputElement;
  expect(token.type).toBe("password");
  fireEvent.click(screen.getByRole("button", { name: "Show token" })); expect(token.type).toBe("text");
  fireEvent.click(screen.getByRole("button", { name: "Connect with credentials" }));
  expect(token.value).toBe(""); expect(token.type).toBe("password"); expect(token.disabled).toBe(true);
  reject(new Error("Incorrect PIN mock-secret-token"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Incorrect PIN"));
  expect(screen.getByRole("alert").textContent).not.toContain("mock-secret-token");
  expect(mock.refresh).not.toHaveBeenCalled();
});
it("clears credentials on cancellation", () => {
  openManual(); fill(); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Connect number" }));
  fireEvent.click(screen.getByRole("button", { name: "Use credentials" }));
  expect((screen.getByLabelText("Permanent access token") as HTMLInputElement).value).toBe("");
});

it("uses the organization token when configured and omits a blank access token", async () => {
  mock.callFunction.mockImplementation(async (path: string) => path.includes("?organization_id=") ? { has_system_token: true } : { status: "connected" });
  openManual();
  await screen.findByText("Leave blank to use the organization’s Meta App token");
  fill();
  fireEvent.change(screen.getByLabelText("Permanent access token"), { target: { value: " " } });
  expect((screen.getByLabelText("Permanent access token") as HTMLInputElement).required).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Connect with credentials" }));
  await screen.findByRole("status");
  const body = mock.callFunction.mock.calls.find((call) => call[1] === "POST")?.[2];
  expect(body).not.toHaveProperty("access_token");
});
it("still requires a token without an organization token", async () => {
  openManual(); fill();
  fireEvent.change(screen.getByLabelText("Permanent access token"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect with credentials" }));
  expect(screen.getByRole("alert").textContent).toContain("permanent access token");
  expect(mock.callFunction.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(0);
});
