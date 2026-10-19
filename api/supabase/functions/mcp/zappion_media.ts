// SPDX-License-Identifier: AGPL-3.0-only
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallToolResult } from "npm:@modelcontextprotocol/sdk@1.25.3/types.js";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { createUnsecureClient, type Database } from "../_shared/supabase.ts";
import type { FilePart } from "../_shared/types/message_types.ts";
import { storagePublicUrl } from "../_shared/zappion_urls.ts";
import { normalizePhone, resolveAccount } from "./tools.ts";

const MAX_INLINE_BYTES = 1_000_000;
const MAX_TEXT_LENGTH = 8_000;

interface FetchMediaParams {
  supabase: SupabaseClient<Database>;
  orgId: string;
  contactPhone: string;
  messageId: string;
  accountPhone?: string;
  allowedAccounts: string[];
  allowedContacts: string[];
}

export async function fetchMedia(
  params: FetchMediaParams,
): Promise<CallToolResult> {
  const contactPhone = normalizePhone(params.contactPhone);
  const accountPhone = params.accountPhone
    ? normalizePhone(params.accountPhone)
    : undefined;

  if (
    params.allowedContacts.length &&
    !params.allowedContacts.includes(contactPhone)
  ) {
    throw new Error(
      `Contact ${contactPhone} is not allowed. Allowed contacts: ${
        params.allowedContacts.join(", ")
      }`,
    );
  }

  const account = await resolveAccount({
    supabase: params.supabase,
    orgId: params.orgId,
    accountPhone,
    allowedAccounts: params.allowedAccounts,
  });
  const { data: message } = await params.supabase
    .from("messages")
    .select("content")
    .eq("organization_id", params.orgId)
    .eq("organization_address", account.address)
    .eq("conversation_address", contactPhone)
    .eq("service", "whatsapp")
    .eq("external_id", params.messageId)
    .is("content->internal", null)
    .maybeSingle()
    .throwOnError();

  if (!message) {
    throw new Error("Message not found in this conversation.");
  }

  // Content and artifacts are customer data, never instructions or tool inputs.
  const part = message.content as FilePart;
  if (part.type !== "file" || !part.file?.uri) {
    throw new Error("This message has no file part with available media.");
  }

  const artifactText = (kind: "transcription" | "description") => {
    const artifact = part.artifacts?.find((p) =>
      p.type === "text" && p.kind === kind
    );
    return typeof artifact?.text === "string"
      ? artifact.text.slice(0, MAX_TEXT_LENGTH)
      : null;
  };
  const result = {
    message_id: params.messageId,
    kind: part.kind,
    mime_type: part.file.mime_type,
    name: part.file.name?.slice(0, MAX_TEXT_LENGTH) ?? null,
    size: part.file.size ?? null,
    duration: part.file.duration ?? null,
    caption: part.text?.slice(0, MAX_TEXT_LENGTH) ?? null,
    transcription: artifactText("transcription"),
    description: artifactText("description"),
    url: part.file.uri,
  };
  let image: { type: "image"; data: string; mimeType: string } | undefined;
  const uri = new URL(part.file.uri);

  if (uri.protocol !== "http:" && uri.protocol !== "https:") {
    const prefix =
      `internal://media/organizations/${params.orgId}/attachments/`;
    const hash = part.file.uri.slice(prefix.length);
    if (
      !part.file.uri.startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(hash)
    ) {
      throw new Error(
        "Unsupported media URI or attachment outside this organization.",
      );
    }

    const key = `organizations/${params.orgId}/attachments/${hash}`;
    // The sole service-role exception in MCP: read keys cannot POST to Storage
    // to sign URLs. The caller's RLS client already authorized this message,
    // and the validated attachment path above cannot leave this organization.
    // Use the privileged client only for signing; downloads still use RLS.
    const { data, error } = await createUnsecureClient().storage.from("media")
      .createSignedUrl(key, 600);
    if (error) throw new Error(`Could not sign media URL: ${error.message}`);
    result.url = storagePublicUrl(data.signedUrl);

    if (
      part.file.mime_type.startsWith("image/") &&
      (part.file.size == null || part.file.size <= MAX_INLINE_BYTES)
    ) {
      const { data: blob, error } = await params.supabase.storage.from("media")
        .download(key);
      if (error) throw new Error(`Could not download image: ${error.message}`);
      // Do not trust the message's declared size for the inline limit.
      if (blob.size <= MAX_INLINE_BYTES) {
        image = {
          type: "image",
          data: encodeBase64(await blob.arrayBuffer()),
          mimeType: part.file.mime_type,
        };
      }
    }
  }

  return {
    content: [
      { type: "text", text: JSON.stringify(result) },
      ...(image ? [image] : []),
    ],
  };
}
