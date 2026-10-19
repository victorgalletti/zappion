// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { ChevronDown, Lock } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isOutgoing, isRenderable } from "@/lib/messages";
import type { MessageRow, Template } from "@/lib/types";
import { dayLabel } from "@/lib/utils";
import { MessageBubble, type BubbleApproval } from "./message-bubble";

type DayGroup = {
  key: string;
  label: string;
  items: { key: string; message: MessageRow; tail: boolean }[];
};

export function MessageList({
  messages,
  templates,
  interactive,
  onReply,
  onReact,
  contactName,
  focusId,
  approvalFor,
}: {
  messages: MessageRow[];
  /** A message to bring into view (the current search result). */
  focusId?: string | null;
  contactName: string;
  templates?: Template[];
  interactive: boolean;
  onReply: (message: MessageRow) => void;
  onReact: (message: MessageRow, emoji: string) => void;
  /** Approve / reject controls for a message waiting for approval. */
  approvalFor?: (message: MessageRow) => BubbleApproval | undefined;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  // Replies point at WhatsApp's id (external_id); reactions are their own rows,
  // and the latest one per person wins (an empty one removes it).
  const { byExternalId, reactions } = useMemo(() => {
    const byExternalId = new Map<string, MessageRow>();
    const latest = new Map<string, Map<string, string>>();
    for (const m of messages) {
      if (m.external_id) byExternalId.set(m.external_id, m);
      const c = m.content;
      if (c.kind !== "reaction" || !c.re_message_id) continue;
      const data = ("data" in c ? c.data : null) as { action?: string; unicode?: string } | null;
      const who = m.sender_address ?? "me";
      const forTarget = latest.get(c.re_message_id) ?? new Map<string, string>();
      if (data?.action === "removed" || !data?.unicode) forTarget.delete(who);
      else forTarget.set(who, data.unicode);
      latest.set(c.re_message_id, forTarget);
    }
    const reactions = new Map<string, string[]>();
    for (const [id, people] of latest) if (people.size) reactions.set(id, [...people.values()]);
    return { byExternalId, reactions };
  }, [messages]);

  const jump = (externalId: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-external-id="${CSS.escape(externalId)}"]`);
    if (!el) return;
    atBottomRef.current = false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate([{ filter: "brightness(0.85)" }, { filter: "none" }], { duration: 1200, easing: "ease-out" });
  };

  const days = useMemo<DayGroup[]>(() => {
    const out: DayGroup[] = [];
    let lastDay = "";
    let lastSide: boolean | null = null;
    for (const m of messages) {
      if (!isRenderable(m)) continue;
      const day = dayLabel(m.timestamp);
      if (day !== lastDay) {
        out.push({ key: `day-${m.timestamp}`, label: day, items: [] });
        lastDay = day;
        lastSide = null;
      }
      const side = isOutgoing(m);
      out[out.length - 1].items.push({ key: m.id, message: m, tail: side !== lastSide });
      lastSide = side;
    }
    return out;
  }, [messages, t]);

  // Pause following before a search jump or any resize notification can run.
  useLayoutEffect(() => {
    if (focusId) atBottomRef.current = false;
  }, [focusId]);

  // Follow new messages only when already at the bottom, like WhatsApp.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [days]);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!focusId) return;
    atBottomRef.current = false;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(focusId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, messages]);

  return (
    <div className="chat-wallpaper relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          atBottomRef.current = bottom;
          setAtBottom(bottom);
        }}
        className="thin-scroll relative z-[1] flex h-full flex-col overflow-x-hidden overflow-y-auto px-4 pt-4 pb-6 md:px-6"
      >
        <div ref={contentRef} className="flex shrink-0 flex-col">
          <p className="mx-auto mb-3 flex max-w-md items-center gap-1.5 rounded-md bg-notice px-2.5 py-1.5 text-center text-[0.77rem] leading-5 text-notice-text shadow-sm">
            <Lock className="size-3 shrink-0" />
            {t.messageList.apiNotice}
          </p>
          {days.map((day) => (
            <section key={day.key} className="flex shrink-0 flex-col">
              <div className="sticky top-1 z-10 my-2.5 text-center">
                <span className="inline-block rounded-md bg-date px-2.5 py-1.5 text-xs text-date-text uppercase shadow-sm">
                  {day.label}
                </span>
              </div>
              {day.items.map((item) => (
                <MessageBubble
                  key={item.key}
                  message={item.message}
                  tail={item.tail}
                  templates={templates}
                  quoted={item.message.content.re_message_id ? byExternalId.get(item.message.content.re_message_id) : undefined}
                  reactions={item.message.external_id ? reactions.get(item.message.external_id) : undefined}
                  interactive={interactive}
                  onReply={() => onReply(item.message)}
                  onReact={(emoji) => onReact(item.message, emoji)}
                  onJump={jump}
                  contactName={contactName}
                  approval={approvalFor?.(item.message)}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}
          className="absolute right-5 bottom-4 z-10 flex size-10 items-center justify-center rounded-full bg-surface text-icon shadow-md"
          aria-label={t.messageList.scrollToBottom}
        >
          <ChevronDown className="size-6" />
        </button>
      )}
    </div>
  );
}
