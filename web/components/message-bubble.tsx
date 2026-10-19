// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT, getLocale } from "@/lib/i18n";

import { ChevronDown, Download, LayoutTemplate, MapPin, Play, Reply, User, Video } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useMediaUrl } from "@/hooks/use-chat";
import { fileOf, isAwaitingApproval, isOutgoing, preview, storagePath } from "@/lib/messages";
import type { FileInfo, MessageRow, Template } from "@/lib/types";
import { cn, timeOf } from "@/lib/utils";
import { DeliveryStatus } from "./delivery-status";
import { MessageText } from "./message-text";
import { isVoiceNote, VoiceMessagePlayer } from "./voice-message-player";

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString(getLocale().locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} MB`;
}

function isVisualMedia(message: MessageRow) {
  return message.content.kind === "image" || message.content.kind === "video";
}

function isFramedMedia(message: MessageRow) {
  return !!fileOf(message.content) && message.content.kind !== "audio" && message.content.kind !== "sticker";
}

export function fileTypeOf(file: FileInfo) {
  const subtype = file.mime_type?.split(";")[0].trim().toLowerCase().split("/")[1] ?? "";
  const extensions: Record<string, string> = {
    msword: "doc",
    "vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "vnd.oasis.opendocument.text": "odt",
    plain: "txt",
    "vnd.ms-excel": "xls",
    "vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "vnd.oasis.opendocument.spreadsheet": "ods",
    "vnd.ms-powerpoint": "ppt",
    "vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  };
  const ext = file.name?.trim().match(/\.([^.\s]+)$/)?.[1].toLowerCase() || extensions[subtype] || subtype;
  const color = ext === "pdf" ? "#e53935"
    : ["doc", "docx", "odt", "rtf", "txt"].includes(ext) ? "#1e88e5"
    : ["xls", "xlsx", "csv", "ods"].includes(ext) ? "#43a047"
    : ["ppt", "pptx"].includes(ext) ? "#fb8c00"
    : "#8696a0";
  return { ext, color };
}

function FileBadge({ file, large = false }: { file: FileInfo; large?: boolean }) {
  const { ext, color } = fileTypeOf(file);
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: color }}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] px-0.5 font-bold text-white",
        large ? "h-16 w-[52px] text-xs" : "h-8 w-[26px] text-[7px] leading-none",
      )}
    >
      <span className="truncate">{ext.toUpperCase()}</span>
    </span>
  );
}

function Media({ message, file, time }: { message: MessageRow; file: FileInfo; time?: ReactNode }) {
  const t = useT();
  const path = storagePath(file.uri);
  const { data: url, isLoading } = useMediaUrl(path);
  const kind = message.content.kind;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const loading = !path || isLoading || !url;

  if (isVisualMedia(message)) {
    return (
      <div className="relative overflow-hidden rounded-[5px]">
        {loading ? (
          <div className="flex h-[200px] w-full items-center justify-center gap-2 bg-black/10 text-sm text-sub dark:bg-white/10">
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {t.messageBubble.loadingMedia}
          </div>
        ) : kind === "image" ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={file.name ?? t.mediaLibrary.image} className="max-h-80 w-full rounded-[5px] object-cover" />
          </a>
        ) : (
          <>
            <video
              ref={videoRef}
              src={`${url}#t=0.1`}
              preload="metadata"
              controls={playing}
              playsInline
              onLoadedMetadata={(event) => {
                const seconds = event.currentTarget.duration;
                if (Number.isFinite(seconds)) setDuration(Math.floor(seconds));
              }}
              onPlay={() => setPlaying(true)}
              className="block max-h-80 w-full rounded-[5px] object-cover"
            />
            {!playing && (
              <button
                type="button"
                aria-label={t.messageBubble.playVideo}
                onClick={() => {
                  setPlaying(true);
                  if (videoRef.current) {
                    videoRef.current.controls = true;
                    void videoRef.current.play().catch(() => setPlaying(false));
                  }
                }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-black/45 text-white">
                  <Play className="ml-1 size-7 fill-current" />
                </span>
              </button>
            )}
          </>
        )}
        {!playing && (time || (!loading && kind === "video")) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex min-h-10 items-end gap-2 bg-gradient-to-t from-black/50 to-transparent px-1.5 pb-1 text-white [text-shadow:0_1px_2px_rgb(0_0_0/60%)] [&_.text-sub]:text-white">
            {!loading && kind === "video" && (
              <span className="flex items-center gap-1 text-[0.68rem] font-medium">
                <Video className="size-3" />
                {duration !== null && `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`}
              </span>
            )}
            {time && <span className="ml-auto">{time}</span>}
          </div>
        )}
      </div>
    );
  }

  // Incoming media is fetched from Meta by the Zappion API's preprocessor; until it
  // lands in storage the uri is still Meta's id.
  if (loading) {
    return (
      <div className={cn(
        "flex h-12 min-w-48 items-center gap-2 text-sm text-sub",
        isFramedMedia(message) && "rounded-[5px] bg-black/5 p-2.5 dark:bg-white/5",
      )}>
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        {kind === "audio" ? t.messageBubble.loadingAudio : t.messageBubble.loadingMedia}
        {kind === "audio" && <span className="ml-auto">{time}</span>}
      </div>
    );
  }

  switch (kind) {
    case "audio":
      return (
        <VoiceMessagePlayer src={url} messageId={message.id} variant={isVoiceNote(file) ? "voice" : "file"} time={time} />
      );
    case "sticker":
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={file.name ?? t.mediaLibrary.image}
            className="max-h-40 w-auto rounded-md object-cover"
          />
        </a>
      );
    default: {
      const { ext } = fileTypeOf(file);
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          download={file.name}
          className="block overflow-hidden rounded-[5px]"
        >
          {ext === "pdf" ? (
            <div className="h-[150px] overflow-hidden rounded-t-[5px] bg-white">
              <iframe
                src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                loading="lazy"
                title={file.name ?? t.messages.document}
                tabIndex={-1}
                className="pointer-events-none block h-[450px] w-full border-0"
              />
            </div>
          ) : (
            <div className="flex h-[100px] items-center justify-center rounded-t-[5px] bg-black/5 dark:bg-white/5">
              <FileBadge file={file} large />
            </div>
          )}
          <div className="flex items-center gap-3 rounded-[5px] bg-black/5 p-2.5 dark:bg-white/5">
            <FileBadge file={file} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{file.name ?? t.messages.document}</span>
              <span className="block truncate text-xs text-sub">{[formatSize(file.size), ext].filter(Boolean).join(" • ")}</span>
            </span>
            <Download className="size-4 shrink-0 text-sub" />
          </div>
        </a>
      );
    }
  }
}

