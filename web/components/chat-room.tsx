// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { ChevronDown, ChevronLeft, ChevronUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markConversationRead, markRead, useLastIncoming, useMessageContext, useMessages, useSendMessage, useTemplates, type Target } from "@/hooks/use-chat";
import { useServiceWindow } from "@/hooks/use-service-window";
import { useDecideMessage, useWaitingApprovals } from "@/hooks/use-message-approvals";
import { formatPhone, isAwaitingApproval, isOutgoing } from "@/lib/messages";
import type { MessageContent, MessageRow } from "@/lib/types";
import { PageHeader } from "./ui/page-header";
import { Avatar } from "./avatar";
import { Composer, MEDIA_KIND } from "./composer";
import { MediaPreview } from "./media-preview";
import { HighlightContext } from "./message-text";
import { MessageList } from "./message-list";
import type { BubbleApproval } from "./message-bubble";
import { templatePayload } from "./template-picker";
import { ConversationActions } from "./conversation-actions";

export interface ChatTarget extends Target {
  displayName: string;
  instanceName?: string;
}

export function ChatRoom({ target, focusMessage, onBack, onBackToRecent, agentId, agentName = "", archived = false, onToggleArchive, archiving }: { target: ChatTarget; focusMessage?: MessageRow | null; onBack?: () => void; onBackToRecent?: () => void; agentId?: string; agentName?: string; archived?: boolean; onToggleArchive?: () => void; archiving?: boolean }) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: recentMessages = [], isLoading } = useMessages(
    target.conversationIds ?? (target.conversationId ? [target.conversationId] : null),
  );
  const [showRecent, setShowRecent] = useState(false);
  useEffect(() => setShowRecent(false), [focusMessage?.id]);
  const context = useMessageContext(!showRecent && focusMessage && !recentMessages.some((m) => m.id === focusMessage.id) ? focusMessage : null, target.conversationIds ?? (target.conversationId ? [target.conversationId] : []));
  const messages = !showRecent && focusMessage && !recentMessages.some((m) => m.id === focusMessage.id) ? context.data ?? [focusMessage] : recentMessages;
  const templates = useTemplates(target.organizationId, target.organizationAddress);
  const send = useSendMessage(agentId, agentName);

  // Messages an API key is holding for a member to approve; the list names the key.
  const approvals = useWaitingApprovals(target.organizationId);
  const decide = useDecideMessage(target.organizationId);
  const approvalKeyNames = useMemo(() => new Map((approvals.data ?? []).map((a) => [a.message_id, a.api_key_name])), [approvals.data]);
  const approvalFor = (message: MessageRow): BubbleApproval | undefined => isOutgoing(message) && isAwaitingApproval(message.status) ? {
    keyName: approvalKeyNames.get(message.id),
    busy: decide.isPending,
    error: decide.error && decide.variables?.messageId === message.id ? decide.error.message : null,
    onApprove: () => decide.mutate({ messageId: message.id, decision: "approved" }),
    onReject: () => decide.mutate({ messageId: message.id, decision: "rejected" }),
  } : undefined;

  const incoming = useLastIncoming(target.conversationIds ?? (target.conversationId ? [target.conversationId] : null));
  const lastIncoming = useMemo(() => {
    const recent = [...messages].reverse().find((m) => m.sender_address !== null);
    return incoming.data && (!recent || incoming.data.timestamp > recent.timestamp) ? incoming.data : recent;
  }, [messages, incoming.data]);

  const windowState = useServiceWindow(lastIncoming?.timestamp);
  const open = windowState.open;

  // Blue ticks for the customer: the newest incoming message, once, while this
  // chat is actually on screen.
  useEffect(() => {
    if (!lastIncoming || lastIncoming.status?.read) return;
    const mark = () => document.visibilityState === "visible" && markRead(lastIncoming.id);
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [lastIncoming]);

  // "typing…": WhatsApp shows it for about 25 s, so one ping every 20 s while typing.
  const lastTypingRef = useRef(0);
  const onTyping = useCallback(() => {
    if (!open || !lastIncoming || Date.now() - lastTypingRef.current < 20_000) return;
    lastTypingRef.current = Date.now();
    markRead(lastIncoming.id, true);
  }, [open, lastIncoming]);
  /** A file waiting in the preview, and whether one is being dragged over the chat. */
  const [pending, setPending] = useState<{ file: File; kind: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The message being answered; its WhatsApp id goes out as the reply context. */
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);

  useEffect(() => { if (!open) { setPending(null); setReplyTo(null); setDragging(false); } }, [open]);

  // Search in this chat: matches newest first, as WhatsApp lists them.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const term = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (term.length < 2) return [];
    const bodyOf = (m: MessageRow) => {
      const c = m.content;
      if (c.kind === "template") {
        const name = ("data" in c ? (c.data as { name?: string }) : {})?.name;
        return templates.data?.find((t) => t.name === name)?.components.find((x) => x.type === "BODY")?.text ?? name ?? "";
      }
      return "text" in c && typeof c.text === "string" ? c.text : "";
    };
    return messages
      .filter((m) => m.content.kind !== "reaction" && bodyOf(m).toLowerCase().includes(term))
      .map((m) => m.id)
      .reverse();
  }, [messages, term, templates.data]);
  useEffect(() => setMatchIndex(0), [term]);
  const closeSearch = () => {
    setSearching(false);
    setQuery("");
  };
  const withReply = (content: MessageContent): MessageContent =>
    replyTo?.external_id ? ({ ...content, re_message_id: replyTo.external_id } as MessageContent) : content;
  const pick = (file: File) => {
    const kind = MEDIA_KIND(file.type || "application/octet-stream");
    // Audio files skip the preview: WhatsApp gives them no caption.
    if (kind === "audio") return dispatchFile(file, kind);
    setPending({ file, kind });
  };
  const last = messages[messages.length - 1];

  useEffect(() => {
    if (target.conversationId && last) markConversationRead(target.conversationId, last.timestamp);
  }, [target.conversationId, last]);

  const dispatch = (content: MessageContent, file?: File) => {
    send.mutate({ target, content: content.kind === "reaction" ? content : withReply(content), file });
    if (content.kind !== "reaction") setReplyTo(null);
  };
  const dispatchFile = (file: File, kind: string, extra?: { caption?: string; duration?: number }) =>
    dispatch(
      {
        type: "file",
        kind,
        file: { uri: "", mime_type: file.type, ...(extra?.duration ? { duration: extra.duration } : {}) },
        ...(extra?.caption ? { text: extra.caption } : {}),
      },
      file,
    );

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-chat"
      onDragOver={(e) => {
        // Media only inside the 24-hour window; outside it the composer offers templates.
        if (!open || pending || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (!open || !file) return;
        e.preventDefault();
        pick(file);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-surface/85">
          <p className="rounded-lg border-2 border-dashed border-accent px-10 py-8 text-lg text-heading">
            {t.chatRoom.dropTheFileToSend}
          </p>
        </div>
      )}
      <PageHeader className="z-10 h-[calc(56px+env(safe-area-inset-top))] min-h-[calc(56px+env(safe-area-inset-top))] gap-1 px-2 pt-[env(safe-area-inset-top)] md:h-[72px] md:min-h-[72px] md:gap-3 md:px-5 md:pt-0 [&_h1]:text-base md:[&_h1]:text-xl" title={target.displayName} subtitle={<span title={windowState.title}>{formatPhone(target.address)}{target.instanceName ? ` · ${target.instanceName}` : ""} · {windowState.text}</span>} titleId="conversation-title" leading={<>
        {onBack && <button type="button" onClick={onBack} aria-label={t.pageHeader.back} className="flex size-[44px] shrink-0 items-center justify-center rounded-full text-icon hover:bg-panel md:hidden"><ChevronLeft className="size-6" /></button>}
        <Avatar name={target.displayName} seed={target.address} size={40} />
      </>} aria-label={`${target.displayName} · ${formatPhone(target.address)}${target.instanceName ? ` · ${target.instanceName}` : ""} · ${windowState.text}`} actions={<>
        <button
          type="button"
          onClick={() => (searching ? closeSearch() : setSearching(true))}
          className={`${onToggleArchive ? "hidden md:flex" : "flex"} size-[44px] items-center justify-center rounded-full text-icon hover:bg-panel hover:text-heading md:size-10`}
          aria-label={t.chatRoom.searchThisChat}
          title={t.chatRoom.searchThisChat}
        >
          <Search className="size-5" />
        </button>
        {onToggleArchive && <ConversationActions archived={archived} onToggle={onToggleArchive} disabled={archiving} open={menuOpen} onOpenChange={setMenuOpen} onSearch={() => setSearching(true)} />}
      </>} />
      {searching && (
        <div className="z-10 flex items-center gap-2 border-t border-line bg-panel px-4 py-2">
          <Search className="size-4 shrink-0 text-icon" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
              if (e.key === "Enter" && matches.length) setMatchIndex((i) => (i + (e.shiftKey ? -1 : 1) + matches.length) % matches.length);
            }}
            placeholder={t.chatRoom.searchMessages}
            className="min-w-0 flex-1 bg-transparent text-[16px] md:text-sm text-heading outline-none placeholder:text-sub"
          />
          <span className="shrink-0 text-xs tabular-nums text-sub">
            {term.length < 2 ? "" : matches.length ? t.chatRoom.searchPosition(matchIndex + 1, matches.length) : t.chatRoom.noResults}
          </span>
          <button
            type="button"
            disabled={!matches.length}
            onClick={() => setMatchIndex((i) => (i + 1) % matches.length)}
            className="flex size-[44px] shrink-0 items-center justify-center text-icon hover:text-heading disabled:opacity-40 md:size-auto"
            aria-label={t.chatRoom.previousResult}
          >
            <ChevronUp className="size-5" />
          </button>
          <button
            type="button"
            disabled={!matches.length}
            onClick={() => setMatchIndex((i) => (i - 1 + matches.length) % matches.length)}
            className="flex size-[44px] shrink-0 items-center justify-center text-icon hover:text-heading disabled:opacity-40 md:size-auto"
            aria-label={t.chatRoom.nextResult}
          >
            <ChevronDown className="size-5" />
          </button>
          <button type="button" onClick={closeSearch} className="flex size-[44px] shrink-0 items-center justify-center text-icon hover:text-heading md:size-auto" aria-label={t.chatRoom.closeSearch}>
            <X className="size-5" />
          </button>
        </div>
      )}

      {focusMessage && !showRecent && <div className="flex items-center justify-between bg-panel px-4 py-2 text-xs text-sub"><span>{context.isError ? t.chatRoom.couldNotLoadTheMessageContext : t.chatRoom.messageOpenedFromTheMediaLibrary}</span>{context.isError && <button onClick={() => void context.refetch()}>{t.home.tryAgain}</button>}<button className="text-accent" onClick={() => { setShowRecent(true); onBackToRecent?.(); }}>{t.chatRoom.backToRecentMessages}</button></div>}
      {pending ? (
        <MediaPreview
          file={pending.file}
          kind={pending.kind}
          onCancel={() => setPending(null)}
          onSend={(caption) => {
            if (open) dispatchFile(pending.file, pending.kind, { caption });
            setPending(null);
          }}
        />
      ) : isLoading ? (
        <div className="chat-wallpaper flex-1" />
      ) : (
        <HighlightContext.Provider value={term.length >= 2 ? query.trim() : ""}>
        <MessageList
          key={target.conversationId ?? target.address}
          focusId={matches[matchIndex] ?? (!showRecent ? focusMessage?.id : null)}
          messages={messages}
          templates={templates.data}
          interactive={open}
          contactName={target.displayName}
          onReply={setReplyTo}
          approvalFor={approvalFor}
          onReact={(message, emoji) => {
            if (!message.external_id) return;
            // Choosing the reaction already there takes it back, as in WhatsApp.
            const mine = [...messages]
              .reverse()
              .find((m) => !m.sender_address && m.content.kind === "reaction" && m.content.re_message_id === message.external_id);
            const current = mine && "data" in mine.content ? (mine.content.data as { action?: string; unicode?: string }) : null;
            const removing = current?.action === "added" && current.unicode === emoji;
            dispatch({
              type: "data",
              kind: "reaction",
              re_message_id: message.external_id,
              data: removing ? { action: "removed" } : { action: "added", unicode: emoji, name: emoji },
            });
          }}
        />
        </HighlightContext.Provider>
      )}

      {send.error && (
        <div className="bg-red-50 px-4 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {send.error.message}
        </div>
      )}

      {!pending && <div className="shrink-0 pb-[env(safe-area-inset-bottom)] md:contents"><Composer
        agentName={agentName}
        windowOpen={open}
        onTyping={onTyping}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        contactName={target.displayName}
        templates={templates.data ?? []}
        templatesLoading={templates.isLoading}
        templatesError={templates.error?.message}
        sending={send.isPending}
        onSendText={(text) => dispatch({ type: "text", kind: "text", text })}
        onSendFile={dispatchFile}
        onPickFile={pick}
        onSendTemplate={(t) => dispatch({ type: "data", kind: "template", data: templatePayload(t) })}
      /></div>}
    </section>
  );
}
