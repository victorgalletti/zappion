// SPDX-License-Identifier: AGPL-3.0-only
import { getT } from "@/lib/i18n";
import type { ButtonDraft, HeaderDraft, ParameterFormat, TemplateDraft, TemplateKind, TemplateLike } from "./types";

// Resolve labels when read so imports never capture a language.
export const KIND_LABELS: Record<TemplateKind, string> = {
  get standard() { return getT().templatesCatalog.standard; }, get media() { return getT().templatesCatalog.mediaLocation; }, get carousel() { return getT().templatesCatalog.mediaCarousel; }, get productCarousel() { return getT().templatesCatalog.productCarousel; },
  get catalog() { return getT().templatesCatalog.catalog; }, get mpm() { return getT().templatesCatalog.multipleProductsMpm; }, get product() { return getT().templatesCatalog.productSpm; }, get offer() { return getT().templatesCatalog.limitedTimeOffer; }, get coupon() { return getT().templatesCatalog.coupon; },
  get authentication() { return getT().templatesCatalog.authenticationOtp; }, get flow() { return getT().templatesCatalog.flow; }, get callPermission() { return getT().templatesCatalog.callPermission; },
};
export const CATEGORY_LABELS: Record<string, string> = { get MARKETING() { return getT().templatesCatalog.marketing; }, get UTILITY() { return getT().templatesCatalog.utility; }, get AUTHENTICATION() { return getT().templatesCatalog.authentication; } };
export const BUTTON_LABELS: Record<string, string> = { get QUICK_REPLY() { return getT().templatesCatalog.quickReply; }, get URL() { return getT().templatesCatalog.visitWebsite; }, get PHONE_NUMBER() { return getT().templatesCatalog.callPhoneNumber; }, get COPY_CODE() { return getT().templatesCatalog.copyCode; }, get FLOW() { return getT().templatesCatalog.flow; }, get VOICE_CALL() { return getT().templatesCatalog.callOnWhatsapp; }, get SPM() { return getT().templatesCatalog.viewProduct; }, get CATALOG() { return getT().templatesCatalog.viewCatalog; }, get MPM() { return getT().templatesCatalog.viewItems; }, get OTP() { return getT().templatesCatalog.verificationCode; } };
// Template text is sent to Meta; keep its defaults independent of the UI language.
const DEFAULT_BUTTON_TEXT: Record<string, string> = { QUICK_REPLY: "Quick reply", URL: "Visit website", PHONE_NUMBER: "Call phone number", COPY_CODE: "Copy code", FLOW: "Flow", VOICE_CALL: "Call on WhatsApp", SPM: "View product", CATALOG: "View catalog", MPM: "View items", OTP: "Verification code" };
export const emptyHeader = (): HeaderDraft => ({ format: "NONE", text: "", examples: {}, handle: "", previewUrl: "" });
export const newButton = (type: ButtonDraft["type"]): ButtonDraft => ({ type, text: type === "COPY_CODE" ? undefined : (DEFAULT_BUTTON_TEXT[type] ?? ""), ...(type === "URL" ? { url: "https://" } : {}), ...(type === "FLOW" ? { flow_action: "navigate", flow_id: "", navigate_screen: "" } : {}), ...(type === "VOICE_CALL" ? { ttl_minutes: 1440 } : {}), ...(type === "COPY_CODE" ? { example: "" } : {}) });
export function newDraft(kind: TemplateKind = "standard"): TemplateDraft {
  const marketing = ["carousel", "productCarousel", "catalog", "mpm", "product", "offer", "coupon"].includes(kind);
  const draft: TemplateDraft = {
    name: "", category: kind === "authentication" ? "AUTHENTICATION" : marketing ? "MARKETING" : "UTILITY", language: "pt_BR", kind,
    parameterFormat: "positional", header: emptyHeader(), body: { text: "", examples: {} }, footer: "", buttons: [], cards: [],
    offer: { text: "Special offer", hasExpiration: true },
    auth: { security: true, expirationMinutes: 10, otpType: "COPY_CODE", text: "Copy code", autofillText: "Autofill", apps: [{ package_name: "", signature_hash: "" }], termsAccepted: false },
  };
  if (kind === "media") draft.header.format = "IMAGE";
  if (kind === "mpm") { draft.header.format = "TEXT"; draft.buttons = [newButton("MPM")]; }
  if (kind === "catalog") draft.buttons = [newButton("CATALOG")];
  if (kind === "product") { draft.header.format = "PRODUCT"; draft.buttons = [newButton("SPM")]; }
  if (kind === "coupon" || kind === "offer") draft.buttons = [newButton("COPY_CODE")];
  if (kind === "offer") draft.buttons.push(newButton("URL"));
  if (kind === "flow") draft.buttons = [newButton("FLOW")];
  if (kind === "carousel" || kind === "productCarousel") draft.cards = Array.from({ length: 2 }, () => ({
    header: { ...emptyHeader(), format: kind === "carousel" ? "IMAGE" : "PRODUCT" }, body: { text: "", examples: {} },
    buttons: [newButton(kind === "carousel" ? "URL" : "SPM")],
  }));
  return draft;
}
export const componentType = (c: { type: string }) => c.type.toUpperCase();
export function inferKind(t: TemplateLike): TemplateKind {
  const carousel = t.components.find(c => componentType(c) === "CAROUSEL");
  if (carousel) return carousel.cards?.[0]?.components.some(c => c.format?.toUpperCase() === "PRODUCT") ? "productCarousel" : "carousel";
  if (t.category.toUpperCase() === "AUTHENTICATION") return "authentication";
  if (t.components.some(c => componentType(c) === "LIMITED_TIME_OFFER")) return "offer";
  if (t.components.some(c => componentType(c) === "CALL_PERMISSION_REQUEST")) return "callPermission";
  const buttons = t.components.flatMap(c => c.buttons ?? []);
  for (const [button, kind] of [["CATALOG", "catalog"], ["MPM", "mpm"], ["SPM", "product"], ["COPY_CODE", "coupon"], ["FLOW", "flow"]] as const) if (buttons.some(b => componentType(b) === button)) return kind;
  return t.components.some(c => componentType(c) === "HEADER" && c.format && c.format.toUpperCase() !== "TEXT") ? "media" : "standard";
}
export function variables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1]))];
}
export function fillVariables(text: string, values: Record<string, string>) {
  return text.replace(/\{\{([^{}]+)\}\}/g, (whole, name: string) => values[name] || whole);
}
export function duplicateTemplate(t: TemplateLike): TemplateDraft {
  const d = newDraft(inferKind(t));
  d.name = `${t.name.slice(0, 505)}_copia`; d.language = t.language;
  d.category = t.category.toUpperCase() as TemplateDraft["category"];
  d.parameterFormat = (t.parameter_format?.toLowerCase() as ParameterFormat | undefined) ?? (t.components.some(c => variables(c.text ?? "").some(v => !/^\d+$/.test(v))) ? "named" : "positional");
  function read(components: TemplateLike["components"]) {
    const h = components.find(c => componentType(c) === "HEADER");
    const b = components.find(c => componentType(c) === "BODY");
    function examples(c: typeof h, header = false) {
      const named = header ? c?.example?.header_text_named_params : c?.example?.body_text_named_params;
      if (named) return Object.fromEntries(named.map(n => [n.param_name, n.example]));
      const positional = header ? c?.example?.header_text : c?.example?.body_text?.[0];
      return Object.fromEntries(variables(c?.text ?? "").map((v, i) => [v, positional?.[i] ?? ""]));
    }
    return {
      header: { ...emptyHeader(), format: (h?.format?.toUpperCase() ?? "NONE") as HeaderDraft["format"], text: h?.text ?? "", examples: examples(h, true), handle: h?.example?.header_handle?.[0] ?? "" },
      body: { text: b?.text ?? "", examples: examples(b) },
      buttons: components.flatMap(c => c.buttons ?? []).map(b => ({ ...b, type: componentType(b) as ButtonDraft["type"], variableExample: Array.isArray(b.example) ? (b.url && b.example[0]?.startsWith(b.url.split("{{")[0]) ? b.example[0].slice(b.url.split("{{")[0].length) : b.example[0]) : "" })),
    };
  }
  Object.assign(d, read(t.components));
  d.footer = t.components.find(c => componentType(c) === "FOOTER")?.text ?? "";
  d.cards = t.components.find(c => componentType(c) === "CAROUSEL")?.cards?.map(c => read(c.components)) ?? [];
  const offer = t.components.find(c => componentType(c) === "LIMITED_TIME_OFFER")?.limited_time_offer;
  if (offer) d.offer = { text: offer.text, hasExpiration: !!offer.has_expiration };
  if (d.kind === "authentication") {
    const b = d.buttons[0];
    d.auth = { ...d.auth, otpType: b?.otp_type?.toUpperCase() as TemplateDraft["auth"]["otpType"] || "COPY_CODE", text: b?.text ?? "Copy code", autofillText: b?.autofill_text ?? "Autofill", apps: b?.supported_apps ?? d.auth.apps,
      security: t.components.find(c => componentType(c) === "BODY")?.add_security_recommendation ?? false,
      expirationMinutes: t.components.find(c => componentType(c) === "FOOTER")?.code_expiration_minutes };
    // Meta's read response uses URL for OTP. Never recreate its generated URL.
    d.buttons = []; d.body = { text: "", examples: {} }; d.footer = "";
  }
  return d;
}
