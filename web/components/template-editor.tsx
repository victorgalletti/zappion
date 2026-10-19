// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT, useLocale } from "@/lib/i18n";
import { PageHeader } from "./ui/page-header";
import { ArrowLeft, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BUTTON_LABELS, CATEGORY_LABELS, KIND_LABELS, newButton, newDraft, variables } from "@/lib/templates/catalog";
import { LANGUAGE_CODES } from "@/lib/templates/languages";
import { buildCreatePayload, draftComponents } from "@/lib/templates/payload";
import { validateDraft } from "@/lib/templates/validation";
import { uploadTemplateMedia, validateTemplateMedia } from "@/lib/templates/upload";
import type { ButtonDraft, CardDraft, CreateTemplatePayload, HeaderDraft, ParameterFormat, TemplateDraft, TemplateKind, TextDraft } from "@/lib/templates/types";
import { Select } from "./ui/select";
import { TemplatePreview } from "./template-preview";

const inputClass = "mt-1 w-full rounded-xl border border-line bg-input px-3 py-2.5 text-sm text-heading outline-none focus:border-accent";
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-xs text-sub"><span>{label}</span>{children}</label>; }
function Input({ label, value, onChange, max, type = "text" }: { label: string; value: string; onChange: (value: string) => void; max?: number; type?: string }) { return <Field label={label}><input type={type} value={value} onChange={e => onChange(e.target.value)} maxLength={max} className={inputClass} /></Field>; }
function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string; disabled?: boolean }[] }) { return <div className="text-xs text-sub"><span>{label}</span><Select aria-label={label} value={value} onChange={onChange} options={options} className="mt-1" /></div>; }
function TextEditor({ label, value, onChange, format, max, header = false }: { label: string; value: TextDraft; onChange: (value: TextDraft) => void; format: ParameterFormat; max: number; header?: boolean }) {
  const t = useT();
  const [variableName, setVariableName] = useState("cliente");
  const names = variables(value.text);
  return <div className="space-y-2">
    <Field label={`${label} · ${[...value.text].length}/${max}`}><textarea value={value.text} onChange={e => onChange({ ...value, text: e.target.value })} rows={header ? 2 : 4} className={inputClass} /></Field>
    <div className="flex items-end gap-2">{format === "named" && <Input label={t.templateEditor.newVariableName} value={variableName} onChange={setVariableName} />}
      <button type="button" disabled={header && names.length >= 1} onClick={() => {
        const name = format === "positional" ? String(names.length + 1) : variableName;
        if (!name || (format === "named" && !/^[a-z_]+$/.test(name))) return;
        onChange({ ...value, text: `${value.text}${value.text ? " " : ""}{{${name}}}${header ? "" : "."}`, examples: { ...value.examples, [name]: value.examples[name] ?? "" } });
      }} className="flex shrink-0 items-center gap-1 rounded-full border border-line px-3 py-2 text-xs text-heading disabled:opacity-40"><Plus className="size-3" />{t.templateEditor.addVariable}</button>
    </div>
    {names.map(name => <Input key={name} label={t.templateEditor.requiredExample(label, name)} value={value.examples[name] ?? ""} onChange={example => onChange({ ...value, examples: { ...value.examples, [name]: example } })} />)}
  </div>;
}
function HeaderEditor({ value, onChange, format, choices, organizationId, organizationAddress }: { value: HeaderDraft; onChange: (h: HeaderDraft) => void; format: ParameterFormat; choices: HeaderDraft["format"][]; organizationId: string; organizationAddress: string }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const version = useRef(0);
  useEffect(() => { const url = value.previewUrl; return () => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); }; }, [value.previewUrl]);
  const media = ["IMAGE", "VIDEO", "DOCUMENT"].includes(value.format);
  const labels: Record<string, string> = { NONE: t.templateEditor.noHeader, TEXT: t.templateEditor.text, IMAGE: t.mediaLibrary.image, VIDEO: t.messages.video, DOCUMENT: t.templateEditor.pdfDocument, LOCATION: t.messages.location, PRODUCT: t.templateEditor.catalogProduct };
  return <div className="space-y-3 rounded-xl border border-line p-3">
    <Choice label={t.templateEditor.header} value={value.format} onChange={v => { version.current++; setFile(null); setError(""); onChange({ ...value, format: v as HeaderDraft["format"], handle: "", previewUrl: "" }); }} options={choices.map(v => ({ value: v, label: labels[v] }))} />
    {value.format === "TEXT" && <TextEditor label={t.templateEditor.headerText} value={value} onChange={v => onChange({ ...value, ...v })} format={format} max={60} header />}
    {media && <>
      {/* Choosing the sample uploads it to Meta right away; the handle is what creation needs. */}
      <Field label={t.templateEditor.sampleFile}>
        <div className={`mt-1 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-heading hover:bg-panel ${pending ? "pointer-events-none opacity-60" : ""}`}>
          <Upload className="size-4 shrink-0 text-icon" />
          <span className="min-w-0 flex-1 truncate">{pending ? t.templateEditor.uploadingSampleToMeta : file ? file.name : value.format === "IMAGE" ? t.templateEditor.chooseImageJPGOrPNGUpTo5MB : value.format === "VIDEO" ? t.templateEditor.chooseVideoMP4UpTo16MB : t.templateEditor.choosePDFUpTo100MB}</span>
          {value.handle && !pending && <span className="shrink-0 text-xs text-accent">{t.templateEditor.uploaded}</span>}
          <input type="file" className="sr-only" accept={value.format === "IMAGE" ? "image/jpeg,image/jpg,image/png" : value.format === "VIDEO" ? "video/mp4" : "application/pdf"} onChange={async e => {
            const chosen = e.target.files?.[0]; e.target.value = ""; if (!chosen) return;
            const invalid = validateTemplateMedia(chosen, value.format); setError(invalid ?? ""); if (invalid) return;
            const requestVersion = ++version.current; setFile(chosen);
            const next = { ...value, handle: "", previewUrl: URL.createObjectURL(chosen) }; onChange(next);
            setPending(true);
            try { const handle = await uploadTemplateMedia(chosen, value.format, organizationId, organizationAddress); if (requestVersion === version.current) onChange({ ...next, handle }); }
            catch (err) { if (requestVersion === version.current) setError((err as Error).message); }
            finally { setPending(false); }
          }} />
        </div>
      </Field>
      <details className="text-xs text-sub">
        <summary className="cursor-pointer select-none">{t.templateEditor.useAHeaderHandleAlreadyObtainedFromMeta}</summary>
        <div className="mt-2"><Input label={t.templateEditor.headerHandle} value={value.handle} onChange={handle => onChange({ ...value, handle })} /></div>
      </details>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </>}
    {value.format === "LOCATION" && <p className="text-xs text-sub">{t.templateEditor.coordinatesWillBeSelectedWhenSendingTheTemplate}</p>}
    {value.format === "PRODUCT" && <p className="text-xs text-sub">{t.templateEditor.theImageNameAndPriceComeFromTheCatalog}</p>}
  </div>;
}
function ButtonsEditor({ value, onChange, allowed, max = 10, format }: { value: ButtonDraft[]; onChange: (v: ButtonDraft[]) => void; allowed: ButtonDraft["type"][]; max?: number; format: ParameterFormat }) {
  const t = useT();
  const [next, setNext] = useState<ButtonDraft["type"]>(allowed[0] ?? "QUICK_REPLY");
  function update(i: number, patch: Partial<ButtonDraft>) { onChange(value.map((b, n) => i === n ? { ...b, ...patch } : b)); }
  return <div className="space-y-3">
    <p className="text-xs font-medium text-sub">{t.templateEditor.buttons(value.length, max)}</p>
    {value.map((b, i) => <div key={i} className="space-y-2 rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2"><span className="text-xs text-heading">{i + 1}. {BUTTON_LABELS[b.type]}</span><div className="flex gap-2">
        {i > 0 && <button type="button" aria-label={t.templateEditor.moveButtonUp(i + 1)} onClick={() => { const list = [...value]; [list[i - 1], list[i]] = [list[i], list[i - 1]]; onChange(list); }} className="text-xs text-accent">{t.templateEditor.moveUp}</button>}
        <button type="button" aria-label={t.templateEditor.removeButton(i + 1)} onClick={() => onChange(value.filter((_, n) => i !== n))} className="text-sub"><Trash2 className="size-4" /></button>
      </div></div>
      {!["COPY_CODE", "CATALOG", "MPM", "SPM"].includes(b.type) && <Input label={t.templateEditor.buttonText} value={b.text ?? ""} onChange={text => update(i, { text })} max={b.type === "VOICE_CALL" ? 20 : 25} />}
      {b.type === "URL" && <>
        <Input label={t.templateEditor.urlWithOptionalVariable} value={b.url ?? ""} onChange={url => update(i, { url })} max={2000} />
        {!variables(b.url ?? "").length && <button type="button" onClick={() => update(i, { url: `${b.url ?? ""}{{${format === "named" ? "destino" : "1"}}}` })} className="text-xs text-accent">{t.templateEditor.addUrlVariable}</button>}
        {variables(b.url ?? "").length > 0 && <Input label={t.templateEditor.requiredUrlVariableExample} value={b.variableExample ?? ""} onChange={variableExample => update(i, { variableExample })} />}
      </>}
      {b.type === "PHONE_NUMBER" && <Input label={t.templateEditor.phoneNumberWithCountryCode} value={b.phone_number ?? ""} onChange={phone_number => update(i, { phone_number })} max={20} />}
      {b.type === "COPY_CODE" && <Input label={t.templateEditor.requiredCouponExample} value={typeof b.example === "string" ? b.example : ""} onChange={example => update(i, { example })} max={20} />}
      {b.type === "FLOW" && <>
        <Input label={t.templateEditor.publishedFlowId} value={b.flow_id ?? ""} onChange={flow_id => update(i, { flow_id })} />
        <Choice label={t.templateEditor.flowAction} value={b.flow_action ?? "navigate"} onChange={flow_action => update(i, { flow_action: flow_action as ButtonDraft["flow_action"] })} options={[{ value: "navigate", label: t.templateEditor.openScreen }, { value: "data_exchange", label: t.templateEditor.exchangeDataWithEndpoint }]} />
        {b.flow_action !== "data_exchange" && <Input label={t.templateEditor.initialScreenId} value={b.navigate_screen ?? ""} onChange={navigate_screen => update(i, { navigate_screen })} />}
      </>}
      {b.type === "VOICE_CALL" && <Input label={t.templateEditor.callValidity144043200Minutes} type="number" value={String(b.ttl_minutes ?? "")} onChange={v => update(i, { ttl_minutes: Number(v) })} />}
    </div>)}
    <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Choice label={t.templateEditor.addButton} value={allowed.includes(next) ? next : allowed[0] ?? ""} onChange={v => setNext(v as ButtonDraft["type"])} options={allowed.map(type => ({ value: type, label: BUTTON_LABELS[type] }))} /></div><button type="button" disabled={value.length >= max} onClick={() => onChange([...value, newButton(allowed.includes(next) ? next : allowed[0])])} aria-label={t.templateEditor.addButton} className="rounded-full border border-line p-3 text-heading disabled:opacity-40"><Plus className="size-4" /></button></div>
  </div>;
}

