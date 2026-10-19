// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { duplicateTemplate, inferKind, newButton, newDraft } from "./catalog";
import { buildCreatePayload } from "./payload";
import { buildSendPayload, parseSections, sendFields, unsupportedTemplate, validateSend } from "./send";
import { validateDraft } from "./validation";
import type { SendValues, TemplateDraft, TemplateKind } from "./types";

function fixture(kind: TemplateKind = "standard"): TemplateDraft {
  const d = newDraft(kind); d.name = "test_template";
  if (kind !== "authentication") d.body = { text: "Olá {{1}}, confira sua atualização.", examples: { "1": "Pessoa fictícia" } };
  if (kind === "media") d.header.handle = "4::mock-handle";
  if (kind === "mpm") d.header.text = "Confira seus itens";
  if (kind === "offer" || kind === "coupon") d.buttons[0].example = "MOCK25";
  if (kind === "offer") { d.buttons[1].url = "https://example.com/{{1}}"; d.buttons[1].variableExample = "promo"; }
  if (kind === "flow") { d.buttons[0].flow_id = "123456"; d.buttons[0].navigate_screen = "START"; }
  d.cards.forEach((c, i) => { if (kind === "carousel") { c.header.handle = `4::mock-${i}`; c.body = { text: "Produto {{1}} em destaque.", examples: { "1": "Teste" } }; c.buttons[0].url = "https://example.com/{{1}}"; c.buttons[0].variableExample = `sku-${i}`; } });
  return d;
}
const kinds: TemplateKind[] = ["standard", "media", "carousel", "productCarousel", "catalog", "mpm", "product", "offer", "coupon", "authentication", "flow", "callPermission"];
const stored = (d: TemplateDraft) => ({ ...buildCreatePayload(d), status: "APPROVED" });
function filled(d: TemplateDraft): SendValues {
  return Object.fromEntries(sendFields(stored(d)).filter(f => f.required).map(f => [f.key,
    f.key.endsWith("media") ? "123456" : f.key.endsWith("catalogId") ? "456789" : f.key.endsWith("sections") ? "Teste | sku1, sku2" : f.key === "expiration" ? "2099-01-01T12:00" : f.key === "otp" ? "123456" : "valor fictício",
  ]));
}

