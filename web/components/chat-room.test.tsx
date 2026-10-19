// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MessageRow } from "@/lib/types";
import { ChatRoom, type ChatTarget } from "./chat-room";
import type { BubbleApproval } from "./message-bubble";

const approvals = vi.hoisted(() => ({
  list: vi.fn(() => ({ data: [] as unknown[] })), decide: { mutate: vi.fn(), isPending: false, error: null as Error | null, variables: undefined as { messageId: string } | undefined },
  approvalFor: undefined as undefined | ((message: MessageRow) => BubbleApproval | undefined),
}));
vi.mock("@/hooks/use-message-approvals", () => ({
  useWaitingApprovals: approvals.list,
  useDecideMessage: () => approvals.decide,
}));

vi.mock("@/hooks/use-chat", () => ({
  useMessages: () => ({ data: [], isLoading: false }),
  useMessageContext: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useSendMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useLastIncoming: () => ({ data: null }),
  markConversationRead: vi.fn(),
  markRead: vi.fn(),
}));
vi.mock("@/hooks/use-service-window", () => ({
  useServiceWindow: () => ({ open: true, title: "Open", text: "Open" }),
}));
vi.mock("./message-list", () => ({ MessageList: (props: { approvalFor?: (message: MessageRow) => BubbleApproval | undefined }) => { approvals.approvalFor = props.approvalFor; return null; } }));
vi.mock("./composer", () => ({ Composer: () => null, MEDIA_KIND: () => "document" }));

const target: ChatTarget = {
  organizationId: "org", organizationAddress: "instance", address: "5511999990000",
  conversationId: "chat", displayName: "Contact",
};

describe("phone conversation header", () => {
  it("renders a phone-only back button when onBack is given and calls it", () => {
    const onBack = vi.fn();
    render(<ChatRoom target={target} onBack={onBack} />);
    const button = screen.getByRole("button", { name: "Back" });
    expect(button.classList.contains("md:hidden")).toBe(true);
    expect(button.classList.contains("size-[44px]")).toBe(true);
    fireEvent.click(button);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("omits the back button without onBack", () => {
    render(<ChatRoom target={target} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("offers search in the phone overflow menu alongside archive", () => {
    const onToggleArchive = vi.fn();
    render(<ChatRoom target={target} onToggleArchive={onToggleArchive} />);
    expect(screen.getByRole("button", { name: "Search this chat" }).classList.contains("hidden")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
    const search = screen.getByRole("menuitem", { name: "Search this chat" });
    expect(search.classList.contains("md:hidden")).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Archive chat" })).toBeTruthy();
    fireEvent.click(search);
    expect(screen.getByPlaceholderText("Search messages")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("messages held for approval", () => {
  const held = {
    id: "held", organization_id: "org", conversation_id: "chat", service: "whatsapp", organization_address: "instance",
    conversation_address: "5511999990000", sender_address: null, external_id: null, agent_id: null,
    status: { awaiting_approval: "2026-10-16T10:00:00Z" }, timestamp: "2026-10-16T10:00:00Z", created_at: "2026-10-16T10:00:00Z",
    content: { type: "text", kind: "text", text: "Hi" },
  } as MessageRow;

  it("names the key, wires approve and reject, and scopes errors to the decided message", () => {
    approvals.list.mockReturnValue({ data: [{ message_id: "held", api_key_name: "Support bot" }] });
    approvals.decide.error = new Error("the API key reached its hourly limit for messages (2)");
    approvals.decide.variables = { messageId: "held" };
    render(<ChatRoom target={target} />);
    expect(approvals.list).toHaveBeenCalledWith("org");
    const controls = approvals.approvalFor!(held)!;
    expect(controls).toMatchObject({ keyName: "Support bot", busy: false, error: "the API key reached its hourly limit for messages (2)" });
    controls.onApprove();
    expect(approvals.decide.mutate).toHaveBeenLastCalledWith({ messageId: "held", decision: "approved" });
    controls.onReject();
    expect(approvals.decide.mutate).toHaveBeenLastCalledWith({ messageId: "held", decision: "rejected" });
    expect(approvals.approvalFor!({ ...held, id: "other" })!.error).toBeNull();
  });

  it("gives no controls to sent, rejected or incoming messages", () => {
    approvals.list.mockReturnValue({ data: [] });
    render(<ChatRoom target={target} />);
    expect(approvals.approvalFor!({ ...held, status: { awaiting_approval: "t", approved: "t", pending: "t" } })).toBeUndefined();
    expect(approvals.approvalFor!({ ...held, status: { awaiting_approval: "t", rejected: "t" } })).toBeUndefined();
    expect(approvals.approvalFor!({ ...held, sender_address: "5511999990000" })).toBeUndefined();
    expect(approvals.approvalFor!(held)!.keyName).toBeUndefined();
  });
});
