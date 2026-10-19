// SPDX-License-Identifier: AGPL-3.0-only
"use client";

// WhatsApp formatting (*bold*, _italic_, ~strike~, `code`, ```blocks```, quotes,
// lists) with the CRM's parser (lib/whatsapp-markdown.ts) and link detection
// (lib/linkify.ts). Stored message text is Markdown: pass `markdown` to convert it
// first (lib/markdown.ts); template bodies are WhatsApp flavor already.
// Rendering is simplified: no link previews.

import { createContext, Fragment, memo, useContext, type ReactNode } from "react";
import { linkifyText, sanitizeHref } from "@/lib/linkify";
import { markdownToWhatsApp } from "@/lib/markdown";
import { parseBlocks, parseInline, type InlineNode } from "@/lib/whatsapp-markdown";

/** The term being searched in the open chat; every occurrence is marked. */
export const HighlightContext = createContext("");

function mark(text: string, query: string, key: string): ReactNode {
  if (!query) return text;
  const pattern = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(pattern);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 ? (
      <mark key={`${key}-m${i}`} className="rounded-sm bg-[#ffd279] text-black">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function withLinks(text: string, key: string, query = ""): ReactNode[] {
  return linkifyText(text).map((segment, i) =>
    segment.type === "url" ? (
      <a
        key={`${key}-${i}`}
        href={sanitizeHref(segment.href)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-read underline-offset-2 hover:underline"
      >
        {segment.display}
      </a>
    ) : (
      <Fragment key={`${key}-${i}`}>{mark(segment.value, query, `${key}-${i}`)}</Fragment>
    ),
  );
}

function inline(nodes: InlineNode[], key: string, query = ""): ReactNode[] {
  return nodes.map((node, i) => {
    const k = `${key}-${i}`;
    switch (node.k) {
      case "text":
        return <Fragment key={k}>{withLinks(node.v, k, query)}</Fragment>;
      case "bold":
        return <strong key={k}>{inline(node.ch, k, query)}</strong>;
      case "italic":
        return <em key={k}>{inline(node.ch, k, query)}</em>;
      case "strike":
        return <s key={k}>{inline(node.ch, k, query)}</s>;
      case "code":
        return (
          <code key={k} className="rounded bg-black/10 px-1 font-mono text-[0.8rem] dark:bg-white/10">
            {node.v}
          </code>
        );
    }
  });
}

export const MessageText = memo(function MessageText({ text, markdown }: { text: string; markdown?: boolean }) {
  const query = useContext(HighlightContext);
  const blocks = parseBlocks(markdown ? markdownToWhatsApp(text) : text);
  return (
    <div className="whitespace-pre-wrap break-words">
      {blocks.map((block, i) => {
        const key = `b-${i}`;
        switch (block.k) {
          case "mono":
            return (
              <pre key={key} className="my-1 overflow-x-auto rounded bg-black/10 p-2 font-mono text-[0.8rem] dark:bg-white/10">
                {block.v}
              </pre>
            );
          case "quote":
            return (
              <div key={key} className="my-0.5 border-l-4 border-sub/40 pl-2 text-sub">
                {inline(parseInline(block.v), key, query)}
              </div>
            );
          case "bullet":
            return (
              <div key={key} className="flex gap-1.5 pl-1">
                <span>•</span>
                <span>{inline(parseInline(block.v), key, query)}</span>
              </div>
            );
          case "ordered":
            return (
              <div key={key} className="flex gap-1.5 pl-1">
                <span>{block.n}.</span>
                <span>{inline(parseInline(block.v), key, query)}</span>
              </div>
            );
          default:
            return <Fragment key={key}>{inline(parseInline(block.v), key, query)}</Fragment>;
        }
      })}
    </div>
  );
});
