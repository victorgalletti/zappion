// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Camera, FileText, LayoutTemplate, MapPin, Mic, Smile, User, Video, type LucideIcon } from "lucide-react";
import { isOutgoing, preview, type PreviewIcon } from "@/lib/messages";
import type { ConversationView } from "@/lib/types";
import { cn, listTime } from "@/lib/utils";
import { Avatar } from "./avatar";
import { DeliveryStatus } from "./delivery-status";
import { useT } from "@/lib/i18n";
import { useState } from "react";
import { ConversationActions } from "./conversation-actions";

const ICONS: Record<PreviewIcon, LucideIcon> = {
  voice: Mic,
  image: Camera,
  video: Video,
  document: FileText,
  sticker: Smile,
  template: LayoutTemplate,
  location: MapPin,
  contact: User,
};

export function ConversationItem({
  conversation,
  active,
  onSelect,
  instanceLabel,
  onToggleArchive,
  archiving,
  awaitingApproval = false,
}: {
  conversation: ConversationView;
  active: boolean;
  onSelect: () => void;
  instanceLabel?: string;
  onToggleArchive: () => void;
  archiving: boolean;
  /** One of its messages is waiting for a member to approve it. */
  awaitingApproval?: boolean;
}) {
  // Subscribe so preview() and listTime() refresh when the language changes.
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const last = conversation.lastMessage;
  const unread = conversation.unread > 0 && !active;
  const line = preview(last);
  const Icon = line.icon ? ICONS[line.icon] : null;
  return (
    <div className={cn("group relative mb-1 flex min-h-[76px] w-full items-center rounded-xl hover:bg-panel/60 md:h-[76px]", active && "bg-panel")} onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}>
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className="flex min-h-[76px] min-w-0 flex-1 self-stretch items-center rounded-xl py-2 pl-3 text-left md:h-full md:py-0"
    >
      <Avatar name={conversation.displayName} seed={conversation.address} size={48} className="mr-3 max-md:size-[52px]!" />
      <div className="flex min-w-0 flex-1 flex-col justify-center pr-1 md:h-full">
        <div className="mb-0.5 flex items-center justify-between gap-2">
          <h3 className="truncate text-base font-medium text-heading">{conversation.displayName}</h3>
          {last && (
            <span className={cn("shrink-0 text-xs", unread ? "text-unread" : "text-sub")}>{listTime(last.timestamp)}</span>
          )}
        </div>
        {instanceLabel && <p className="truncate text-[0.625rem] text-sub">{instanceLabel}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 text-sm text-sub">
            {last && isOutgoing(last) && <DeliveryStatus status={last.status} />}
            {Icon && <Icon className={cn("size-4 shrink-0", line.icon === "voice" ? "text-read" : "text-sub")} />}
            <span className="line-clamp-2 break-words md:block md:truncate">{line.text}</span>
          </span>
          {awaitingApproval && (
            <span title={t.sidebar.approvalMarkerTitle} className="shrink-0 rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[0.625rem] font-semibold text-orange-600 dark:text-orange-400">
              {t.sidebar.approvalMarker}<span className="sr-only">: {t.sidebar.approvalMarkerTitle}</span>
            </span>
          )}
          {unread && (
            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-unread px-1.5 text-xs font-medium text-white dark:text-[rgb(19,28,33)]">
              {conversation.unread}
            </span>
          )}
        </div>
      </div>
    </button>
    <ConversationActions archived={!!conversation.archived} onToggle={onToggleArchive} disabled={archiving} open={menuOpen} onOpenChange={setMenuOpen} inList />
    </div>
  );
}
