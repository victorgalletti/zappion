// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { FileText, Image as ImageIcon, LayoutTemplate, Mic, Plus, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isOutgoing, preview } from "@/lib/messages";
import type { MessageRow, Template } from "@/lib/types";
import { usePreferences } from "@/lib/preferences";
import { signatureName } from "@/lib/signature";
import { cn } from "@/lib/utils";
import { AudioRecorder } from "./audio-recorder";
import { TemplatePicker, type TemplateSend } from "./template-picker";

export const MEDIA_KIND = (mime: string) =>
  mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";

export function Composer({
  agentName = "",
  windowOpen,
  onTyping,
  replyTo,
  onCancelReply,
  contactName,
  templates,
  templatesLoading,
  templatesError,
  sending,
  onSendText,
  onSendFile,
  onPickFile,
  onSendTemplate,
}: {
  agentName?: string;
  /** Inside the 24-hour customer service window: free text and media allowed. */
  windowOpen: boolean;
  /** Called on each keystroke; the chat throttles it into the customer's "typing…". */
  onTyping: () => void;
  /** The message being answered, shown above the field until sent or cancelled. */
  replyTo: MessageRow | null;
  onCancelReply: () => void;
  contactName: string;
  templates: Template[];
  templatesLoading: boolean;
  templatesError?: string | null;
  sending: boolean;
  onSendText: (text: string) => void;
  onSendFile: (file: File, kind: string, extra?: { caption?: string; duration?: number }) => void;
  /** A photo, video or document chosen, pasted or dropped: it goes to the preview first. */
  onPickFile: (file: File) => void;
  onSendTemplate: (t: TemplateSend) => void;
}) {
  const t = useT();
  const { preferences } = usePreferences();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [picker, setPicker] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  // Grow the textarea with its content, up to six lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (!value || sending) return;
    onSendText(value);
    setText("");
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setAttachMenu(false);
    if (file) onPickFile(file);
  };

  if (!windowOpen) {
    return (
      <footer className="relative mx-3 mb-3 mt-2 flex min-h-[62px] items-center gap-3 rounded-2xl bg-input px-4 py-3">
        {picker && (
          <TemplatePicker
            templates={templates}
            loading={templatesLoading}
            error={templatesError}
            onClose={() => setPicker(false)}
            onSend={(t) => {
              setPicker(false);
              onSendTemplate(t);
            }}
          />
        )}
        <p className="flex-1 text-sm text-sub">
          {t.composer.windowClosed} <strong>{t.composer.approvedTemplate}</strong>.
        </p>
        <button
          type="button"
          onClick={() => setPicker((v) => !v)}
          className="flex min-h-[44px] items-center gap-2 rounded-full bg-accent md:min-h-0 px-4 py-2 text-sm font-medium text-white"
        >
          <LayoutTemplate className="size-4" /> {t.composer.templates}
        </button>
      </footer>
    );
  }

  return (
    <>
    {replyTo && (
      <div className="flex items-center gap-3 bg-panel px-4 pt-2.5">
        <div className="min-w-0 flex-1 overflow-hidden rounded-md border-l-4 border-accent bg-black/5 px-3 py-1.5 dark:bg-white/5">
          <span className="block text-xs font-medium text-accent">{isOutgoing(replyTo) ? t.composer.you : contactName}</span>
          <span className="block truncate text-sm text-sub">{preview(replyTo).text}</span>
        </div>
        <button type="button" onClick={onCancelReply} className="flex size-[44px] shrink-0 items-center justify-center text-icon hover:text-heading md:size-auto" aria-label={t.composer.cancelReply}>
          <X className="size-5" />
        </button>
      </div>
    )}
    {preferences.signatureEnabled && !recording && <p className="mx-6 mt-2 text-xs text-sub">{t.composer.signingAs} <strong>{signatureName(preferences, agentName)}</strong></p>}
    <footer className="relative mx-3 mb-3 mt-2 flex min-h-[52px] items-end gap-1 rounded-[26px] bg-input px-2 py-1.5">
      {picker && (
        <TemplatePicker
          templates={templates}
          loading={templatesLoading}
          error={templatesError}
          onClose={() => setPicker(false)}
          onSend={(t) => {
            setPicker(false);
            onSendTemplate(t);
          }}
        />
      )}
      {recording ? (
        <AudioRecorder
          onCancel={() => setRecording(false)}
          onComplete={(file, seconds) => {
            setRecording(false);
            onSendFile(file, "audio", { duration: seconds });
          }}
        />
      ) : (
        <>
          <button type="button" onClick={() => setPicker((v) => !v)} className="flex size-[44px] md:size-[42px] shrink-0 items-center justify-center text-icon hover:text-heading" title={t.composer.messageTemplates}>
            <LayoutTemplate className="size-6" />
          </button>
          <div className="relative">
            <button type="button" onClick={() => setAttachMenu((v) => !v)} className={cn("flex size-[44px] md:size-[42px] shrink-0 items-center justify-center text-icon hover:text-heading", attachMenu && "text-heading")} title={t.composer.attach}>
              <Plus className="size-6" />
            </button>
            {attachMenu && (
              <div className="absolute bottom-full left-0 z-30 mb-3 w-44 overflow-hidden rounded-lg bg-menu py-1.5 shadow-[0_2px_5px_0_#00000042,0_2px_10px_0_rgba(0,0,0,0.16)]">
                <button type="button" onClick={() => imageRef.current?.click()} className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 md:min-h-0 text-sm text-heading hover:bg-panel">
                  <ImageIcon className="size-5 text-[#bf59cf]" /> {t.composer.photosAndVideos}
                </button>
                <button type="button" onClick={() => docRef.current?.click()} className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 md:min-h-0 text-sm text-heading hover:bg-panel">
                  <FileText className="size-5 text-[#7f66ff]" /> {t.messages.document}
                </button>
              </div>
            )}
            <input ref={imageRef} type="file" accept="image/jpeg,image/png,video/mp4,video/3gpp" hidden onChange={pickFile} />
            <input ref={docRef} type="file" hidden onChange={pickFile} />
          </div>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim()) onTyping();
            }}
            onPaste={(e) => {
              const file = [...e.clipboardData.files][0];
              if (file) {
                e.preventDefault();
                onPickFile(file);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && !e.shiftKey && (preferences.enterToSend || e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
            aria-label={t.composer.typeAMessage}
            placeholder={t.composer.typeAMessage}
            className="thin-scroll max-h-[120px] min-h-[44px] min-w-0 flex-1 md:min-h-[42px] resize-none rounded-lg bg-transparent px-1 py-2.5 text-[16px] md:text-[0.95rem] leading-[1.375rem] text-heading outline-none placeholder:text-sub"
          />
          {text.trim() ? (
            <button type="button" onClick={submit} disabled={sending} className="flex size-[44px] md:size-[42px] shrink-0 items-center justify-center text-icon hover:text-heading" title={t.composer.send}>
              <Send className="size-6" />
            </button>
          ) : (
            <button type="button" onClick={() => setRecording(true)} className="flex size-[44px] md:size-[42px] shrink-0 items-center justify-center text-icon hover:text-heading" title={t.composer.recordAudio}>
              <Mic className="size-6" />
            </button>
          )}
        </>
      )}
    </footer>
    </>
  );
}
