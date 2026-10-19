// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callFunction, FunctionError } from "@/lib/supabase";

export interface MetaApp {
  app_id: string;
  has_app_secret: boolean;
  has_system_token: boolean;
  verify_token: string;
  updated_at: string;
  callback_url: string | null;
  webhook_fields: string[];
}
export interface MetaAppInput { app_id: string; app_secret?: string; system_user_token?: string }
export interface MetaAppWebhook {
  callback_url: string | null;
  active: boolean;
  missing_fields: string[];
  matches: boolean;
}
export interface MetaAppTest {
  webhook: null | MetaAppWebhook | { ok: false; reason?: string; message: string };
  app: { ok: true; name: string } | { ok: false; reason?: string; message: string };
  token: null | { ok: true; scopes: string[]; expires_at: number | null } | { ok: false; reason?: string; message: string };
}
const path = "whatsapp-management/app";
const key = (id: string) => ["meta-app", id];

export function useMetaApp(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: key(organizationId), enabled,
    queryFn: () => callFunction<MetaApp | null>(`${path}?organization_id=${encodeURIComponent(organizationId)}`, "GET"),
  });
}

export function useMetaAppActions(organizationId: string) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async (input: MetaAppInput) => {
      try {
        return await callFunction<MetaApp>(path, "PUT", { organization_id: organizationId, ...input });
      } catch (error) {
        let message = error instanceof Error ? error.message : String(error);
        for (const secret of [input.app_secret, input.system_user_token].filter((value): value is string => !!value)) message = message.split(secret).join("••••••••");
        throw error instanceof FunctionError ? new FunctionError(message, error.status, error.reason) : new Error(message);
      } finally {
        // React Query retains mutation variables; erase credentials from them too.
        delete input.app_secret;
        delete input.system_user_token;
      }
    },
    onSuccess: (app) => { client.setQueryData(key(organizationId), app); },
  });
  const disconnect = useMutation({
    mutationFn: () => callFunction<void>(`${path}?organization_id=${encodeURIComponent(organizationId)}`, "DELETE"),
    onSuccess: () => { client.setQueryData(key(organizationId), null); },
  });
  const test = useMutation({ mutationFn: () => callFunction<MetaAppTest>(`${path}/test`, "POST", { organization_id: organizationId }) });
  const configureWebhook = useMutation({ mutationFn: () => callFunction<MetaAppWebhook>(`${path}/webhook`, "POST", { organization_id: organizationId }) });
  return { save, disconnect, test, configureWebhook };
}
