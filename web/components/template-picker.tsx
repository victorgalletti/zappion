// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
import { ArrowLeft, Search, Send, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Template } from "@/lib/types";
import { KIND_LABELS, inferKind } from "@/lib/templates/catalog";
import { buildSendPayload, sendFields, validateSend } from "@/lib/templates/send";
import type { SendValues, TemplateSendPayload } from "@/lib/templates/types";
import { TemplatePreview } from "./template-preview";

export type TemplateSend = TemplateSendPayload;
/** The Zappion API passes the complete Graph template through content.data. */
export function templatePayload(t: TemplateSend) { return { ...t }; }

export function TemplatePicker({ templates, loading, error, onSend, onClose }: {
  templates: Template[]; loading: boolean; error?: string | null; onSend: (t: TemplateSend) => void; onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Template | null>(null);
  const [values, setValues] = useState<SendValues>({});
  const [attempted, setAttempted] = useState(false);
  const approved = useMemo(() => templates.filter(t => t.status === "APPROVED" && t.name.toLowerCase().includes(query.toLowerCase())), [templates, query]);
  const fields = selected ? sendFields(selected, values) : [];
  const issues = selected ? validateSend(selected, values) : [];
  const ready = !!selected && !issues.length;
  return <div className="absolute right-0 bottom-full left-0 z-30 mx-3 mb-2 flex max-h-[min(640px,75dvh)] flex-col overflow-hidden rounded-xl border border-line bg-menu shadow-xl">
    <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
      {selected ? <button type="button" onClick={() => { setSelected(null); setAttempted(false); }} className="text-icon" aria-label={t.pageHeader.back}><ArrowLeft className="size-5" /></button> : <Search className="size-4 text-icon" />}
      {selected ? <span className="min-w-0 flex-1 truncate font-medium text-heading">{selected.name}</span> : <input autoFocus aria-label={t.templatePicker.searchApprovedTemplates} value={query} onChange={e => setQuery(e.target.value)} placeholder={t.templatePicker.searchApprovedTemplates} className="min-w-0 flex-1 bg-transparent text-sm text-heading outline-none placeholder:text-sub" />}
      <button type="button" onClick={onClose} className="text-icon" aria-label={t.home.close}><X className="size-5" /></button>
    </div>
    {!selected ? <div className="thin-scroll overflow-y-auto">
      {loading && <p className="p-4 text-sm text-sub">{t.templatePicker.loadingTemplates}</p>}
      {error && <p className="p-4 text-sm text-danger">{error}</p>}
      {!loading && !error && approved.length === 0 && <p className="p-4 text-sm text-sub">{t.templatePicker.noApprovedTemplates}</p>}
      {approved.map(t => <button key={t.id} type="button" onClick={() => { setSelected(t); setValues({}); setAttempted(false); }} className="block w-full border-b border-line px-4 py-3 text-left hover:bg-panel">
        <span className="flex justify-between gap-2"><span className="truncate text-sm font-medium text-heading">{t.name}</span><span className="text-xs text-sub">{t.language}</span></span>
        <span className="mt-1 block text-xs text-sub">{KIND_LABELS[inferKind(t)]}</span><span className="line-clamp-2 text-xs text-sub">{t.components.find(c => c.type.toUpperCase() === "BODY")?.text}</span>
      </button>)}
    </div> : <form onSubmit={e => { e.preventDefault(); setAttempted(true); if (ready) onSend(buildSendPayload(selected, values)); }} className="thin-scroll min-h-0 space-y-3 overflow-y-auto p-4">
      <TemplatePreview template={selected} values={values} />
      {fields.map(f => <label key={f.key} className="block text-xs text-sub">{f.label}{f.required ? " *" : ""}
        {f.kind === "textarea" ? <textarea rows={3} value={values[f.key] ?? ""} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} className="mt-1 w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-heading" /> : <input type={f.kind ?? "text"} step={f.kind === "number" ? "any" : undefined} maxLength={f.maxLength} value={values[f.key] ?? ""} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} className="mt-1 w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-heading outline-none focus:border-accent" />}
      </label>)}
      {attempted && issues.length > 0 && <ul role="alert" className="space-y-1 text-xs text-danger">{issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>}
      {fields.some(f => f.key.endsWith(".media")) && <p className="text-xs text-sub">{t.templatePicker.useAURLAccessibleToMetaOrTheID}</p>}
      <button type="submit" aria-disabled={!ready} className={`flex w-full items-center justify-center gap-2 rounded-full bg-accent py-2.5 text-sm font-medium text-white ${!ready ? "opacity-50" : ""}`}><Send className="size-4" />{t.templatePicker.sendTemplate}</button>
    </form>}
  </div>;
}
