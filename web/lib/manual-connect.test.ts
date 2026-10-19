// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyManualConnectFields, manualConnect, manualConnectError, validateManualConnect } from "./manual-connect";

const mock = vi.hoisted(() => ({ callFunction: vi.fn() }));
vi.mock("./supabase", () => ({ callFunction: mock.callFunction }));
const valid = { ...emptyManualConnectFields, phone_number_id: "123456", waba_id: "654321", access_token: "mock-secret-token" };
beforeEach(() => { mock.callFunction.mockResolvedValue({ status: "connected" }); });

describe("manual connection", () => {
  it.each([
    [{ phone_number_id: "" }, /Phone number ID/],
    [{ phone_number_id: "123a" }, /Phone number ID/],
    [{ waba_id: "" }, /WABA ID/],
    [{ access_token: "  " }, /token/],
    [{ register: true, pin: "12345" }, /6-digit/],
    [{ register: true, pin: "12345a" }, /6-digit/],
    [{ callback_url: "http://callback.test" }, /HTTPS/],
    [{ callback_url: "invalid" }, /HTTPS/],
    [{ callback_url: "https://user:secret@callback.test" }, /credentials/],
    [{ label: "a".repeat(101) }, /100 characters/],
  ])("validates fields %j", (patch, expected) => expect(validateManualConnect({ ...valid, ...patch })).toMatch(expected));

  it("requires PIN only for registration and allows optional advanced fields", () => {
    expect(validateManualConnect(valid)).toBeNull();
    expect(validateManualConnect({ ...valid, register: true, pin: "001234", callback_url: "https://callback.test/webhook" })).toBeNull();
  });

  it("sends the organization and only relevant optional fields", async () => {
    await manualConnect("mock-org", { ...valid, phone_number_id: " 123456 ", pin: "123456" });
    expect(mock.callFunction).toHaveBeenCalledExactlyOnceWith("whatsapp-management/manual-connect", "POST", {
      organization_id: "mock-org", phone_number_id: "123456", waba_id: "654321", access_token: "mock-secret-token", register: false,
    });
  });

  it("sends registration and webhook overrides when supplied", async () => {
    await manualConnect("mock-org", { ...valid, register: true, pin: "001234", label: " Teste ", callback_url: "https://callback.test", verify_token: "mock-verify" });
    expect(mock.callFunction.mock.calls[0][2]).toMatchObject({ pin: "001234", label: "Teste", callback_url: "https://callback.test", verify_token: "mock-verify" });
  });

  it("does not call the backend for invalid fields", async () => {
    await expect(manualConnect("mock-org", { ...valid, register: true })).rejects.toThrow(/PIN/);
    expect(mock.callFunction).not.toHaveBeenCalled();
  });

  it.each([
    ["Invalid OAuth access token", /Invalid or expired token/],
    ["Phone number does not belong to WABA", /does not belong/],
    ["Incorrect PIN", /Incorrect PIN/],
    ["HTTP 403", /administrator/],
    ["Failed to fetch", /connection/],
    ["Unsupported request", /Unsupported request/],
  ])("translates backend/Meta error %s", async (message, expected) => {
    mock.callFunction.mockRejectedValue(new Error(message));
    await expect(manualConnect("mock-org", valid)).rejects.toThrow(expected);
  });

  it("redacts secrets from unrecognized errors", () => {
    const message = manualConnectError(new Error("Rejected mock-secret-token mock-verify 001234"), ["mock-secret-token", "mock-verify", "001234"]);
    expect(message).not.toContain("mock-secret-token"); expect(message).not.toContain("mock-verify"); expect(message).not.toContain("001234");
  });
});

it("allows a blank token only with the organization system token", async () => {
  const fields = { ...valid, access_token: "  " };
  expect(validateManualConnect(fields, true)).toBeNull();
  expect(validateManualConnect(fields, false)).toMatch(/token/);
  await manualConnect("mock-org", fields, true);
  expect(mock.callFunction.mock.calls[0][2]).not.toHaveProperty("access_token");
  await expect(manualConnect("mock-org", fields, false)).rejects.toThrow(/token/);
});
