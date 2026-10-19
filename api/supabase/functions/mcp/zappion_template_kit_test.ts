// SPDX-License-Identifier: AGPL-3.0-only
import { type KitTemplate, templateKit } from "./zappion_template_kit.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const positional: KitTemplate = {
  name: "order_ready",
  language: "pt_BR",
  components: [
    {
      type: "HEADER",
      format: "TEXT",
      text: "Order {{1}}",
      example: { header_text: ["#123"] },
    },
    {
      type: "BODY",
      text: "Hi {{1}}, your order {{2}} is ready. Bye {{1}}.",
      example: { body_text: [["Ana", "#123"]] },
    },
    { type: "FOOTER", text: "Zappion" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Thanks" },
        {
          type: "URL",
          text: "Track",
          url: "https://x.test/t/{{1}}",
          example: ["https://x.test/t/abc"],
        },
        { type: "COPY_CODE", text: "Copy code" },
      ],
    },
  ],
};

const named: KitTemplate = {
  name: "welcome",
  language: "en_US",
  parameter_format: "NAMED",
  components: [
    { type: "HEADER", format: "IMAGE" },
    {
      type: "BODY",
      text: "Welcome {{first_name}}!",
      example: {
        body_text_named_params: [{ param_name: "first_name", example: "Ana" }],
      },
    },
  ],
};

const kit = templateKit();

Deno.test("fields list each variable once, with its example", () => {
  assertEquals(
    kit.fields(positional).map((f) => [f.key, f.kind, f.example ?? null]),
    [
      ["header:1", "text", "#123"],
      ["body:1", "text", "Ana"],
      ["body:2", "text", "#123"],
      ["button:1", "text", "https://x.test/t/abc"],
      ["button:2", "coupon", null],
    ],
  );
  assertEquals(
    kit.fields(named).map((f) => [f.key, f.kind, f.example ?? null]),
    [["header:media", "image", null], ["body:first_name", "text", "Ana"]],
  );
});

Deno.test("positional components follow Meta's send format", () => {
  const values = {
    "header:1": "#9",
    "body:1": "Bia",
    "body:2": " #9 ",
    "button:1": "xyz",
    "button:2": "OFF10",
  };
  assertEquals(kit.missing(positional, values), []);
  assertEquals(kit.build(positional, values), [
    { type: "header", parameters: [{ type: "text", text: "#9" }] },
    {
      type: "body",
      parameters: [{ type: "text", text: "Bia" }, {
        type: "text",
        text: "#9",
      }],
    },
    {
      type: "button",
      sub_type: "url",
      index: "1",
      parameters: [{ type: "text", text: "xyz" }],
    },
    {
      type: "button",
      sub_type: "copy_code",
      index: "2",
      parameters: [{ type: "coupon_code", coupon_code: "OFF10" }],
    },
  ]);
});

Deno.test("named templates send parameter names and media links", () => {
  const values = {
    "header:media": "https://x.test/a.jpg",
    "body:first_name": "Ana",
  };
  assertEquals(kit.build(named, values), [
    {
      type: "header",
      parameters: [{ type: "image", image: { link: "https://x.test/a.jpg" } }],
    },
    {
      type: "body",
      parameters: [{ type: "text", parameter_name: "first_name", text: "Ana" }],
    },
  ]);
});

Deno.test("missing lists empty fields and fill keeps unfilled variables", () => {
  assertEquals(
    kit.missing(positional, { "body:1": "Ana" }).map((f) => f.key),
    ["header:1", "body:2", "button:1", "button:2"],
  );
  assertEquals(
    kit.fill("Hi {{1}}, order {{ 2 }}", "body", { "body:1": "Ana" }),
    "Hi Ana, order {{ 2 }}",
  );
});

Deno.test("the kit runs on its own, as the screen inlines it", () => {
  const inlined = new Function(
    `return (${templateKit.toString()})();`,
  )() as ReturnType<typeof templateKit>;
  assertEquals(
    inlined.build(named, { "body:first_name": "Ana", "header:media": "u" }),
    kit.build(named, { "body:first_name": "Ana", "header:media": "u" }),
  );
});
