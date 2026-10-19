// SPDX-License-Identifier: AGPL-3.0-only
import { getT } from "@/lib/i18n";
import { componentType, fillVariables, variables } from "./catalog";
import { LANGUAGE_CODES } from "./languages";
import type { ButtonDraft, ParameterFormat, TemplateDraft, TextDraft, ValidationIssue } from "./types";

export const LIMITS = { name: 512, header: 60, body: 1024, footer: 60, button: 25, url: 2000, buttons: 10, cards: 10, cardBody: 160, offerBody: 600, offerText: 16, coupon: 20, offerCode: 15, otp: 15 } as const;
export function isWebUrl(value: string) {
  try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) && !!u.hostname && !u.username && !u.password; } catch { return false; }
}
export function validateDraft(d: TemplateDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (path: string, message: string) => issues.push({ path, message });
  const length = (path: string, text: string, max: number, required = true) => {
    if (required && !text.trim()) fail(path, getT().templatesValidation.fillOutThisField);
    if ([...text].length > max) fail(path, getT().templatesValidation.limitOfCharacters(max));
  };
  if (!/^[a-z0-9_]+$/.test(d.name) || d.name.length > LIMITS.name) fail("name", getT().templatesValidation.useUpTo512LowercaseLettersNumbersAnd);
  if (!(LANGUAGE_CODES as readonly string[]).includes(d.language)) fail("language", getT().templatesValidation.selectALanguageSupportedByMeta);
  if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(d.category)) fail("category", getT().templatesValidation.invalidCategory);
  const marketing = ["carousel", "productCarousel", "catalog", "mpm", "product", "offer", "coupon"];
  if (marketing.includes(d.kind) && d.category !== "MARKETING") fail("category", getT().templatesValidation.thisTypeRequiresTheMarketingCategory);
  if ((d.category === "AUTHENTICATION") !== (d.kind === "authentication")) fail("category", getT().templatesValidation.authenticationOnlySupportsThePredefinedOtpTemplate);
  if (!["named", "positional"].includes(d.parameterFormat)) fail("parameterFormat", getT().templatesValidation.invalidVariableFormat);
  function text(path: string, field: TextDraft, max: number, header = false, required = true, format: ParameterFormat = d.parameterFormat) {
    length(path, field.text, max, required);
    const vars = variables(field.text);
    const residue = field.text.replace(/\{\{[^{}]+\}\}/g, "");
    if (/[{}]/.test(residue)) fail(path, getT().templatesValidation.variableHasIncompleteOrInvalidBraces);
    if (format === "named" && vars.some(v => !/^[a-z_]+$/.test(v))) fail(path, getT().templatesValidation.namedVariablesUseOnlyLowercaseLettersAndUnderscores);
    if (format === "positional" && vars.some((v, i) => v !== String(i + 1))) fail(path, getT().templatesValidation.positionalVariablesMustAppearInSequence12);
    if (header && vars.length > 1) fail(path, getT().templatesValidation.headersSupportOnlyOneVariable);
    if (header && /[*_~`]/.test(residue)) fail(path, getT().templatesValidation.headersDoNotSupportMarkdownFormatting);
    if (!header && (/^\s*\{\{/.test(field.text) || /\}\}\s*$/.test(field.text))) fail(path, getT().templatesValidation.theBodyCannotStartOrEndWithA);
    if (/\}\}\s*\{\{/.test(field.text)) fail(path, getT().templatesValidation.separateVariablesWithText);
    for (const v of vars) {
      if (!field.examples[v]?.trim()) fail(`${path}.${v}`, getT().templatesValidation.enterAnExampleFor(v));
      if (/[\r\n\t]/.test(field.examples[v] ?? "")) fail(`${path}.${v}`, getT().templatesValidation.examplesMustFitOnOneLine);
    }
    if ([...fillVariables(field.text, field.examples)].length > max) fail(path, getT().templatesValidation.textWithExamplesExceedsCharacters(max));
  }
  function header(path: string, h: TemplateDraft["header"]) {
    if (!["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION", "PRODUCT"].includes(h.format)) fail(path, getT().templatesValidation.headerFormatIsNotSupportedByTheCloud);
    if (h.format === "TEXT") text(path, h, LIMITS.header, true);
    if (["IMAGE", "VIDEO", "DOCUMENT"].includes(h.format)) {
      if (!h.handle.trim()) fail(`${path}.handle`, getT().templatesValidation.enterTheHeaderHandleFromMetaSResumable);
      else if (!/^\d+:/.test(h.handle)) fail(`${path}.handle`, getT().templatesValidation.useAHandleReturnedByMetaSResumable);
    }
  }
  function buttons(path: string, list: ButtonDraft[], card = false) {
    if (list.length > (card ? 2 : LIMITS.buttons)) fail(path, card ? getT().templatesValidation.cardsSupportUpToTwoButtons : getT().templatesValidation.useUpToTenButtons);
    for (const [type, max] of [["URL", 2], ["PHONE_NUMBER", 1], ["COPY_CODE", 1], ["FLOW", 1], ["VOICE_CALL", 1]] as const) if (list.filter(b => b.type === type).length > max) fail(path, getT().templatesValidation.useUpToButtons(max, type));
    const groups = list.map(b => b.type === "QUICK_REPLY" ? "q" : "a").join("");
    if (!/^(q*a*|a*q*)$/.test(groups)) fail(path, getT().templatesValidation.groupQuickRepliesBeforeOrAfterTheOther);
    list.forEach((b, i) => {
      const p = `${path}.${i}`;
      if (card && !["QUICK_REPLY", "URL", "PHONE_NUMBER", "SPM"].includes(b.type)) fail(p, getT().templatesValidation.thisButtonTypeIsNotAllowedOnA);
      if (!["QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE", "FLOW", "VOICE_CALL", "CATALOG", "MPM", "SPM"].includes(b.type)) fail(p, getT().templatesValidation.unsupportedButtonType);
      if (!["COPY_CODE", "CATALOG", "MPM", "SPM"].includes(b.type)) length(`${p}.text`, b.text ?? "", b.type === "VOICE_CALL" ? 20 : LIMITS.button);
      if (variables(b.text ?? "").length) fail(p, getT().templatesValidation.buttonLabelsDoNotSupportVariables);
      if (b.type === "URL") {
        const url = b.url ?? ""; const vars = variables(url);
        length(`${p}.url`, url, LIMITS.url);
        if (!isWebUrl(url.replace(/\{\{[^{}]+\}\}/g, "example"))) fail(p, getT().templatesValidation.enterAValidHttpOrHttpsUrl);
        if (vars.length > 1 || (vars.length && !url.endsWith(`{{${vars[0]}}}`)) || /[{}]/.test(url.replace(/\{\{[^{}]+\}\}/g, ""))) fail(p, getT().templatesValidation.urlsSupportOneVariableAtTheEnd);
        if (vars.length && (d.parameterFormat === "positional" ? vars[0] !== "1" : !/^[a-z_]+$/.test(vars[0]))) fail(p, getT().templatesValidation.theUrlVariableDoesNotMatchTheSelected);
        if (vars.length && !b.variableExample?.trim()) fail(p, getT().templatesValidation.enterAnExampleForTheUrlVariable);
        if (vars.length && url.replace(`{{${vars[0]}}}`, b.variableExample ?? "").length > LIMITS.url) fail(p, getT().templatesValidation.urlWithExampleExceeds2000Characters);
      }
      if (b.type === "PHONE_NUMBER" && (!/^\+?[0-9 -]{5,20}$/.test(b.phone_number ?? "") || (b.phone_number ?? "").replace(/\D/g, "").length < 5)) fail(p, getT().templatesValidation.enterAPhoneNumberWithACountryCode);
      if (b.type === "COPY_CODE") {
        if (d.category !== "MARKETING") fail(p, getT().templatesValidation.couponsRequireMarketingUseOtpForAuthentication);
        length(`${p}.example`, typeof b.example === "string" ? b.example : "", d.kind === "offer" ? LIMITS.offerCode : LIMITS.coupon);
      }
      if (b.type === "FLOW") {
        if (!/^\d+$/.test(b.flow_id ?? "")) fail(p, getT().templatesValidation.enterTheIdOfTheFlowPublishedOn);
        if (!["navigate", "data_exchange"].includes(b.flow_action ?? "")) fail(p, getT().templatesValidation.selectTheFlowAction);
        if (b.flow_action === "navigate" && !b.navigate_screen?.trim()) fail(p, getT().templatesValidation.enterTheInitialFlowScreen);
      }
      if (b.type === "VOICE_CALL" && (!Number.isInteger(b.ttl_minutes) || b.ttl_minutes! < 1440 || b.ttl_minutes! > 43200)) fail(p, getT().templatesValidation.callValidity1440To43200Minutes);
    });
  }
  if (d.kind === "authentication") {
    if (d.header.format !== "NONE" || d.footer || d.buttons.length || d.cards.length || d.body.text) fail("auth", getT().templatesValidation.otpUsesOnlyMetaSPredefinedTextWith);
    if (d.parameterFormat !== "positional") fail("auth", getT().templatesValidation.otpUsesOnePositionalVariableForTheCode);
    if (!["COPY_CODE", "ONE_TAP", "ZERO_TAP"].includes(d.auth.otpType)) fail("auth", getT().templatesValidation.invalidOtpType);
    const minutes = d.auth.expirationMinutes;
    if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 90)) fail("auth.expiration", getT().templatesValidation.expirationMustBeBetween1And90Minutes);
    length("auth.text", d.auth.text, 25, false); length("auth.autofillText", d.auth.autofillText, 25, false);
    if (d.auth.otpType !== "COPY_CODE") {
      if (!d.auth.apps.length || d.auth.apps.length > 5) fail("auth.apps", getT().templatesValidation.enterOneToFiveAndroidApps);
      d.auth.apps.forEach((app, i) => {
        if (app.package_name.length > 224 || !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(app.package_name)) fail(`auth.apps.${i}`, getT().templatesValidation.invalidAndroidPackageName);
        if (!/^[a-zA-Z0-9+/=]{11}$/.test(app.signature_hash)) fail(`auth.apps.${i}`, getT().templatesValidation.signatureHashMustBe11Characters);
      });
    }
    if (d.auth.otpType === "ZERO_TAP" && !d.auth.termsAccepted) fail("auth.terms", getT().templatesValidation.confirmThatYouUnderstandTheZeroTapAuthentication);
    return issues;
  }
  text("body", d.body, d.kind === "offer" ? LIMITS.offerBody : d.kind === "product" ? LIMITS.cardBody : LIMITS.body);
  header("header", d.header);
  length("footer", d.footer, LIMITS.footer, false);
  if (/[{}*_~`]/.test(d.footer)) fail("footer", getT().templatesValidation.footersDoNotSupportVariablesOrMarkdown);
  buttons("buttons", d.buttons);
  const has = (type: string) => d.buttons.filter(b => componentType(b) === type).length;
  if (["carousel", "productCarousel", "callPermission"].includes(d.kind) && (d.header.format !== "NONE" || d.footer || d.buttons.length)) fail("components", getT().templatesValidation.thisTypeUsesOnlyABodyAndIts);
  if (!["carousel", "productCarousel"].includes(d.kind) && d.cards.length) fail("cards", getT().templatesValidation.cardsAreOnlyAllowedInCarousels);
  if (d.kind === "media" && !["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(d.header.format)) fail("header", getT().templatesValidation.selectAnImageVideoDocumentOrLocation);
  if (d.kind === "catalog" && (d.header.format !== "NONE" || d.buttons.length !== 1 || !has("CATALOG"))) fail("catalog", getT().templatesValidation.catalogUsesABodyOptionalFooterAndOne);
  if (d.kind === "mpm" && (d.header.format !== "TEXT" || d.buttons.length !== 1 || !has("MPM"))) fail("mpm", getT().templatesValidation.mpmRequiresATextHeaderAndOneProducts);
  if (d.kind === "product" && (d.header.format !== "PRODUCT" || d.buttons.length !== 1 || !has("SPM"))) fail("product", getT().templatesValidation.productRequiresAProductHeaderAndOneSpm);
  if (d.header.format === "PRODUCT" && d.kind !== "product") fail("header", getT().templatesValidation.aProductHeaderRequiresTheProductType);
  for (const [type, kind] of [["CATALOG", "catalog"], ["MPM", "mpm"], ["SPM", "product"]]) if (has(type) && d.kind !== kind) fail("buttons", getT().templatesValidation.useTheTypeForThisButton(kind));
  if (d.kind === "coupon" && !has("COPY_CODE")) fail("buttons", getT().templatesValidation.couponRequiresACopyCodeButton);
  if (d.kind === "flow" && !has("FLOW")) fail("buttons", getT().templatesValidation.flowRequiresAFlowButton);
  if (d.kind === "offer") {
    length("offer.text", d.offer.text, LIMITS.offerText);
    if (variables(d.offer.text).length) fail("offer.text", getT().templatesValidation.offerTitlesDoNotSupportVariables);
    if (d.footer || !["NONE", "IMAGE", "VIDEO"].includes(d.header.format)) fail("offer", getT().templatesValidation.offerSupportsAnOptionalImageVideoHeaderWithout);
    if (!has("URL") || d.buttons.some(b => !["COPY_CODE", "URL"].includes(b.type)) || d.buttons.length > 2 || (has("COPY_CODE") && d.buttons[0].type !== "COPY_CODE")) fail("buttons", getT().templatesValidation.offerSupportsOneUrlAndAnOptionalCoupon);
  }
  if (["carousel", "productCarousel"].includes(d.kind)) {
    if (d.cards.length < 2 || d.cards.length > 10 || (d.kind === "productCarousel" && d.cards.length !== 2)) fail("cards", d.kind === "productCarousel" ? getT().templatesValidation.createExactlyTwoProductCardsSendUpTo : getT().templatesValidation.createTwoToTenCards);
    const first = d.cards[0];
    d.cards.forEach((card, i) => {
      const p = `cards.${i}`; header(`${p}.header`, card.header);
      if (d.kind === "carousel") {
        if (!["IMAGE", "VIDEO"].includes(card.header.format)) fail(p, getT().templatesValidation.cardsRequireAnImageOrVideo);
        if (card.buttons.some(b => b.type === "SPM")) fail(p, getT().templatesValidation.spmRequiresAProductCarousel);
        if (card.body.text) text(`${p}.body`, card.body, LIMITS.cardBody, false, false);
      } else if (card.header.format !== "PRODUCT" || card.body.text || card.buttons.length !== 1 || !["SPM", "URL"].includes(card.buttons[0]?.type)) fail(p, getT().templatesValidation.productCardsRequireProductAndOneSpmOr);
      buttons(`${p}.buttons`, card.buttons, true);
      if (first && (card.header.format !== first.header.format || !!card.body.text !== !!first.body.text || card.buttons.map(b => b.type).join() !== first.buttons.map(b => b.type).join())) fail(p, getT().templatesValidation.allCardsMustHaveTheSameFormatBody);
    });
  }
  return issues;
}
