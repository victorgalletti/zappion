// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaUrl } from "@/hooks/use-chat";
import type { FileInfo, MessageRow } from "@/lib/types";
import { timeOf } from "@/lib/utils";
import { fileTypeOf, MessageBubble } from "./message-bubble";

vi.mock("@/hooks/use-chat", () => ({ useMediaUrl: vi.fn() }));

const file: FileInfo = { uri: "internal://media/report", name: "Report.PDF", mime_type: "application/pdf", size: 13 * 1024 };
const message: MessageRow = {
  id: "message", organization_id: "org", conversation_id: "chat", service: "whatsapp",
  organization_address: "123", conversation_address: "456", sender_address: "456",
  external_id: "external", agent_id: null, status: null,
  timestamp: "2026-10-15T12:00:00Z", created_at: "2026-10-15T12:00:00Z",
  content: { type: "file", kind: "document", file },
};
const props = { contactName: "Contact", tail: false, interactive: false, onReply: vi.fn(), onReact: vi.fn(), onJump: vi.fn() };

describe("fileTypeOf", () => {
  it.each([
    ["pdf", "#e53935"],
    ...["doc", "docx", "odt", "rtf", "txt"].map((ext) => [ext, "#1e88e5"]),
    ...["xls", "xlsx", "csv", "ods"].map((ext) => [ext, "#43a047"]),
    ...["ppt", "pptx"].map((ext) => [ext, "#fb8c00"]),
    ["zip", "#8696a0"],
  ])("recognizes .%s case-insensitively and prioritizes the filename", (ext, color) => {
    expect(fileTypeOf({ ...file, name: `report.final.${ext.toUpperCase()}`, mime_type: "application/octet-stream" })).toEqual({ ext, color });
  });

  it.each([
    ["application/pdf", "pdf"],
    ["application/msword", "doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["application/vnd.oasis.opendocument.text", "odt"],
    ["text/plain; charset=utf-8", "txt"],
    ["application/rtf", "rtf"],
    ["application/vnd.ms-excel", "xls"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    ["application/vnd.oasis.opendocument.spreadsheet", "ods"],
    ["text/csv", "csv"],
    ["application/vnd.ms-powerpoint", "ppt"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
    ["application/zip", "zip"],
  ])("falls back from an extensionless name to %s", (mime_type, ext) => {
    expect(fileTypeOf({ ...file, name: "report", mime_type }).ext).toBe(ext);
    expect(fileTypeOf({ ...file, name: undefined, mime_type }).ext).toBe(ext);
  });

  it("handles missing type information", () => {
    expect(fileTypeOf({ uri: "file", mime_type: "" })).toEqual({ ext: "", color: "#8696a0" });
  });
});

describe("document bubbles", () => {
  beforeEach(() => {
    vi.mocked(useMediaUrl).mockReturnValue({ data: "https://example.com/report", isLoading: false } as ReturnType<typeof useMediaUrl>);
  });

  it("wraps the PDF preview and metadata in one download link and puts time below it", () => {
    const { container } = render(<MessageBubble {...props} message={message} />);
    const link = screen.getByRole("link");
    const iframe = screen.getByTitle("Report.PDF");
    expect(link.getAttribute("download")).toBe("Report.PDF");
    expect(link.getAttribute("href")).toBe("https://example.com/report");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.contains(iframe)).toBe(true);
    expect(iframe.getAttribute("src")).toBe("https://example.com/report#toolbar=0&navpanes=0&scrollbar=0&view=FitH");
    expect(iframe.className).toContain("pointer-events-none");
    expect(screen.getByText("13 KB • pdf")).toBeTruthy();
    expect(link.nextElementSibling?.className).toContain("justify-end");
    expect(container.firstElementChild?.className).toContain("p-[3px]");
  });

  it("shows a placeholder for other file kinds and keeps the caption and time below the link", () => {
    render(<MessageBubble {...props} message={{ ...message, content: {
      type: "file", kind: "file", file: { ...file, name: "Notes.txt", size: undefined }, text: "Read these notes",
    } }} />);
    const link = screen.getByRole("link");
    expect(link.querySelector("iframe")).toBeNull();
    expect(screen.getAllByText("TXT")).toHaveLength(2);
    expect(screen.getByText("txt")).toBeTruthy();
    const caption = screen.getByText("Read these notes");
    expect(link.nextElementSibling?.contains(caption)).toBe(true);
    expect(link.nextElementSibling?.lastElementChild?.className).toContain("ml-auto");
  });

  it("keeps a loading card until the media URL is available", () => {
    vi.mocked(useMediaUrl).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useMediaUrl>);
    render(<MessageBubble {...props} message={message} />);
    expect(screen.queryByRole("link")).toBeNull();
    const loading = screen.getByText("Loading media…");
    expect(loading.className).toContain("rounded-[5px]");
    expect(loading.querySelector(".animate-spin")).toBeTruthy();
  });
});

describe("audio bubbles", () => {
  beforeEach(() => {
    vi.mocked(useMediaUrl).mockReturnValue({ data: "https://example.com/audio", isLoading: false } as ReturnType<typeof useMediaUrl>);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No duration probe")));
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["audio/mpeg", true],
    ["audio/mp4", true],
    ["audio/ogg; codecs=opus", false],
    ["audio/webm", false],
  ])("selects the audio layout for %s and keeps normal padding with time inside the player", (mime_type, isFile) => {
    const { container } = render(<MessageBubble {...props} message={{ ...message, content: {
      type: "file", kind: "audio", file: { ...file, mime_type },
    } }} />);
    expect(screen.getByRole("slider", { name: "Seek audio" })).toBeTruthy();
    expect(!!screen.queryByRole("button", { name: /Playback speed:/ })).toBe(!isFile);
    expect(container.firstElementChild?.className).toContain("px-[9px] pt-1.5 pb-1");
    const player = container.querySelector("audio")!.parentElement!;
    const time = screen.getByText(timeOf(message.timestamp));
    expect(player.contains(time)).toBe(true);
    expect(time.parentElement?.className).toContain("col-start-3 row-start-2");
    expect(screen.getAllByText(timeOf(message.timestamp))).toHaveLength(1);
    expect(!!player.querySelector("canvas")).toBe(!isFile);
    expect(!!player.querySelector('input[type="range"]')).toBe(isFile);
  });

  it("keeps the audio loading state", () => {
    vi.mocked(useMediaUrl).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useMediaUrl>);
    render(<MessageBubble {...props} message={{ ...message, content: {
      type: "file", kind: "audio", file: { ...file, mime_type: "audio/mpeg" },
    } }} />);
    const loading = screen.getByText("Loading audio…");
    const time = screen.getByText(timeOf(message.timestamp));
    expect(loading.contains(time)).toBe(true);
    expect(time.parentElement?.className).toContain("ml-auto");
    expect(loading.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});

describe("messages held for approval", () => {
  const held: MessageRow = {
    ...message, id: "held", sender_address: null, external_id: null,
    status: { awaiting_approval: "2026-10-15T12:00:00Z" },
    content: { type: "text", kind: "text", text: "Your order shipped" },
  };
  const approval = () => ({ keyName: "Support bot", busy: false, error: null, onApprove: vi.fn(), onReject: vi.fn() });

  it("marks the bubble as pending, names the key and calls approve and reject", () => {
    const controls = approval();
    const { container } = render(<MessageBubble {...props} message={held} approval={controls} />);
    const bubble = container.firstElementChild!;
    expect(bubble.getAttribute("data-awaiting-approval")).toBe("true");
    expect(bubble.className).toContain("outline-dashed");
    expect(screen.getByRole("group", { name: "Waiting for approval · Support bot" })).toBeTruthy();
    expect(screen.getByLabelText("Waiting for approval")).toBeTruthy();
    expect(screen.queryByLabelText("Sent")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(controls.onApprove).toHaveBeenCalledOnce();
    expect(controls.onReject).toHaveBeenCalledOnce();
  });

  it("disables both buttons while a decision is in flight and shows its error", () => {
    render(<MessageBubble {...props} message={held} approval={{ ...approval(), busy: true, error: "the service window is closed: only a template can be sent" }} />);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("the service window is closed: only a template can be sent");
  });

  it("still shows the pending label before the key name is known", () => {
    render(<MessageBubble {...props} message={held} approval={{ ...approval(), keyName: undefined }} />);
    expect(screen.getByRole("group", { name: "Waiting for approval" })).toBeTruthy();
  });

  it("shows Rejected instead of ticks and no buttons for a rejected message", () => {
    const { container } = render(<MessageBubble {...props} message={{ ...held, status: { awaiting_approval: "a", rejected: "b" } }} approval={approval()} />);
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(container.firstElementChild!.getAttribute("data-awaiting-approval")).toBeNull();
  });

  it("goes back to normal delivery ticks once approved", () => {
    render(<MessageBubble {...props} message={{ ...held, status: { awaiting_approval: "a", approved: "b", pending: "c", sent: "d" } }} approval={approval()} />);
    expect(screen.getByLabelText("Sent")).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("ignores the approval controls for incoming messages", () => {
    render(<MessageBubble {...props} message={{ ...held, sender_address: "456" }} approval={approval()} />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
