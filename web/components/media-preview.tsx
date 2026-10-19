// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT, getLocale } from "@/lib/i18n";

import { PageHeader } from "./ui/page-header";

import { FileText, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString(getLocale().locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} MB`;
}

/** WhatsApp's own limits; the Zappion API rejects anything above them at dispatch. */
const LIMITS: Record<string, number> = {
  image: 5 * 1000 * 1000,
  video: 16 * 1000 * 1000,
  document: 100 * 1000 * 1000,
};

/**
 * Replaces the chat while a file waits to be sent, as WhatsApp Web does: see
 * it, add a caption, send or discard.
 */
export function MediaPreview({
  file,
  kind,
  onSend,
  onCancel,
}: {
  file: File;
  kind: string;
  onSend: (caption: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [caption, setCaption] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const url = useMemo(() => (kind === "image" || kind === "video" ? URL.createObjectURL(file) : null), [file, kind]);
  const tooBig = file.size > (LIMITS[kind] ?? Infinity);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const send = () => !tooBig && onSend(caption.trim());

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-unselected">
      <PageHeader title={file.name} actions={<button type="button" onClick={onCancel} className="flex size-10 items-center justify-center rounded-full text-icon hover:bg-panel hover:text-heading" aria-label={t.audioRecorder.discard}><X className="size-6" /></button>} />

      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        {kind === "image" && url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.name} className="max-h-full max-w-full rounded-md object-contain shadow-lg" />
        )}
        {kind === "video" && url && <video src={url} controls className="max-h-full max-w-full rounded-md shadow-lg" />}
        {kind === "document" && (
          <div className="flex flex-col items-center gap-3 text-center">
            <FileText className="size-24 text-sub" strokeWidth={1} />
            <p className="max-w-sm truncate text-heading">{file.name}</p>
            <p className="text-sm text-sub">{formatSize(file.size)} · {file.type || t.mediaPreview.file}</p>
          </div>
        )}
      </div>

      {tooBig && (
        <p className="px-4 pb-2 text-center text-sm text-danger">
          {t.mediaPreview.fileTooLarge(formatSize(file.size), formatSize(LIMITS[kind]))}
        </p>
      )}

      <footer className="flex items-center gap-3 bg-panel px-4 py-3">
        <input
          ref={inputRef}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={t.mediaPreview.addACaption}
          className="h-11 flex-1 rounded-lg bg-input px-3 text-[0.95rem] text-heading outline-none placeholder:text-sub"
        />
        <button
          type="button"
          onClick={send}
          disabled={tooBig}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow disabled:opacity-50"
          aria-label={t.composer.send}
        >
          <Send className="size-5" />
        </button>
      </footer>
    </div>
  );
}
