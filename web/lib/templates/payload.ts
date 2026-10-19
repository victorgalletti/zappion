// SPDX-License-Identifier: AGPL-3.0-only
import { variables } from "./catalog";
import { validateDraft } from "./validation";
import type { ButtonDraft, CreateTemplatePayload, HeaderDraft, ParameterFormat, TemplateComponent, TemplateDraft, TextDraft } from "./types";

function textComponent(type: "HEADER" | "BODY", field: TextDraft, format: ParameterFormat): TemplateComponent {
  const names = variables(field.text);
  const example = names.length ? format === "named" ? {
    [type === "HEADER" ? "header_text_named_params" : "body_text_named_params"]: names.map(param_name => ({ param_name, example: field.examples[param_name] })),
  } : type === "HEADER" ? { header_text: names.map(n => field.examples[n]) } : { body_text: [names.map(n => field.examples[n])] } : undefined;
  return { type, text: field.text, ...(example ? { example } : {}) };
}
function headerComponent(h: HeaderDraft, format: ParameterFormat): TemplateComponent[] {
  if (h.format === "NONE") return [];
  if (h.format === "TEXT") return [{ ...textComponent("HEADER", h, format), format: "TEXT" }];
  return [{ type: "HEADER", format: h.format, ...(["IMAGE", "VIDEO", "DOCUMENT"].includes(h.format) ? { example: { header_handle: [h.handle] } } : {}) }];
}
function buttonComponent(buttons: ButtonDraft[], offer = false): TemplateComponent[] {
  return buttons.length ? [{ type: "BUTTONS", buttons: buttons.map(b => {
    switch (b.type) {
      case "URL": return { type: b.type, text: b.text, url: b.url, ...(variables(b.url ?? "").length ? { example: [offer ? (b.url ?? "").replace(/\{\{[^{}]+\}\}/g, b.variableExample ?? "") : b.variableExample!] } : {}) };
      case "PHONE_NUMBER": return { type: b.type, text: b.text, phone_number: b.phone_number };
      case "COPY_CODE": return { type: b.type, example: b.example };
      case "CATALOG": return { type: b.type, text: "View catalog" };
      case "MPM": return { type: b.type, text: "View items" };
      case "SPM": return { type: b.type, text: "View" };
      case "FLOW": return { type: b.type, text: b.text, flow_id: b.flow_id, flow_action: b.flow_action, ...(b.flow_action === "navigate" ? { navigate_screen: b.navigate_screen } : {}) };
      case "VOICE_CALL": return { type: b.type, text: b.text, ttl_minutes: b.ttl_minutes };
      default: return { type: b.type, text: b.text };
    }
  }) }] : [];
}
/** Preview tolerates incomplete drafts; submission always calls the validated builder. */
export function draftComponents(d: TemplateDraft): TemplateComponent[] {
  if (d.kind === "authentication") return [
    { type: "BODY", add_security_recommendation: d.auth.security },
    ...(d.auth.expirationMinutes === undefined ? [] : [{ type: "FOOTER", code_expiration_minutes: d.auth.expirationMinutes }]),
    { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: d.auth.otpType,
      ...(d.auth.text ? { text: d.auth.text } : {}),
      ...(d.auth.otpType !== "COPY_CODE" ? { autofill_text: d.auth.autofillText || undefined, supported_apps: d.auth.apps } : {}),
      ...(d.auth.otpType === "ZERO_TAP" ? { zero_tap_terms_accepted: d.auth.termsAccepted } : {}),
    }] },
  ];
  return [
    ...headerComponent(d.header, d.parameterFormat),
    ...(d.kind === "offer" ? [{ type: "LIMITED_TIME_OFFER", limited_time_offer: { text: d.offer.text, has_expiration: d.offer.hasExpiration } }] : []),
    textComponent("BODY", d.body, d.parameterFormat),
    ...(d.footer ? [{ type: "FOOTER", text: d.footer }] : []),
    ...buttonComponent(d.buttons, d.kind === "offer"),
    ...(d.kind === "callPermission" ? [{ type: "CALL_PERMISSION_REQUEST" }] : []),
    ...(["carousel", "productCarousel"].includes(d.kind) ? [{ type: "CAROUSEL", cards: d.cards.map(card => ({ components: [
      ...headerComponent(card.header, d.parameterFormat), ...(card.body.text ? [textComponent("BODY", card.body, d.parameterFormat)] : []), ...buttonComponent(card.buttons),
    ] })) }] : []),
  ];
}
export function buildCreatePayload(d: TemplateDraft): CreateTemplatePayload {
  const issues = validateDraft(d);
  if (issues.length) throw new Error(issues.map(i => i.message).join("\n"));
  return { name: d.name, category: d.category, language: d.language, parameter_format: d.parameterFormat, components: draftComponents(d) };
}
