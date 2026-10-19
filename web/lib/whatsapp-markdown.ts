// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WhatsApp-style markdown parser.
 *
 * Inline:  *bold*   _italic_   ~strike~   `code`
 * Block:   ```...```  (monospace block)
 *          > quote
 *          * item / - item  (bullet list)
 *          1. item           (ordered list)
 */

// ─── AST types ────────────────────────────────────────────────────────────────

export type InlineNode =
  | { k: "text"; v: string }
  | { k: "bold" | "italic" | "strike"; ch: InlineNode[] }
  | { k: "code"; v: string }; // `...`  no nesting inside

export type BlockNode =
  | { k: "text"; v: string } // one or more plain lines joined with \n
  | { k: "mono"; v: string } // ```...```
  | { k: "quote"; v: string }
  | { k: "bullet"; v: string }
  | { k: "ordered"; n: number; v: string };

// ─── Block parser ─────────────────────────────────────────────────────────────

const MONO_BLOCK_SPLIT = /(```[\s\S]*?```)/g;

export function parseBlocks(content: string): BlockNode[] {
  // Normalize line endings
  const normalized = content.replace(/\r\n/g, "\n");
  const result: BlockNode[] = [];

  // Split on multi-line code blocks first so their content is never line-parsed
  const parts = normalized.split(MONO_BLOCK_SPLIT);

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    if (!part) continue;

    if (pi % 2 === 1) {
      // Inside ```...```
      result.push({ k: "mono", v: part.slice(3, -3) });
      continue;
    }

    const lines = part.split("\n");
    let textLines: string[] = [];

    const flushText = () => {
      if (textLines.length === 0) return;
      // Trim trailing empty lines but keep internal blank lines
      while (textLines.length && textLines[textLines.length - 1] === "") {
        textLines.pop();
      }
      if (textLines.length) result.push({ k: "text", v: textLines.join("\n") });
      textLines = [];
    };

    for (const line of lines) {
      const quoteM = /^>\s?(.*)$/.exec(line);
      const bulletM = /^[*\-]\s+(.+)$/.exec(line);
      const orderedM = /^(\d+)\.\s+(.+)$/.exec(line);

      if (quoteM) {
        flushText();
        result.push({ k: "quote", v: quoteM[1] ?? "" });
      } else if (bulletM) {
        flushText();
        result.push({ k: "bullet", v: bulletM[1] ?? "" });
      } else if (orderedM) {
        flushText();
        result.push({ k: "ordered", n: parseInt(orderedM[1] ?? "1", 10), v: orderedM[2] ?? "" });
      } else {
        textLines.push(line);
      }
    }

    flushText();
  }

  return result;
}

// ─── Inline parser ────────────────────────────────────────────────────────────

// ─── Plain-text extraction (for previews) ────────────────────────────────────

/**
 * Strips WhatsApp markdown markers so the text can be shown as a plain
 * one-line preview (e.g. in the conversation list).
 */
export function stripWhatsAppMarkdown(text: string): string {
  return (
    text
      // multi-line mono blocks → placeholder
      .replace(/```[\s\S]*?```/g, "[code]")
      // inline code → unwrap
      .replace(/`([^`\n]+)`/g, "$1")
      // bold / italic / strike → unwrap content
      .replace(/\*(\S(?:[\s\S]*?\S)?|\S)\*/g, "$1")
      .replace(/_(\S(?:[\s\S]*?\S)?|\S)_/g, "$1")
      .replace(/~(\S(?:[\s\S]*?\S)?|\S)~/g, "$1")
      // blockquote prefix
      .replace(/^>\s?/gm, "")
      // bullet/ordered list prefixes
      .replace(/^[*\-]\s+/gm, "")
      .replace(/^\d+\.\s+/gm, "")
  );
}

/** Pattern entries ordered by precedence (code first — no nesting inside). */
const INLINE_PATTERNS: Array<{
  re: RegExp;
  k: InlineNode["k"];
  noNest?: true;
}> = [
  // Inline code: `text` (no nested markers; content must be non-empty)
  { re: /`([^`\n]+)`/, k: "code", noNest: true },
  // Bold: *text* — inner must start/end with non-space
  { re: /\*(\S(?:[\s\S]*?\S)?|\S)\*/, k: "bold" },
  // Italic: _text_
  { re: /_(\S(?:[\s\S]*?\S)?|\S)_/, k: "italic" },
  // Strikethrough: ~text~
  { re: /~(\S(?:[\s\S]*?\S)?|\S)~/, k: "strike" },
];

export function parseInline(text: string, depth = 0): InlineNode[] {
  if (!text) return [];
  if (depth > 5) return [{ k: "text", v: text }];

  // Find the leftmost match among all patterns
  let earliest: {
    index: number;
    end: number;
    inner: string;
    k: InlineNode["k"];
    noNest: boolean;
  } | null = null;

  for (const { re, k, noNest } of INLINE_PATTERNS) {
    const m = re.exec(text);
    if (m && (earliest === null || m.index < earliest.index)) {
      earliest = {
        index: m.index,
        end: m.index + m[0].length,
        inner: m[1] ?? "",
        k,
        noNest: !!noNest,
      };
    }
  }

  if (!earliest) return [{ k: "text", v: text }];

  const result: InlineNode[] = [];

  if (earliest.index > 0) {
    result.push({ k: "text", v: text.slice(0, earliest.index) });
  }

  if (earliest.noNest) {
    result.push({ k: earliest.k as "code", v: earliest.inner });
  } else {
    result.push({
      k: earliest.k as "bold" | "italic" | "strike",
      ch: parseInline(earliest.inner, depth + 1),
    });
  }

  const after = text.slice(earliest.end);
  if (after) result.push(...parseInline(after, depth));

  return result;
}
