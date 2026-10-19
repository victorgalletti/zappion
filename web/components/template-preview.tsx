// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT, useLocale } from "@/lib/i18n";
import { ChevronLeft, ChevronRight, Copy, FileText, ImageIcon, MapPin, Phone, ShoppingBag, Video } from "lucide-react";
import { useRef, useState } from "react";
import { componentType, fillVariables, inferKind, variables } from "@/lib/templates/catalog";
import { exampleSendValues, sendCards } from "@/lib/templates/send";
import type { SendValues, TemplateComponent, TemplateLike } from "@/lib/templates/types";
import { MessageText } from "./message-text";

/** Creation and composer deliberately share the same rendering and variable scopes. */
export function TemplatePreview({ template, values, media = {} }: { template: TemplateLike; values?: SendValues; media?: Record<string, string> }) {
  const t = useT();
  const { locale } = useLocale();
  const examples = exampleSendValues(template);
  const current = values ?? examples;
  const rail = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const auth = template.category.toUpperCase() === "AUTHENTICATION";
  const cards = sendCards(template, current);
  function text(c: TemplateComponent, scope: string) {
    return fillVariables(c.text ?? "", Object.fromEntries(variables(c.text ?? "").map(n => [n, current[`${scope}.${componentType(c).toLowerCase()}.${n}`] ?? ""])));
  }
  function bubble(cs: TemplateComponent[], scope: string, card = false) {
    const header = cs.find(c => componentType(c) === "HEADER");
    const body = cs.find(c => componentType(c) === "BODY");
    const footer = cs.find(c => componentType(c) === "FOOTER");
    const offer = cs.find(c => componentType(c) === "LIMITED_TIME_OFFER")?.limited_time_offer;
    const buttons = cs.flatMap(c => c.buttons ?? []);
    const format = header?.format?.toUpperCase();
    const source = media[scope] || current[`${scope}.media`];
    const safeSource = source && /^(https?:\/\/|blob:)/.test(source) ? source : undefined;
    const product = format === "PRODUCT" || (!card && inferKind(template) === "catalog");
    const visible = !card && buttons.length > 3 && !expanded ? buttons.slice(0, 2) : buttons;
    const code = current.otp || "{{1}}";
    return <div className="overflow-hidden rounded-lg bg-sent text-bubble shadow-sm">
      {header && format === "TEXT" && <p className="px-3 pt-2 text-sm font-semibold whitespace-pre-wrap break-words">{text(header, scope)}</p>}
      {(product || ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(format ?? "")) && <div className="m-1 flex min-h-32 items-center justify-center overflow-hidden rounded bg-panel text-sub">
        {format === "IMAGE" && safeSource ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={safeSource} alt={t.templatePreview.headerImage} className="max-h-48 w-full object-cover" /> :
          format === "VIDEO" && safeSource ? <video src={safeSource} controls preload="metadata" className="max-h-48 w-full" /> :
          <div className="flex flex-col items-center gap-2 p-4 text-center text-xs">
            {product ? <ShoppingBag className="size-9" /> : format === "VIDEO" ? <Video className="size-9" /> : format === "DOCUMENT" ? <FileText className="size-9" /> : format === "LOCATION" ? <MapPin className="size-9" /> : <ImageIcon className="size-9" />}
            <span>{product ? t.templatePreview.catalogProduct : format === "LOCATION" ? current[`${scope}.locationName`] || t.messages.location : format === "DOCUMENT" ? t.templatePreview.pdfDocument : format === "VIDEO" ? t.messages.video : t.mediaLibrary.image}</span>
            {product && current[`${scope}.productId`] && <span>{t.templatePreview.sku}{current[`${scope}.productId`]}</span>}
            {format === "LOCATION" && <span>{current[`${scope}.address`] || t.templatePreview.mapOfSharedLocation}</span>}
          </div>}
      </div>}
      <div className="space-y-1 px-3 py-2 text-sm">
        {auth ? <MessageText text={body?.text ? fillVariables(body.text, { "1": code }) : template.language.startsWith("pt") ? `*${code}* é seu código de verificação.${body?.add_security_recommendation ? " Para sua segurança, não compartilhe este código." : ""}` : `*${code}* is your verification code.${body?.add_security_recommendation ? " For your security, do not share this code." : ""}`} /> : <MessageText text={body ? text(body, scope) || t.templatePreview.yourTextWillAppearHere : ""} />}
        {offer && <div className="mt-2 rounded border border-line p-2"><p className="font-semibold">{offer.text}</p>{offer.has_expiration && <p className="text-xs text-sub">{current.expiration ? t.templatePreview.validUntil(new Date(current.expiration).toLocaleString(locale)) : t.templatePreview.countdownToExpiration}</p>}</div>}
        {footer && <p className="text-xs whitespace-pre-wrap text-sub">{auth && !footer.text && footer.code_expiration_minutes ? (template.language.startsWith("pt") ? `Este código expira em ${footer.code_expiration_minutes} minutos.` : `This code expires in ${footer.code_expiration_minutes} minutes.`) : footer.text}</p>}
        <p className="text-right text-[0.625rem] text-sub">12:00 ✓✓</p>
      </div>
      {visible.map((b, i) => {
        const type = componentType(b);
        const label = type === "COPY_CODE" ? t.templatePreview.copyCodeWithValue(current[`${scope}.button.${i}`] ? ` · ${current[`${scope}.button.${i}`]}` : "") : type === "CATALOG" ? t.templatesCatalog.viewCatalog : type === "MPM" ? t.templatesCatalog.viewItems : type === "SPM" ? t.templatesCatalog.viewProduct : b.text || t.templatesCatalog.copyCode;
        return <div key={i} className="flex items-center justify-center gap-2 border-t border-line px-3 py-2 text-center text-sm text-accent">
          {["COPY_CODE", "OTP"].includes(type) ? <Copy className="size-4" /> : ["VOICE_CALL", "PHONE_NUMBER"].includes(type) ? <Phone className="size-4" /> : ["SPM", "MPM", "CATALOG"].includes(type) ? <ShoppingBag className="size-4" /> : null}{label}
        </div>;
      })}
      {!card && buttons.length > 3 && !expanded && <button type="button" onClick={() => setExpanded(true)} className="w-full border-t border-line py-2 text-sm text-accent">{t.templatePreview.viewAllOptions}</button>}
      {cs.some(c => componentType(c) === "CALL_PERMISSION_REQUEST") && <div className="border-t border-line p-2 text-center text-sm"><p className="text-sub">{t.templatePreview.allowCallsFromThisBusiness}</p><p className="py-2 text-accent">{t.templatePreview.allowDecline}</p></div>}
    </div>;
  }
  return <section aria-label={t.templatePreview.whatsAppTemplatePreview} className="min-w-0 rounded-xl border border-line bg-panel p-3">
    <p className="mb-3 text-xs font-medium text-sub">{t.templatePreview.whatsAppPreviewIllustrative}</p>
    <div className="chat-wallpaper relative isolate rounded-lg p-3">
      <div className="relative z-[1] mx-auto max-w-sm">{bubble(template.components, "root")}</div>
      {cards.length > 0 && <>
        <div ref={rail} tabIndex={0} aria-label={t.templatePreview.carouselCardsSwipeToSeeMore} className="thin-scroll relative z-[1] mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2">
          {cards.map((c, i) => <div key={i} className="w-60 shrink-0 snap-start">{bubble(c.components, `card.${i}`, true)}</div>)}
        </div>
        <div className="relative z-[1] flex items-center justify-center gap-4 text-sub"><button type="button" aria-label={t.templatePreview.previousCard} onClick={() => rail.current?.scrollBy({ left: -248, behavior: "smooth" })}><ChevronLeft className="size-5" /></button><span className="text-xs">{t.templatePreview.cardsSwipe(cards.length)}</span><button type="button" aria-label={t.templatePreview.nextCard} onClick={() => rail.current?.scrollBy({ left: 248, behavior: "smooth" })}><ChevronRight className="size-5" /></button></div>
      </>}
    </div>
  </section>;
}
