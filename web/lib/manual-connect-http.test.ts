// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from "vitest";
import { manualConnect, emptyManualConnectFields } from "./manual-connect";
const mock = vi.hoisted(() => ({ getSession: vi.fn(async () => ({ data: { session: { access_token: "mock-session-token" } } })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getSession: mock.getSession } }) }));
afterEach(() => vi.unstubAllGlobals());
const fields = { ...emptyManualConnectFields, phone_number_id: "123456", waba_id: "654321", access_token: "mock-system-user-token" };
it("authenticates the HTTP call with the session token and sends credentials only in the body", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ status: "connected" }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await manualConnect("mock-org", fields);
  const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("/functions/v1/whatsapp-management/manual-connect");
  expect(request.headers).toMatchObject({ Authorization: "Bearer mock-session-token" });
  expect(JSON.parse(request.body as string)).toMatchObject({ organization_id: "mock-org", access_token: "mock-system-user-token" });
});
it("uses cause.error.message from non-success HTTP responses", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Connection failed", cause: { error: { message: "Phone number does not belong to WABA" } } }), { status: 400 })));
  await expect(manualConnect("mock-org", fields)).rejects.toThrow("The number does not belong to the specified WABA");
});
