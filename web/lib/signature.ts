// SPDX-License-Identifier: AGPL-3.0-only
import { hasFormattedText } from "./markdown";
import type { Preferences } from "./preferences";
import type { MessageContent } from "./types";

export function signatureName(preferences: Pick<Preferences, "signatureName">, agentName: string) {
  return preferences.signatureName.trim() || agentName.trim();
}

export function signMessageContent(content: MessageContent, preferences: Pick<Preferences, "signatureEnabled" | "signatureName">, agentName: string): MessageContent {
  if (!preferences.signatureEnabled || !hasFormattedText(content)) return content;
  // Stored text is Markdown: **bold**, which WhatsApp shows as *bold*.
  const prefix = `**${signatureName(preferences, agentName)}:**\n`;
  return content.text.startsWith(prefix) ? content : { ...content, text: prefix + content.text };
}
