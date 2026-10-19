// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { Archive, ArchiveRestore, ChevronDown, MoreVertical, Search } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ConversationActions({ archived, onToggle, disabled, open, onOpenChange, inList = false, onSearch }: {
  archived: boolean;
  onToggle: () => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inList?: boolean;
  onSearch?: () => void;
}) {
  const t = useT();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const Icon = inList ? ChevronDown : MoreVertical;
  const ActionIcon = archived ? ArchiveRestore : Archive;
  const hasSearch = !!onSearch;
  const close = () => { onOpenChange(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current!.getBoundingClientRect();
    const phoneSearch = hasSearch && window.innerWidth < 768;
    const menuHeight = phoneSearch ? 120 : 72;
    setPosition({
      top: rect.bottom + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight + 8) : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)),
    });
    (phoneSearch ? search : action).current?.focus();
  }, [open, hasSearch]);

  return <div className="relative shrink-0" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
    <button ref={trigger} type="button" aria-label={t.conversationActions.chatOptions} title={t.conversationActions.chatOptions} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => onOpenChange(!open)} className={inList ? "flex size-11 items-center justify-center rounded-full text-icon hover:bg-panel focus:opacity-100 md:size-8 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" : "flex size-[44px] items-center justify-center rounded-full text-icon hover:bg-panel hover:text-heading md:size-10"}>
      <Icon className="size-5" />
    </button>
    {open && createPortal(<>
      <button type="button" tabIndex={-1} aria-label={t.conversationActions.closeChatOptions} onClick={close} className="fixed inset-0 z-40 cursor-default" />
      <div id={id} role="menu" aria-label={t.conversationActions.chatActions} style={position} className="fixed z-50 w-56 rounded-xl border border-line bg-menu p-1.5 shadow-lg">
        {onSearch && <button ref={search} role="menuitem" type="button" onClick={() => { close(); onSearch(); }} className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-heading hover:bg-panel focus:bg-panel md:hidden"><Search className="size-4" />{t.chatRoom.searchThisChat}</button>}
        <button ref={action} role="menuitem" type="button" disabled={disabled} onClick={() => { close(); onToggle(); }} className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-heading hover:bg-panel focus:bg-panel disabled:opacity-50 md:min-h-0">
          <ActionIcon className="size-4" />{archived ? t.conversationActions.unarchiveChat : t.conversationActions.archiveChat}
        </button>
      </div>
    </>, document.body)}
  </div>;
}
