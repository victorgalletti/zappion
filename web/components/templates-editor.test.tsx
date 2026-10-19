// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newDraft } from "@/lib/templates/catalog";
import { buildCreatePayload } from "@/lib/templates/payload";
import { TemplateEditor } from "./template-editor";
import { TemplatePicker } from "./template-picker";

vi.mock("@/lib/templates/upload", () => ({ uploadTemplateMedia: vi.fn().mockResolvedValue("4::mock"), validateTemplateMedia: () => null }));
beforeAll(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
function props() { return { organizationId: "mock-org", organizationAddress: "mock-number", pending: false, onClose: vi.fn(), onCreate: vi.fn() }; }

describe("Template editor with mocked creation", () => {
  it("adds variables, requires examples and submits the validated payload", () => {
    const p = props(); render(<TemplateEditor initial={newDraft()} {...p} />);
    fireEvent.change(screen.getByLabelText("Template name (lowercase letters, numbers, and _)"), { target: { value: "mock_order" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText(/Message body ·/), { target: { value: "Olá, seu pedido chegou" } });
    fireEvent.click(screen.getByRole("button", { name: "Add variable" }));
    expect((screen.getByLabelText(/Message body · \d+\/1024/) as HTMLTextAreaElement).value).toBe("Olá, seu pedido chegou {{1}}.");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(p.onCreate).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("example");
    fireEvent.click(screen.getByRole("button", { name: "2. Content" }));
    fireEvent.change(screen.getByLabelText("Message body · required example {{1}}"), { target: { value: "MOCK123" } });
    expect(screen.getByRole("region", { name: "WhatsApp template preview" }).textContent).toContain("Olá, seu pedido chegou MOCK123.");
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(p.onCreate).toHaveBeenCalledWith({ name: "mock_order", category: "UTILITY", language: "pt_BR", parameter_format: "positional", components: [{ type: "BODY", text: "Olá, seu pedido chegou {{1}}.", example: { body_text: [["MOCK123"]] } }] });
  });
  it("submits named templates with parameter_format named", () => {
    const d = newDraft(); d.parameterFormat = "named"; d.name = "mock_named"; d.body = { text: "Olá {{cliente}}, tudo bem?", examples: { cliente: "Teste" } };
    const p = props(); render(<TemplateEditor initial={d} {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "3. Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(p.onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "mock_named", parameter_format: "named" }));
  });
  it("uploads the media sample as soon as it is chosen", async () => {
    const { uploadTemplateMedia } = await import("@/lib/templates/upload");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:mock", revokeObjectURL: vi.fn() }));
    const d = newDraft("media"); const p = props(); render(<TemplateEditor initial={d} {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "2. Content" }));
    const file = new File(["mock"], "test.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/^Sample file/), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByLabelText("header_handle") as HTMLInputElement).value).toBe("4::mock"));
    expect(screen.getByText("Uploaded ✓")).toBeTruthy();
    expect(uploadTemplateMedia).toHaveBeenCalledWith(file, "IMAGE", "mock-org", "mock-number");
  });
});

describe("Template picker with mocked sending", () => {
  it("only lists approved templates and sends coupon/header/body with the shared preview", () => {
    const d = newDraft("coupon"); d.name = "mock_coupon"; d.header = { ...d.header, format: "IMAGE", handle: "4::mock" }; d.body = { text: "Olá {{1}}, use nosso cupom.", examples: { "1": "Exemplo" } }; d.buttons[0].example = "MOCK";
    const t = { ...buildCreatePayload(d), id: "mock", status: "APPROVED" }; const onSend = vi.fn();
    render(<TemplatePicker templates={[t, { ...t, id: "pending", name: "pending", status: "PENDING" }]} loading={false} onClose={vi.fn()} onSend={onSend} />);
    expect(screen.queryByText("pending")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: /mock_coupon/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send template" })); expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Body: {{1}} *"), { target: { value: "Teste" } });
    fireEvent.change(screen.getByLabelText("Image: Public URL or media ID *"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Coupon code *"), { target: { value: "MOCK25" } });
    expect(screen.getByRole("region", { name: "WhatsApp template preview" }).textContent).toContain("Olá Teste, use nosso cupom.");
    fireEvent.click(screen.getByRole("button", { name: "Send template" }));
    expect(onSend).toHaveBeenCalledWith({ name: "mock_coupon", language: { code: "pt_BR" }, components: [
      { type: "header", parameters: [{ type: "image", image: { id: "123456" } }] }, { type: "body", parameters: [{ type: "text", text: "Teste" }] }, { type: "button", sub_type: "copy_code", index: "0", parameters: [{ type: "coupon_code", coupon_code: "MOCK25" }] },
    ] });
  });
  it("blocks unknown Meta components instead of silently sending an incomplete payload", () => {
    const onSend = vi.fn(); render(<TemplatePicker templates={[{ id: "mock", name: "mock_unsupported", category: "UTILITY", language: "pt_BR", status: "APPROVED", components: [{ type: "BODY", text: "Teste" }, { type: "NEW_META_COMPONENT" }] }]} loading={false} onSend={onSend} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /mock_unsupported/ })); fireEvent.click(screen.getByRole("button", { name: "Send template" }));
    expect(screen.getByRole("alert").textContent).toContain("not yet supported"); expect(onSend).not.toHaveBeenCalled();
  });
});
