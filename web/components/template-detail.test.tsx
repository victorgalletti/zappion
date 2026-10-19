// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Template } from "@/lib/types";
import { TemplateDetail } from "./template-detail";
const template: Template = { id: "mock-carousel", name: "mock_carousel", category: "MARKETING", language: "pt_BR", status: "APPROVED", parameter_format: "named", quality_score: { score: "GREEN", reasons: ["Mock quality"] }, components: [
  { type: "BODY", text: "Olá {{cliente}}", example: { body_text_named_params: [{ param_name: "cliente", example: "Exemplo fictício" }] } },
  { type: "CAROUSEL", cards: [{ components: [
    { type: "HEADER", format: "IMAGE", example: { header_handle: ["https://example.com/mock.png"] } },
    { type: "BODY", text: "Produto {{1}}", example: { body_text: [["Amostra"]] } },
    { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver produto", url: "https://example.com/{{1}}", example: ["https://example.com/mock"] }] },
  ] }] },
] };
describe("Template read-only detail", () => {
  it("renders named and card examples, media, buttons and metadata", () => {
    render(<TemplateDetail template={template} onDuplicate={vi.fn()} onBack={vi.fn()} />);
    const preview = within(screen.getByRole("region", { name: "WhatsApp template preview" }));
    expect(preview.getByText("Olá Exemplo fictício")).toBeTruthy();
    expect(preview.getByText("Produto Amostra")).toBeTruthy();
    expect(preview.getByRole("img").getAttribute("src")).toBe("https://example.com/mock.png");
    expect(preview.getByText("Ver produto")).toBeTruthy();
    const data = within(screen.getByRole("region", { name: "Template data" }));
    for (const text of ["Named", "Approved", "High", "mock-carousel", "Mock quality", "Not applicable"]) expect(data.getByText(text)).toBeTruthy();
    const variables = within(screen.getByRole("region", { name: "Variables and examples" }));
    expect(variables.getByText("Body: {{cliente}}")).toBeTruthy();
    expect(variables.getByText("Card 1 · Body: {{1}}")).toBeTruthy();
    expect(variables.getByText("Amostra")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("copies the complete original JSON and reports clipboard failure", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<TemplateDetail template={template} onDuplicate={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("JSON copied."));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(template, null, 2));
    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Could not"));
  });
  it("handles missing examples and unknown components without enabling duplication", () => {
    render(<TemplateDetail template={{ ...template, components: [{ type: "BODY", text: "Oi {{1}}" }, { type: "UNKNOWN" }] }} onDuplicate={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText("No example provided")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Duplicate as new" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/The preview may be incomplete/)).toBeTruthy();
  });
});
