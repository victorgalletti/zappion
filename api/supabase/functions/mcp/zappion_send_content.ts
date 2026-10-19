// SPDX-License-Identifier: AGPL-3.0-only
// The message content `send_message` accepts, as zod schemas so MCP clients
// see every shape in the tool's input schema. Each one maps onto an
// OutgoingMessage part that whatsapp-dispatcher already converts for Meta.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OutgoingMessage } from "../_shared/supabase.ts";
import { MAX_STORAGE_UPLOAD_SIZE, uploadToStorage } from "../_shared/media.ts";

const replyTo = z.string().optional().describe(
  "Message id (from fetch_conversation) to reply to",
);

const text = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(4096).describe(
    "Markdown: **bold**, _italic_, ~~strike~~, `code`",
  ),
  re_message_id: replyTo,
});

const mediaKinds = ["image", "video", "audio", "document", "sticker"] as const;

// MIME type per kind when neither the caller nor the server says.
const defaultMimeType: Record<(typeof mediaKinds)[number], string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/mpeg",
  document: "application/pdf",
  sticker: "image/webp",
};

const file = z.object({
  type: z.literal("file"),
  kind: z.enum(mediaKinds),
  url: z.url({ protocol: /^https$/ }).describe(
    "Public HTTPS URL; WhatsApp downloads it. Images: JPEG or PNG only (no WebP); stickers: WebP",
  ),
  mime_type: z.string().optional().describe(
    "e.g. image/png, application/pdf; audio/ogg; codecs=opus sends a voice note",
  ),
  filename: z.string().optional().describe("Documents only"),
  caption: z.string().max(1024).optional().describe(
    "Not for audio or sticker",
  ),
  re_message_id: replyTo,
});

const location = z.object({
  type: z.literal("location"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().optional(),
  address: z.string().optional(),
  re_message_id: replyTo,
});

const contacts = z.object({
  type: z.literal("contacts"),
  contacts: z.array(z.object({
    name: z.string().min(1).describe("Full name"),
    phones: z.array(z.object({
      phone: z.string().min(1).describe("International format, e.g. +5511…"),
      type: z.string().optional().describe("CELL, WORK, HOME…"),
    })).min(1),
  })).min(1).max(10),
  re_message_id: replyTo,
});

const reaction = z.object({
  type: z.literal("reaction"),
  re_message_id: z.string().describe(
    "Message id (from fetch_conversation) to react to",
  ),
  emoji: z.string().describe("One emoji; empty string removes the reaction"),
});

const template = z.object({
  type: z.literal("template"),
  name: z.string().min(1),
  language: z.string().min(1).describe("e.g. pt_BR, en_US"),
  components: z.array(z.record(z.string(), z.unknown())).optional().describe(
    "Meta template components with parameters, e.g. [{type:'body',parameters:[{type:'text',text:'…'}]}]",
  ),
});

export const sendContent = z.discriminatedUnion("type", [
  text,
  file,
  location,
  contacts,
  reaction,
  template,
]);

export type SendContent = z.infer<typeof sendContent>;

/** Converts the tool's content into the row content the dispatcher sends. */
export function toOutgoingMessage(content: SendContent): OutgoingMessage {
  const base = { version: "1" as const };

  switch (content.type) {
    case "text":
      return {
        ...base,
        type: "text",
        kind: "text",
        text: content.text,
        re_message_id: content.re_message_id,
      };
    case "file":
      checkImageType(content.kind, content.mime_type);
      if (content.caption && ["audio", "sticker"].includes(content.kind)) {
        throw new Error(
          `A caption is not allowed on ${content.kind} messages.`,
        );
      }
      return {
        ...base,
        type: "file",
        kind: content.kind,
        file: {
          uri: content.url,
          mime_type: content.mime_type ?? defaultMimeType[content.kind],
          name: content.filename,
        },
        text: content.caption,
        re_message_id: content.re_message_id,
      };
    case "location":
      return {
        ...base,
        type: "data",
        kind: "location",
        data: {
          latitude: content.latitude,
          longitude: content.longitude,
          name: content.name,
          address: content.address,
        },
        re_message_id: content.re_message_id,
      } as OutgoingMessage;
    case "contacts":
      return {
        ...base,
        type: "data",
        kind: "contacts",
        data: content.contacts.map((c) => ({
          // Meta wants at least one name part besides the formatted name.
          name: {
            formatted_name: c.name,
            first_name: c.name.split(" ")[0],
            last_name: c.name.split(" ").slice(1).join(" ") || undefined,
          },
          phones: c.phones.map((p) => ({ phone: p.phone, type: p.type })),
        })),
        re_message_id: content.re_message_id,
      } as OutgoingMessage;
    case "reaction":
      return {
        ...base,
        type: "data",
        kind: "reaction",
        data: content.emoji
          ? { action: "added", unicode: content.emoji }
          : { action: "removed" },
        re_message_id: content.re_message_id,
      };
    case "template":
      return {
        ...base,
        type: "data",
        kind: "template",
        data: {
          name: content.name,
          language: { code: content.language, policy: "deterministic" },
          components: content.components,
        },
      } as OutgoingMessage;
  }
}

// Meta rejects WebP and other formats as an image after accepting the send
// (error 131053), so refuse a type it is known to refuse.
function checkImageType(kind: string, mimeType?: string) {
  if (
    kind === "image" && mimeType &&
    !["image/jpeg", "image/png"].includes(mimeType.split(";")[0].trim())
  ) {
    throw new Error(`Images must be JPEG or PNG, not ${mimeType}.`);
  }
}

/**
 * Downloads a file part's external URL into the organization's media storage
 * and points the part at it, as a file attached in the app is. The chat can
 * then show it, the dispatcher uploads it to Meta with its size checks, and
 * the conversation keeps the file after the link expires.
 */
export async function storeExternalMedia(
  supabase: SupabaseClient<Database>,
  orgId: string,
  content: OutgoingMessage,
): Promise<OutgoingMessage> {
  if (content.type !== "file") return content;

  const url = content.file.uri;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });

  if (!response.ok) {
    throw new Error(`Could not download ${url}: HTTP ${response.status}.`);
  }

  const declared = Number(response.headers.get("content-length"));

  if (declared > MAX_STORAGE_UPLOAD_SIZE) {
    await response.body?.cancel();
    throw new Error(`The file at ${url} is larger than the upload limit.`);
  }

  const blob = await response.blob();

  if (blob.size > MAX_STORAGE_UPLOAD_SIZE) {
    throw new Error(`The file at ${url} is larger than the upload limit.`);
  }

  // The server's type wins over the default guessed from the kind, but not
  // over a type the caller set (e.g. audio/ogg; codecs=opus for a voice note).
  const served = response.headers.get("content-type")?.split(";")[0].trim();
  const mimeType = content.file.mime_type !==
      defaultMimeType[content.kind as keyof typeof defaultMimeType]
    ? content.file.mime_type
    : served || content.file.mime_type;

  checkImageType(content.kind, served || mimeType);

  const name = content.file.name ??
    (decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") ||
      undefined);

  const uri = await uploadToStorage(
    supabase,
    orgId,
    new Blob([blob], { type: mimeType }),
    name,
  );

  return {
    ...content,
    file: { ...content.file, uri, mime_type: mimeType, size: blob.size, name },
  };
}
