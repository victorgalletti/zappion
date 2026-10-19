import * as log from "./logger.ts";

// Conversions between common Markdown (what the DB, UI, and agents speak)
// and the wire flavors: WhatsApp formatting and Slack mrkdwn. The two wire
// flavors share the same emphasis conventions (*bold*, _italic_, ~strike~,
// backtick code), so the Slack converters delegate to the WhatsApp ones and
// add what differs: HTML-entity escaping and <url|text> links.
//
// A marker only counts as formatting when it would actually render: it must
// hug non-space text on the inside, be bounded by non-alphanumerics on the
// outside, and open/close on the same line — WhatsApp's own rendering
// rules, and close enough to CommonMark's for the intersection we convert.
// Anything else is literal text (filenames like a_b.pdf, arithmetic like
// 2*3 or 2 * 3) and must survive untouched: these conversions are lossy and
// destructive if they misfire, because the converted text is what gets
// stored/sent.
//
// WhatsApp `_italic_` is intentionally NOT converted: word-bounded
// `_italic_` already renders as italic in common Markdown, and intraword
// underscores (snake_case) are literal on both sides.

const BOLD_SENTINEL = "\u0002";

/** Applies fn outside code spans: code blocks (```...```) and inline
 * (`...`) pass through untouched. */
function outsideCode(text: string, fn: (part: string) => string): string {
  return text
    .split(/(`{3}[\s\S]*?`{3})/)
    .map((part) => {
      if (part.startsWith("```")) return part;
      return part
        .split(/(`[^`\n]+`)/)
        .map((subPart) => (subPart.startsWith("`") ? subPart : fn(subPart)))
        .join("");
    })
    .join("");
}

/** Replaces single-char emphasis markers with the given open/close pair,
 * enforcing the rendering rules above. */
function convertMarker(
  text: string,
  marker: "*" | "~",
  open: string,
  close: string,
): string {
  // Outside a character class * must be escaped; ~ must NOT be (strict
  // unicode mode rejects unnecessary escapes). Neither needs escaping
  // inside a class.
  const m = marker === "*" ? "\\*" : "~";
  // (boundary) marker (non-space ... non-space, same line, no marker) marker (boundary)
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}${marker}])${m}([^\\s${marker}](?:[^${marker}\\n]*?[^\\s${marker}])?)${m}(?=$|[^\\p{L}\\p{N}${marker}])`,
    "gmu",
  );

  // The leading boundary is consumed by the match, which would make the
  // scanner skip an immediately following marker ("*a* *b*"); run until
  // fixpoint (bounded — each pass strictly consumes markers).
  let previous;
  do {
    previous = text;
    text = text.replace(re, (_, pre, inner) => `${pre}${open}${inner}${close}`);
  } while (text !== previous);

  return text;
}

/** Common Markdown → WhatsApp flavor (outbound). */
export function markdownToWhatsApp(text: string): string {
  try {
    return outsideCode(text, (part) => {
      let processed = part;

      // Headers: # Title -> *Title* (via the sentinel so the italic pass
      // below doesn't re-match the stars)
      processed = processed.replace(
        /^#+\s+(.*)$/gm,
        `${BOLD_SENTINEL}$1${BOLD_SENTINEL}`,
      );

      // Bold: **text** / __text__ -> *text*, via a sentinel so the italic
      // pass below doesn't re-match the stars.
      processed = processed.replace(
        /\*\*(?![\s*])(.+?)(?<![\s*])\*\*/g,
        `${BOLD_SENTINEL}$1${BOLD_SENTINEL}`,
      );
      processed = processed.replace(
        /__(?![\s_])(.+?)(?<![\s_])__/g,
        `${BOLD_SENTINEL}$1${BOLD_SENTINEL}`,
      );

      // Italic: *text* -> _text_ (markdown _text_ is already valid in WA)
      processed = convertMarker(processed, "*", "_", "_");

      // Strikethrough: ~~text~~ -> ~text~
      processed = processed.replace(
        /~~(?![\s~])(.+?)(?<![\s~])~~/g,
        "~$1~",
      );

      // deno-lint-ignore no-control-regex
      return processed.replace(/\u0002/g, "*");
    });
  } catch (error) {
    log.error("Error converting Markdown to WhatsApp", error);
    return text;
  }
}

/** WhatsApp flavor → common Markdown (inbound). */
export function whatsappToMarkdown(text: string): string {
  try {
    return outsideCode(text, (part) => {
      let processed = part;

      // Bold: *text* -> **text**
      processed = convertMarker(processed, "*", "**", "**");

      // Strikethrough: ~text~ -> ~~text~~
      processed = convertMarker(processed, "~", "~~", "~~");

      return processed;
    });
  } catch (error) {
    log.error("Error converting WhatsApp to Markdown", error);
    return text;
  }
}

/** Common Markdown → Slack mrkdwn (outbound). */
export function markdownToSlack(text: string): string {
  try {
    // Escape mrkdwn's control characters first, before the link pass
    // introduces its own < >. A line-leading "> " survives as a quote —
    // mrkdwn uses the same blockquote syntax.
    let processed = text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      // Line-leading "> " is mrkdwn's own blockquote syntax and must
      // survive the escaping: park it behind a sentinel, restore after.
      .replace(/^>(?= )/gm, "")
      .replaceAll(">", "&gt;")
      .replace(//g, ">");

    // Special mentions back to their wire form (after the escape pass, like
    // the link conversion below, so the freshly written < > survive). User
    // mentions are the dispatcher's job: it re-encodes @Name from
    // content.mentions.
    processed = processed.replace(
      /(^|\s)@(here|channel|everyone)\b/g,
      "$1<!$2>",
    );

    // Emphasis/headers are the WhatsApp conversions verbatim.
    processed = markdownToWhatsApp(processed);

    // Links: [text](url) -> <url|text>, outside code spans. `&` inside the
    // url was escaped above, which is what mrkdwn expects.
    return outsideCode(
      processed,
      (part) => part.replace(/\[([^\]\n]+)\]\((https?:[^\s)]+)\)/g, "<$2|$1>"),
    );
  } catch (error) {
    log.error("Error converting Markdown to Slack", error);
    return text;
  }
}

/** Slack mrkdwn → common Markdown (inbound). */
export function slackToMarkdown(text: string): string {
  try {
    const processed = outsideCode(text, (part) => {
      let p = part;

      // Links: <url|label> -> [label](url); bare <url> -> url
      p = p.replace(/<(https?:\/\/[^>|]+)\|([^>]+)>/g, "[$2]($1)");
      p = p.replace(/<(https?:\/\/[^>|]+)>/g, "$1");

      // Channel references: <#C123|name> -> #name. Special mentions
      // (<!here>) become their plain form; user mentions (<@U123>) are the
      // slack-webhook's job — it has the directory to name them and records
      // content.mentions — so any that reach here pass verbatim.
      p = p.replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1");
      p = p.replace(/<!(here|channel|everyone)>/g, "@$1");

      // Emphasis: same wire flavor as WhatsApp.
      p = convertMarker(p, "*", "**", "**");
      p = convertMarker(p, "~", "~~", "~~");

      return p;
    });

    // Slack entity-escapes the whole payload, code spans included, so the
    // unescape runs on everything — and last, so freshly produced entities
    // above can't be double-decoded.
    return processed
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
  } catch (error) {
    log.error("Error converting Slack to Markdown", error);
    return text;
  }
}