export function TemplateEditor({ initial, organizationId, organizationAddress, onClose, onCreate, pending, error }: { initial: TemplateDraft; organizationId: string; organizationAddress: string; onClose: () => void; onCreate: (d: CreateTemplatePayload) => void; pending: boolean; error?: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const patch = (p: Partial<TemplateDraft>) => setDraft(d => ({ ...d, ...p }));
  const issues = validateDraft(draft);
  const special = ["carousel", "productCarousel", "callPermission"].includes(draft.kind);
  const headerChoices: HeaderDraft["format"][] = draft.kind === "offer" ? ["NONE", "IMAGE", "VIDEO"] : draft.kind === "media" ? ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"] : draft.kind === "mpm" ? ["TEXT"] : draft.kind === "product" ? ["PRODUCT"] : ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION"];
  const allowed: ButtonDraft["type"][] = draft.kind === "offer" ? ["COPY_CODE", "URL"] : draft.kind === "catalog" ? ["CATALOG"] : draft.kind === "mpm" ? ["MPM"] : draft.kind === "product" ? ["SPM"] : ["QUICK_REPLY", "URL", "PHONE_NUMBER", ...(draft.category === "MARKETING" ? ["COPY_CODE" as const] : []), "FLOW", "VOICE_CALL"];
  const template = { name: draft.name, language: draft.language, category: draft.category, parameter_format: draft.parameterFormat, components: draftComponents(draft) };
  function changeKind(kind: TemplateKind) {
    const fresh = newDraft(kind);
    setDraft({ ...fresh, name: draft.name, language: draft.language, body: kind === "authentication" ? fresh.body : draft.body }); setAttempted(false);
  }
  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-6">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={e => {
      if (e.key === "Escape" && !pending) { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([aria-hidden="true"]), textarea, [tabindex="0"]') ?? [])].filter(el => el.offsetParent !== null);
        const first = focusable[0]; const last = focusable.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }} className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl outline-none">
      <PageHeader title={t.templateEditor.createMessageTemplate} titleId={titleId} actions={<button type="button" disabled={pending} aria-label={t.templateEditor.closeEditor} onClick={onClose} className="text-icon"><X className="size-5" /></button>} />
      <div className="flex gap-2 border-b border-line px-5 py-3">{[t.templateEditor.details, t.templateEditor.content, t.templateEditor.review].map((label, i) => <button key={label} type="button" onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined} className={`rounded-full px-3 py-1.5 text-xs ${step === i ? "bg-accent text-white" : "bg-panel text-sub"}`}>{i + 1}. {label}</button>)}</div>
      <form onSubmit={e => { e.preventDefault(); if (pending) return; setAttempted(true); if (!issues.length) onCreate(buildCreatePayload(draft)); else setStep(2); }} className="thin-scroll min-h-0 overflow-y-auto">
        <div className="grid items-start gap-5 p-5 md:grid-cols-2">
          <div className="min-w-0 space-y-4">
            {step === 0 && <>
              <Input label={t.templateEditor.templateNameLowercaseLettersNumbersAnd} value={draft.name} onChange={name => patch({ name })} max={512} />
              <Choice label={t.templateEditor.templateType} value={draft.kind} onChange={v => changeKind(v as TemplateKind)} options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))} />
              <Choice label={t.templateEditor.templateCategory} value={draft.category} onChange={v => v === "AUTHENTICATION" ? changeKind("authentication") : patch({ category: v as TemplateDraft["category"] })} options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label, disabled: draft.kind === "authentication" ? value !== "AUTHENTICATION" : ["carousel", "productCarousel", "catalog", "mpm", "product", "offer", "coupon"].includes(draft.kind) && value !== "MARKETING" }))} />
              <Choice label={t.templateEditor.templateLanguage} value={draft.language} onChange={language => patch({ language })} options={LANGUAGE_CODES.map(value => ({ value, label: value === "pt_BR" ? t.templateEditor.portugueseBrazil : value === "en_US" ? t.templateEditor.englishUS : value === "es" ? t.templateEditor.spanish : new Intl.DisplayNames([locale], { type: "language" }).of(value.replace("_", "-")) ?? value }))} />
              {draft.kind !== "authentication" && <Choice label={t.templateEditor.variableFormat} value={draft.parameterFormat} onChange={v => patch({ parameterFormat: v as ParameterFormat })} options={[{ value: "positional", label: t.templateEditor.positionalFormat }, { value: "named", label: t.templateEditor.namedFormat }]} />}
              {["catalog", "mpm", "product", "productCarousel"].includes(draft.kind) && <p className="text-xs leading-5 text-sub">{t.templateEditor.requiresACatalogWithInventoryConnectedToTheWABA}</p>}
              {draft.kind === "flow" && <p className="text-xs leading-5 text-sub">{t.templateEditor.useAFlowAlreadyPublishedOnMetaCreateAnd}</p>}
            </>}
            {step === 1 && (draft.kind === "authentication" ? <>
              <p className="text-sm leading-6 text-sub">{t.templateEditor.metaSetsTheVerificationCodeTextConfigureOnlyThe}</p>
              <Choice label={t.templateEditor.otpType} value={draft.auth.otpType} onChange={v => patch({ auth: { ...draft.auth, otpType: v as TemplateDraft["auth"]["otpType"], termsAccepted: false } })} options={[{ value: "COPY_CODE", label: t.templatesCatalog.copyCode }, { value: "ONE_TAP", label: t.templateEditor.oneTapAutofill }, { value: "ZERO_TAP", label: t.templateEditor.zeroTapAutofill }]} />
              <label className="flex gap-2 text-sm text-heading"><input type="checkbox" checked={draft.auth.security} onChange={e => patch({ auth: { ...draft.auth, security: e.target.checked } })} />{t.templateEditor.includeSecurityRecommendation}</label>
              <Input label={t.templateEditor.expiration190MinutesLeaveBlankToOmit} type="number" value={String(draft.auth.expirationMinutes ?? "")} onChange={v => patch({ auth: { ...draft.auth, expirationMinutes: v === "" ? undefined : Number(v) } })} />
              <Input label={t.templateEditor.copyCodeTextOptional} value={draft.auth.text} onChange={text => patch({ auth: { ...draft.auth, text } })} max={25} />
              {draft.auth.otpType !== "COPY_CODE" && <>
                <Input label={t.templateEditor.autofillTextOptional} value={draft.auth.autofillText} onChange={autofillText => patch({ auth: { ...draft.auth, autofillText } })} max={25} />
                <p className="text-xs leading-5 text-sub">{t.templateEditor.oneTapAndZeroTapRequireAndroidAppIntegration}</p>
                {draft.auth.apps.map((app, i) => <div key={i} className="space-y-2 rounded-xl border border-line p-3"><Input label={t.templateEditor.appAndroidPackageName(i + 1)} value={app.package_name} onChange={package_name => patch({ auth: { ...draft.auth, apps: draft.auth.apps.map((a, n) => n === i ? { ...a, package_name } : a) } })} max={224} /><Input label={t.templateEditor.appSignatureHash11Characters(i + 1)} value={app.signature_hash} onChange={signature_hash => patch({ auth: { ...draft.auth, apps: draft.auth.apps.map((a, n) => n === i ? { ...a, signature_hash } : a) } })} max={11} /><button type="button" className="text-xs text-danger" onClick={() => patch({ auth: { ...draft.auth, apps: draft.auth.apps.filter((_, n) => i !== n) } })}>{t.templateEditor.removeApp}</button></div>)}
                <button type="button" disabled={draft.auth.apps.length >= 5} className="text-xs text-accent disabled:opacity-40" onClick={() => patch({ auth: { ...draft.auth, apps: [...draft.auth.apps, { package_name: "", signature_hash: "" }] } })}>{t.templateEditor.addAppUpTo5}</button>
              </>}
              {draft.auth.otpType === "ZERO_TAP" && <label className="flex gap-2 text-xs leading-5 text-sub"><input type="checkbox" checked={draft.auth.termsAccepted} onChange={e => patch({ auth: { ...draft.auth, termsAccepted: e.target.checked } })} />{t.templateEditor.iUnderstandTheZeroTapTermsAndConfirmThat}</label>}
            </> : <>
              {!special && draft.kind !== "catalog" && <HeaderEditor value={draft.header} onChange={header => patch({ header })} format={draft.parameterFormat} choices={headerChoices} organizationId={organizationId} organizationAddress={organizationAddress} />}
              <TextEditor label={t.templateEditor.messageBody} value={draft.body} onChange={body => patch({ body })} format={draft.parameterFormat} max={draft.kind === "offer" ? 600 : draft.kind === "product" ? 160 : 1024} />
              {!special && draft.kind !== "offer" && <Input label={t.templateEditor.footerOptionalNoVariables} value={draft.footer} onChange={footer => patch({ footer })} max={60} />}
              {draft.kind === "offer" && <><Input label={t.templateEditor.offerTitleUpTo16Characters} value={draft.offer.text} onChange={text => patch({ offer: { ...draft.offer, text } })} max={16} /><label className="flex gap-2 text-sm text-heading"><input type="checkbox" checked={draft.offer.hasExpiration} onChange={e => patch({ offer: { ...draft.offer, hasExpiration: e.target.checked } })} />{t.templateEditor.showExpirationAndCountdown}</label><p className="text-xs text-sub">{t.templateEditor.unavailableOnWhatsAppWebDesktopTheCodeAndDate}</p></>}
              {!special && <ButtonsEditor value={draft.buttons} onChange={buttons => patch({ buttons })} allowed={allowed} max={["catalog", "mpm", "product"].includes(draft.kind) ? 1 : draft.kind === "offer" ? 2 : 10} format={draft.parameterFormat} />}
              {draft.cards.map((card, i) => {
                const update = (p: Partial<CardDraft>) => patch({ cards: draft.cards.map((c, n) => n === i ? { ...c, ...p } : c) });
                return <section key={i} className="space-y-3 rounded-xl border border-line p-3"><div className="flex justify-between text-sm text-heading"><h3>{t.templateEditor.card(i + 1)}</h3>{draft.kind === "carousel" && draft.cards.length > 2 && <button type="button" aria-label={t.templateEditor.removeCard(i + 1)} onClick={() => patch({ cards: draft.cards.filter((_, n) => i !== n) })}><Trash2 className="size-4" /></button>}</div><HeaderEditor value={card.header} onChange={header => update({ header })} format={draft.parameterFormat} choices={draft.kind === "productCarousel" ? ["PRODUCT"] : ["IMAGE", "VIDEO"]} organizationId={organizationId} organizationAddress={organizationAddress} />{draft.kind === "carousel" && <TextEditor label={t.templateEditor.cardBodyOptionalOnAllCards(i + 1)} value={card.body} onChange={body => update({ body })} format={draft.parameterFormat} max={160} />}<ButtonsEditor value={card.buttons} onChange={buttons => update({ buttons })} allowed={draft.kind === "productCarousel" ? ["SPM", "URL"] : ["QUICK_REPLY", "URL", "PHONE_NUMBER"]} max={draft.kind === "productCarousel" ? 1 : 2} format={draft.parameterFormat} /></section>;
              })}
              {draft.kind === "carousel" && <button type="button" disabled={draft.cards.length >= 10} onClick={() => patch({ cards: [...draft.cards, structuredClone(draft.cards.at(-1)!)] })} className="text-sm text-accent disabled:opacity-40">{t.templateEditor.addCard(draft.cards.length)}</button>}
              {draft.kind === "productCarousel" && <p className="text-xs text-sub">{t.templateEditor.twoCardsForApprovalWhenSendingChooseTwoTo}</p>}
              {draft.kind === "callPermission" && <p className="text-xs text-sub">{t.templateEditor.metaIncludesControlsToAllowOrDeclineCallsCannot}</p>}
            </>)}
            {step === 2 && <>
              <p className="text-sm text-heading">{draft.name || t.templateEditor.untitledTemplate} · {KIND_LABELS[draft.kind]}</p><p className="text-xs text-sub">{CATEGORY_LABELS[draft.category]} · {draft.language} · {draft.parameterFormat === "named" ? t.templateEditor.namedVariables : t.templateEditor.positionalVariables}</p>
              {issues.length ? <ul role={attempted ? "alert" : undefined} className="space-y-2 text-xs leading-5 text-danger">{issues.map((i, n) => <li key={n}><span className="font-medium">{i.path}:</span> {i.message}</li>)}</ul> : <p className="text-sm text-accent">{t.templateEditor.structureAndExampleRequirementsValidated}</p>}
              <p className="text-xs leading-5 text-sub">{t.templateEditor.metaDecidesApprovalAndMayRecategorizeTheTemplateDuplicating}</p>
              <details className="text-xs text-sub"><summary className="cursor-pointer">{t.templateEditor.viewGraphApiPayload}</summary><pre className="thin-scroll mt-2 max-h-64 overflow-auto rounded bg-panel p-3">{JSON.stringify(template, null, 2)}</pre></details>
            </>}
          </div>
          <div className="min-w-0 md:sticky md:top-0"><TemplatePreview template={template} media={{ root: draft.header.previewUrl, ...Object.fromEntries(draft.cards.map((c, i) => [`card.${i}`, c.header.previewUrl])) }} /></div>
        </div>
        <div className="sticky bottom-0 space-y-2 border-t border-line bg-surface px-5 py-4">
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex items-center justify-between gap-3"><button type="button" disabled={pending} onClick={() => step ? setStep(step - 1) : onClose()} className="flex items-center gap-1 rounded-full border border-line px-4 py-2 text-sm text-heading"><ArrowLeft className="size-4" />{step ? t.pageHeader.back : t.templateEditor.cancel}</button>{step < 2 ? <button type="button" onClick={() => setStep(step + 1)} className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white">{t.templateEditor.continue}</button> : <button type="submit" disabled={pending} className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white disabled:opacity-40">{pending ? t.templateEditor.sending : t.templateEditor.submitForApproval}</button>}</div>
        </div>
      </form>
    </div>
  </div>, document.body);
}
