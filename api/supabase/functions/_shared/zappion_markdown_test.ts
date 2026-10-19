// SPDX-License-Identifier: AGPL-3.0-only
// Pins _shared/markdown.ts to the fixtures web/lib/markdown.test.ts also
// runs, so the web and the backend convert formatting the same way.
// Run: deno test api/supabase/functions/_shared/zappion_markdown_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import fixtures from "./zappion_markdown_fixtures.json" with { type: "json" };
import { markdownToWhatsApp, whatsappToMarkdown } from "./markdown.ts";

for (const [input, expected] of fixtures.markdownToWhatsApp) {
  Deno.test(`markdownToWhatsApp ${JSON.stringify(input)}`, () => {
    assertEquals(markdownToWhatsApp(input), expected);
  });
}

for (const [input, expected] of fixtures.whatsappToMarkdown) {
  Deno.test(`whatsappToMarkdown ${JSON.stringify(input)}`, () => {
    assertEquals(whatsappToMarkdown(input), expected);
  });
}

for (const text of fixtures.roundTrip) {
  Deno.test(`round trip ${JSON.stringify(text)}`, () => {
    assertEquals(markdownToWhatsApp(whatsappToMarkdown(text)), text);
  });
}