describe("Meta creation payloads", () => {
  it.each(kinds)("validates, creates and duplicates %s without leaking editor state", kind => {
    const d = fixture(kind); expect(validateDraft(d)).toEqual([]);
    const p = buildCreatePayload(d); expect(p).toEqual({ name: "test_template", category: d.category, language: "pt_BR", parameter_format: "positional", components: expect.any(Array) });
    expect(inferKind(p)).toBe(kind === "media" ? "media" : kind);
    expect(JSON.stringify(p)).not.toMatch(/previewUrl|variableExample|parameterFormat|"kind"|"handle"/);
    const copy = duplicateTemplate(p); expect(copy.name).toBe("test_template_copia"); expect(validateDraft(copy)).toEqual([]);
    expect(buildCreatePayload(copy).components).toEqual(p.components);
  });
  it("uses nested arrays for positional body and a flat array for header examples", () => {
    const d = fixture(); d.header = { ...d.header, format: "TEXT", text: "Pedido {{1}}", examples: { "1": "123" } }; d.footer = "Obrigado";
    expect(buildCreatePayload(d).components).toEqual([
      { type: "HEADER", format: "TEXT", text: "Pedido {{1}}", example: { header_text: ["123"] } },
      { type: "BODY", text: d.body.text, example: { body_text: [["Pessoa fictícia"]] } }, { type: "FOOTER", text: "Obrigado" },
    ]);
  });
  it("creates named examples and parameter_format exactly as Graph expects", () => {
    const d = fixture(); d.parameterFormat = "named"; d.body = { text: "Olá {{cliente}}, seu pedido está pronto.", examples: { cliente: "Exemplo" } };
    d.header = { ...d.header, format: "TEXT", text: "Pedido {{pedido}}", examples: { pedido: "AB" } };
    d.buttons = [{ type: "URL", text: "Abrir", url: "https://example.com/{{pedido}}", variableExample: "AB" }];
    const p = buildCreatePayload(d); expect(p.parameter_format).toBe("named");
    expect(p.components[0].example).toEqual({ header_text_named_params: [{ param_name: "pedido", example: "AB" }] });
    expect(p.components[1].example).toEqual({ body_text_named_params: [{ param_name: "cliente", example: "Exemplo" }] });
    expect(p.components[2].buttons).toEqual([{ type: "URL", text: "Abrir", url: "https://example.com/{{pedido}}", example: ["AB"] }]);
  });
  it.each(["IMAGE", "VIDEO", "DOCUMENT"] as const)("uses resumable handles for %s", format => {
    const d = fixture("media"); d.header.format = format;
    expect(buildCreatePayload(d).components[0]).toEqual({ type: "HEADER", format, example: { header_handle: ["4::mock-handle"] } });
    d.header.handle = ""; expect(() => buildCreatePayload(d)).toThrow("header_handle");
  });
  it("does not require a handle for location", () => {
    const d = fixture("media"); d.header.format = "LOCATION"; d.header.handle = "";
    expect(buildCreatePayload(d).components[0]).toEqual({ type: "HEADER", format: "LOCATION" });
  });
  it.each(["COPY_CODE", "ONE_TAP", "ZERO_TAP"] as const)("creates %s OTP with no custom body", otpType => {
    const d = fixture("authentication"); d.auth.otpType = otpType; d.auth.termsAccepted = true; d.auth.apps = [{ package_name: "com.example.test", signature_hash: "K8a/AINcGX7" }];
    const p = buildCreatePayload(d);
    expect(p.components[0]).toEqual({ type: "BODY", add_security_recommendation: true });
    expect(p.components[1]).toEqual({ type: "FOOTER", code_expiration_minutes: 10 });
    expect(p.components[2].buttons?.[0]).toEqual({ type: "OTP", otp_type: otpType, text: "Copy code", ...(otpType !== "COPY_CODE" ? { autofill_text: "Autofill", supported_apps: d.auth.apps } : {}), ...(otpType === "ZERO_TAP" ? { zero_tap_terms_accepted: true } : {}) });
  });
  it("creates special commerce and call permission components", () => {
    expect(buildCreatePayload(fixture("catalog")).components.at(-1)).toEqual({ type: "BUTTONS", buttons: [{ type: "CATALOG", text: "View catalog" }] });
    expect(buildCreatePayload(fixture("mpm")).components.at(-1)).toEqual({ type: "BUTTONS", buttons: [{ type: "MPM", text: "View items" }] });
    expect(buildCreatePayload(fixture("product")).components[0]).toEqual({ type: "HEADER", format: "PRODUCT" });
    expect(buildCreatePayload(fixture("callPermission")).components.at(-1)).toEqual({ type: "CALL_PERMISSION_REQUEST" });
    expect(buildCreatePayload(fixture("flow")).components.at(-1)?.buttons?.[0]).toEqual({ type: "FLOW", text: "Flow", flow_id: "123456", flow_action: "navigate", navigate_screen: "START" });
  });
  it("creates LTO with copy-code example and no footer", () => {
    const p = buildCreatePayload(fixture("offer"));
    expect(p.components.find(c => c.type === "LIMITED_TIME_OFFER")).toEqual({ type: "LIMITED_TIME_OFFER", limited_time_offer: { text: "Special offer", has_expiration: true } });
    expect(p.components.at(-1)?.buttons?.[0]).toEqual({ type: "COPY_CODE", example: "MOCK25" });
    expect(p.components.at(-1)?.buttons?.[1].example).toEqual(["https://example.com/promo"]);
  });
  it("creates media carousel with exact card count and product carousel without handles", () => {
    const media = buildCreatePayload(fixture("carousel")).components.at(-1)!;
    expect(media.type).toBe("CAROUSEL"); expect(media.cards).toHaveLength(2);
    expect(media.cards?.[0].components.map(c => c.type)).toEqual(["HEADER", "BODY", "BUTTONS"]);
    const product = buildCreatePayload(fixture("productCarousel")).components.at(-1)!;
    expect(product.cards?.[0].components).toEqual([{ type: "HEADER", format: "PRODUCT" }, { type: "BUTTONS", buttons: [{ type: "SPM", text: "View" }] }]);
  });
});

