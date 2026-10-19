// SPDX-License-Identifier: AGPL-3.0-only
import { getT, getLocale } from "@/lib/i18n";
import { fileOf } from "./messages";
import type { MessageRow } from "./types";

export type MediaTab = "media" | "links" | "docs";
export function classifyMime(mime: string): "media" | "docs" {
  return /^(image|video)\//i.test(mime) ? "media" : "docs";
}
export function extractLinks(text: string): { url: string; domain: string }[] {
  const found = new Map<string, { url: string; domain: string }>();
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+/gi)) {
    const raw = match[0].replace(/[.,;:!?]+$/, "").replace(/\)+$/, (suffix) => {
      const opens = (match[0].match(/\(/g) ?? []).length;
      const closes = (match[0].match(/\)/g) ?? []).length;
      return suffix.slice(0, Math.max(0, suffix.length - (closes - opens)));
    });
    try {
      const url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
      if (["http:", "https:"].includes(url.protocol) && url.hostname.includes(".")) found.set(url.href, { url: url.href, domain: url.hostname });
    } catch { /* Invalid URLs are plain text. */ }
  }
  return [...found.values()];
}
export const mediaText = (row: MessageRow) => typeof row.content.text === "string" ? row.content.text : "";
export function mediaTabOf(row: MessageRow): MediaTab | null {
  const file = fileOf(row.content);
  if (file) return classifyMime(file.mime_type ?? "");
  return row.content.type === "text" && extractLinks(mediaText(row)).length ? "links" : null;
}
export function groupMedia(rows: MessageRow[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(today); week.setDate(today.getDate() - (today.getDay() + 6) % 7);
  const previous = new Date(week); previous.setDate(week.getDate() - 7);
  const groups = new Map<string, { key: string; label: string; start: Date; end: Date; rows: MessageRow[] }>();
  for (const row of rows) {
    const date = new Date(row.timestamp);
    const key = date >= today ? "today" : date >= week ? "week" : date >= previous ? "previous" : `${date.getFullYear()}-${date.getMonth()}`;
    const label = key === "today" ? getT().mediaLibrary.today : key === "week" ? getT().mediaLibrary.thisWeek : key === "previous" ? getT().mediaLibrary.lastWeek : date.toLocaleDateString(getLocale().locale, { month: "long", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
    const group = groups.get(key) ?? { key, label, start: date, end: date, rows: [] };
    if (date < group.start) group.start = date;
    if (date > group.end) group.end = date;
    group.rows.push(row); groups.set(key, group);
  }
  return [...groups.values()];
}
export function formatBytes(size?: number) {
  if (size === undefined) return getT().mediaLibrary.unknownSize;
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toLocaleString(getLocale().locale, { maximumFractionDigits: 1 })} KB` : `${(size / 1024 / 1024).toLocaleString(getLocale().locale, { maximumFractionDigits: 1 })} MB`;
}
