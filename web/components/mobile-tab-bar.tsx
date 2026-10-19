// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { Archive, Images, LayoutTemplate, MessageSquare } from "lucide-react";
import type { AgentRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "./member-avatar";
import type { NavigationSection } from "./navigation-rail";

export function MobileTabBar({ section, onSelect, unread, archivedUnread = 0, approvals = 0, agent }: {
  section: NavigationSection;
  onSelect: (section: NavigationSection) => void;
  unread: number;
  archivedUnread?: number;
  /** Messages waiting for approval, shown on Chats. */
  approvals?: number;
  agent: AgentRow;
}) {
  const t = useT();
  const items = [
    { id: "chats", label: t.profilePanel.chats, icon: MessageSquare },
    { id: "templates", label: t.composer.templates, icon: LayoutTemplate },
    { id: "archived", label: t.navigationRail.archived, icon: Archive },
    { id: "media", label: t.mediaLibrary.media, icon: Images },
    { id: "profile", label: t.profilePanel.myProfile, icon: null },
  ] as const;

  return (
    <nav aria-label={t.navigationRail.mainNavigation} className="absolute right-[max(0.5rem,env(safe-area-inset-right))] bottom-[calc(0.5rem+env(safe-area-inset-bottom))] left-[max(0.5rem,env(safe-area-inset-left))] z-40 flex items-center rounded-full border border-line bg-panel/90 p-1.5 shadow-lg backdrop-blur-xl md:hidden">
      {items.map(({ id, label, icon: Icon }) => {
        const count = id === "chats" ? unread : id === "archived" ? archivedUnread : 0;
        const waiting = id === "chats" ? approvals : 0;
        const name = count ? t.navigationRail.unread(label, count, id === "archived") : id === "profile" ? t.navigationRail.myProfileLabel(agent.name) : label;
        return <button key={id} type="button" onClick={() => onSelect(id)} aria-label={waiting ? `${name}, ${t.navigationRail.approvals(waiting)}` : name} aria-current={section === id ? "page" : undefined}
          className={cn("flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full px-1 py-1 text-icon hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent", section === id && "bg-accent/10 text-accent")}>
          <span className="relative flex size-6 items-center justify-center">
            {Icon ? <Icon aria-hidden="true" className="size-5" /> : <span className={cn("rounded-full", section === id && "ring-2 ring-accent")}><MemberAvatar name={agent.name} id={agent.id} path={agent.picture} size={24} /></span>}
            {count > 0 && <span aria-hidden="true" className="absolute -top-1 -right-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-unread px-1 text-[0.625rem] font-semibold text-black">{count > 99 ? "99+" : count}</span>}
            {waiting > 0 && <span aria-hidden="true" className="absolute -right-2 -bottom-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-orange-500 px-1 text-[0.625rem] font-semibold text-white">{waiting > 99 ? "99+" : waiting}</span>}
          </span>
          <span className="w-full truncate text-center text-[0.625rem] font-medium">{label}</span>
        </button>;
      })}
    </nav>
  );
}
