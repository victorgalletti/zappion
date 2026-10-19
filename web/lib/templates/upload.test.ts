// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ FUNCTIONS_URL: "https://mock.example/functions/v1", supabase: { auth } }));
import { uploadTemplateMedia, validateTemplateMedia } from "./upload";

afterEach(() => vi.unstubAllGlobals());
describe("Template sample upload adapter (no network)", () => {
  it("validates MIME and size before upload", () => {
    expect(validateTemplateMedia(new File(["mock"], "test.png", { type: "image/png" }), "IMAGE")).toBeNull();
    expect(validateTemplateMedia(new File(["mock"], "test.gif", { type: "image/gif" }), "IMAGE")).toContain("JPG/PNG");
    expect(validateTemplateMedia(new File([], "empty.pdf", { type: "application/pdf" }), "DOCUMENT")).toContain("empty");
    expect(validateTemplateMedia(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" }), "IMAGE")).toContain("5 MB");
  });
  it("sends the authorized multipart contract and returns a resumable handle", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "mock-session" } } });
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ header_handle: "4::mock-handle" }), { status: 200 })); vi.stubGlobal("fetch", fetch);
    const file = new File(["mock"], "test.png", { type: "image/png" });
    expect(await uploadTemplateMedia(file, "IMAGE", "mock-org", "mock-instance")).toBe("4::mock-handle");
    const [url, request] = fetch.mock.calls[0]; expect(url).toBe("https://mock.example/functions/v1/whatsapp-management/template-media?organization_id=mock-org"); expect(request.headers).toEqual({ Authorization: "Bearer mock-session" });
    expect(request.body.get("organization_id")).toBe("mock-org"); expect(request.body.get("organization_address")).toBe("mock-instance"); expect(request.body.get("format")).toBe("IMAGE"); expect(request.body.get("file")).toBe(file);
  });
  it("reports the missing route without treating a media ID as a header handle", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "mock-session" } } });
    const fetch = vi.fn().mockResolvedValue(new Response("Not found", { status: 404 })); vi.stubGlobal("fetch", fetch);
    await expect(uploadTemplateMedia(new File(["mock"], "test.png", { type: "image/png" }), "IMAGE", "mock-org", "mock-instance")).rejects.toThrow("template-media");
  });
  it("requires an authenticated session", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } }); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(uploadTemplateMedia(new File(["mock"], "test.png", { type: "image/png" }), "IMAGE", "mock-org", "mock-instance")).rejects.toThrow("Sign in again"); expect(fetch).not.toHaveBeenCalled();
  });
});
