// SPDX-License-Identifier: AGPL-3.0-only
// Reads a Meta template's variables and builds the `components` that
// send_message takes. The template picker screen runs the same code in the
// browser: `templateKit.toString()` is inlined into its HTML, so everything
// the kit uses at runtime lives inside the function.

export type KitTemplate = {
  name: string;
  language: string;
  parameter_format?: string;
  components?: KitComponent[];
};

type KitComponent = {
  type: string;
  format?: string;
  text?: string;
  example?: Record<string, unknown>;
  buttons?: { type: string; text?: string; url?: string; example?: unknown }[];
};

export type KitField = {
  /** Values are keyed by this: `header:1`, `body:name`, `button:0`, `header:media`. */
  key: string;
  component: "header" | "body" | "button";
  kind: "text" | "image" | "video" | "document" | "coupon";
  /** The variable as written in the template (`1`, `first_name`). */
  name: string;
  example?: string;
  index?: number;
};

export function templateKit() {
  const VAR = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  const MEDIA = ["IMAGE", "VIDEO", "DOCUMENT"];

  function varsOf(text: string | undefined): string[] {
    const found: string[] = [];
    for (const m of (text ?? "").matchAll(VAR)) {
      if (!found.includes(m[1])) found.push(m[1]);
    }
    return found;
  }

  function exampleFor(
    c: KitComponent,
    name: string,
    position: number,
  ): string | undefined {
    const ex = c.example ?? {};
    const named = (ex.body_text_named_params ?? ex.header_text_named_params) as
      | { param_name: string; example: string }[]
      | undefined;
    const hit = named?.find((p) => p.param_name === name);
    if (hit) return hit.example;
    const body = ex.body_text as string[][] | undefined;
    if (body?.[0]?.[position] !== undefined) return body[0][position];
    const header = ex.header_text as string[] | undefined;
    return header?.[position];
  }

  function fields(t: KitTemplate): KitField[] {
    const out: KitField[] = [];
    for (const c of t.components ?? []) {
      const type = c.type.toUpperCase();
      if (type === "HEADER" || type === "BODY") {
        const component = type === "HEADER" ? "header" : "body";
        if (type === "HEADER" && MEDIA.includes(c.format ?? "")) {
          out.push({
            key: "header:media",
            component,
            kind: (c.format ?? "").toLowerCase() as KitField["kind"],
            name: (c.format ?? "").toLowerCase(),
          });
          continue;
        }
        varsOf(c.text).forEach((name, i) =>
          out.push({
            key: `${component}:${name}`,
            component,
            kind: "text",
            name,
            example: exampleFor(c, name, i),
          })
        );
      }
      if (type === "BUTTONS") {
        (c.buttons ?? []).forEach((b, index) => {
          const btn = b.type.toUpperCase();
          if (btn === "URL" && varsOf(b.url).length) {
            const ex = b.example as string[] | string | undefined;
            out.push({
              key: `button:${index}`,
              component: "button",
              kind: "text",
              name: b.text ?? "URL",
              example: Array.isArray(ex) ? ex[0] : ex,
              index,
            });
          }
          if (btn === "COPY_CODE") {
            out.push({
              key: `button:${index}`,
              component: "button",
              kind: "coupon",
              name: b.text ?? "Code",
              index,
            });
          }
        });
      }
    }
    return out;
  }

  /** Fields still empty, in the order the screen shows them. */
  function missing(t: KitTemplate, values: Record<string, string>) {
    return fields(t).filter((f) => !(values[f.key] ?? "").trim());
  }

  /** The `components` for send_message's template content. */
  function build(t: KitTemplate, values: Record<string, string>) {
    const named = (t.parameter_format ?? "").toUpperCase() === "NAMED";
    const value = (key: string) => (values[key] ?? "").trim();
    const components: Record<string, unknown>[] = [];
    const textParams = (list: KitField[]) =>
      list.map((f) => ({
        type: "text",
        ...(named && { parameter_name: f.name }),
        text: value(f.key),
      }));

    const all = fields(t);
    for (const component of ["header", "body"] as const) {
      const list = all.filter((f) => f.component === component);
      if (!list.length) continue;
      const media = list.find((f) => f.key === "header:media");
      components.push({
        type: component,
        parameters: media
          ? [{ type: media.kind, [media.kind]: { link: value(media.key) } }]
          : textParams(list),
      });
    }
    for (const f of all.filter((f) => f.component === "button")) {
      components.push({
        type: "button",
        sub_type: f.kind === "coupon" ? "copy_code" : "url",
        index: String(f.index),
        parameters: [
          f.kind === "coupon"
            ? { type: "coupon_code", coupon_code: value(f.key) }
            : { type: "text", text: value(f.key) },
        ],
      });
    }
    return components;
  }

  /** A component's text with the values filled in, for the preview. */
  function fill(
    text: string | undefined,
    component: "header" | "body",
    values: Record<string, string>,
  ): string {
    return (text ?? "").replace(VAR, (whole, name: string) => {
      const v = (values[`${component}:${name}`] ?? "").trim();
      return v || whole;
    });
  }

  return { fields, missing, build, fill };
}
