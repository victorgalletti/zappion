// SPDX-License-Identifier: AGPL-3.0-only
// Rows as the Zappion API stores them (supabase/schemas/03_models). Only the columns
// the interface reads.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface ConversationRow {
  id: string;
  organization_id: string;
  service: string;
  organization_address: string;
  address: string;
  name: string | null;
  type: string | null;
  extra: Record<string, Json> | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  service: string;
  organization_address: string;
  conversation_address: string;
  /** null = we authored it (outgoing); set = the contact did. */
  sender_address: string | null;
  external_id: string | null;
  agent_id: string | null;
  content: MessageContent;
  status: MessageStatusMap | null;
  timestamp: string;
  created_at: string;
}

export type MessageStatusMap = Partial<
  Record<"pending" | "accepted" | "sent" | "delivered" | "read" | "failed" | "typing" | "awaiting_approval" | "approved" | "rejected", string>
> & {
  errors?: { error?: { code?: number; message?: string; error_data?: { details?: string } } }[];
};

export type FileInfo = {
  mime_type: string;
  uri: string;
  name?: string;
  size?: number;
  /** Seconds, for audio we recorded; the Zappion API keeps it with the file and ignores it. */
  duration?: number;
};

export type MessageContent =
  | { version?: string; type: "text"; kind: string; text: string; re_message_id?: string }
  | { version?: string; type: "file"; kind: string; file: FileInfo; text?: string; re_message_id?: string }
  | { version?: string; type: "data"; kind: string; data: Json; text?: string; re_message_id?: string }
  | { version?: string; type: string; kind: string; re_message_id?: string; [key: string]: unknown };

export interface ContactAddressRow {
  address: string;
  organization_address: string;
  extra: { name?: string; saved_name?: string; synced?: { name?: string } } | null;
}

export interface OrganizationAddressRow {
  organization_id: string;
  address: string;
  service: string;
  status: string;
  extra: { phone_number?: string; verified_name?: string; waba_id?: string; label?: string } | null;
}

export interface AgentRow {
  id: string;
  organization_id: string;
  user_id: string;
  name: string;
  role: Role;
  picture?: string | null;
}

export type { TemplateComponent } from "./templates/types";
import type { TemplateComponent, ParameterFormat } from "./templates/types";

export interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: TemplateComponent[];
  parameter_format?: ParameterFormat;
  rejected_reason?: string;
  quality_score?: { score?: string; reason?: string; reasons?: string[] };
}

/** One conversation as the sidebar shows it. */
export interface ConversationView extends ConversationRow {
  /** Every row for this person (with and without the ninth digit); `id` is the one to reply on. */
  memberIds: string[];
  displayName: string;
  lastMessage: MessageRow | null;
  unread: number;
  archived?: boolean;
}

export type Role = "owner" | "admin" | "member";

export interface OrganizationRow {
  id: string;
  name: string;
  extra: { logo?: string; [key: string]: Json | undefined } | null;
}

export interface InvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role: Role;
  status: "pending" | "accepted" | "rejected" | "revoked";
  created_at: string;
  organization_name?: string;
  invited_by_name?: string;
}
