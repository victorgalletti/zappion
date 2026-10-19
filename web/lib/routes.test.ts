// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { parseRoute, routeHref, safeNext, type Route } from "./routes";

describe("routes", () => {
  it.each<[string, string, Route]>([
    ["/", "", { section: "chats", conversationId: null, messageId: null }],
    ["/chats", "", { section: "chats", conversationId: null, messageId: null }],
    ["/chats/abc-123", "", { section: "chats", conversationId: "abc-123", messageId: null }],
    ["/chats/abc", "?message=m1", { section: "chats", conversationId: "abc", messageId: "m1" }],
    ["/archived/abc/", "", { section: "archived", conversationId: "abc", messageId: null }],
    ["/templates", "", { section: "templates" }],
    ["/media", "", { section: "media" }],
    ["/settings", "", { section: "settings", settings: "organization" }],
    ["/settings/members", "", { section: "settings", settings: "members" }],
    ["/settings/integrations", "", { section: "settings", settings: "integrations" }],
    ["/settings/meta-app", "", { section: "settings", settings: "meta-app" }],
    ["/profile", "", { section: "profile", profile: "profile" }],
    ["/profile/preferences", "", { section: "profile", profile: "preferences" }],
  ])("parses %s%s", (path, search, route) => {
    expect(parseRoute(path, search)).toEqual(route);
  });

  it.each(["/nope", "/chats/a/b", "/chats/%zz", "/chats/a b", "/templates/x", "/settings/billing", "/profile/x/y"])("rejects %s", (path) => {
    expect(parseRoute(path)).toBeNull();
  });

  it("ignores a message without a conversation and a malformed message id", () => {
    expect(parseRoute("/chats", "?message=m1")).toEqual({ section: "chats", conversationId: null, messageId: null });
    expect(parseRoute("/chats/abc", "?message=<x>")).toEqual({ section: "chats", conversationId: "abc", messageId: null });
  });

  it.each(["/chats", "/chats/abc", "/chats/abc?message=m1", "/archived/abc", "/templates", "/media", "/settings/organization", "/settings/instances", "/settings/meta-app", "/settings/integrations", "/profile", "/profile/preferences"])("round-trips %s", (href) => {
    const [path, search = ""] = href.split("?");
    expect(routeHref(parseRoute(path, search)!)).toBe(href);
  });

  it.each([[null, "/chats"], ["/media", "/media"], ["/chats/abc?message=m1", "/chats/abc?message=m1"], ["//evil.example", "/chats"], ["/\\evil.example", "/chats"], ["https://evil.example", "/chats"], ["/nope", "/chats"]])("safeNext(%s) is %s", (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
});
