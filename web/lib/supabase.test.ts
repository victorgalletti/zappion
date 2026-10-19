// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { callFunction, FunctionError } from "./supabase";

const mock = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getSession: mock.getSession } }) }));
beforeEach(() => {
  mock.getSession.mockResolvedValue({ data: { session: { access_token: "session-token" } } });
  vi.stubGlobal("fetch", mock.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  [{ message: "Credential rejected", cause: { reason: "app_secret_rejected" } }, "Credential rejected", "app_secret_rejected"],
  [{ message: "Top level", cause: { error: { message: "Meta message", error_user_msg: "User message" } } }, "User message", undefined],
  [{ message: "Top level", cause: { error: { message: "Meta message" } } }, "Meta message", undefined],
  [{ message: "Top level" }, "Top level", undefined],
  [{ message: "Unknown error", cause: { reason: "future_reason" } }, "Unknown error", "future_reason"],
  [{ message: "Bad reason", cause: { reason: 123 } }, "Bad reason", undefined],
])("preserves message precedence and exposes status/reason: %j", async (body, message, reason) => {
  mock.fetch.mockResolvedValue(new Response(JSON.stringify(body), { status: 400 }));
  const error = await callFunction("whatsapp-management/app", "PUT", { app_id: "123" }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(FunctionError);
  expect(error).toMatchObject({ message, status: 400, reason });
});

it("uses the existing HTTP fallback for non-JSON errors", async () => {
  mock.fetch.mockResolvedValue(new Response("Bad gateway", { status: 502 }));
  await expect(callFunction("example", "GET")).rejects.toMatchObject({ message: "HTTP 502", status: 502, reason: undefined });
});

it("returns successful JSON and sends the signed-in session", async () => {
  mock.fetch.mockResolvedValue(new Response(JSON.stringify({ app_id: "123" }), { status: 200 }));
  await expect(callFunction("whatsapp-management/app", "PUT", { app_id: "123" })).resolves.toEqual({ app_id: "123" });
  expect(mock.fetch).toHaveBeenCalledWith(expect.stringContaining("/functions/v1/whatsapp-management/app"), {
    method: "PUT", headers: { Authorization: "Bearer session-token", "Content-Type": "application/json" }, body: '{"app_id":"123"}',
  });
});