describe("Meta validation limits and combinations", () => {
  it.each(kinds.filter(k => ["carousel", "productCarousel", "catalog", "mpm", "product", "offer", "coupon"].includes(k)))("rejects Utility for %s", kind => { const d = fixture(kind); d.category = "UTILITY"; expect(validateDraft(d).some(i => i.path === "category")).toBe(true); });
  it.each(["name", "body", "header", "footer", "button", "url"])("checks %s limits", field => {
    const d = fixture();
    if (field === "name") d.name = "a".repeat(513);
    if (field === "body") d.body.text = "a".repeat(1025);
    if (field === "header") { d.header.format = "TEXT"; d.header.text = "a".repeat(61); }
    if (field === "footer") d.footer = "a".repeat(61);
    if (field === "button") d.buttons = [{ type: "QUICK_REPLY", text: "a".repeat(26) }];
    if (field === "url") d.buttons = [{ type: "URL", text: "Abrir", url: `https://example.com/${"a".repeat(2000)}` }];
    expect(validateDraft(d).length).toBeGreaterThan(0);
  });
  it.each(["Olá {{2}}, confira.", "Olá {{1}} e {{3}}, confira.", "Olá {{cliente}}, confira.", "Olá {{1}, confira.", "{{1}} confira.", "Olá {{1}}", "Olá {{1}}{{2}}, confira."])("rejects malformed positional body %s", text => { const d = fixture(); d.body.text = text; expect(validateDraft(d).length).toBeGreaterThan(0); });
  it("requires every example, checks expanded lengths and forbids footer variables", () => {
    const d = fixture(); d.body.examples = {}; expect(() => buildCreatePayload(d)).toThrow("example");
    d.body.examples = { "1": "x".repeat(1024) }; expect(() => buildCreatePayload(d)).toThrow("examples");
    d.body = fixture().body; d.footer = "{{1}}"; expect(() => buildCreatePayload(d)).toThrow("Footers");
  });
  it("validates named parameter names and one-variable headers", () => {
    const d = fixture(); d.parameterFormat = "named"; d.body = { text: "Olá {{Client1}}, tudo bem?", examples: { Client1: "Mock" } }; expect(validateDraft(d).length).toBeGreaterThan(0);
    d.parameterFormat = "positional"; d.body = fixture().body; d.header = { ...d.header, format: "TEXT", text: "{{1}} e {{2}}", examples: { "1": "A", "2": "B" } }; expect(() => buildCreatePayload(d)).toThrow("only one");
  });
  it("enforces button counts, grouping, URL suffix and examples", () => {
    const d = fixture(); d.buttons = Array.from({ length: 11 }, () => newButton("QUICK_REPLY")); expect(() => buildCreatePayload(d)).toThrow("ten");
    d.buttons = [newButton("QUICK_REPLY"), { type: "URL", text: "Site", url: "https://example.com" }, newButton("QUICK_REPLY")]; expect(() => buildCreatePayload(d)).toThrow("Group");
    d.buttons = Array.from({ length: 3 }, () => ({ type: "URL" as const, text: "Site", url: "https://example.com" })); expect(() => buildCreatePayload(d)).toThrow("up to 2");
    d.buttons = [{ type: "URL", text: "Site", url: "https://example.com/{{1}}/path", variableExample: "mock" }]; expect(() => buildCreatePayload(d)).toThrow("at the end");
    d.buttons[0].url = "https://example.com/{{1}}"; d.buttons[0].variableExample = ""; expect(() => buildCreatePayload(d)).toThrow("example");
    d.buttons = [{ type: "URL", text: "Site", url: "javascript:alert(1)" }]; expect(() => buildCreatePayload(d)).toThrow("URL");
  });
  it("validates carousel range and uniform components", () => {
    const d = fixture("carousel"); d.cards.pop(); expect(() => buildCreatePayload(d)).toThrow("two to ten");
    d.cards = fixture("carousel").cards; d.cards[1].header.format = "VIDEO"; expect(() => buildCreatePayload(d)).toThrow("All cards");
    d.cards = fixture("carousel").cards; d.cards[1].body.text = ""; expect(() => buildCreatePayload(d)).toThrow("All cards");
    const p = fixture("productCarousel"); p.cards.push(structuredClone(p.cards[0])); expect(() => buildCreatePayload(p)).toThrow("exactly two");
  });
  it("enforces LTO body/coupon limits, supported headers and footer restrictions", () => {
    const d = fixture("offer"); d.footer = "Rodapé"; expect(() => buildCreatePayload(d)).toThrow("without a footer");
    d.footer = ""; d.body.text = "a".repeat(601); expect(() => buildCreatePayload(d)).toThrow("600");
    d.body = fixture().body; d.buttons[0].example = "a".repeat(16); expect(() => buildCreatePayload(d)).toThrow("15");
  });
  it("validates authentication category, apps, hash, expiry and explicit zero-tap acknowledgment", () => {
    const d = fixture("authentication"); d.auth.expirationMinutes = 91; expect(() => buildCreatePayload(d)).toThrow("90");
    d.auth.expirationMinutes = 10; d.auth.otpType = "ONE_TAP"; expect(() => buildCreatePayload(d)).toThrow("Android");
    d.auth.apps = [{ package_name: "com.example.test", signature_hash: "K8a/AINcGX7" }]; expect(validateDraft(d)).toEqual([]);
    d.auth.otpType = "ZERO_TAP"; expect(() => buildCreatePayload(d)).toThrow("terms"); d.auth.termsAccepted = true; expect(validateDraft(d)).toEqual([]);
    d.body.text = "custom"; expect(() => buildCreatePayload(d)).toThrow("predefined");
  });
  it("limits voice call validity and disallows interactive components with call permissions", () => {
    const d = fixture(); d.buttons = [newButton("VOICE_CALL")]; expect(validateDraft(d)).toEqual([]); d.buttons[0].ttl_minutes = 1439; expect(() => buildCreatePayload(d)).toThrow("1440");
    const permission = fixture("callPermission"); permission.buttons = [newButton("QUICK_REPLY")]; expect(() => buildCreatePayload(permission)).toThrow("only a body");
  });
  it("validates Flow ID/action/screen and commerce structure", () => {
    const d = fixture("flow"); d.buttons[0].navigate_screen = ""; expect(() => buildCreatePayload(d)).toThrow("initial Flow screen");
    d.buttons[0].flow_action = "data_exchange"; expect(validateDraft(d)).toEqual([]); expect(buildCreatePayload(d).components.at(-1)?.buttons?.[0]).not.toHaveProperty("navigate_screen");
    const catalog = fixture("catalog"); catalog.header.format = "TEXT"; catalog.header.text = "Extra"; expect(() => buildCreatePayload(catalog)).toThrow("Catalog");
  });
});

