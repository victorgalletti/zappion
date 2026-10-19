// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel, pending = false, error, tone = "danger" }: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  error?: string | null;
  tone?: "danger" | "primary";
}) {
  const t = useT().confirmDialog;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const siblings = [...document.body.children].filter(element => element !== root.current) as HTMLElement[];
    const previous = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    document.body.style.overflow = "hidden";
    cancel.current?.focus();
    const trap = (event: FocusEvent) => {
      if (!panel.current?.contains(event.target as Node)) cancel.current?.focus();
    };
    document.addEventListener("focusin", trap);
    return () => {
      document.removeEventListener("focusin", trap);
      siblings.forEach((element, index) => { element.inert = previous[index]; });
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  const button = "rounded-xl border border-line px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
  return createPortal(<div ref={root} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={event => { if (event.target === event.currentTarget && !pending) onCancel(); }}>
    <div ref={panel} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 text-heading shadow-2xl" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); if (!pending) onCancel(); }
      if (event.key === "Tab") {
        const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
        const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <h3 id={`${id}-title`} className="font-semibold">{title}</h3>
      <p id={`${id}-description`} className="mt-3 text-sm leading-6 text-sub">{description}</p>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancel} type="button" className={`${button} hover:bg-panel`} onClick={() => { if (!pending) onCancel(); }} aria-disabled={pending}>{t.cancel}</button>
        <button type="button" disabled={pending} aria-busy={pending} className={`${button} border-transparent text-white hover:brightness-110 ${tone === "danger" ? "bg-danger" : "bg-accent"}`} onClick={onConfirm}>{pending ? t.pending : confirmLabel}</button>
      </div>
    </div>
  </div>, document.body);
}
