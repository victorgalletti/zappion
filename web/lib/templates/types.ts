// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Official Meta documentation consulted on 2026-10-14 (Cloud API, backend v24.0).
 * Pages read directly after web search returned HTTP 429:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/overview
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-media/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/coupon-templates/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/limited-time-offer-templates/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/autofill-button-authentication-templates/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/zero-tap-authentication-templates/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-call-permission-request-templates/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/call-button-messages-deep-links/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalog-template-messages/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/mpm-template-messages/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/spm-template-messages/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/product-card-carousel-template-messages/
 * https://developers.facebook.com/docs/graph-api/guides/upload/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api/
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
 * Flow references attempted (Meta currently serves login instead of documentation):
 * https://developers.facebook.com/docs/whatsapp/flows/guides/sending-a-flow/
 * https://developers.facebook.com/docs/whatsapp/flows/reference/messages/
 * Official Meta collection fallback:
 * https://www.postman.com/meta/whatsapp-business-platform/request/gysmavw/create-flow-template-message-by-id
 * GIF is exclusive to Marketing Messages API, not this Cloud API integration.
 * Regional payments, booking/location requests and unified catalogs need separate
 * integrations; unknown components are preserved on read and blocked on send.
 */
export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type ParameterFormat = "positional" | "named";
export type HeaderFormat = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION" | "PRODUCT";
export type TemplateKind = "standard" | "media" | "carousel" | "productCarousel" | "catalog" | "mpm" | "product" | "offer" | "coupon" | "authentication" | "flow" | "callPermission";
export type ButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "OTP" | "FLOW" | "CATALOG" | "MPM" | "SPM" | "VOICE_CALL";
export interface SupportedApp { package_name: string; signature_hash: string }
export interface TemplateButton {
  type: ButtonType;
  text?: string;
  url?: string;
  phone_number?: string;
  example?: string | string[];
  otp_type?: "COPY_CODE" | "ONE_TAP" | "ZERO_TAP";
  autofill_text?: string;
  supported_apps?: SupportedApp[];
  zero_tap_terms_accepted?: boolean;
  flow_id?: string;
  flow_action?: "navigate" | "data_exchange";
  navigate_screen?: string;
  ttl_minutes?: number;
}
export interface ComponentExample {
  header_text?: string[];
  body_text?: string[][];
  header_handle?: string[];
  header_text_named_params?: { param_name: string; example: string }[];
  body_text_named_params?: { param_name: string; example: string }[];
}
/** Broad read shape: Meta can introduce new component types; do not silently send them. */
export interface TemplateComponent {
  type: string;
  text?: string;
  format?: string;
  example?: ComponentExample;
  buttons?: TemplateButton[];
  cards?: { components: TemplateComponent[] }[];
  limited_time_offer?: { text: string; has_expiration?: boolean };
  add_security_recommendation?: boolean;
  code_expiration_minutes?: number;
}
export interface CreateTemplatePayload {
  name: string;
  category: TemplateCategory;
  language: string;
  parameter_format: ParameterFormat;
  components: TemplateComponent[];
}
export interface TextDraft { text: string; examples: Record<string, string> }
export interface HeaderDraft extends TextDraft { format: HeaderFormat; handle: string; previewUrl: string }
export interface ButtonDraft extends TemplateButton { variableExample?: string }
export interface CardDraft { header: HeaderDraft; body: TextDraft; buttons: ButtonDraft[] }
export interface TemplateDraft {
  name: string;
  category: TemplateCategory;
  language: string;
  kind: TemplateKind;
  parameterFormat: ParameterFormat;
  header: HeaderDraft;
  body: TextDraft;
  footer: string;
  buttons: ButtonDraft[];
  cards: CardDraft[];
  offer: { text: string; hasExpiration: boolean };
  auth: { security: boolean; expirationMinutes: number | undefined; otpType: "COPY_CODE" | "ONE_TAP" | "ZERO_TAP"; text: string; autofillText: string; apps: SupportedApp[]; termsAccepted: boolean };
}
export interface TemplateLike {
  name: string; language: string; category: string; status?: string;
  parameter_format?: ParameterFormat; components: TemplateComponent[];
}
export interface ValidationIssue { path: string; message: string }
/** Send fields are scoped by root/card and component/index, never mixed together. */
export type SendValues = Record<string, string>;
export interface SendField { key: string; label: string; required: boolean; kind?: "text" | "url" | "number" | "datetime-local" | "textarea"; maxLength?: number }
export type GraphObject = { [key: string]: import("@/lib/types").Json };
export interface TemplateSendPayload { name: string; language: { code: string }; components?: GraphObject[] }
