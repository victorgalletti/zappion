// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { Archive, Images, LayoutTemplate, MessageSquare, Settings } from "lucide-react";
import type { AgentRow } from "@/lib/types";
import { MemberAvatar } from "./member-avatar";
import { OrganizationAvatar } from "./organization-avatar";
import { cn } from "@/lib/utils";

export type NavigationSection = "chats" | "archived" | "templates" | "media" | "settings" | "profile";
export const NAVIGATION_WIDTH = 64;

export function NavigationRail({ section, onSelect, organizationName, organizationLogo, unread, archivedUnread = 0, approvals = 0, agent, onOpenOrganization, onOpenProfile }: {
  agent?: AgentRow;
  onOpenOrganization?: () => void;
  onOpenProfile?: () => void;
  section: NavigationSection;
  onSelect: (section: NavigationSection) => void;
  organizationName: string;
  organizationLogo?: string | null;
  unread: number;
  archivedUnread?: number;
  /** Messages waiting for approval, shown on Chats. */
  approvals?: number;
}) {
  const t = useT();
  const items = [
    { id: "chats", label: t.profilePanel.chats, icon: MessageSquare },
    { id: "archived", label: t.navigationRail.archived, icon: Archive },
    { id: "templates", label: t.composer.messageTemplates, icon: LayoutTemplate },
    { id: "media", label: t.mediaLibrary.media, icon: Images },
  ] as const;

  return (
    <nav aria-label={t.navigationRail.mainNavigation} className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-line bg-panel py-4">
      <button type="button" onClick={onOpenOrganization ?? (() => onSelect("settings"))} title={t.navigationRail.organization(organizationName)} aria-label={t.navigationRail.organization(organizationName)} className="mb-2 flex size-10 shrink-0 items-center justify-center rounded-full hover:ring-2 hover:ring-accent/40">
        <OrganizationAvatar name={organizationName} path={organizationLogo} size={32} />
      </button>
      {items.map(({ id, label, icon: Icon }) => {
        const count = id === "chats" ? unread : id === "archived" ? archivedUnread : 0;
        const waiting = id === "chats" ? approvals : 0;
        const name = count ? t.navigationRail.unread(label, count, id === "archived") : label;
        return <button key={id} type="button" onClick={() => onSelect(id)} title={label} aria-label={waiting ? `${name}, ${t.navigationRail.approvals(waiting)}` : name} aria-current={section === id ? "page" : undefined}
          className={cn("relative flex size-10 items-center justify-center rounded-xl text-icon hover:bg-surface hover:text-heading", section === id && "bg-surface text-heading after:absolute after:-left-2 after:h-5 after:w-[3px] after:rounded-full after:bg-accent")}>
          <Icon className="size-5" />
          {count > 0 && <span aria-hidden="true" className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-unread px-1 text-[0.625rem] font-semibold text-black">{count > 99 ? "99+" : count}</span>}
          {waiting > 0 && <span aria-hidden="true" className="absolute -right-1 -bottom-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-orange-500 px-1 text-[0.625rem] font-semibold text-white">{waiting > 99 ? "99+" : waiting}</span>}
        </button>
      })}
      <div className="mt-auto flex flex-col items-center gap-3">
        <button type="button" onClick={onOpenOrganization ?? (() => onSelect("settings"))} title={t.navigationRail.settings} aria-label={t.navigationRail.settings} aria-current={section === "settings" ? "page" : undefined}
          className={cn("relative flex size-10 items-center justify-center rounded-xl text-icon hover:bg-surface hover:text-heading", section === "settings" && "bg-surface text-heading after:absolute after:-left-2 after:h-5 after:w-[3px] after:rounded-full after:bg-accent")}>
          <Settings className="size-5" />
        </button>
        {agent && <button type="button" onClick={onOpenProfile ?? (() => onSelect("profile"))} title={t.profilePanel.myProfile} aria-label={t.navigationRail.myProfileLabel(agent.name)} aria-current={section === "profile" ? "page" : undefined} className={cn("flex size-10 shrink-0 items-center justify-center rounded-full hover:ring-2 hover:ring-accent/40", section === "profile" && "ring-2 ring-accent")}>
          <MemberAvatar name={agent.name} id={agent.id} path={agent.picture} size={32} />
        </button>}
      </div>
    </nav>
  );
}
