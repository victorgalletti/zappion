// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { filterConversations, preferenceRows, withConversationPreferences } from "./conversation-preferences";
import type { ConversationView } from "./types";

function conversation(overrides: Partial<ConversationView> = {}): ConversationView {
  return {
    id: "with-nine", memberIds: ["with-nine", "without-nine"], organization_id: "org", service: "whatsapp",
    organization_address: "instance-a", address: "5511999990000", name: null, type: null, extra: null,
    created_at: "2026-01-01", updated_at: "2026-01-01", displayName: "Contato de teste", lastMessage: null,
    unread: 3, ...overrides,
  };
}

describe("archived conversation lists", () => {
  const archived = conversation({ archived: true });
  const normal = conversation({ id: "other", memberIds: ["other"], unread: 1 });
  const read = conversation({ id: "read", memberIds: ["read"], unread: 0, organization_address: "instance-b" });
  const rows = [archived, normal, read];

  it("excludes archives from Everything, Unread, instance and search filters", () => {
    expect(filterConversations(rows)).toEqual([normal, read]);
    expect(filterConversations(rows, { unreadOnly: true })).toEqual([normal]);
    expect(filterConversations(rows, { instance: "instance-a" })).toEqual([normal]);
    expect(filterConversations(rows, { query: "Contato" })).toEqual([normal, read]);
    expect(filterConversations(rows, { archived: true })).toEqual([archived]);
    expect(filterConversations(rows, { archived: true, query: "999990000" })).toEqual([archived]);
  });

  it("keeps the whole group archived when any row is archived, regardless of primary row or new messages", () => {
    const preferences = preferenceRows("agent", "org", ["without-nine"], "2026-01-01");
    const views = withConversationPreferences([conversation({ unread: 4, updated_at: "2026-10-14" })], preferences);
    expect(views[0].archived).toBe(true);
    expect(filterConversations(views)).toEqual([]);
    expect(withConversationPreferences([conversation({ id: "without-nine" })], preferences)[0].archived).toBe(true);
  });

  it("builds one preference per member row for both archive and unarchive", () => {
    for (const timestamp of ["2026-01-01", null]) {
      expect(preferenceRows("workspace-agent", "org", ["with-nine", "without-nine", "with-nine"], timestamp)).toEqual([
        { agent_id: "workspace-agent", organization_id: "org", conversation_id: "with-nine", archived_at: timestamp },
        { agent_id: "workspace-agent", organization_id: "org", conversation_id: "without-nine", archived_at: timestamp },
      ]);
    }
  });
});
