// SPDX-License-Identifier: AGPL-3.0-only
// Zappion: the organization's own Meta App (Settings › Meta App).
// Admin+ and signed-in users only: API keys cannot read or change it. Secrets
// are written once and never returned; the screen gets "configured" flags.
import { HTTPException } from "jsr:@hono/hono/http-exception";
import { createUnsecureClient } from "../_shared/supabase.ts";
import * as log from "../_shared/logger.ts";
import {
  type AppCheck,
  appWebhookStatus,
  checkApp,
  checkSystemToken,
  subscribeAppWebhook,
  type TokenCheck,
  WEBHOOK_FIELDS,
  webhookCallbackUrl,
  type WebhookStatus,
} from "../_shared/zappion_whatsapp_credentials.ts";

export type MetaAppSettings = {
  app_id: string;
  has_app_secret: boolean;
  has_system_token: boolean;
  verify_token: string | null;
  /** Where Meta must send this App's webhooks; null until the server has
   * WEBHOOK_PUBLIC_URL. */
  callback_url: string | null;
  webhook_fields: string[];
  updated_at: string;
} | null;

export type MetaAppPayload = {
  organization_id: string;
  app_id: string;
  /** Omit to keep the stored secret. */
  app_secret?: string;
  /** Omit to keep the stored token; "" removes it. */
  system_user_token?: string;
};

export async function getMetaApp(
  organization_id: string,
): Promise<MetaAppSettings> {
  const { data } = await createUnsecureClient()
    .rpc("whatsapp_org_app_credentials", {
      p_organization_id: organization_id,
    })
    .maybeSingle()
    .throwOnError();

  if (!data) return null;

  const { data: row } = await createUnsecureClient()
    .from("whatsapp_apps")
    .select("updated_at")
    .eq("organization_id", organization_id)
    .single()
    .throwOnError();

  return {
    app_id: data.app_id,
    has_app_secret: !!data.app_secret,
    has_system_token: !!data.system_token,
    verify_token: data.verify_token,
    callback_url: webhookCallbackUrl(data.app_id),
    webhook_fields: WEBHOOK_FIELDS,
    updated_at: row.updated_at,
  };
}

/**
 * Validates with Meta before storing anything: the App ID + Secret must work
 * together, and a system user token must belong to that App and have the
 * WhatsApp permissions.
 */
export async function saveMetaApp(
  payload: MetaAppPayload,
): Promise<MetaAppSettings> {
  const app_id = payload.app_id?.trim();
  if (!app_id || !/^\d{5,25}$/.test(app_id)) {
    throw new HTTPException(400, { message: "app_id is a numeric id" });
  }

  const client = createUnsecureClient();
  const { data: stored } = await client
    .rpc("whatsapp_org_app_credentials", {
      p_organization_id: payload.organization_id,
    })
    .maybeSingle()
    .throwOnError();

  const new_secret = payload.app_secret?.trim() || null;
  // A stored secret only counts for the same App: a new App ID needs its own.
  const app_secret = new_secret ??
    (stored?.app_id === app_id ? stored.app_secret : null);

  if (!app_secret) {
    throw new HTTPException(400, { message: "app_secret is required" });
  }

  const app = await checkApp(app_id, app_secret);
  if (!app.ok) {
    throw new HTTPException(400, {
      message: app.message,
      cause: { reason: app.reason },
    });
  }

  const new_token = payload.system_user_token?.trim();
  if (new_token) {
    const token = await checkSystemToken(app_id, app_secret, new_token);
    if (!token.ok) {
      throw new HTTPException(400, {
        message: token.message,
        cause: { reason: token.reason },
      });
    }
  }

  const { error } = await client.rpc("whatsapp_app_save", {
    p_organization_id: payload.organization_id,
    p_app_id: app_id,
    p_app_secret: new_secret ?? undefined,
    // Changing App invalidates the old token unless a new one is given.
    p_system_token: payload.system_user_token !== undefined
      ? new_token ?? ""
      : stored && stored.app_id !== app_id
      ? ""
      : undefined,
  });

  if (error) {
    if (error.code === "23505") {
      throw new HTTPException(409, {
        message: "This Meta App is already connected to another organization",
      });
    }
    throw new HTTPException(500, {
      message: "Could not save the Meta App",
      cause: error,
    });
  }

  log.info("Meta App saved", {
    organization_id: payload.organization_id,
    app_id,
  });

  return await getMetaApp(payload.organization_id);
}

type WebhookCheck = WebhookStatus | {
  ok: false;
  reason: string;
  message: string;
};

export async function testMetaApp(
  organization_id: string,
): Promise<
  { app: AppCheck; token: TokenCheck | null; webhook: WebhookCheck | null }
> {
  const { data } = await createUnsecureClient()
    .rpc("whatsapp_org_app_credentials", {
      p_organization_id: organization_id,
    })
    .maybeSingle()
    .throwOnError();

  if (!data?.app_secret) {
    throw new HTTPException(404, { message: "No Meta App configured" });
  }

  const app = await checkApp(data.app_id, data.app_secret);
  const token = data.system_token && app.ok
    ? await checkSystemToken(data.app_id, data.app_secret, data.system_token)
    : null;
  const webhook = app.ok
    ? await appWebhookStatus(data.app_id, data.app_secret)
    : null;

  return { app, token, webhook };
}

/**
 * The "Configure automatically" button: points the App's WhatsApp webhook at
 * this install, with the organization's verify token and Zappion's fields.
 */
export async function configureMetaAppWebhook(
  organization_id: string,
): Promise<WebhookStatus> {
  const { data } = await createUnsecureClient()
    .rpc("whatsapp_org_app_credentials", {
      p_organization_id: organization_id,
    })
    .maybeSingle()
    .throwOnError();

  if (!data?.app_secret || !data.verify_token) {
    throw new HTTPException(404, { message: "No Meta App configured" });
  }

  const result = await subscribeAppWebhook(
    data.app_id,
    data.app_secret,
    data.verify_token,
  );

  if (!result.ok) {
    throw new HTTPException(result.reason === "no_public_url" ? 409 : 400, {
      message: result.message,
      cause: { reason: result.reason },
    });
  }

  log.info("Meta App webhook configured", {
    organization_id,
    app_id: data.app_id,
  });

  const status = await appWebhookStatus(data.app_id, data.app_secret);
  if ("ok" in status) {
    throw new HTTPException(502, {
      message: status.message,
      cause: { reason: status.reason },
    });
  }
  return status;
}

export async function deleteMetaApp(organization_id: string): Promise<void> {
  await createUnsecureClient()
    .rpc("whatsapp_app_delete", { p_organization_id: organization_id })
    .throwOnError();

  log.info("Meta App removed", { organization_id });
}
