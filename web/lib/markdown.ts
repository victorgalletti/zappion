// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Conversions between common Markdown and the WhatsApp formatting flavor.
 *
 * messages.content.text holds common Markdown (**bold**, *italic* or
 * _italic_, ~~strike~~, `code`): that is what the backend, the MCP and the
 * AI agents read and write. People type the WhatsApp flavor (*bold*,
 * _italic_, ~strike~), and the bubbles render it, so the web converts at the
 * boundary: whatsappToMarkdown before saving, markdownToWhatsApp before
 * rendering.
 *
 * Port of api/supabase/functions/_shared/markdown.ts (the WhatsApp half);
 * keep both in step. Shared fixtures in
 * api/supabase/functions/_shared/zappion_markdown_fixtures.json pin them.
 *
 * A marker only counts as formatting when it would actually render: it must
 * hug non-space text on the inside, be bounded by non-alphanumerics on the
 * outside, and open/close on the same line. Anything else (a_b.pdf, 2*3) is
 * literal text and survives untouched.
 */

import type { MessageContent } from "./types";

const BOLD_SENTINEL = "\u0002";

/** Applies fn outside code spans: ```blocks``` and `inline` pass through. */
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

/** Replaces single-char emphasis markers with the given open/close pair. */
function convertMarker(text: string, marker: "*" | "~", open: string, close: string): string {
  const m = marker === "*" ? "\\*" : "~";
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}${marker}])${m}([^\\s${marker}](?:[^${marker}\\n]*?[^\\s${marker}])?)${m}(?=$|[^\\p{L}\\p{N}${marker}])`,
    "gmu",
  );
  // The leading boundary is consumed by each match, so "*a* *b*" needs a
  // second pass; run until nothing changes (each pass consumes markers).
  let previous;
  do {
    previous = text;
    text = text.replace(re, (_, pre, inner) => `${pre}${open}${inner}${close}`);
  } while (text !== previous);
  return text;
}

/** Common Markdown → WhatsApp flavor (for rendering and previews). */
export function markdownToWhatsApp(text: string): string {
  return outsideCode(text, (part) => {
    let processed = part;
    // Headers and **bold** / __bold__ go through a sentinel so the italic
    // pass below doesn't re-match the stars.
    processed = processed.replace(/^#+\s+(.*)$/gm, `${BOLD_SENTINEL}$1${BOLD_SENTINEL}`);
    processed = processed.replace(/\*\*(?![\s*])(.+?)(?<![\s*])\*\*/g, `${BOLD_SENTINEL}$1${BOLD_SENTINEL}`);
    processed = processed.replace(/__(?![\s_])(.+?)(?<![\s_])__/g, `${BOLD_SENTINEL}$1${BOLD_SENTINEL}`);
    // Italic: *text* -> _text_ (Markdown _text_ is already valid WhatsApp).
    processed = convertMarker(processed, "*", "_", "_");
    // Strikethrough: ~~text~~ -> ~text~
    processed = processed.replace(/~~(?![\s~])(.+?)(?<![\s~])~~/g, "~$1~");
    return processed.replaceAll(BOLD_SENTINEL, "*");
  });
}

/** WhatsApp flavor → common Markdown (for what people type before saving). */
export function whatsappToMarkdown(text: string): string {
  return outsideCode(text, (part) => {
    let processed = part;
    processed = convertMarker(processed, "*", "**", "**");
    processed = convertMarker(processed, "~", "~~", "~~");
    return processed;
  });
}

/** The contents whose text is formatted message text: plain text messages and
 * image, video and document captions. Templates, reactions and the rest keep
 * their text as is. */
export function hasFormattedText(content: MessageContent): content is MessageContent & { text: string } {
  if (typeof content.text !== "string" || !content.text) return false;
  return (content.type === "text" && content.kind === "text") || (content.type === "file" && ["image", "video", "document"].includes(content.kind));
}

/** What the person typed (WhatsApp flavor) as stored content (Markdown). */
export function toStoredContent(content: MessageContent): MessageContent {
  return hasFormattedText(content) ? { ...content, text: whatsappToMarkdown(content.text) } : content;
}
