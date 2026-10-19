// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationAddressRow, Template } from "@/lib/types";
const mocks = vi.hoisted(() => ({ reset: vi.fn(), mutate: vi.fn(), refetch: vi.fn(), address: vi.fn(), loading: false, error: null as Error | null, data: [] as Template[] }));
vi.mock("./providers", () => ({ useOrganizationId: () => "mock-org" }));
vi.mock("@/hooks/use-chat", () => ({
  useTemplates: (_org: string, address: string) => { mocks.address(address); return { isLoading: mocks.loading, error: mocks.error, data: mocks.data, refetch: mocks.refetch }; },
  useCreateTemplate: () => ({ reset: mocks.reset, mutate: mocks.mutate, isPending: false, error: null }),
}));
vi.mock("./template-editor", () => ({ TemplateEditor: ({ initial }: { initial: { name: string; kind: string } }) => <div role="dialog">{initial.name} · {initial.kind}</div> }));
import { TemplatesManager } from "./templates-manager";
const numbers: OrganizationAddressRow[] = [{ organization_id: "mock-org", address: "mock-number", service: "whatsapp", status: "connected", extra: { label: "Instância A" } }];
const fixtures: Template[] = [
  { id: "mock-1", name: "mock_coupon", category: "MARKETING", language: "pt_BR", status: "REJECTED", rejected_reason: "Mock rejection reason", quality_score: { score: "RED" }, components: [{ type: "BODY", text: "Olá {{1}}", example: { body_text: [["Cliente fictício"]] } }, { type: "BUTTONS", buttons: [{ type: "COPY_CODE", example: "MOCK25" }] }] },
  { id: "mock-2", name: "mock_standard", category: "UTILITY", language: "en_US", status: "APPROVED", components: [{ type: "BODY", text: "Test update." }] },
];
function choose(label: string, option: string) { fireEvent.click(screen.getByRole("combobox", { name: label })); fireEvent.click(screen.getByRole("option", { name: option })); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.loading = false; mocks.error = null; mocks.data = fixtures;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
describe("Templates page with mocked organization", () => {
  it("opens a read-only detail and duplicates without writing", () => {
    render(<TemplatesManager numbers={numbers} />);
    expect(screen.queryByRole("region", { name: "Template details" })).toBeNull();
    expect(screen.getByText("Coupon · Marketing · pt_BR")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /mock_coupon/ }));
    const detail = within(screen.getByRole("region", { name: "Template details" }));
    expect(detail.getByText("Mock rejection reason")).toBeTruthy();
    expect(detail.getByText("Low")).toBeTruthy();
    expect(detail.getByRole("region", { name: "WhatsApp template preview" }).textContent).toContain("Olá Cliente fictício");
    expect(detail.queryByRole("textbox")).toBeNull();
    fireEvent.click(detail.getByRole("button", { name: "Duplicate as new" }));
    expect(screen.getByRole("dialog").textContent).toBe("mock_coupon_copia · coupon");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each([
    ["Filter by status", "Approved"], ["Filter by category", "Utility"],
    ["Filter by type", "Standard"], ["Filter by language", "en_US"],
  ])("filters by %s using the custom Select", (label, option) => {
    render(<TemplatesManager numbers={numbers} />); choose(label, option);
    expect(screen.queryByRole("button", { name: /mock_coupon/ })).toBeNull();
    expect(screen.getByRole("button", { name: /mock_standard/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: /mock_coupon/ })).toBeTruthy();
  });
  it("combines search and filters, hides a filtered detail and handles no matches", () => {
    render(<TemplatesManager numbers={numbers} />);
    fireEvent.click(screen.getByRole("button", { name: /mock_coupon/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search templates" }), { target: { value: " STANDARD " } });
    expect(screen.queryByRole("region", { name: "Template details" })).toBeNull();
    choose("Filter by status", "Rejected");
    expect(screen.getByText("No templates match these filters.")).toBeTruthy();
  });
  it("changes instance, resets detail and opens the current editor", () => {
    render(<TemplatesManager numbers={[...numbers, { ...numbers[0], address: "mock-second", extra: { label: "Instância B" } }]} />);
    fireEvent.click(screen.getByRole("button", { name: /mock_coupon/ }));
    choose("Template instance", "Instância B");
    expect(mocks.address).toHaveBeenLastCalledWith("mock-second");
    expect(screen.queryByRole("region", { name: "Template details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    expect(screen.getByRole("dialog").textContent).toBe(" · standard");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("handles loading, empty, failed and missing-instance states", () => {
    mocks.loading = true; mocks.data = [];
    const { rerender } = render(<TemplatesManager numbers={numbers} />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    mocks.loading = false; rerender(<TemplatesManager numbers={numbers} />);
    expect(screen.getByText(/No templates yet/)).toBeTruthy();
    mocks.error = new Error("Mock failure"); rerender(<TemplatesManager numbers={numbers} />);
    expect(screen.getByRole("alert").textContent).toContain("Mock failure");
    fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(mocks.refetch).toHaveBeenCalled();
    rerender(<TemplatesManager numbers={[]} />);
    expect(screen.getByText("Connect an instance to manage templates.")).toBeTruthy();
  });
});
