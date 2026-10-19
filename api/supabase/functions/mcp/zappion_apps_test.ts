// SPDX-License-Identifier: AGPL-3.0-only
import { loadView, VIEWS } from "./zappion_apps.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

for (const view of Object.keys(VIEWS) as (keyof typeof VIEWS)[]) {
  Deno.test(`the ${view} screen is one self-contained HTML file`, async () => {
    const html = await loadView(view);
    assert(html.startsWith("<!doctype html>"), "starts with a doctype");
    assert(!html.includes("inline:"), "every placeholder is replaced");
    assert(html.includes("window.McpApp = {"), "the bridge is inlined");
    assert(html.includes("--z-bg:"), "the styles are inlined");
    assert(
      !/<script[^>]+src=|<link[^>]+href=/.test(html),
      "loads nothing from outside (the host's default CSP blocks it)",
    );
    // Every inline script must at least parse.
    for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      new Function(code);
    }
  });
}

Deno.test("the template picker carries the template kit", async () => {
  const html = await loadView("templatePicker");
  assert(html.includes("function templateKit()"), "the kit is inlined");
});
