// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useRef } from "react";
import { formatPhone, isOutgoing, isRenderable, preview, type PreviewIcon } from "@/lib/messages";
import { playNotificationTone, unlockNotificationSound } from "@/lib/notification-sound";
import { usePreferences } from "@/lib/preferences";
import type { ConversationView, MessageRow } from "@/lib/types";

const icons: Record<PreviewIcon, string> = { voice: "🎤", image: "📷", video: "🎥", document: "📄", sticker: "🏷️", template: "📋", location: "📍", contact: "👤" };

export function useMessageNotifications(organizationId: string | undefined, conversations: ConversationView[], openIds: string[], onOpen: (id: string) => void) {
  const { preferences } = usePreferences();
  const startedAt = useRef(Date.now());
  const seen = useRef(new Set<string>());
  const lastSound = useRef(-Infinity);
  const notifications = useRef(new Map<string, Notification>());
  useEffect(() => {
    startedAt.current = Date.now();
    seen.current.clear();
    lastSound.current = -Infinity;
    const current = notifications.current;
    const unlock = () => { void unlockNotificationSound(); };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      current.forEach((notification) => notification.close());
      current.clear();
    };
  }, [organizationId]);

  return useCallback((message: MessageRow) => {
    if (!organizationId || message.organization_id !== organizationId || message.service !== "whatsapp" || !message.conversation_id || isOutgoing(message) || !isRenderable(message)) return;
    const content = message.content;
    if (!["text", "file"].includes(content.type) && !["template", "location", "contacts"].includes(content.kind)) return;
    const timestamp = Date.parse(message.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < startedAt.current || seen.current.has(message.id)) return;
    seen.current.add(message.id);
    if (seen.current.size > 1000) seen.current.delete(seen.current.values().next().value!);
    const foreground = document.visibilityState === "visible" && document.hasFocus();
    if (preferences.notificationSound && !(foreground && openIds.includes(message.conversation_id)) && Date.now() - lastSound.current >= 2000) {
      if (playNotificationTone()) lastSound.current = Date.now();
    }
    if (!preferences.desktopNotifications || foreground || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const id = message.conversation_id;
      const conversation = conversations.find((c) => c.memberIds.includes(id));
      const line = preview(message);
      const notification = new Notification(conversation?.displayName ?? formatPhone(message.conversation_address), {
        body: `${line.icon ? `${icons[line.icon]} ` : ""}${line.text}`,
        tag: id,
        silent: true,
      });
      notifications.current.get(id)?.close();
      notifications.current.set(id, notification);
      notification.onclose = () => { if (notifications.current.get(id) === notification) notifications.current.delete(id); };
      notification.onclick = () => { window.focus(); onOpen(id); notification.close(); };
    } catch {
      /* notifications blocked */
    }
  }, [organizationId, conversations, openIds, onOpen, preferences]);
}
