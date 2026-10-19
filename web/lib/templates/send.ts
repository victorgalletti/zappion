// SPDX-License-Identifier: AGPL-3.0-only
import { getT } from "@/lib/i18n";
import { componentType, fillVariables, inferKind, variables } from "./catalog";
import { isWebUrl, LIMITS } from "./validation";
import type { GraphObject, SendField, SendValues, TemplateComponent, TemplateLike, TemplateSendPayload, ValidationIssue } from "./types";

const supportedComponents = ["HEADER", "BODY", "FOOTER", "BUTTONS", "CAROUSEL", "LIMITED_TIME_OFFER", "CALL_PERMISSION_REQUEST"];
const supportedButtons = ["QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE", "OTP", "FLOW", "CATALOG", "MPM", "SPM", "VOICE_CALL"];
export function unsupportedTemplate(t: TemplateLike): boolean {
  function check(cs: TemplateComponent[]): boolean {
    return cs.some(c => !supportedComponents.includes(componentType(c)) || (c.format && !["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION", "PRODUCT"].includes(c.format.toUpperCase())) ||
      c.buttons?.some(b => !supportedButtons.includes(componentType(b))) || c.cards?.some(card => check(card.components)));
  }
  return check(t.components);
}
export function sendCards(t: TemplateLike, values: SendValues): { components: TemplateComponent[] }[] {
  const cards = t.components.find(c => componentType(c) === "CAROUSEL")?.cards ?? [];
  if (inferKind(t) !== "productCarousel") return cards;
  const requested = Number(values.cardCount ?? cards.length);
  const count = Number.isInteger(requested) ? Math.min(10, Math.max(2, requested)) : cards.length;
  return Array.from({ length: count }, (_, i) => cards[i] ?? cards[0]);
}
export function sendFields(t: TemplateLike, values: SendValues = {}): SendField[] {
  const fields: SendField[] = [];
  const add = (key: string, label: string, required = true, kind: SendField["kind"] = "text", maxLength?: number) => fields.push({ key, label, required, kind, maxLength });
  if (t.category.toUpperCase() === "AUTHENTICATION") { add("otp", getT().templatesSend.verificationCode, true, "text", LIMITS.otp); return fields; }
  if (inferKind(t) === "productCarousel") add("cardCount", getT().templatesSend.numberOfProducts2To10, false, "number");
  function collect(cs: TemplateComponent[], scope: string, label = "") {
    cs.forEach(c => {
      const type = componentType(c);
      if (type === "BODY" || (type === "HEADER" && c.format?.toUpperCase() === "TEXT")) variables(c.text ?? "").forEach(v => add(`${scope}.${type.toLowerCase()}.${v}`, getT().templatesSend.variableLabel(label, type, v)));
      if (type === "HEADER") {
        const format = c.format?.toUpperCase();
        if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format ?? "")) add(`${scope}.media`, getT().templatesSend.mediaLabel(label, format));
        if (format === "LOCATION") {
          add(`${scope}.latitude`, getT().templatesSend.latitude90To90(label), true, "number"); add(`${scope}.longitude`, getT().templatesSend.longitude180To180(label), true, "number");
          add(`${scope}.locationName`, getT().templatesSend.locationName(label)); add(`${scope}.address`, getT().templatesSend.address(label));
        }
        if (format === "PRODUCT") { add(`${scope}.catalogId`, getT().templatesSend.catalogId(label)); add(`${scope}.productId`, getT().templatesSend.productIdSku(label)); }
      }
      if (type === "LIMITED_TIME_OFFER" && c.limited_time_offer?.has_expiration) add("expiration", getT().templatesSend.offerExpiresAt, true, "datetime-local");
      if (type === "BUTTONS") c.buttons?.forEach((b, i) => {
        const p = `${scope}.button.${i}`; const bt = componentType(b);
        if (bt === "URL") variables(b.url ?? "").forEach(v => add(p, getT().templatesSend.websiteLabel(label, b.text, v)));
        if (bt === "COPY_CODE") add(p, getT().templatesSend.couponCode(label), true, "text", inferKind(t) === "offer" ? LIMITS.offerCode : LIMITS.coupon);
        if (bt === "QUICK_REPLY") add(p, getT().templatesSend.replyId(label, b.text), false, "text", 128);
        if (bt === "FLOW") { add(`${p}.token`, getT().templatesSend.flowIdToken(label), false); add(`${p}.data`, getT().templatesSend.initialFlowDataJsonObjectOptional(label), false, "textarea"); }
        if (bt === "CATALOG" || bt === "MPM") add(`${p}.thumbnail`, getT().templatesSend.thumbnailLabel(label, bt === "CATALOG"), bt === "MPM");
        if (bt === "MPM") add(`${p}.sections`, getT().templatesSend.sectionsOneLinePerSectionInTheFormat(label), true, "textarea");
        if (bt === "VOICE_CALL") { add(`${p}.ttl`, getT().templatesSend.callValidityInMinutesOptional1To43200(label), false, "number"); add(`${p}.payload`, getT().templatesSend.callIdOptional(label), false, "text", 512); }
      });
    });
  }
  collect(t.components, "root");
  sendCards(t, values).forEach((card, i) => collect(card.components, `card.${i}`, getT().templatesSend.card(i + 1)));
  return fields;
}
export function parseSections(text: string) {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const [title, items = "", ...extra] = line.split("|");
    if (extra.length) throw new Error(getT().templatesSend.useOnlyOneSeparatorPerSection);
    return { title: title.trim(), product_items: items.split(",").map(s => s.trim()).filter(Boolean).map(product_retailer_id => ({ product_retailer_id })) };
  });
}
export function validateSend(t: TemplateLike, v: SendValues, now = Date.now()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (path: string, message: string) => issues.push({ path, message });
  if (t.status && t.status !== "APPROVED") fail("status", getT().templatesSend.onlyApprovedTemplatesCanBeSent);
  if (unsupportedTemplate(t)) fail("components", getT().templatesSend.thisTemplateHasComponentsThatAreNotYet);
  sendFields(t, v).forEach(f => {
    const value = v[f.key] ?? "";
    if (f.required && !value.trim()) fail(f.key, getT().templatesSend.fillOut(f.label));
    if (f.maxLength && [...value].length > f.maxLength) fail(f.key, getT().templatesSend.limitOfCharacters(f.label, f.maxLength));
    if (f.key.endsWith(".media") && value && !(/^\d+$/.test(value) || isWebUrl(value))) fail(f.key, getT().templatesSend.mediaRequiresAPublicHttpHttpsUrlOr);
    if (/\.(latitude|longitude)$/.test(f.key) && value) {
      const limit = f.key.endsWith("latitude") ? 90 : 180;
      if (!Number.isFinite(Number(value)) || Math.abs(Number(value)) > limit) fail(f.key, getT().templatesSend.coordinateIsOutsideTheAllowedRange);
    }
    if (f.key.endsWith("catalogId") && value && !/^\d+$/.test(value)) fail(f.key, getT().templatesSend.catalogIdMustBeNumeric);
    if (f.key.endsWith(".ttl") && value && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 43200)) fail(f.key, getT().templatesSend.callValidityMustBeBetween1And43200);
    if (f.key.endsWith(".data") && value) {
      try { const data = JSON.parse(value); if (!data || Array.isArray(data) || typeof data !== "object") throw new Error(); }
      catch { fail(f.key, getT().templatesSend.flowDataMustBeAValidJsonObject); }
    }
    if (f.key.endsWith(".sections") && value) {
      try {
        const sections = parseSections(value); const count = sections.reduce((n, s) => n + s.product_items.length, 0);
        if (sections.length < 1 || sections.length > 10 || count < 1 || count > 30 || sections.some(s => !s.title || [...s.title].length > 24 || /[*_~`]/.test(s.title) || !s.product_items.length)) fail(f.key, getT().templatesSend.useUpTo10SectionsTitlesOfUp);
      } catch (e) { fail(f.key, (e as Error).message); }
    }
  });
  if (v.expiration && (!Number.isFinite(new Date(v.expiration).getTime()) || new Date(v.expiration).getTime() <= now)) fail("expiration", getT().templatesSend.chooseAFutureExpirationForTheOffer);
  if (v.cardCount && (!Number.isInteger(Number(v.cardCount)) || Number(v.cardCount) < 2 || Number(v.cardCount) > 10)) fail("cardCount", getT().templatesSend.sendTwoToTenProducts);
  if (v.otp && (/\s|[{}*_~`]|\p{Extended_Pictographic}/u.test(v.otp))) fail("otp", getT().templatesSend.otpCodesDoNotSupportSpacesMarkdownOr);
  function textLimits(cs: TemplateComponent[], scope: string, card: boolean) {
    cs.forEach(c => {
      const type = componentType(c);
      if (["BODY", "HEADER"].includes(type) && c.text) {
        const filled = fillVariables(c.text, Object.fromEntries(variables(c.text).map(name => [name, v[`${scope}.${type.toLowerCase()}.${name}`] ?? ""])));
        const max = type === "HEADER" ? 60 : card || inferKind(t) === "product" ? 160 : inferKind(t) === "offer" ? 600 : 1024;
        if ([...filled].length > max) fail(scope, getT().templatesSend.filledTextExceedsCharacters(max));
      }
      c.buttons?.forEach((b, i) => {
        if (componentType(b) === "URL" && b.url && variables(b.url).length && b.url.replace(/\{\{[^{}]+\}\}/g, encodeURIComponent(v[`${scope}.button.${i}`] ?? "")).length > 2000) fail(scope, getT().templatesSend.filledUrlExceeds2000Characters);
      });
    });
  }
  if (t.category.toUpperCase() !== "AUTHENTICATION") { textLimits(t.components, "root", false); sendCards(t, v).forEach((c, i) => textLimits(c.components, `card.${i}`, true)); }
  return issues;
}
export function buildSendPayload(t: TemplateLike, v: SendValues): TemplateSendPayload {
  const issues = validateSend(t, v);
  if (issues.length) throw new Error(issues.map(i => i.message).join("\n"));
  if (t.category.toUpperCase() === "AUTHENTICATION") return { name: t.name, language: { code: t.language }, components: [
    { type: "body", parameters: [{ type: "text", text: v.otp }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: v.otp }] },
  ] };
  function compose(cs: TemplateComponent[], scope: string): GraphObject[] {
    const out: GraphObject[] = [];
    for (const c of cs) {
      const type = componentType(c);
      if (type === "BODY" || (type === "HEADER" && c.format?.toUpperCase() === "TEXT")) {
        const names = variables(c.text ?? "");
        if (names.length) out.push({ type: type.toLowerCase(), parameters: names.map(name => ({ type: "text", text: v[`${scope}.${type.toLowerCase()}.${name}`], ...(/^\d+$/.test(name) ? {} : { parameter_name: name }) })) });
      }
      if (type === "HEADER") {
        const format = c.format?.toLowerCase();
        if (["image", "video", "document"].includes(format ?? "")) { const value = v[`${scope}.media`]; out.push({ type: "header", parameters: [{ type: format!, [format!]: /^\d+$/.test(value) ? { id: value } : { link: value } }] }); }
        if (format === "location") out.push({ type: "header", parameters: [{ type: "location", location: { latitude: v[`${scope}.latitude`], longitude: v[`${scope}.longitude`], name: v[`${scope}.locationName`], address: v[`${scope}.address`] } }] });
        if (format === "product") out.push({ type: "header", parameters: [{ type: "product", product: { catalog_id: v[`${scope}.catalogId`], product_retailer_id: v[`${scope}.productId`] } }] });
      }
      if (type === "LIMITED_TIME_OFFER" && c.limited_time_offer?.has_expiration) out.push({ type: "limited_time_offer", parameters: [{ type: "limited_time_offer", limited_time_offer: { expiration_time_ms: new Date(v.expiration).getTime() } }] });
      if (type === "BUTTONS") c.buttons?.forEach((b, i) => {
        const bt = componentType(b); const p = `${scope}.button.${i}`; const value = v[p]; let parameters: GraphObject[] = [];
        if (bt === "URL" && variables(b.url ?? "").length) {
          const name = variables(b.url!)[0]; parameters = [{ type: "text", text: encodeURIComponent(value), ...(/^\d+$/.test(name) ? {} : { parameter_name: name }) }];
        }
        if (bt === "COPY_CODE") parameters = [{ type: "coupon_code", coupon_code: value }];
        if (bt === "QUICK_REPLY" && value) parameters = [{ type: "payload", payload: value }];
        if (bt === "FLOW") {
          const action: GraphObject = {};
          if (v[`${p}.token`]) action.flow_token = v[`${p}.token`];
          if (v[`${p}.data`]) action.flow_action_data = JSON.parse(v[`${p}.data`]);
          if (Object.keys(action).length) parameters = [{ type: "action", action }];
        }
        if (bt === "CATALOG" && v[`${p}.thumbnail`]) parameters = [{ type: "action", action: { thumbnail_product_retailer_id: v[`${p}.thumbnail`] } }];
        if (bt === "MPM") parameters = [{ type: "action", action: { thumbnail_product_retailer_id: v[`${p}.thumbnail`], sections: parseSections(v[`${p}.sections`]) } }];
        if (bt === "VOICE_CALL") {
          if (v[`${p}.ttl`]) parameters.push({ type: "ttl_minutes", ttl_minutes: Number(v[`${p}.ttl`]) });
          if (v[`${p}.payload`]) parameters.push({ type: "payload", payload: v[`${p}.payload`] });
        }
        if (parameters.length) out.push({ type: "button", sub_type: bt.toLowerCase(), index: String(i), parameters });
      });
    }
    return out;
  }
  const components = compose(t.components, "root");
  const cards = sendCards(t, v);
  if (cards.length) components.push({ type: "carousel", cards: cards.map((card, card_index) => ({ card_index, components: compose(card.components, `card.${card_index}`) })) });
  return { name: t.name, language: { code: t.language }, ...(components.length ? { components } : {}) };
}
export function exampleSendValues(t: TemplateLike): SendValues {
  const values: SendValues = {};
  function read(cs: TemplateComponent[], scope: string) {
    for (const c of cs) {
      const type = componentType(c).toLowerCase(); const names = variables(c.text ?? "");
      if (type === "header" && ["IMAGE", "VIDEO", "DOCUMENT"].includes(c.format?.toUpperCase() ?? "")) {
        values[`${scope}.media`] = c.example?.header_handle?.[0] ?? "";
      }
      const named = type === "header" ? c.example?.header_text_named_params : c.example?.body_text_named_params;
      const positional = type === "header" ? c.example?.header_text : c.example?.body_text?.[0];
      names.forEach((n, i) => { values[`${scope}.${type}.${n}`] = named?.find(x => x.param_name === n)?.example ?? positional?.[i] ?? ""; });
      c.buttons?.forEach((b, i) => { values[`${scope}.button.${i}`] = typeof b.example === "string" ? b.example : b.example?.[0] ?? ""; });
    }
  }
  read(t.components, "root"); sendCards(t, {}).forEach((c, i) => read(c.components, `card.${i}`));
  values.otp = "123456";
  return values;
}
