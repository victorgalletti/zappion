// SPDX-License-Identifier: AGPL-3.0-only
export type TextSegment =
  | { type: "text"; value: string }
  | { type: "url"; href: string; display: string };

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

/** Remove common punctuation attached to the end of a URL without stripping `)` from valid paths containing `(`. */
export function trimUrlBoundaries(matched: string): string {
  let u = matched;
  while (u.length > 0) {
    const last = u.slice(-1);
    if (".,;:!".includes(last)) {
      u = u.slice(0, -1);
      continue;
    }
    if (last === ")" && !u.includes("(")) {
      u = u.slice(0, -1);
      continue;
    }
    if (last === "]" || last === "}") {
      u = u.slice(0, -1);
      continue;
    }
    break;
  }
  return u;
}

export function isHttpOrHttpsUrl(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "tel:", "mailto:"]);

/** Return the original href if the protocol is safe; otherwise return "#". */
export function sanitizeHref(href: string): string {
  try {
    const { protocol } = new URL(href);
    return SAFE_PROTOCOLS.has(protocol) ? href : "#";
  } catch {
    return "#";
  }
}

/** Split text into literal segments and valid http(s) URLs. */
export function linkifyText(raw: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  const matches = [...raw.matchAll(URL_RE)];
  for (const m of matches) {
    const start = m.index ?? 0;
    const fullMatch = m[0];
    if (start > lastIndex) {
      segments.push({ type: "text", value: raw.slice(lastIndex, start) });
    }
    const trimmed = trimUrlBoundaries(fullMatch);
    if (!isHttpOrHttpsUrl(trimmed)) {
      segments.push({ type: "text", value: fullMatch });
      lastIndex = start + fullMatch.length;
      continue;
    }
    let href = trimmed;
    try {
      href = new URL(trimmed).href;
    } catch {
      segments.push({ type: "text", value: fullMatch });
      lastIndex = start + fullMatch.length;
      continue;
    }
    segments.push({ type: "url", href, display: trimmed });
    lastIndex = start + fullMatch.length;
  }
  if (lastIndex < raw.length) {
    segments.push({ type: "text", value: raw.slice(lastIndex) });
  }
  if (segments.length === 0) {
    segments.push({ type: "text", value: raw });
  }
  return segments;
}

export function uniqueHttpUrlsFromText(raw: string, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of linkifyText(raw)) {
    if (seg.type !== "url") continue;
    if (seen.has(seg.href)) continue;
    seen.add(seg.href);
    out.push(seg.href);
    if (out.length >= max) break;
  }
  return out;
}
