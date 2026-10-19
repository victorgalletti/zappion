// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
import { Copy } from "lucide-react";
import { useState } from "react";
import { CATEGORY_LABELS, KIND_LABELS, duplicateTemplate, inferKind } from "@/lib/templates/catalog";
import { TEMPLATE_STATUS, templateQuality } from "@/lib/templates/display";
import { exampleSendValues, sendFields, unsupportedTemplate } from "@/lib/templates/send";
import type { Template } from "@/lib/types";
import { TemplatePreview } from "./template-preview";

export function TemplateDetail({ template, onDuplicate, onBack }: { template: Template; onDuplicate: () => void; onBack: () => void }) {
  const t = useT();
  const [copyState, setCopyState] = useState("");
  const examples = exampleSendValues(template);
  const fields = sendFields(template).filter(field => field.required);
  const unsupported = unsupportedTemplate(template);
  const data = [
    [t.templateDetail.type, KIND_LABELS[inferKind(template)]],
    [t.templateDetail.category, CATEGORY_LABELS[template.category] ?? template.category],
    [t.preferences.language, template.language],
    [t.templateDetail.variableFormat, duplicateTemplate(template).parameterFormat === "named" ? t.templateDetail.named : t.templateDetail.positional],
    [t.templateDetail.status, TEMPLATE_STATUS[template.status]?.label ?? template.status],
    [t.templateDetail.rejectionReason, (template.rejected_reason && template.rejected_reason !== "NONE" ? template.rejected_reason : "") || (template.status === "REJECTED" ? t.templateDetail.missingRejectionReason : t.templateDetail.notApplicable)],
    [t.templateDetail.quality, templateQuality(template.quality_score?.score)],
    [t.templateDetail.qualityDetails, template.quality_score?.reason || template.quality_score?.reasons?.join(" · ") || t.templateDetail.missingQualityDetails],
    [t.templateDetail.id, template.id],
  ];
  return <section aria-label={t.templateDetail.templateDetails} className="thin-scroll min-h-0 min-w-0 flex-1 overflow-y-auto bg-panel/30 p-5 sm:p-6">
    <button type="button" onClick={onBack} className="mb-4 text-sm text-accent md:hidden">{t.templateDetail.backToTemplates}</button>
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 break-words text-lg font-semibold text-heading">{template.name}</h2>
        <button type="button" disabled={unsupported} title={unsupported ? t.templateDetail.duplicationUnavailableForUnknownComponents : undefined} onClick={onDuplicate} className="rounded-full border border-line px-4 py-2 text-sm text-heading hover:bg-panel disabled:opacity-40">{t.templateDetail.duplicateAsNew}</button>
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(template, null, 2)); setCopyState(t.templateDetail.jsonCopied); }
          catch { setCopyState(t.templateDetail.couldNotCopyJson); }
        }} className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-heading hover:bg-panel"><Copy className="size-4" />{t.templateDetail.copyJson}</button>
      </div>
      {copyState && <p role="status" className="text-sm text-sub">{copyState}</p>}
      {unsupported && <p className="text-sm text-sub">{t.templateDetail.thisTemplateContainsUnsupportedComponentsThePreviewMayBe}</p>}
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="flex items-center gap-3 bg-surface px-4 py-3"><span className="flex size-9 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden="true">C</span><div><p className="text-sm font-medium text-heading">{t.templateDetail.sampleCustomer}</p><p className="text-xs text-sub">{t.templateDetail.sampleChatNoMessagesWillBeSent}</p></div></div>
        <TemplatePreview key={template.id} template={template} />
      </div>
      <section aria-label={t.templateDetail.templateData} className="rounded-xl border border-line bg-surface p-4">
        <h3 className="mb-4 font-medium text-heading">{t.templateDetail.templateData}</h3>
        <dl className="grid gap-4 sm:grid-cols-2">{data.map(([label, value]) => <div key={label}><dt className="text-xs text-sub">{label}</dt><dd className="mt-1 break-words text-sm text-heading">{value}</dd></div>)}</dl>
      </section>
      <section aria-label={t.templateDetail.variablesAndExamples} className="rounded-xl border border-line bg-surface p-4">
        <h3 className="mb-3 font-medium text-heading">{t.templateDetail.variablesAndExamples}</h3>
        <p className="mb-3 text-xs text-sub">{t.templateDetail.examplesProvidedByTheTemplateParametersWithoutExamplesAre}</p>
        {fields.length ? <dl className="space-y-3">{fields.map(field => <div key={field.key}><dt className="text-xs text-sub">{field.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-heading">{examples[field.key] || t.templateDetail.noExampleProvided}</dd></div>)}</dl> : <p className="text-sm text-sub">{t.templateDetail.thisTemplateHasNoVariables}</p>}
      </section>
    </div>
  </section>;
}
