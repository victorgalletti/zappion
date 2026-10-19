// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
import { Plus, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useCreateTemplate, useTemplates } from "@/hooks/use-chat";
import { instanceName } from "@/lib/instances";
import { CATEGORY_LABELS, KIND_LABELS, duplicateTemplate, inferKind, newDraft } from "@/lib/templates/catalog";
import { emptyTemplateFilters, filterTemplates, TEMPLATE_STATUS, templateQuality } from "@/lib/templates/display";
import type { TemplateDraft } from "@/lib/templates/types";
import type { OrganizationAddressRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useOrganizationId } from "./providers";
import { TemplateDetail } from "./template-detail";
import { TemplateEditor } from "./template-editor";
import { PageHeader } from "./ui/page-header";
import { Select } from "./ui/select";

export function TemplatesManager({ numbers }: { numbers: OrganizationAddressRow[] }) {
  const messages = useT();
  const [instance, setInstance] = useState("");
  const address = numbers.find(n => n.address === instance)?.address ?? numbers[0]?.address;
  const selector = numbers.length > 1 ? <Select aria-label={messages.templatesManager.templateInstance} value={address ?? ""} onChange={setInstance} options={numbers.map(n => ({ value: n.address, label: instanceName(n) }))} /> : null;
  return <main aria-label={messages.composer.templates} className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
    {address ? <InstanceTemplates key={address} organizationAddress={address} instanceSelector={selector} /> : <>
      <PageHeader title={messages.composer.templates} />
      <p className="p-6 text-sm text-sub">{messages.templatesManager.connectAnInstanceToManageTemplates}</p>
    </>}
  </main>;
}

function InstanceTemplates({ organizationAddress, instanceSelector }: { organizationAddress: string; instanceSelector: ReactNode }) {
  const messages = useT();
  const organizationId = useOrganizationId();
  const templates = useTemplates(organizationId, organizationAddress);
  const create = useCreateTemplate(organizationId, organizationAddress);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [filters, setFilters] = useState(emptyTemplateFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = templates.data ?? [];
  const filtered = filterTemplates(items, filters);
  const selected = !templates.error ? filtered.find(t => t.id === selectedId) : undefined;
  function open(d: TemplateDraft) { create.reset(); setDraft(d); }
  function options(values: string[], label: string, labels: Record<string, string> = {}) {
    return [{ value: "", label }, ...[...new Set(values)].sort().map(value => ({ value, label: labels[value] ?? value }))];
  }
  return <>
    <PageHeader title={messages.composer.templates} actions={<button type="button" onClick={() => open(newDraft())} className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110"><Plus className="size-4" />{messages.templatesManager.createTemplate}</button>} />
    <div className="flex min-h-0 flex-1">
      <aside aria-label={messages.templatesManager.templateList} className={cn("flex min-h-0 w-full shrink-0 flex-col border-r border-line md:w-80 lg:w-96", selected && "hidden md:flex")}>
        <div className="space-y-3 border-b border-line p-4">
          {instanceSelector && <div className="space-y-1"><p className="text-xs text-sub">{messages.mediaLibrary.instance}</p>{instanceSelector}</div>}
          <label className="flex items-center gap-2 rounded-xl border border-line bg-input px-3 py-2 text-sub"><Search className="size-4" /><input aria-label={messages.templatesManager.searchTemplates} value={filters.query} onChange={e => setFilters({ ...filters, query: e.target.value })} placeholder={messages.templatesManager.searchTemplates} className="min-w-0 flex-1 bg-transparent text-sm text-heading outline-none" /></label>
          <div className="grid grid-cols-2 gap-2">
            <Select aria-label={messages.templatesManager.filterByStatus} size="compact" value={filters.status} onChange={status => setFilters({ ...filters, status })} options={options(items.map(t => t.status), messages.templatesManager.allStatuses, Object.fromEntries(Object.entries(TEMPLATE_STATUS).map(([key, value]) => [key, value.label])))} />
            <Select aria-label={messages.templatesManager.filterByCategory} size="compact" value={filters.category} onChange={category => setFilters({ ...filters, category })} options={options(items.map(t => t.category), messages.templatesManager.allCategories, CATEGORY_LABELS)} />
            <Select aria-label={messages.templatesManager.filterByType} size="compact" value={filters.kind} onChange={kind => setFilters({ ...filters, kind })} options={options(items.map(inferKind), messages.templatesManager.allTypes, KIND_LABELS)} />
            <Select aria-label={messages.templatesManager.filterByLanguage} size="compact" value={filters.language} onChange={language => setFilters({ ...filters, language })} options={options(items.map(t => t.language), messages.templatesManager.allLanguages)} />
          </div>
          {Object.values(filters).some(Boolean) && <button type="button" onClick={() => setFilters(emptyTemplateFilters)} className="text-xs text-accent">{messages.mediaLibrary.clearFilters}</button>}
        </div>
        <div className="thin-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {templates.isLoading && <p role="status" className="p-3 text-sm text-sub">{messages.templatesManager.loadingTemplates}</p>}
          {templates.error && <div role="alert" className="space-y-2 p-3 text-sm text-danger"><p>{messages.templatesManager.couldNotLoadTemplates}{templates.error.message}</p><button type="button" onClick={() => void templates.refetch()} className="text-accent">{messages.home.tryAgain}</button></div>}
          {!templates.isLoading && !templates.error && !filtered.length && <p className="p-3 text-sm leading-6 text-sub">{items.length ? messages.templatesManager.noTemplatesMatchTheseFilters : messages.templatesManager.noTemplatesYetCreateATemplateToStartChats}</p>}
          {!templates.error && filtered.map(t => {
            const status = TEMPLATE_STATUS[t.status];
            return <button type="button" key={t.id} aria-pressed={selected?.id === t.id} onClick={() => setSelectedId(t.id)} className={cn("block w-full rounded-xl border p-4 text-left hover:bg-panel focus-visible:outline-accent", selected?.id === t.id ? "border-accent bg-accent/5" : "border-line")}>
              <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-heading" title={t.name}>{t.name}</span><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold", status?.style ?? "bg-panel text-sub")}>{status?.label ?? t.status}</span></span>
              <span className="mt-2 block text-xs text-sub">{KIND_LABELS[inferKind(t)]} · {CATEGORY_LABELS[t.category] ?? t.category} · {t.language}</span>
              <span className="mt-1 block text-xs text-sub">{messages.templatesManager.quality}{templateQuality(t.quality_score?.score)}</span>
            </button>;
          })}
        </div>
      </aside>
      {selected ? <TemplateDetail key={selected.id} template={selected} onDuplicate={() => open(duplicateTemplate(selected))} onBack={() => setSelectedId(null)} /> : <div className="hidden min-w-0 flex-1 items-center justify-center bg-panel/30 p-8 text-center text-sm text-sub md:flex">{messages.templatesManager.selectATemplateToSeeItsPreviewAndDetails}</div>}
    </div>
    {draft && organizationId && <TemplateEditor initial={draft} organizationId={organizationId} organizationAddress={organizationAddress} pending={create.isPending} error={create.error?.message} onClose={() => setDraft(null)} onCreate={payload => create.mutate(payload, { onSuccess: () => setDraft(null) })} />}
  </>;
}
