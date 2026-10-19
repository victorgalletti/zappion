// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageRow } from "@/lib/types";
import type { MessageBubble } from "./message-bubble";
import { MessageList } from "./message-list";

const bubble = vi.hoisted(() => ({ scrollIntoView: vi.fn(), animate: vi.fn() }));
vi.mock("./message-bubble", () => ({
  MessageBubble: ({ message, tail, onJump }: ComponentProps<typeof MessageBubble>) => (
    <div
      data-message-id={message.id}
      data-external-id={message.external_id}
      data-tail={String(tail)}
      ref={(node) => {
        if (node) {
          node.scrollIntoView = bubble.scrollIntoView;
          node.animate = bubble.animate;
        }
      }}
    >
      {message.id}
      {message.content.re_message_id && (
        <button onClick={() => onJump(message.content.re_message_id!)}>Jump to quote</button>
      )}
    </div>
  ),
}));

function message(id: string, timestamp = "2026-10-14T12:00:00Z", sender: string | null = null): MessageRow {
  return {
    id, timestamp, sender_address: sender, external_id: `external-${id}`,
    organization_id: "org", conversation_id: "chat", service: "whatsapp",
    organization_address: "instance", conversation_address: "contact", agent_id: null,
    status: {}, created_at: timestamp, content: { type: "text", kind: "text", text: id },
  };
}

const props = { contactName: "Contact", interactive: true, onReply: vi.fn(), onReact: vi.fn() };
let height: number;
let resize: () => void;
let observe: ReturnType<typeof vi.fn>;
let disconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  height = 1000;
  observe = vi.fn();
  disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function scroller(container: HTMLElement) {
  return container.querySelector<HTMLDivElement>(".thin-scroll")!;
}

function grow(nextHeight: number) {
  act(() => {
    height = nextHeight;
    resize();
  });
}

describe("message day groups", () => {
  it("confines each sticky chip to its day and preserves message order and tails", () => {
    const messages = [
      message("first"), message("second"), message("incoming", undefined, "contact"),
      message("next-day", "2026-10-15T12:00:00Z", "contact"),
    ];
    const hidden = { ...message("reaction"), content: { type: "data", kind: "reaction", data: {} } };
    const { container } = render(<MessageList {...props} messages={[...messages, hidden]} />);
    const sections = container.querySelectorAll("section");
    expect(sections).toHaveLength(2);
    expect(Array.from(sections[0].querySelectorAll("[data-message-id]"), (node) => node.getAttribute("data-message-id")))
      .toEqual(["first", "second", "incoming"]);
    expect(sections[1].querySelector("[data-message-id]")?.getAttribute("data-message-id")).toBe("next-day");
    for (const section of sections) {
      expect(section.classList.contains("flex-col")).toBe(true);
      expect(section.firstElementChild?.classList.contains("sticky")).toBe(true);
      expect(section.firstElementChild?.classList.contains("top-1")).toBe(true);
      expect(section.querySelectorAll(".sticky")).toHaveLength(1);
    }
    expect(Array.from(container.querySelectorAll("[data-tail]"), (node) => node.getAttribute("data-tail")))
      .toEqual(["true", "false", "true", "true"]);
  });
});

describe("bottom following", () => {
  it("opens at the bottom, follows delayed media growth, and disconnects on unmount", () => {
    const { container, unmount } = render(<MessageList {...props} messages={[message("first")]} />);
    const scroll = scroller(container);
    expect(scroll.scrollTop).toBe(1000);
    expect(observe).toHaveBeenCalledWith(scroll.firstElementChild);
    grow(1400);
    expect(scroll.scrollTop).toBe(1400);
    grow(1900);
    expect(scroll.scrollTop).toBe(1900);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("stays put after scrolling up and resumes following when back near the bottom", () => {
    const messages = [message("first")];
    const { container, rerender } = render(<MessageList {...props} messages={messages} />);
    const scroll = scroller(container);
    fireEvent.scroll(scroll, { target: { scrollTop: 200 } });
    expect(screen.queryByRole("button", { name: "Scroll to bottom" })).toBeTruthy();
    grow(1400);
    rerender(<MessageList {...props} messages={[...messages, message("second")]} />);
    expect(scroll.scrollTop).toBe(200);
    fireEvent.scroll(scroll, { target: { scrollTop: 950 } });
    expect(screen.queryByRole("button", { name: "Scroll to bottom" })).toBeNull();
    grow(1700);
    expect(scroll.scrollTop).toBe(1700);
    height = 1800;
    rerender(<MessageList {...props} messages={[...messages, message("second"), message("third")]} />);
    expect(scroll.scrollTop).toBe(1800);
  });

  it("does not pin before a search jump's scroll event, including when messages change", () => {
    const messages = [message("first"), message("second")];
    const { container, rerender } = render(<MessageList {...props} messages={messages} />);
    const scroll = scroller(container);
    height = 1200;
    rerender(<MessageList {...props} messages={[...messages]} focusId="first" />);
    expect(scroll.scrollTop).toBe(1000);
    expect(bubble.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    grow(1400);
    expect(scroll.scrollTop).toBe(1000);
    fireEvent.scroll(scroll, { target: { scrollTop: 200 } });
    grow(1600);
    expect(scroll.scrollTop).toBe(200);
  });

  it("honors an initial search target while media loads", () => {
    const { container } = render(<MessageList {...props} messages={[message("first")]} focusId="first" />);
    const scroll = scroller(container);
    expect(bubble.scrollIntoView).toHaveBeenCalledOnce();
    grow(1400);
    expect(scroll.scrollTop).toBe(0);
  });

  it("pauses following immediately for a quoted-message jump", () => {
    const first = message("first");
    const reply = message("reply");
    reply.content.re_message_id = first.external_id!;
    const { container } = render(<MessageList {...props} messages={[first, reply]} />);
    const scroll = scroller(container);
    fireEvent.click(screen.getByRole("button", { name: "Jump to quote" }));
    expect(bubble.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(bubble.animate).toHaveBeenCalledOnce();
    grow(1400);
    expect(scroll.scrollTop).toBe(1000);
    fireEvent.scroll(scroll, { target: { scrollTop: 200 } });
    grow(1600);
    expect(scroll.scrollTop).toBe(200);
  });
});
