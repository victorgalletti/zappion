// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import fixtures from "../../api/supabase/functions/_shared/zappion_markdown_fixtures.json";
import { markdownToWhatsApp, whatsappToMarkdown } from "./markdown";

// Same fixtures as the backend's zappion_markdown_test.ts: both sides must agree.
describe("markdown conversions (shared fixtures)", () => {
  it.each(fixtures.markdownToWhatsApp)("markdownToWhatsApp(%j) = %j", (input, expected) => {
    expect(markdownToWhatsApp(input)).toBe(expected);
  });

  it.each(fixtures.whatsappToMarkdown)("whatsappToMarkdown(%j) = %j", (input, expected) => {
    expect(whatsappToMarkdown(input)).toBe(expected);
  });

  it.each(fixtures.roundTrip)("round trips %j", (text) => {
    expect(markdownToWhatsApp(whatsappToMarkdown(text))).toBe(text);
  });
});
