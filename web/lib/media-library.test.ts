// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { classifyMime, extractLinks, groupMedia, mediaTabOf } from "./media-library";
import type { MessageRow } from "./types";
const row = (timestamp: string) => ({ id: timestamp, timestamp } as MessageRow);
describe("media periods", () => {
  it("separates today, this week, previous week and older months", () => {
    const groups = groupMedia([row('2026-10-14T12:00:00'), row('2026-10-13T12:00:00'), row('2026-10-11T12:00:00'), row('2026-10-05T12:00:00'), row('2026-10-04T12:00:00'), row('2026-09-30T12:00:00')], new Date('2026-10-14T15:00:00'));
    expect(groups.map((g) => g.label)).toEqual(['Today', 'This week', 'Last week', 'October', 'September']);
    expect(groups[2].rows).toHaveLength(2);
    expect(groups[2].start.getDate()).toBe(5); expect(groups[2].end.getDate()).toBe(11);
  });
  it("keeps years separate and handles a week crossing New Year", () => {
    const groups = groupMedia([row('2025-12-31T10:00:00'), row('2024-12-31T10:00:00')], new Date('2026-01-01T12:00:00'));
    expect(groups.map((g) => g.label)).toEqual(['This week', 'December 2024']);
    expect(groupMedia([], new Date())).toEqual([]);
  });
});
describe("link extraction", () => {
  it("extracts domains, deduplicates and strips punctuation", () => {
    expect(extractLinks('Veja https://example.com/test. https://example.com/test e www.site.com!')).toEqual([{ url: 'https://example.com/test', domain: 'example.com' }, { url: 'https://www.site.com/', domain: 'www.site.com' }]);
  });
  it("preserves balanced parentheses and query parameters", () => {
    expect(extractLinks('(https://example.com/a_(b)) https://example.com/?q=oi&x=2').map((l) => l.url)).toEqual(['https://example.com/a_(b)', 'https://example.com/?q=oi&x=2']);
  });
  it("rejects malformed links and unsafe protocols", () => {
    expect(extractLinks('javascript:alert(1) ftp://example.com https:// e texto')).toEqual([]);
  });
});
describe("mime classification", () => {
  it.each(['image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'IMAGE/PNG'])('%s is media', (mime) => expect(classifyMime(mime)).toBe('media'));
  it.each(['audio/ogg', 'audio/mpeg', 'application/pdf', 'application/zip', 'text/plain', ''])('%s is a document', (mime) => expect(classifyMime(mime)).toBe('docs'));
  it('classifies only text links and file messages', () => {
    expect(mediaTabOf({ content: { type: 'text', text: 'https://example.com' } } as MessageRow)).toBe('links');
    expect(mediaTabOf({ content: { type: 'data', text: 'https://example.com' } } as MessageRow)).toBeNull();
    expect(mediaTabOf({ content: { type: 'file', file: { mime_type: 'audio/ogg' } } } as MessageRow)).toBe('docs');
  });
});
