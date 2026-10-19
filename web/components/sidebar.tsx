// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { Archive, Plus, Search } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import type { ConversationView, OrganizationAddressRow } from "@/lib/types";
import { ConversationItem } from "./conversation-item";
import { instanceName } from "@/lib/instances";
import type { NavigationSection } from "./navigation-rail";
import { PageHeader } from "./ui/page-header";
import { Select } from "./ui/select";
import { filterConversations } from "@/lib/conversation-preferences";

type Drawer = null | "new";

export function Sidebar({
  numbers,
  conversations,
  loading,
  activeId,
  onSelect,
  onStartChat,
  width,
  section,
  onSectionChange,
  onToggleArchive,
  archiving,
  approvalConversationIds,
}: {
  numbers: OrganizationAddressRow[];
  conversations: ConversationView[];
  loading: boolean;
  activeId: string | null;
  onSelect: (c: ConversationView) => void;
  onStartChat: (address: string, organizationAddress: string) => void;
  width: number;
  section: NavigationSection;
  onSectionChange: (section: NavigationSection) => void;
  onToggleArchive: (c: ConversationView) => void;
  archiving: boolean;
  /** Conversation rows with a message waiting for approval. */
  approvalConversationIds?: ReadonlySet<string>;
}) {
  const t = useT();
  const [instanceFilter, setInstanceFilter] = useState("");
  const [selectedInstance, setSelectedInstance] = useState("");
  const connected = numbers.filter((number) => number.status === "connected");
  const newInstance = connected.find((number) => number.address === selectedInstance)?.address ?? (connected.length === 1 ? connected[0].address : "");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [newNumber, setNewNumber] = useState("");

  const archived = section === "archived";
  const filtered = useMemo(() => filterConversations(conversations, {
    archived, query, unreadOnly: !archived && unreadOnly, instance: archived ? "" : instanceFilter,
  }), [conversations, query, unreadOnly, instanceFilter, archived]);

  const unreadCount = conversations.filter((c) => !c.archived && c.unread > 0).length;
  const archivedUnread = conversations.filter((c) => c.archived && c.unread > 0).length;

  return (
    <aside style={{ "--sidebar-width": `${width}px` } as CSSProperties} aria-label={archived ? t.navigationRail.archived : section === "chats" ? t.profilePanel.chats : section === "templates" ? t.composer.templates : section === "profile" ? t.profilePanel.myProfile : t.navigationRail.settings} className="relative flex min-h-0 w-full shrink-0 flex-col border-r border-line bg-surface md:w-[var(--sidebar-width)]">
      <PageHeader className="h-auto min-h-0 border-b-0 pt-[max(1rem,env(safe-area-inset-top))] pb-1 md:h-[72px] md:min-h-[72px] md:border-b md:py-0 [&>h1]:text-4xl [&>h1]:font-bold md:[&>h1]:text-xl md:[&>h1]:font-semibold [&>button]:size-11 md:[&>button]:size-10" title={archived ? <span title={t.sidebar.theseChatsStayArchivedWhenNewMessagesArrive}>{t.navigationRail.archived}</span> : section === "chats" ? t.profilePanel.chats : t.composer.templates}
        onBack={archived ? () => { setQuery(""); onSectionChange("chats"); } : undefined} backLabel={t.sidebar.backToChats} actions={section === "chats" &&
          <button type="button" onClick={() => setDrawer("new")} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:brightness-110 md:size-8" title={t.sidebar.newChat} aria-label={t.sidebar.newChat}>
            <Plus className="size-[18px]" />
          </button>
      } />
      <div className="bg-surface px-5 pt-3 pb-3">
        <label className="flex h-11 items-center gap-3 rounded-full bg-panel px-4 md:h-10">
          <Search className="size-4 text-icon" />
          <input
            aria-label={t.sidebar.searchChats}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.sidebar.searchOrStartANewChat}
            className="min-w-0 w-full bg-transparent text-base text-heading outline-none placeholder:text-sub md:text-sm"
          />
        </label>
      </div>

      {!archived && <div className="flex flex-wrap gap-2 px-5 pb-3" aria-label={t.sidebar.filterChats}>
        {[false, true].map((unread) => <button key={String(unread)} type="button" aria-pressed={unreadOnly === unread} onClick={() => setUnreadOnly(unread)} className={`min-h-11 rounded-full border px-3 py-1.5 text-xs font-medium md:min-h-0 ${unreadOnly === unread ? "border-accent/20 bg-accent/15 text-accent" : "border-line text-sub hover:bg-panel"}`}>{unread ? t.sidebar.unread(unreadCount) : t.sidebar.all}</button>)}
        {numbers.length > 1 && <Select aria-label={t.sidebar.filterByInstance} value={instanceFilter} onChange={setInstanceFilter} size="compact" className="min-h-11 text-sub md:min-h-0" options={[{ value: "", label: t.mediaLibrary.allInstances }, ...numbers.map((number) => ({ value: number.address, label: instanceName(number) }))]} />}
      </div>}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-surface px-2 pb-2">
        {section === "chats" && <button type="button" aria-label={archivedUnread ? t.sidebar.archivedUnread(archivedUnread) : t.navigationRail.archived} onClick={() => { setQuery(""); onSectionChange("archived"); }} className="mb-1 flex h-14 w-full items-center gap-5 rounded-xl px-6 text-heading hover:bg-panel">
          <Archive className="size-5 text-accent" /><span className="flex-1 text-left font-medium">{t.navigationRail.archived}</span>{archivedUnread > 0 && <span className="text-sm font-medium text-accent">{archivedUnread}</span>}
        </button>}
        {loading && <p className="p-6 text-center text-sm text-sub">{t.sidebar.loadingChats}</p>}
        {!loading && filtered.length === 0 && (
          <p className="p-6 text-center text-sm text-sub">
            {query ? t.sidebar.noChatsFound : archived ? t.sidebar.noArchivedChats : unreadOnly ? t.sidebar.noUnreadChats : t.sidebar.noChatsYet}
          </p>
        )}
        {filtered.map((conversation) => {
          const instance = numbers.find((number) => number.address === conversation.organization_address);
          return <ConversationItem
            key={conversation.id}
            conversation={conversation}
            instanceLabel={numbers.length > 1 ? (instance ? instanceName(instance) : conversation.organization_address) : undefined}
            active={!!activeId && conversation.memberIds.includes(activeId)}
            onSelect={() => onSelect(conversation)}
            onToggleArchive={() => onToggleArchive(conversation)}
            archiving={archiving}
            awaitingApproval={!!approvalConversationIds && conversation.memberIds.some((id) => approvalConversationIds.has(id))}
          />;
        })}
      </div>

      {section === "chats" && drawer && (
        <div className="absolute inset-0 z-20 flex flex-col bg-surface">
          <PageHeader title={t.sidebar.newChat} onBack={() => setDrawer(null)} />
            <form
              className="space-y-4 p-6"
              onSubmit={(e) => {
                e.preventDefault();
                const digits = newNumber.replace(/\D/g, "");
                if (digits.length < 10 || !newInstance) return;
                onStartChat(digits, newInstance);
                setNewNumber("");
                setDrawer(null);
              }}
            >
              {connected.length > 1 && <label className="block text-sm text-sub">{t.sidebar.sendVia}<Select required name="instance" aria-label={t.sidebar.newChatInstance} value={newInstance} onChange={setSelectedInstance} placeholder={t.sidebar.chooseAnInstance} className="mt-2 py-3" options={connected.map((number) => ({ value: number.address, label: instanceName(number) }))} /></label>}
              {connected.length === 0 && <p className="text-sm text-sub">{t.sidebar.connectNumber}</p>}
              <label className="block">
                <span className="text-sm text-accent">{t.sidebar.numberWithCountryAndAreaCode}</span>
                <input
                  autoFocus
                  inputMode="tel"
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  placeholder="5561999999999"
                  className="mt-2 w-full border-b-2 border-accent bg-transparent pb-1.5 text-heading outline-none placeholder:text-sub"
                />
              </label>
              <p className="text-xs leading-5 text-sub">
                {t.sidebar.firstMessage} <strong>{t.composer.approvedTemplate}</strong>{t.sidebar.testNumbersNotice}
              </p>
              <button type="submit" disabled={!newInstance || newNumber.replace(/\D/g, "").length < 10} className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
                {t.sidebar.openChat}
              </button>
            </form>
        </div>
      )}
    </aside>
  );
}
