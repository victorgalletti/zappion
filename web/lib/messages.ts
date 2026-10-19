// SPDX-License-Identifier: AGPL-3.0-only
import { getT } from "@/lib/i18n";
import { markdownToWhatsApp } from "./markdown";
import type { FileInfo, MessageContent, MessageRow, MessageStatusMap } from "./types";

export type DeliveryState = "awaiting_approval" | "rejected" | "sending" | "sent" | "delivered" | "read" | "failed";

/** Held by an API key that requires approval, and not yet approved, rejected or queued. */
export function isAwaitingApproval(status: MessageStatusMap | null): boolean {
  return !!status?.awaiting_approval && !status.approved && !status.rejected && !status.pending;
}

/** Collapses the Zappion API's timestamped status map into the one state a bubble shows. */
export function deliveryState(status: MessageStatusMap | null): DeliveryState {
  const s = status ?? {};
  if (s.failed) return "failed";
  if (s.rejected) return "rejected";
  if (isAwaitingApproval(s)) return "awaiting_approval";
  if (s.read) return "read";
  if (s.delivered) return "delivered";
  if (s.sent || s.accepted) return "sent";
  return "sending";
}

export function failureReason(status: MessageStatusMap | null): string | null {
  const error = status?.errors?.[0]?.error;
  if (!error) return null;
  return error.error_data?.details ?? error.message ?? null;
}

export const isOutgoing = (m: MessageRow) => !m.sender_address;

export function fileOf(content: MessageContent): FileInfo | null {
  return content.type === "file" && "file" in content ? (content.file as FileInfo) : null;
}

/** Reactions, typing markers and the like ride on the messages table but are not bubbles. */
export function isRenderable(m: MessageRow): boolean {
  const c = m.content;
  if (!c) return false;
  if (c.kind === "reaction") return false;
  if (c.type === "text" && "text" in c && !c.text) return false;
  return true;
}

export type PreviewIcon = "voice" | "image" | "video" | "document" | "sticker" | "template" | "location" | "contact";

const clock = (seconds?: number) =>
  seconds ? ` (${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")})` : "";

/** The sidebar preview, as WhatsApp words it: an icon and a short line. */
export function preview(m: MessageRow | null): { icon?: PreviewIcon; text: string } {
  if (!m) return { text: "" };
  const c = m.content;
  // Stored text is Markdown; show it the way WhatsApp would (*bold*, not **bold**).
  if (c.type === "text" && "text" in c) return { text: markdownToWhatsApp(String(c.text)) };
  if (c.type === "file") {
    const file = fileOf(c);
    const caption = "text" in c && typeof c.text === "string" && c.text ? markdownToWhatsApp(c.text) : "";
    switch (c.kind) {
      case "audio":
        return { icon: "voice", text: getT().messages.voiceMessage(clock(file?.duration)) };
      case "image":
        return { icon: "image", text: caption || getT().messages.photo };
      case "video":
        return { icon: "video", text: caption || getT().messages.video };
      case "sticker":
        return { icon: "sticker", text: getT().messages.sticker };
      default:
        return { icon: "document", text: caption || file?.name || getT().messages.document };
    }
  }
  if (c.kind === "template") {
    const data = "data" in c ? (c.data as { name?: string }) : {};
    return { icon: "template", text: data?.name ?? getT().messages.template };
  }
  if (c.kind === "location") return { icon: "location", text: getT().messages.location };
  if (c.kind === "contacts") return { icon: "contact", text: getT().messages.contact };
  return { text: "text" in c && typeof c.text === "string" ? c.text : getT().messages.message };
}

/**
 * Same person, same key: a Brazilian mobile reaches the API both with the ninth
 * digit (as people type it) and without (as Meta's wa_id often has it), and each
 * form gets its own conversation row.
 */
export function phoneKey(address: string): string {
  const d = address.replace(/\D/g, "");
  const mobile = d.match(/^55(\d{2})9?([6-9]\d{7})$/);
  return mobile ? `55${mobile[1]}${mobile[2]}` : d || address;
}

/** Bucket path for an internal:// media uri, or null for external links and Meta ids. */
export function storagePath(uri: string): string | null {
  const prefix = "internal://media/";
  return uri.startsWith(prefix) ? uri.slice(prefix.length) : null;
}

/**
 * Brazilian mobiles arrive from Meta without the ninth digit (551199887766),
 * while people type them with it. Shown the way people read them.
 */
export function formatPhone(address: string): string {
  const d = address.replace(/\D/g, "");
  const br = d.match(/^55(\d{2})(9?)(\d{4})(\d{4})$/);
  if (br) {
    // Only mobiles (first local digit 6–9) gained the nine; landlines did not.
    const nine = br[2] || (/^[6-9]/.test(br[3]) ? "9" : "");
    return `+55 ${br[1]} ${nine}${br[3]}-${br[4]}`;
  }
  if (d.length > 6) return `+${d}`;
  return address;
}
