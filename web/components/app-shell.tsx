// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { notFound, usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseRoute, routeHref } from "@/lib/routes";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatRoom, type ChatTarget } from "@/components/chat-room";
import { OrganizationProvider } from "@/components/providers";
import { NavigationRail, NAVIGATION_WIDTH, type NavigationSection } from "@/components/navigation-rail";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { TemplatesManager } from "@/components/templates-manager";
import { MediaLibrary } from "@/components/media-library";
import { SettingsPanel } from "@/components/settings-panel";
import { ProfilePanel } from "@/components/profile-panel";
import { InvitationInbox } from "@/components/invitation-inbox";
import { instanceName } from "@/lib/instances";
import { Sidebar } from "@/components/sidebar";
import { Unselected } from "@/components/unselected";
import { useConversations, useFocusMessage, useRealtime } from "@/hooks/use-chat";
import { useWaitingApprovals } from "@/hooks/use-message-approvals";
import { useMessageNotifications } from "@/hooks/use-message-notifications";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { useSession, useWorkspace } from "@/hooks/use-session";
import { formatPhone } from "@/lib/messages";
import { useArchiveConversation, useConversationPreferences } from "@/hooks/use-conversation-preferences";
import { withConversationPreferences } from "@/lib/conversation-preferences";
import type { ConversationView } from "@/lib/types";

/** Brazilian mobiles reach the API with or without the ninth digit. */
function sameNumber(a: string, b: string) {
  const strip = (n: string) => n.replace(/^55(\d{2})9(\d{8})$/, "55$1$2");
  return a === b || strip(a) === strip(b);
}