describe("Graph send payloads", () => {
  it.each(kinds)("sends %s using scoped values, without creation examples", kind => {
    const d = fixture(kind); const values = filled(d); const p = buildSendPayload(stored(d), values);
    expect(p.name).toBe("test_template"); expect(p.language).toEqual({ code: "pt_BR" }); expect(p.components?.length).toBeGreaterThan(0);
    expect(JSON.stringify(p)).not.toMatch(/header_handle|body_text|example|previewUrl|parameter_format/);
  });
  it("omits components for entirely static text", () => { const d = fixture(); d.body = { text: "Mensagem estática.", examples: {} }; expect(buildSendPayload(stored(d), {})).toEqual({ name: d.name, language: { code: "pt_BR" } }); });
  it("serializes named header/body values with parameter_name", () => {
    const d = fixture(); d.parameterFormat = "named"; d.body = { text: "Olá {{cliente}}, tudo bem?", examples: { cliente: "Mock" } };
    d.header = { ...d.header, format: "TEXT", text: "Pedido {{pedido}}", examples: { pedido: "A" } };
    expect(buildSendPayload(stored(d), { "root.body.cliente": "Teste", "root.header.pedido": "B" }).components).toEqual([
      { type: "header", parameters: [{ type: "text", parameter_name: "pedido", text: "B" }] }, { type: "body", parameters: [{ type: "text", parameter_name: "cliente", text: "Teste" }] },
    ]);
  });
  it.each(["IMAGE", "VIDEO", "DOCUMENT"] as const)("sends %s by URL or media ID", format => {
    const d = fixture("media"); d.header.format = format;
    for (const media of ["12345", "https://example.com/media"]) expect(buildSendPayload(stored(d), { ...filled(d), "root.media": media }).components?.[0]).toEqual({ type: "header", parameters: [{ type: format.toLowerCase(), [format.toLowerCase()]: media === "12345" ? { id: media } : { link: media } }] });
    expect(validateSend(stored(d), { ...filled(d), "root.media": "4::handle" }).length).toBeGreaterThan(0);
  });
  it("sends location with bounded coordinates", () => {
    const d = fixture("media"); d.header.format = "LOCATION";
    const v = { "root.body.1": "Teste", "root.latitude": "-20", "root.longitude": "-40", "root.locationName": "Local de teste", "root.address": "Endereço fictício" };
    expect(buildSendPayload(stored(d), v).components?.[0]).toEqual({ type: "header", parameters: [{ type: "location", location: { latitude: "-20", longitude: "-40", name: "Local de teste", address: "Endereço fictício" } }] });
    expect(validateSend(stored(d), { ...v, "root.latitude": "91" })).not.toEqual([]);
  });
  it("encodes URL suffixes and keeps original button indexes", () => {
    const d = fixture(); d.buttons = [newButton("QUICK_REPLY"), { type: "URL", text: "Site", url: "https://example.com/{{1}}", variableExample: "Teste" }, { type: "PHONE_NUMBER", text: "Ligar", phone_number: "+551100000000" }];
    const p = buildSendPayload(stored(d), { "root.body.1": "Pessoa", "root.button.0": "mock-payload", "root.button.1": "São Paulo" });
    expect(p.components?.slice(1)).toEqual([{ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "mock-payload" }] }, { type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "S%C3%A3o%20Paulo" }] }]);
  });
  it("sends OTP twice even when Meta read shape has a URL button", () => {
    const t = { ...stored(fixture("authentication")), components: [{ type: "BODY", text: "*{{1}}* é seu código." }, { type: "BUTTONS", buttons: [{ type: "URL" as const, text: "Copiar", url: "https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp{{1}}" }] }] };
    expect(buildSendPayload(t, { otp: "654321" }).components).toEqual([{ type: "body", parameters: [{ type: "text", text: "654321" }] }, { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "654321" }] }]);
    const copy = duplicateTemplate(t); expect(copy.buttons).toEqual([]); expect(validateDraft(copy)).toEqual([]);
    expect(validateSend(t, { otp: "a".repeat(16) })).not.toEqual([]);
  });
  it("sends carousel media, body and URL values per card", () => {
    const d = fixture("carousel"); const p = buildSendPayload(stored(d), filled(d));
    expect(p.components?.at(-1)).toEqual({ type: "carousel", cards: [0, 1].map(card_index => ({ card_index, components: [
      { type: "header", parameters: [{ type: "image", image: { id: "123456" } }] },
      { type: "body", parameters: [{ type: "text", text: "valor fictício" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "valor%20fict%C3%ADcio" }] },
    ] })) });
  });
  it("sends 2–10 product cards with catalog and retailer IDs", () => {
    const d = fixture("productCarousel"); const t = stored(d); const v = { cardCount: "3", ...Object.fromEntries(sendFields(t, { cardCount: "3" }).filter(f => f.required).map(f => [f.key, f.key.endsWith("catalogId") ? "123" : "mock"])) };
    const p = buildSendPayload(t, v); expect(p.components?.at(-1)?.cards).toHaveLength(3);
    expect((p.components?.at(-1)?.cards as { components: unknown[] }[])[2].components[0]).toEqual({ type: "header", parameters: [{ type: "product", product: { catalog_id: "123", product_retailer_id: "mock" } }] });
    expect(validateSend(t, { ...v, cardCount: "11" })).not.toEqual([]);
  });
  it("sends catalog thumbnail optionally and MPM sections with total product limits", () => {
    const catalog = fixture("catalog"); expect(buildSendPayload(stored(catalog), { ...filled(catalog), "root.button.0.thumbnail": "sku1" }).components?.at(-1)).toEqual({ type: "button", sub_type: "catalog", index: "0", parameters: [{ type: "action", action: { thumbnail_product_retailer_id: "sku1" } }] });
    const mpm = fixture("mpm"); const v = { ...filled(mpm), "root.button.0.thumbnail": "sku1", "root.button.0.sections": "Seção | sku1, sku2" };
    expect(buildSendPayload(stored(mpm), v).components?.at(-1)).toEqual({ type: "button", sub_type: "mpm", index: "0", parameters: [{ type: "action", action: { thumbnail_product_retailer_id: "sku1", sections: [{ title: "Seção", product_items: [{ product_retailer_id: "sku1" }, { product_retailer_id: "sku2" }] }] } }] });
    expect(validateSend(stored(mpm), { ...v, "root.button.0.sections": `Teste | ${Array.from({ length: 31 }, (_, i) => `sku${i}`).join(",")}` })).not.toEqual([]);
    expect(() => parseSections("A | sku | extra")).toThrow();
  });
  it("sends coupon and offer expiration as epoch milliseconds", () => {
    const offer = fixture("offer"); const v: SendValues = { ...filled(offer), "root.button.0": "MOCK25" }; const p = buildSendPayload(stored(offer), v);
    expect(p.components?.find(c => c.type === "limited_time_offer")).toEqual({ type: "limited_time_offer", parameters: [{ type: "limited_time_offer", limited_time_offer: { expiration_time_ms: new Date(v.expiration).getTime() } }] });
    expect(p.components?.find(c => c.sub_type === "copy_code")).toEqual({ type: "button", sub_type: "copy_code", index: "0", parameters: [{ type: "coupon_code", coupon_code: "MOCK25" }] });
    expect(validateSend(stored(offer), { ...v, expiration: "2000-01-01T12:00" })).not.toEqual([]);
  });
  it("sends Flow action data and rejects invalid JSON", () => {
    const d = fixture("flow"); const v = { ...filled(d), "root.button.0.token": "mock-token", "root.button.0.data": '{"order":"mock"}' };
    expect(buildSendPayload(stored(d), v).components?.at(-1)).toEqual({ type: "button", sub_type: "flow", index: "0", parameters: [{ type: "action", action: { flow_token: "mock-token", flow_action_data: { order: "mock" } } }] });
    expect(validateSend(stored(d), { ...v, "root.button.0.data": "[]" })).not.toEqual([]);
  });
  it("sends voice call overrides and call permission using only body params", () => {
    const d = fixture(); d.buttons = [newButton("VOICE_CALL")]; const v = { ...filled(d), "root.button.0.ttl": "100", "root.button.0.payload": "mock" };
    expect(buildSendPayload(stored(d), v).components?.at(-1)).toEqual({ type: "button", sub_type: "voice_call", index: "0", parameters: [{ type: "ttl_minutes", ttl_minutes: 100 }, { type: "payload", payload: "mock" }] });
    expect(buildSendPayload(stored(fixture("callPermission")), filled(fixture("callPermission"))).components).toHaveLength(1);
  });
  it("blocks unapproved, unknown components and incomplete send values", () => {
    const t = stored(fixture()); expect(() => buildSendPayload({ ...t, status: "PENDING" }, filled(fixture()))).toThrow("approved"); expect(() => buildSendPayload(t, {})).toThrow("Fill out");
    const unknown = { ...t, components: [...t.components, { type: "NEW_META_TYPE" }] }; expect(unsupportedTemplate(unknown)).toBe(true); expect(() => buildSendPayload(unknown, filled(fixture()))).toThrow("not yet supported");
  });
});