function TemplateBody({ name, templates }: { name: string; templates?: Template[] }) {
  const t = useT();
  const template = templates?.find((t) => t.name === name);
  const header = template?.components.find((c) => c.type === "HEADER")?.text;
  const body = template?.components.find((c) => c.type === "BODY")?.text;
  const footer = template?.components.find((c) => c.type === "FOOTER")?.text;
  const buttons = template?.components.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  if (!template)
    return (
      <span className="flex items-center gap-1.5">
        <LayoutTemplate className="size-4 shrink-0 text-sub" />
        {t.messages.template} <strong>{name}</strong>
      </span>
    );
  return (
    <div>
      {header && <div className="mb-1 font-semibold">{header}</div>}
      {body && <MessageText text={body} />}
      {footer && <div className="mt-1 text-xs text-sub">{footer}</div>}
      {buttons.length > 0 && (
        <div className="mt-2 -mx-2 -mb-1 border-t border-black/10 dark:border-white/10">
          {buttons.map((b) => (
            <div key={b.text} className="py-2 text-center text-sm text-read">
              {b.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Body({ message, templates, time }: { message: MessageRow; templates?: Template[]; time?: ReactNode }) {
  const t = useT();
  const c = message.content;
  const file = fileOf(c);
  if (file) {
    const caption = "text" in c && typeof c.text === "string" ? c.text : "";
    if (isFramedMedia(message)) {
      return (
        <div className="w-[330px] max-w-full">
          <Media key={message.id} message={message} file={file} time={!caption && isVisualMedia(message) ? time : undefined} />
          {caption && (
            <div className="flex flex-wrap items-end gap-x-2 px-[6px] pt-1 pb-0.5">
              <div className="max-w-full min-w-0">
                <MessageText text={caption} markdown />
              </div>
              <span className="ml-auto shrink-0 text-sub">{time}</span>
            </div>
          )}
          {!caption && !isVisualMedia(message) && (
            <div className="flex justify-end px-[6px] pt-1 pb-0.5 text-sub">{time}</div>
          )}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <Media message={message} file={file} time={c.kind === "audio" ? time : undefined} />
        {caption && <MessageText text={caption} markdown />}
      </div>
    );
  }
  if (c.kind === "template") {
    const data = ("data" in c ? c.data : {}) as { name?: string };
    return <TemplateBody name={data?.name ?? ""} templates={templates} />;
  }
  if (c.kind === "location") {
    const data = ("data" in c ? c.data : {}) as { latitude?: number; longitude?: number; name?: string; address?: string };
    const href = `https://maps.google.com/?q=${data.latitude},${data.longitude}`;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-read">
        <MapPin className="size-4" /> {data.name ?? data.address ?? t.messages.location}
      </a>
    );
  }
  if (c.kind === "contacts") {
    const list = ("data" in c ? c.data : []) as { name?: { formatted_name?: string } }[];
    return (
      <div className="flex items-center gap-2">
        <User className="size-4 text-sub" />
        {list.map((x) => x.name?.formatted_name).filter(Boolean).join(", ") || t.messages.contact}
      </div>
    );
  }
  const text = "text" in c && typeof c.text === "string" ? c.text : `[${c.kind}]`;
  return <MessageText text={text} markdown />;
}

/** Approve / reject controls for an outgoing message an API key is holding for approval. */
export interface BubbleApproval {
  /** The API key that sent it, once the approval row is loaded. */
  keyName?: string | null;
  /** A decision is in flight: both buttons are disabled. */
  busy: boolean;
  /** The last decision on this message failed with this message. */
  error?: string | null;
  onApprove: () => void;
  onReject: () => void;
}

function ApprovalBar({ approval, framed }: { approval?: BubbleApproval; framed: boolean }) {
  const t = useT();
  const label = t.messageBubble.waitingForApproval(approval?.keyName);
  const button = "rounded-full px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div role="group" aria-label={label} className={cn("mt-1.5 border-t border-dashed border-black/15 pt-1.5 dark:border-white/15", framed && "mx-[6px] mb-1")}>
      <p className="text-xs text-sub">{label}</p>
      {approval && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button type="button" disabled={approval.busy} onClick={approval.onApprove} className={cn(button, "bg-accent text-white hover:brightness-110")}>
            {t.messageBubble.approve}
          </button>
          <button type="button" disabled={approval.busy} onClick={approval.onReject} className={cn(button, "border border-line text-heading hover:bg-panel")}>
            {t.messageBubble.reject}
          </button>
        </div>
      )}
      {approval?.error && <p role="alert" className="mt-1.5 text-xs text-danger">{approval.error}</p>}
    </div>
  );
}

/** The reactions WhatsApp Web offers first. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function Quote({ quoted, contactName, onJump }: { quoted: MessageRow; contactName: string; onJump: () => void }) {
  const t = useT();
  const line = preview(quoted);
  return (
    <button
      type="button"
      onClick={onJump}
      className="mb-1 block w-full overflow-hidden rounded-md border-l-4 border-accent bg-black/5 px-2 py-1 text-left dark:bg-white/5"
    >
      <span className="block text-xs font-medium text-accent">{isOutgoing(quoted) ? t.composer.you : contactName}</span>
      <span className="line-clamp-2 text-xs text-sub">{line.text}</span>
    </button>
  );
}

export function MessageBubble({
  message,
  tail,
  templates,
  quoted,
  reactions,
  interactive,
  onReply,
  onReact,
  onJump,
  contactName,
  approval,
}: {
  message: MessageRow;
  /** How the quote names the other side. */
  contactName: string;
  /** First bubble of a run from the same side gets the WhatsApp tail. */
  tail: boolean;
  templates?: Template[];
  /** The message this one replies to, when it is loaded. */
  quoted?: MessageRow;
  /** Current reactions to this message, one per person. */
  reactions?: string[];
  /** Replies and reactions are free-form messages: only inside the 24-hour window. */
  interactive: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onJump: (externalId: string) => void;
  /** Controls for a message waiting for approval; ignored for any other message. */
  approval?: BubbleApproval;
}) {
  const t = useT();
  const out = isOutgoing(message);
  const visual = isVisualMedia(message);
  const framed = isFramedMedia(message);
  const awaiting = out && isAwaitingApproval(message.status);
  const time = (
    <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[0.68rem] font-medium">
      {timeOf(message.timestamp)}
      {out && <DeliveryStatus status={message.status} />}
    </span>
  );
  const [menu, setMenu] = useState(false);
  // Only messages WhatsApp has acknowledged have the id a reply or reaction points to.
  const canInteract = interactive && !!message.external_id;
  return (
    <div
      data-external-id={message.external_id ?? undefined}
      data-message-id={message.id}
      data-awaiting-approval={awaiting || undefined}
      onMouseLeave={() => setMenu(false)}
      className={cn(
        "group relative mb-0.5 w-fit max-w-[95%] rounded-[7.5px] text-[0.95rem] leading-[21px] text-bubble shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] transition-[background-color] lg:max-w-[75%] xl:max-w-[min(65%,65ch)]",
        framed ? "p-[3px]" : "px-[9px] pt-1.5 pb-1",
        out ? "self-end bg-sent" : "self-start bg-received",
        tail && (out ? "bubble-tail-out rounded-tr-none" : "bubble-tail-in rounded-tl-none"),
        tail && "mt-2",
        reactions?.length && "mb-4",
        // Not sent yet: a dashed outline sets it apart from delivered messages.
        awaiting && "outline-1 outline-dashed outline-icon/60",
      )}
    >
      {canInteract && (
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-label={t.messageBubble.messageOptions}
          className={cn(
            "absolute top-1 right-1 z-10 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
            visual ? "bg-black/45 text-white" : cn("text-sub", out ? "bg-sent" : "bg-received"),
            menu && "opacity-100",
          )}
        >
          <ChevronDown className="size-4" />
        </button>
      )}
      {menu && (
        <div
          className={cn(
            "absolute top-7 z-30 w-52 overflow-hidden rounded-lg bg-menu py-1 shadow-[0_2px_5px_0_#00000042,0_2px_10px_0_rgba(0,0,0,0.16)]",
            out ? "right-0" : "left-0",
          )}
        >
          <div className="flex justify-between px-2 pb-1">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setMenu(false);
                  onReact(emoji);
                }}
                className="rounded-full p-1 text-lg leading-none hover:bg-panel"
                aria-label={t.messageBubble.reactWith(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              onReply();
            }}
            className="flex w-full items-center gap-3 px-4 py-2 text-sm text-heading hover:bg-panel"
          >
            <Reply className="size-4 text-icon" /> {t.messageBubble.reply}
          </button>
        </div>
      )}

      {quoted && (
        <div className={cn(framed && "mx-1 mt-1")}>
          <Quote quoted={quoted} contactName={contactName} onJump={() => quoted.external_id && onJump(quoted.external_id)} />
        </div>
      )}

      {framed || message.content.kind === "audio" ? (
        <Body message={message} templates={templates} time={time} />
      ) : (
        /* The time sits beside the last line when it fits and drops below when it does not. */
        <div className="flex flex-wrap items-end gap-x-2">
          <div className="max-w-full min-w-0">
            <Body message={message} templates={templates} />
          </div>
          <span className="mt-0.5 ml-auto flex shrink-0 translate-y-0.5 items-center gap-1 text-[0.68rem] font-medium text-sub">
            {timeOf(message.timestamp)}
            {out && <DeliveryStatus status={message.status} />}
          </span>
        </div>
      )}

      {awaiting && <ApprovalBar approval={approval} framed={framed} />}

      {!!reactions?.length && (
        <span
          className={cn(
            "absolute -bottom-3.5 flex items-center gap-0.5 rounded-full bg-received px-1.5 py-0.5 text-sm leading-none shadow-[0_1px_2px_rgba(11,20,26,0.2)]",
            out ? "right-2" : "left-2",
          )}
        >
          {[...new Set(reactions)].slice(0, 3).join("")}
          {reactions.length > 1 && <span className="ml-0.5 text-[0.7rem] text-sub">{reactions.length}</span>}
        </span>
      )}
    </div>
  );
}
