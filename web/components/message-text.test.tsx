// SPDX-License-Identifier: AGPL-3.0-only
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageText } from "./message-text";

function html(text: string, markdown?: boolean) {
  return render(<MessageText text={text} markdown={markdown} />).container.innerHTML;
}

describe("MessageText", () => {
  it("renders stored Markdown (from the MCP, agents or the webhook)", () => {
    const out = html("**negrito** _itálico_ *também* ~~riscado~~ `**mono**`", true);
    expect(out).toContain("<strong>negrito</strong>");
    expect(out).toContain("<em>itálico</em>");
    expect(out).toContain("<em>também</em>");
    expect(out).toContain("<s>riscado</s>");
    expect(out).toContain("**mono**</code>");
    expect(out).not.toMatch(/\*\*negrito/);
  });

  it("renders WhatsApp flavor by default (templates)", () => {
    const out = html("*negrito* _itálico_ ~riscado~");
    expect(out).toContain("<strong>negrito</strong>");
    expect(out).toContain("<em>itálico</em>");
    expect(out).toContain("<s>riscado</s>");
  });
});