export default function AppShell() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const route = parseRoute(pathname, searchParams.toString());
  if (!route) notFound();
  const section = route.section;
  const activeId = route.section === "chats" || route.section === "archived" ? route.conversationId : null;
  const messageId = route.section === "chats" || route.section === "archived" ? route.messageId : null;
  const navigateSection = (section: NavigationSection) => {
    setDraft(null);
    router.push(routeHref(section === "settings" ? { section, settings: "organization" }
      : section === "profile" ? { section, profile: "profile" }
      : section === "chats" || section === "archived" ? { section, conversationId: null, messageId: null }
      : { section }));
  };
  const openConversation = (id: string, destination: "chats" | "archived" = "chats") => {
    setDraft(null);
    router.push(routeHref({ section: destination, conversationId: id, messageId: null }));
  };
  const session = useSession();
  const workspace = useWorkspace(session?.user.id);
  const organizationId = workspace.data?.organizationId;
  const numbers = workspace.data?.numbers;
  const conversationQuery = useConversations(organizationId);
  const agentId = workspace.data?.agent.id;
  const preferences = useConversationPreferences(organizationId, agentId);
  const archive = useArchiveConversation(organizationId, agentId);
  const views = useMemo(() => withConversationPreferences(conversationQuery.data, preferences.data ?? []), [conversationQuery.data, preferences.data]);
  const conversations = { ...conversationQuery, data: views };
  const waitingApprovals = useWaitingApprovals(organizationId);
  const approvalConversationIds = useMemo(() => new Set((waitingApprovals.data ?? []).map((a) => a.conversation_id)), [waitingApprovals.data]);
  const approvals = waitingApprovals.data?.length ?? 0;

  const focusQuery = useFocusMessage(organizationId, messageId);
  const focusedMessage = focusQuery.data ?? null;
  const [notice, setNotice] = useState<{ conversation: ConversationView; archived: boolean } | null>(null);
  const archiveBusy = useRef(false);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => setNotice(null), [organizationId, agentId]);

  const setArchived = (conversation: ConversationView, archived: boolean) => {
    if (archiveBusy.current || !preferences.data) return;
    archiveBusy.current = true;
    setNotice(null);
    archive.mutate({ memberIds: conversation.memberIds, archived }, {
      onSuccess: () => setNotice({ conversation, archived }),
      onSettled: () => { archiveBusy.current = false; },
    });
  };
  const activeConversation = views.find((c) => c.memberIds.includes(activeId ?? ""));
  const viewportRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const panel = usePanelWidth(shellRef, NAVIGATION_WIDTH);
  /** A chat opened by number that has no conversation row yet. */
  const [draft, setDraft] = useState<{ address: string; organizationAddress: string } | null>(null);
  const conversationOpen = (section === "chats" || section === "archived") && !!(activeId || draft);

  // Mobile keyboards can shrink the visual viewport without changing dvh (Safari).
  useEffect(() => {
    const viewport = window.visualViewport;
    const shell = viewportRef.current;
    if (!conversationOpen || !viewport || !shell) return;
    const resize = () => shell.style.setProperty("--conversation-height", `${viewport.height}px`);
    resize();
    viewport.addEventListener("resize", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      shell.style.removeProperty("--conversation-height");
    };
  }, [conversationOpen, workspace.isLoading, !!workspace.data, session]);

  useEffect(() => {
    if (session === null) router.replace(`/login?next=${encodeURIComponent(pathname + (searchParams.size ? `?${searchParams.toString()}` : ""))}`);
  }, [session, router, pathname, searchParams]);

  // The first message to a new number creates its conversation; switch to it.
  useEffect(() => {
    if (!draft || section !== "chats" || activeId) return;
    const found = conversations.data.find((c) => sameNumber(c.address, draft.address) && c.organization_address === draft.organizationAddress);
    if (found) {
      router.replace(routeHref({ section: "chats", conversationId: found.id, messageId: null }));
    }
  }, [draft, conversations.data, section, activeId, router]);

  useEffect(() => {
    if (section !== "chats" || activeId) setDraft(null);
  }, [section, activeId]);

  const target = useMemo<ChatTarget | null>(() => {
    if (!organizationId) return null;
    if (focusedMessage && activeConversation) {
      const c = conversations.data.find((c) => c.memberIds.includes(focusedMessage.conversation_id ?? ""));
      const instance = numbers?.find((n) => n.address === focusedMessage.organization_address);
      return { organizationId, organizationAddress: focusedMessage.organization_address, address: focusedMessage.conversation_address,
        conversationId: focusedMessage.conversation_id ?? undefined,
        conversationIds: c?.memberIds ?? (focusedMessage.conversation_id ? [focusedMessage.conversation_id] : undefined),
        displayName: c?.displayName ?? formatPhone(focusedMessage.conversation_address),
        instanceName: instance ? instanceName(instance) : focusedMessage.organization_address };
    }
    if (draft && section === "chats" && !activeId) {
      const instance = numbers?.find((number) => number.address === draft.organizationAddress);
      return {
        organizationId,
        organizationAddress: draft.organizationAddress,
        address: draft.address,
        displayName: formatPhone(draft.address),
        instanceName: instance ? instanceName(instance) : draft.organizationAddress,
      };
    }
    const c = conversations.data.find((x) => x.memberIds.includes(activeId ?? ""));
    if (!c) return null;
    const instance = numbers?.find((number) => number.address === c.organization_address);
    return {
      organizationId,
      organizationAddress: c.organization_address,
      address: c.address,
      conversationId: c.id,
      conversationIds: c.memberIds,
      displayName: c.displayName,
      instanceName: instance ? instanceName(instance) : c.organization_address,
    };
  }, [organizationId, numbers, draft, activeId, conversations.data, focusedMessage, activeConversation, section]);

  const onIncoming = useMessageNotifications(organizationId, views, section === "chats" || section === "archived" ? target?.conversationIds ?? [] : [], (id) => {
    openConversation(id);
  });
  useRealtime(organizationId, onIncoming);

  if (session === undefined || (session && workspace.isLoading)) {
    return <div className="h-dvh bg-surface" />;
  }
  if (!session) return null;

  if (workspace.error) return <main className="flex h-dvh items-center justify-center bg-surface"><div className="space-y-4 p-6 text-center"><p className="text-danger">{t.home.couldNotLoadTheOrganization}</p><button className="text-accent" onClick={() => workspace.refetch()}>{t.home.tryAgain}</button></div></main>;
  if (!workspace.data) return <InvitationInbox userId={session.user.id} />;

  const unread = views.reduce((sum, c) => sum + (c.archived ? 0 : c.unread), 0);
  const archivedUnread = views.filter((c) => c.archived && c.unread > 0).length;

  return (
    <OrganizationProvider id={organizationId}>
      <div ref={viewportRef} className="h-dvh bg-surface max-md:h-[var(--conversation-height,100dvh)]">
        <div
          ref={shellRef}
          className={`relative flex h-full w-full overflow-hidden bg-surface ${conversationOpen ? "" : "pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0"} ${panel.dragging ? "cursor-col-resize select-none" : ""}`}
        >
          <div className="hidden shrink-0 md:flex">
            <NavigationRail section={section} onSelect={navigateSection} agent={workspace.data.agent} onOpenOrganization={() => navigateSection("settings")} onOpenProfile={() => navigateSection("profile")} organizationName={workspace.data.organizationName} organizationLogo={workspace.data.organizationLogo} unread={unread} archivedUnread={archivedUnread} approvals={approvals} />
          </div>
          {!conversationOpen && <MobileTabBar section={section} onSelect={navigateSection} agent={workspace.data.agent} unread={unread} archivedUnread={archivedUnread} approvals={approvals} />}
          {section === "settings" ? <SettingsPanel workspace={workspace.data} section={route.section === "settings" ? route.settings : "organization"} onSectionChange={(settings) => router.push(routeHref({ section: "settings", settings }))} /> : section === "profile" ? <ProfilePanel workspace={workspace.data} section={route.section === "profile" ? route.profile : "profile"} onSectionChange={(profile) => router.push(routeHref({ section: "profile", profile }))} /> : section === "templates" ? <TemplatesManager key={workspace.data.organizationId} numbers={workspace.data.numbers} /> : section === "media" ? <MediaLibrary workspace={workspace.data} onOpenMessage={(row) => {
            setDraft(null);
            if (row.conversation_id) router.push(routeHref({ section: "chats", conversationId: row.conversation_id, messageId: row.id }));
          }} /> : <>
          <div className={`${conversationOpen ? "hidden" : "flex"} min-h-0 w-full md:flex md:w-auto md:shrink-0`}>
            <Sidebar
              section={section}
              onSectionChange={navigateSection}
              numbers={workspace.data.numbers}
              conversations={preferences.data ? views : []}
              loading={conversations.isLoading || preferences.isLoading}
              onToggleArchive={(c) => setArchived(c, !c.archived)}
              archiving={archive.isPending || !preferences.data}
              approvalConversationIds={approvalConversationIds}
              activeId={activeId}
              onSelect={(c) => {
                openConversation(c.id, section === "archived" ? "archived" : "chats");
              }}
              onStartChat={(address, organizationAddress) => {
                const existing = conversations.data.find((c) => sameNumber(c.address, address) && c.organization_address === organizationAddress);
                if (existing) {
                  openConversation(existing.id);
                } else {
                  router.push(routeHref({ section: "chats", conversationId: null, messageId: null }));
                  setDraft({ address, organizationAddress });
                }
              }}
              width={panel.width}
            />
          </div>
          {/* Divider: drag to resize, arrows to nudge, double-click to reset. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t.home.resizeSidebar}
            aria-valuenow={panel.width}
            tabIndex={0}
            onPointerDown={panel.startDrag}
            onKeyDown={panel.onKeyDown}
            onDoubleClick={panel.reset}
            style={{ left: NAVIGATION_WIDTH + panel.width - 3 }}
            className={`absolute top-0 bottom-0 z-30 hidden md:block w-1.5 cursor-col-resize transition-colors outline-none hover:bg-accent/40 focus-visible:bg-accent/60 ${panel.dragging ? "bg-accent/60" : ""}`}
          />
          <div className={`${conversationOpen ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 md:flex`}>
            {target ? <ChatRoom key={target.organizationAddress + (target.conversationIds ?? [target.address]).slice().sort().join(",")} target={target} focusMessage={focusedMessage} onBack={() => navigateSection(section === "archived" ? "archived" : "chats")} onBackToRecent={() => { if (route.section === "chats" || route.section === "archived") router.replace(routeHref({ ...route, messageId: null })); }} agentId={workspace.data.agent.id} agentName={workspace.data.agent.name} archived={activeConversation?.archived} onToggleArchive={activeConversation ? () => setArchived(activeConversation, !activeConversation.archived) : undefined} archiving={archive.isPending || !preferences.data} /> : <Unselected />}
          </div>
          </>}
          {(preferences.error || archive.error) && <div role="alert" className="absolute bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 z-50 md:bottom-4 md:left-20 max-w-md rounded-xl border border-line bg-menu px-4 py-3 text-sm text-danger shadow-lg">
            {preferences.error ? t.home.couldNotLoadArchivedChats : t.home.couldNotUpdateTheArchiveStatusTheChange}
            <button type="button" className="ml-3 text-accent" onClick={() => preferences.error ? void preferences.refetch() : archive.reset()}>{preferences.error ? t.home.tryAgain : t.home.close}</button>
          </div>}
          {notice && <div role="status" className="absolute bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 z-50 md:bottom-4 md:left-20 flex items-center gap-6 rounded-xl border border-line bg-menu px-5 py-3 text-sm text-heading shadow-lg">
            <span>{notice.archived ? t.home.chatArchived : t.home.chatUnarchived}</span>
            <button type="button" className="font-medium text-accent" onClick={() => {
              const current = views.find((c) => c.memberIds.some((id) => notice.conversation.memberIds.includes(id))) ?? notice.conversation;
              setArchived(current, !notice.archived);
            }}>{t.home.undo}</button>
          </div>}
        </div>
      </div>
    </OrganizationProvider>
  );
}
