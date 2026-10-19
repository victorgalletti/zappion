// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every screen has its own URL. Paths are English and never change with the
 * UI language, so a link works for everyone.
 *
 *   /chats                      chat list
 *   /chats/<conversationId>     a conversation (any member id of a merged view)
 *   /archived[/<conversationId>]
 *   /templates  /media
 *   /settings/<organization|members|instances|meta-app|integrations>
 *   /profile[/preferences]
 *
 * `?message=<id>` on a conversation scrolls to that message.
 */

export const SETTINGS_SECTIONS = ["organization", "members", "instances", "meta-app", "integrations"] as const;
export const PROFILE_SECTIONS = ["profile", "preferences"] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
export type ProfileSection = typeof PROFILE_SECTIONS[number];

export type Route =
  | { section: "chats" | "archived"; conversationId: string | null; messageId: string | null }
  | { section: "templates" | "media" }
  | { section: "settings"; settings: SettingsSection }
  | { section: "profile"; profile: ProfileSection };

export const DEFAULT_ROUTE: Route = { section: "chats", conversationId: null, messageId: null };

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const id = (value: string | null | undefined) => (value && ID.test(value) ? value : null);
const one = <T extends string>(list: readonly T[], value: string | undefined, fallback: T): T | null =>
  value === undefined ? fallback : (list as readonly string[]).includes(value) ? (value as T) : null;

/** The route for a pathname, or null when no screen lives there (show 404). */
export function parseRoute(pathname: string, search: string | URLSearchParams = ""): Route | null {
  const parts = pathname.split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return "\u0000"; }
  });
  const [section, sub, ...rest] = parts;
  if (!section) return DEFAULT_ROUTE;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  switch (section) {
    case "chats":
    case "archived": {
      if (rest.length || (sub !== undefined && !id(sub))) return null;
      const conversationId = id(sub);
      return { section, conversationId, messageId: conversationId ? id(params.get("message")) : null };
    }
    case "templates":
    case "media":
      return sub === undefined ? { section } : null;
    case "settings": {
      const settings = rest.length ? null : one(SETTINGS_SECTIONS, sub, "organization");
      return settings ? { section, settings } : null;
    }
    case "profile": {
      const profile = rest.length ? null : one(PROFILE_SECTIONS, sub, "profile");
      return profile ? { section, profile } : null;
    }
    default:
      return null;
  }
}

/** The canonical URL for a route. */
export function routeHref(route: Route): string {
  switch (route.section) {
    case "chats":
    case "archived": {
      if (!route.conversationId) return `/${route.section}`;
      const path = `/${route.section}/${encodeURIComponent(route.conversationId)}`;
      return route.messageId ? `${path}?message=${encodeURIComponent(route.messageId)}` : path;
    }
    case "templates":
    case "media":
      return `/${route.section}`;
    case "settings":
      return `/settings/${route.settings}`;
    case "profile":
      return route.profile === "profile" ? "/profile" : `/profile/${route.profile}`;
  }
}

/** Where to go after signing in: only same-site paths, never another origin. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/chats";
  return parseRoute(next.split(/[?#]/)[0]) ? next : "/chats";
}
