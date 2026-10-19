// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, MoreHorizontal, X } from "lucide-react";
import { useT } from "@/lib/i18n";

export function CopyValue({ title, value, secret = false, showLabel, hideLabel }: { title: string; value: string; secret?: boolean; showLabel?: string; hideLabel?: string }) {
  const t = useT().integrations;
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  return <div className="min-w-0 space-y-2">
    <div className="relative rounded-xl border border-line bg-input">
      {secret ? <input readOnly aria-label={title} type={revealed ? "text" : "password"} value={value} className="w-full rounded-xl bg-input p-4 pr-14 font-mono text-xs outline-none" /> : <pre aria-label={title} className="max-h-80 overflow-y-auto whitespace-pre-wrap break-all p-4 pr-14 font-mono text-xs leading-6 text-heading">{value}</pre>}
      <button type="button" className="absolute right-2 top-2 rounded-lg p-2 text-sub hover:bg-panel focus-visible:outline-accent" aria-label={`${t.copy}: ${title}`} onClick={async () => {
        try { await navigator.clipboard.writeText(value); setFailed(false); setStatus(t.copied); }
        catch { setFailed(true); setStatus(t.copyError); }
      }}>{status && !failed ? <Check aria-hidden="true" className="size-4 text-accent" /> : <Copy aria-hidden="true" className="size-4" />}</button>
    </div>
    {secret && <button type="button" className="text-xs text-accent" aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? hideLabel : showLabel}</button>}
    {status && <span role={failed ? "alert" : "status"} className="text-xs text-sub">{status}</span>}
  </div>;
}

export function Modal({ title, onClose, children, compact = false }: { title: string; onClose: () => void; children: ReactNode; compact?: boolean }) {
  const t = useT().integrations;
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  // Refocus the dialog when a wizard step replaces its focused control.
  useEffect(() => { if (document.activeElement === document.body) ref.current?.focus(); });
  return createPortal(<div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3 sm:p-6">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`thin-scroll max-h-[90dvh] w-full ${compact ? "max-w-md" : "max-w-2xl"} overflow-y-auto rounded-2xl border border-line bg-surface text-heading shadow-2xl outline-none`} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? [])];
        const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4"><h3 id={titleId} className="font-semibold">{title}</h3><button type="button" className="rounded-lg p-2 text-sub hover:bg-panel" aria-label={t.close} onClick={onClose}><X className="size-4" /></button></div>
      <div className="space-y-5 p-5">{children}</div>
    </div>
  </div>, document.body);
}

export function Badge({ children, subdued = false, danger = false }: { children: ReactNode; subdued?: boolean; danger?: boolean }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${subdued ? "bg-panel text-sub" : danger ? "bg-danger/10 text-danger" : "bg-accent/10 text-accent"}`}>{children}</span>;
}

export function RowMenu({ label, disabled, items }: { label: string; disabled: boolean; items: { label: string; action?: () => void; tone?: "neutral" }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={ref} className="relative inline-block" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={e => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} type="button" disabled={disabled} aria-label={label} aria-expanded={open} className="rounded-lg p-2 text-sub hover:bg-panel" onClick={() => setOpen(!open)}><MoreHorizontal className="size-4" /></button>
    {open && <div className="absolute right-0 z-10 mt-1 min-w-32 rounded-xl border border-line bg-menu p-1 shadow-lg">{items.filter(item => item.action).map((item, index) => <button key={item.label} autoFocus={index === 0} type="button" className={`w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ${item.tone === "neutral" ? "text-heading" : "text-danger"} hover:bg-panel`} onClick={() => { setOpen(false); trigger.current?.focus(); item.action?.(); }}>{item.label}</button>)}</div>}
  </div>;
}

