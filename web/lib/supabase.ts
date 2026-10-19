// SPDX-License-Identifier: AGPL-3.0-only
import { getT } from "@/lib/i18n";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export const FUNCTIONS_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;

export class FunctionError extends Error {
  constructor(message: string, public readonly status: number, public readonly reason?: string) {
    super(message);
    this.name = "FunctionError";
  }
}

/** Calls a Zappion API edge function as the signed-in agent. */
export async function callFunction<T>(path: string, method: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`${FUNCTIONS_URL}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const cause = (json as { cause?: { reason?: string; error?: { error_user_msg?: string; message?: string } } }).cause;
    throw new FunctionError(cause?.error?.error_user_msg ?? cause?.error?.message ?? (json as { message?: string }).message ?? getT().supabase.httpError(response.status), response.status, typeof cause?.reason === "string" ? cause.reason : undefined);
  }
  return json as T;
}
