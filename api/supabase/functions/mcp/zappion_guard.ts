// SPDX-License-Identifier: AGPL-3.0-only
// Zappion: every MCP tool call goes through `guard`. It opens a row in the
// call log (public.mcp_calls) and asks Postgres whether the call may run:
// with an API key, the key must still be live, have the tool's scope and,
// for a send, be under its hourly limits. The limits are counted in
// Postgres, so they hold across stateless edge invocations. See
// zappion_mcp_begin_call (schemas/04_functions_post_tables/04-93).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallToolResult } from "npm:@modelcontextprotocol/sdk@1.25.3/types.js";
import type { Database } from "../_shared/supabase.ts";
import * as log from "../_shared/logger.ts";

export type Scope = Database["public"]["Enums"]["zappion_api_key_scope"];
export type SendKind = "message" | "template";

export interface GuardContext {
  supabase: SupabaseClient<Database>;
  orgId: string;
}

// What zappion_mcp_begin_call returns when it refuses a call.
export interface Refusal {
  allowed: false;
  code:
    | "invalid_key"
    | "key_revoked"
    | "key_expired"
    | "insufficient_scope"
    | "rate_limited";
  message: string;
  retry_at?: string | null;
  limit?: "messages" | "templates";
  limit_per_hour?: number;
  scope?: Scope;
  required_scope?: Scope;
}

type BeginCall = { allowed: true; call_id: string } | Refusal;

interface GuardOptions<A> {
  tool: string;
  scope: Scope;
  // Set for a send: what it counts against.
  sendKind?: (args: A) => SendKind;
}

/** Wraps a tool handler with the scope check, the send limits and the log. */
export function guard<A extends Record<string, unknown>>(
  ctx: GuardContext,
  options: GuardOptions<A>,
  handler: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    const contact = typeof args.contact_phone === "string"
      ? args.contact_phone.replace(/\D/g, "") || null
      : null;

    const { data, error } = await ctx.supabase.rpc("zappion_mcp_begin_call", {
      p_organization_id: ctx.orgId,
      p_tool: options.tool,
      p_scope: options.scope,
      p_contact_phone: contact ?? undefined,
      p_send_kind: options.sendKind?.(args),
    });

    if (error) {
      throw new Error(`Could not authorize the call: ${error.message}`);
    }

    const begun = data as unknown as BeginCall;

    if (!begun.allowed) {
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: begun }) }],
      };
    }

    const finish = async (ok: boolean, message?: string) => {
      const { error } = await ctx.supabase.rpc("zappion_mcp_finish_call", {
        p_call_id: begun.call_id,
        p_ok: ok,
        p_error: message,
      });

      if (error) log.error("Could not close the MCP call log", error);
    };

    try {
      const result = await handler(args);
      await finish(!result.isError);
      return result;
    } catch (err) {
      await finish(false, err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}
